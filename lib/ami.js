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

export function startAmi(state, amiCfg, { reconnectMs = 5000 } = {}) {
  // Map a channel to a party id the visualizer understands: a known station,
  // or EXTERNAL (routed to the Long Lines toll gateway).
  const partyOf = (channel) => {
    const ep = endpointOf(channel);
    return state.isStation(ep) ? String(ep) : EXTERNAL;
  };

  const channels = new Map(); // uniqueid -> { channel, party, cidNum, cidName, exten, up, callId }
  const bridges = new Map(); // bridgeId -> Set(uniqueid)

  let socket = null;
  let stopped = false;
  let buffer = '';

  function send(action) {
    if (!socket) return;
    let out = '';
    for (const [k, v] of Object.entries(action)) out += `${k}: ${v}\r\n`;
    socket.write(out + '\r\n');
  }

  function connect() {
    if (stopped) return;
    socket = net.createConnection({ host: amiCfg.host, port: amiCfg.port }, () => {
      console.log(`[ami] connected to ${amiCfg.host}:${amiCfg.port}, logging in as ${amiCfg.username}`);
      send({ Action: 'Login', Username: amiCfg.username, Secret: amiCfg.secret, Events: 'call,system' });
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\r\n\r\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 4);
        if (block.trim()) handleBlock(parseBlock(block));
      }
    });

    socket.on('error', (err) => console.warn('[ami] socket error:', err.message));
    socket.on('close', () => {
      socket = null;
      if (stopped) return;
      console.warn(`[ami] disconnected; retrying in ${reconnectMs / 1000}s`);
      setTimeout(connect, reconnectMs);
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
    if (!rec.exten || !state.isService(rec.exten)) return;
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
    if (e.Response === 'Error') {
      console.warn('[ami] error response:', e.Message);
      return;
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
          const callId = `bridge-${bId}`;
          if (channels.get(aUid)) channels.get(aUid).callId = callId;
          if (channels.get(bUid)) channels.get(bUid).callId = callId;
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
            state.endCall(`bridge-${bId}`);
            if (bridges.get(bId).size === 0) bridges.delete(bId);
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

  connect();

  return function stop() {
    stopped = true;
    if (socket) {
      try { send({ Action: 'Logoff' }); } catch {}
      socket.destroy();
    }
  };
}
