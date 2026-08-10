// Minimal Asterisk Manager Interface (AMI) client + translator.
//
// AMI is a simple line-based TCP protocol on port 5038. After logging in we
// receive a stream of events; we watch the ones that describe call lifecycle
// (Dial*, Bridge*, Hangup) and translate them into CallState calls.
//
// Recorded messages (announcements/IVR) are special: Asterisk usually plays them
// on the caller's own channel rather than dialing a second channel, so there's no
// Bridge to watch. Instead we look at the extension a channel landed on — if it
// matches one of the configured `services`, we render it as a call into that
// recording. Configure those numbers in config.json under "services".
//
// This targets ordinary two-party calls, which covers the vast majority of
// traffic. It auto-reconnects if the link drops.
import net from 'node:net';
import { EXTERNAL } from './state.js';
import { LINK } from '../pbx.js';

// "PJSIP/1001-00000abc" -> "1001" ; "SIP/trunk_provider-0000001" -> "trunk_provider"
function endpointOf(channel) {
  if (!channel) return null;
  const m = /^[^/]+\/([^-]+)(?:-[0-9a-f]+)?$/i.exec(channel);
  return m ? m[1] : channel;
}

// "PJSIP/9001@ctx" / "Local/9001@from-internal" / "9001" -> "9001"
function dialTargetOf(dialString) {
  if (!dialString) return null;
  return String(dialString).split('/').pop().split('@')[0].trim() || null;
}

// "Local/201@from-internal-00000001;1" -> "201"
// Ghost/announcement legs are Local channels; the extension they run is the
// only thing that identifies them, since the channel has no real endpoint.
function localTargetOf(channel) {
  const m = /^Local\/([^@]+)@/i.exec(channel || '');
  return m ? m[1] : null;
}
function isLocalChannel(channel) {
  return /^Local\//i.test(channel || '');
}

