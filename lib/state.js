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
    this.stations = new Map(); // id -> { id, name }
    this.services = new Map(); // id -> { id, name }
    this.calls = new Map(); // callId -> call
    for (const s of stations) this.stations.set(String(s.id), { id: String(s.id), name: s.name || String(s.id) });
    for (const s of services) this.services.set(String(s.id), { id: String(s.id), name: s.name || String(s.id) });
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

  startCall({ id, fromId, toId, fromLabel, toLabel, state = 'ringing', external = false }) {
    id = String(id);
    const existing = this.calls.get(id);
    if (!existing) this.handled++;
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
