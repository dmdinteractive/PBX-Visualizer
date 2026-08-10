// CallState: the single source of truth for what's happening on the phone system.
// Both the AMI adapter (real PBX) and the simulator feed it the same way, and it
// emits a 'change' event whenever the picture changes. The web server serializes
// snapshot() to every connected browser.
//
// Three kinds of party can appear on a call:
//   * a station   — one of your extensions (config.stations)
//   * a service   — a recorded message / announcement (config.services)
//   * EXTERNAL    — anything else, i.e. the outside world via the toll gateway
import { EventEmitter } from 'node:events';

export const EXTERNAL = 'EXTERNAL'; // sentinel party id for anything outside our system

export class CallState extends EventEmitter {
  constructor(stations = [], services = []) {
    super();
    this.startedAt = Date.now();
    this.handled = 0; // total calls seen since boot
    // What the board's "Switch link" readout actually reports. Set by whichever
    // source is running, so it describes the PBX link and not the browser's
    // WebSocket. See lib/ami.js for the status vocabulary.
    this.link = { status: 'down', detail: 'starting', since: Date.now() };
    this.stations = new Map(); // id -> { id, name }
    this.services = new Map(); // id -> { id, name }
    this.calls = new Map(); // callId -> call
    for (const s of stations) this.stations.set(String(s.id), { id: String(s.id), name: s.name || String(s.id) });
    for (const s of services) this.services.set(String(s.id), { id: String(s.id), name: s.name || String(s.id) });
  }

  // status: 'up' | 'connecting' | 'authenticating' | 'auth-failed' | 'down' | 'simulate'
  setLink(status, detail = '') {
    if (this.link.status === status && this.link.detail === detail) return;
    this.link = { status, detail, since: Date.now() };
    this._changed();
  }

  isStation(id) {
    return id != null && this.stations.has(String(id));
  }

  isService(id) {
    return id != null && this.services.has(String(id));
  }

  ensureStation(id, name) {
    id = String(id);
    if (!this.stations.has(id)) {
      this.stations.set(id, { id, name: name || id });
      this._changed();
    }
  }

  ensureService(id, name) {
    id = String(id);
    if (!this.services.has(id)) {
      this.services.set(id, { id, name: name || id });
      this._changed();
    }
  }

  // Used by the admin UI to swap the plant out from under a running board.
  setStations(list) {
    this.stations = new Map();
    for (const s of list) this.stations.set(String(s.id), { id: String(s.id), name: s.name || String(s.id) });
    this._changed();
  }

  setServices(list) {
    this.services = new Map();
    for (const s of list) this.services.set(String(s.id), { id: String(s.id), name: s.name || String(s.id) });
    this._changed();
  }

  clearCalls() {
    this.calls.clear();
    this._changed();
  }

  startCall({ id, fromId, toId, fromLabel, toLabel, state = 'ringing', external = false }) {
    id = String(id);
    const existing = this.calls.get(id);
    // 'call' fires once per genuinely new call — what the daily traffic graph
    // counts. Re-announcing an existing call (ringing -> connected) must not.
    if (!existing) {
      this.handled++;
      this.emit('call', { id, fromId: String(fromId), toId: String(toId), external });
    }
    this.calls.set(id, {
      id,
      fromId: String(fromId),
      toId: String(toId),
      fromLabel: fromLabel || String(fromId),
      toLabel: toLabel || String(toId),
      state,
      external,
      since: existing?.since ?? Date.now(),
      _answered: existing?._answered,
    });
    this._changed();
  }

  updateCall(id, patch) {
    id = String(id);
    const call = this.calls.get(id);
    if (!call) return;
    Object.assign(call, patch);
    // A call transitioning to 'connected' resets its timer to the answer moment.
    if (patch.state === 'connected' && !call._answered) {
      call._answered = true;
      call.since = Date.now();
    }
    this._changed();
  }

  endCall(id) {
    if (this.calls.delete(String(id))) this._changed();
  }

  statusOf(partyId) {
    let ringing = false;
    for (const c of this.calls.values()) {
      if (c.fromId !== partyId && c.toId !== partyId) continue;
      if (c.state === 'connected') return 'busy';
      if (c.state === 'ringing') ringing = true;
    }
    return ringing ? 'ringing' : 'idle';
  }

  snapshot() {
    const stations = [...this.stations.values()].map((s) => ({
      id: s.id, name: s.name, status: this.statusOf(s.id),
    }));
    const services = [...this.services.values()].map((s) => ({
      id: s.id, name: s.name, status: this.statusOf(s.id),
    }));
    const calls = [...this.calls.values()].map((c) => ({
      id: c.id,
      fromId: c.fromId,
      toId: c.toId,
      fromLabel: c.fromLabel,
      toLabel: c.toLabel,
      state: c.state,
      external: c.external,
      since: c.since,
    }));

    let active = 0, ringing = 0, messages = 0;
    for (const c of calls) {
      if (c.state === 'connected') {
        active++;
        if (this.isService(c.fromId) || this.isService(c.toId)) messages++;
      } else if (c.state === 'ringing') ringing++;
    }

    return {
      type: 'state',
      now: Date.now(),
      site: this.site,
      subtitle: this.subtitle,
      exhibit: this.exhibit,
      officeName: this.officeName,
      messagesName: this.messagesName,
      tollName: this.tollName,
      link: this.link,
      traffic: this.traffic ? this.traffic.snapshot() : null,
      stations,
      services,
      calls,
      stats: { active, ringing, messages, handled: this.handled, uptimeMs: Date.now() - this.startedAt },
    };
  }

  _changed() {
    this.emit('change');
  }
}