export function startAmi(state, amiCfg, opts = {}) {
  const tune = { ...LINK, ...opts };
  // Map a channel to a party id the visualizer understands: a known station, a
  // recorded message, or EXTERNAL (routed to the Long Lines toll gateway).
  const partyOf = (channel) => {
    // A ghost/announcement is dialed as Local/<exten>@context, so resolve it by
    // the extension in the channel name rather than by endpoint.
    const lt = localTargetOf(channel);
    if (lt) {
      if (state.isService(lt)) return String(lt);
      if (state.isStation(lt)) return String(lt);
      return EXTERNAL;
    }
    const ep = endpointOf(channel);
    if (state.isStation(ep)) return String(ep);
    if (state.isService(ep)) return String(ep);
    return EXTERNAL;
  };

  const channels = new Map(); // uniqueid -> { channel, party, cidNum, cidName, exten, up, callId }
  const bridges = new Map(); // bridgeId -> Set(uniqueid)
  const bridgeCallId = new Map(); // bridgeId -> the call id that bridge represents

  // --- link management ------------------------------------------------------
  // The exhibit runs unattended for months, so every way this link can die has
  // to be survivable: a refused connection, a switch reboot, a pulled cable, a
  // silently half-open TCP socket, and a login the switch rejects.
  let socket = null;
  let stopped = false;
  let buffer = '';
  let attempt = 0;          // consecutive failures, drives the backoff
  let authed = false;
  let lastRxAt = 0;         // last time the switch said anything at all
  let actionSeq = 0;
  let loginActionId = null;
  let retryTimer = null;
  let heartbeatTimer = null;

  const clearTimer = (t) => { if (t) clearTimeout(t); };

  // Exponential backoff with jitter, so a switch coming back after an outage
  // isn't hit by every retry landing on the same tick.
  function backoffMs() {
    const base = Math.min(tune.backoffMaxMs, tune.backoffMinMs * 2 ** Math.max(0, attempt - 1));
    return Math.round(base * (0.8 + Math.random() * 0.4));
  }

  function send(action) {
    if (!socket || socket.destroyed) return null;
    const id = `pbxv-${++actionSeq}`;
    let out = `ActionID: ${id}\r\n`;
    for (const [k, v] of Object.entries(action)) out += `${k}: ${v}\r\n`;
    try { socket.write(out + '\r\n'); } catch { return null; }
    return id;
  }

  // Tear the socket down and schedule the next attempt. Every failure path
  // funnels through here so there is exactly one reconnect timer in flight.
  function dropAndRetry(why, { authFailure = false } = {}) {
    if (stopped) return;
    clearTimer(heartbeatTimer); heartbeatTimer = null;
    if (socket) {
      const s = socket;
      socket = null;
      s.removeAllListeners();
      s.destroy();
    }
    buffer = '';
    authed = false;

    // Losing the feed means losing track of what is up; keeping the old arcs
    // would leave phantom calls lit on the TV forever.
    channels.clear();
    bridges.clear();
    bridgeCallId.clear();
    state.clearCalls();

    if (authFailure) {
      state.setLink('auth-failed', why);
    } else {
      state.setLink('down', why);
    }

    if (retryTimer) return; // one retry in flight is enough
    const wait = authFailure ? tune.authBackoffMs : backoffMs();
    console.warn(`[ami] ${why} — retrying in ${Math.round(wait / 1000)}s`);
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, wait);
  }

  function startHeartbeat() {
    clearTimer(heartbeatTimer);
    const tick = () => {
      if (stopped || !socket) return;
      // A half-open TCP socket accepts writes forever and never delivers data.
      // Silence, not a write error, is what proves the switch is gone.
      if (lastRxAt && Date.now() - lastRxAt > tune.silenceTimeoutMs) {
        return dropAndRetry(`no traffic from the switch for ${Math.round(tune.silenceTimeoutMs / 1000)}s`);
      }
      send({ Action: 'Ping' });
      heartbeatTimer = setTimeout(tick, tune.heartbeatMs);
    };
    heartbeatTimer = setTimeout(tick, tune.heartbeatMs);
  }

  function connect() {
    if (stopped) return;
    attempt++;
    state.setLink('connecting', `${amiCfg.host}:${amiCfg.port}`);

    const s = net.createConnection({ host: amiCfg.host, port: amiCfg.port });
    socket = s;
    buffer = '';
    lastRxAt = 0;

    // Only guards the connect + login phase; the heartbeat takes over after.
    s.setTimeout(tune.connectTimeoutMs, () => {
      if (socket === s && !authed) dropAndRetry('timed out connecting or logging in');
    });

    s.on('connect', () => {
      if (socket !== s) return;
      s.setTimeout(0);
      s.setNoDelay(true);
      s.setKeepAlive(true, 10000); // let the kernel notice a vanished peer too
      lastRxAt = Date.now();
      console.log(`[ami] connected to ${amiCfg.host}:${amiCfg.port}, logging in as ${amiCfg.username}`);
      state.setLink('authenticating', amiCfg.username);
      loginActionId = send({
        Action: 'Login',
        Username: amiCfg.username,
        Secret: amiCfg.secret,
        Events: 'call,system',
      });
      // The login reply is itself the proof the link works end to end.
      s.setTimeout(tune.connectTimeoutMs, () => {
        if (socket === s && !authed) dropAndRetry('the switch never answered the login');
      });
    });

    s.on('data', (chunk) => {
      if (socket !== s) return;
      lastRxAt = Date.now();
      buffer += chunk.toString('utf8');
      // Something that is not AMI is talking to us; don't grow forever.
      if (buffer.length > 1e6) {
        return dropAndRetry('the switch sent 1MB with no message boundary');
      }
      let idx;
      while ((idx = buffer.indexOf('\r\n\r\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 4);
        if (block.trim()) handleBlock(parseBlock(block));
      }
    });

    s.on('error', (err) => {
      if (socket === s) dropAndRetry(`socket error: ${err.message}`);
    });
    s.on('close', () => {
      if (socket === s) dropAndRetry('the switch closed the connection');
    });
  }

  function parseBlock(block) {
    const obj = {};
    for (const line of block.split('\r\n')) {
      const i = line.indexOf(':');
      if (i === -1) continue;
      obj[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return obj;
  }

  // A channel sitting on a recorded-message extension becomes a call into it.
  function maybeStartServiceCall(uid) {
    const rec = channels.get(uid);
    if (!rec || rec.callId) return; // already accounted for by a dial/bridge
    // Local legs are the recording itself, not a caller — the Dial that created
    // them is already drawn, so don't invent a second call here.
    if (isLocalChannel(rec.channel)) return;
    if (!rec.exten || !state.isService(rec.exten)) return;
    if (state.isService(rec.party)) return;
    const callId = `svc-${uid}`;
    rec.callId = callId;
    const fromParty = rec.party || EXTERNAL;
    state.startCall({
      id: callId,
      fromId: fromParty,
      toId: String(rec.exten),
      fromLabel: fromParty === EXTERNAL ? rec.cidNum || 'OUTSIDE LINE' : null,
      toLabel: null,
      state: rec.up ? 'connected' : 'ringing',
      external: fromParty === EXTERNAL,
    });
  }

  function handleBlock(e) {
    if (e.Response) {
      const isLogin = e.ActionID && e.ActionID === loginActionId;
      if (e.Response === 'Error') {
        if (isLogin) {
          // Wrong secret, or this Pi's IP is not in the manager user's Permit
          // list. Hammering the switch won't fix either, so back off hard.
          console.error(`[ami] LOGIN REJECTED: ${e.Message || 'authentication failed'}`);
          console.error(`[ami] check the secret in pbx.js, and that ${amiCfg.username} permits this host`);
          return dropAndRetry(e.Message || 'authentication failed', { authFailure: true });
        }
        console.warn('[ami] error response:', e.Message);
        return;
      }
      if (isLogin) {
        authed = true;
        attempt = 0; // a good login resets the backoff
        loginActionId = null;
        if (socket) socket.setTimeout(0);
        console.log('[ami] authenticated; watching call events');
        state.setLink('up', `${amiCfg.host}:${amiCfg.port}`);
        startHeartbeat();
      }
      return; // Pong and other action replies need no further handling
    }
    switch (e.Event) {
      case 'Newchannel':
      case 'Newstate': {
        const uid = e.Uniqueid;
        if (!uid) break;
        const rec = channels.get(uid) || {};
        rec.channel = e.Channel || rec.channel;
        rec.party = partyOf(e.Channel || rec.channel);
        if (e.Exten && e.Exten !== 's') rec.exten = e.Exten;
        if (e.CallerIDNum && e.CallerIDNum !== '<unknown>') rec.cidNum = e.CallerIDNum;
        if (e.CallerIDName && e.CallerIDName !== '<unknown>') rec.cidName = e.CallerIDName;
        if (e.ChannelStateDesc === 'Up' || e.ChannelState === '6') rec.up = true;
        rec.seenAt = Date.now();
        channels.set(uid, rec);

        maybeStartServiceCall(uid);
        // Promote a ringing recording to connected once the channel answers.
        if (rec.up && rec.callId && rec.callId.startsWith('svc-')) {
          state.updateCall(rec.callId, { state: 'connected' });
        }
        break;
      }

      case 'DialBegin': {
        const callerUid = e.Uniqueid;
        const destUid = e.DestUniqueid || `${callerUid}:dest`;
        const callId = `dial-${destUid}`;
        const fromParty = partyOf(e.Channel);

        // Dialing straight into a recording (e.g. Local/9001@from-internal)?
        const target = dialTargetOf(e.DialString);
        const toParty = state.isService(target) ? String(target) : partyOf(e.DestChannel);

        const fromLabel = fromParty === EXTERNAL ? e.CallerIDNum || 'OUTSIDE LINE' : null;
        const toLabel = toParty === EXTERNAL ? e.DialString || 'OUTSIDE LINE' : null;
        if (channels.get(callerUid)) channels.get(callerUid).callId = callId;
        if (channels.get(destUid)) channels.get(destUid).callId = callId;
        state.startCall({
          id: callId,
          fromId: fromParty,
          toId: toParty,
          fromLabel,
          toLabel,
          state: 'ringing',
          external: fromParty === EXTERNAL || toParty === EXTERNAL,
        });
        break;
      }

      case 'DialEnd': {
        const destUid = e.DestUniqueid || `${e.Uniqueid}:dest`;
        const callId = `dial-${destUid}`;
        if (e.DialStatus && e.DialStatus !== 'ANSWER') state.endCall(callId);
        else state.updateCall(callId, { state: 'connected' });
        break;
      }

      case 'BridgeEnter': {
        const uid = e.Uniqueid;
        const bId = e.BridgeUniqueid;
        if (!uid || !bId) break;
        if (!bridges.has(bId)) bridges.set(bId, new Set());
        bridges.get(bId).add(uid);
        const members = [...bridges.get(bId)];
        if (members.length >= 2) {
          const [aUid, bUid] = members.slice(-2);
          const a = channels.get(aUid) || {};
          const b = channels.get(bUid) || {};

          // If a Dial already described this conversation, promote THAT call to
          // connected. Creating a fresh bridge-* call here would draw a second
          // arc for one call and orphan the dial-* one forever.
          const existing = a.callId || b.callId;
          if (existing) {
            if (channels.get(aUid)) channels.get(aUid).callId = existing;
            if (channels.get(bUid)) channels.get(bUid).callId = existing;
            bridgeCallId.set(bId, existing);
            state.updateCall(existing, { state: 'connected' });
            break;
          }

          const callId = `bridge-${bId}`;
          if (channels.get(aUid)) channels.get(aUid).callId = callId;
          if (channels.get(bUid)) channels.get(bUid).callId = callId;
          bridgeCallId.set(bId, callId);
          const fromParty = a.party || EXTERNAL;
          const toParty = b.party || EXTERNAL;
          state.startCall({
            id: callId,
            fromId: fromParty,
            toId: toParty,
            fromLabel: fromParty === EXTERNAL ? a.cidNum || 'OUTSIDE LINE' : null,
            toLabel: toParty === EXTERNAL ? b.cidNum || 'OUTSIDE LINE' : null,
            state: 'connected',
            external: fromParty === EXTERNAL || toParty === EXTERNAL,
          });
        }
        break;
      }

      case 'BridgeLeave': {
        const bId = e.BridgeUniqueid;
        const uid = e.Uniqueid;
        if (bridges.has(bId)) {
          bridges.get(bId).delete(uid);
          if (bridges.get(bId).size < 2) {
            state.endCall(bridgeCallId.get(bId) || `bridge-${bId}`);
            if (bridges.get(bId).size === 0) {
              bridges.delete(bId);
              bridgeCallId.delete(bId);
            }
          }
        }
        break;
      }

      case 'Hangup': {
        const uid = e.Uniqueid;
        const rec = channels.get(uid);
        if (rec?.callId) state.endCall(rec.callId);
        channels.delete(uid);
        break;
      }
    }
  }

  // Asterisk can drop a Hangup (a crash, a missed reconnect window). Without a
  // sweep those records accumulate for the life of the process.
  const sweepTimer = setInterval(() => {
    const cutoff = Date.now() - 6 * 3600 * 1000;
    for (const [uid, rec] of channels) if ((rec.seenAt ?? 0) < cutoff) channels.delete(uid);
  }, 3600 * 1000);

  connect();

  return function stop() {
    stopped = true;
    clearTimer(retryTimer);
    clearTimer(heartbeatTimer);
    clearInterval(sweepTimer);
    if (socket) {
      try { send({ Action: 'Logoff' }); } catch {}
      socket.destroy();
      socket = null;
    }
    state.setLink('down', 'stopped');
  };
}
