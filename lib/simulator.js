// Generates believable phone traffic so the visualizer looks alive without a PBX.
// It drives CallState with exactly the same calls the AMI adapter would, so the
// front end can't tell the difference. Great for demos and for setting up the TV
// before the AMI credentials are wired in.
import { EXTERNAL } from './state.js';

// The exhibit's published inbound number (routes to extension 501).
const INBOUND_NUMBER = '1 (720) 370-5529';

// Stand-in ghosts used only when no `services` are configured, so a fresh
// `npm start` still demonstrates the recorded-message display.
const DEMO_SERVICES = [
  { id: '201', name: 'GHOST 201' },
  { id: '202', name: 'GHOST 202' },
  { id: '203', name: 'GHOST 203' },
];

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];

export function startSimulator(state, { maxConcurrent = 5 } = {}) {
  if (state.services.size === 0) {
    for (const s of DEMO_SERVICES) state.ensureService(s.id, s.name);
  }
  const stationIds = [...state.stations.keys()];
  const serviceIds = [...state.services.keys()];
  if (stationIds.length === 0) {
    console.warn('[sim] no stations configured; nothing to simulate');
    return () => {};
  }
  let seq = 0;
  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
    return t;
  };

  // The dialplan only rings a phone whose DEVICE_STATE is NOT_INUSE, so a phone
  // is never in two calls at once. Mirror that here.
  function freeStations() {
    const busy = new Set();
    for (const c of state.calls.values()) { busy.add(c.fromId); busy.add(c.toId); }
    return stationIds.filter((id) => !busy.has(id));
  }

  // Mirrors the Hello! exhibit dialplan (dmdinteractive/Hello_Exhibit_PBX):
  //   · a visitor lifts a handset -> PLAR dials 500 -> 75% a random real phone,
  //     25% a ghost. Visitors can never dial out.
  //   · the only outside traffic is INBOUND via 501, and it reaches real phones
  //     only — never a ghost.
  function launchCall() {
    const free = freeStations();
    if (!free.length) return;
    const id = `sim-${++seq}`;
    let call;

    if (Math.random() < 0.15) {
      // Inbound from the exhibit's published number, via extension 501.
      call = { id, fromId: EXTERNAL, toId: pick(free), fromLabel: INBOUND_NUMBER, toLabel: null, external: true };
    } else {
      // A visitor lifts a handset: extension 500 rolls the dice.
      const from = pick(free);
      if (serviceIds.length && Math.random() < 0.25) {
        call = { id, fromId: from, toId: pick(serviceIds), fromLabel: null, toLabel: null, external: false };
      } else {
        const rest = free.filter((s) => s !== from);
        if (!rest.length) return; // no other free phone to ring
        call = { id, fromId: from, toId: pick(rest), fromLabel: null, toLabel: null, external: false };
      }
    }

    state.startCall({ ...call, state: 'ringing' });

    // Ring 2–6s, then answer (~75%) or give up. Recordings always "answer".
    const isService = state.isService(call.toId);
    const ringMs = isService ? 1200 + rnd(1200) : 2000 + rnd(4000);
    later(() => {
      if (isService || Math.random() < 0.75) {
        state.updateCall(id, { state: 'connected' });
        const talkMs = isService ? 8000 + rnd(20000) : 6000 + rnd(45000);
        later(() => state.endCall(id), talkMs);
      } else {
        state.endCall(id); // no answer / abandoned
      }
    }, ringMs);
  }

  const tick = setInterval(() => {
    if (state.calls.size < maxConcurrent && Math.random() < 0.7) launchCall();
  }, 2200);
  timers.add(tick);

  later(launchCall, 400);
  later(launchCall, 1400);
  later(launchCall, 2400);

  console.log(`[sim] simulating traffic across ${stationIds.length} stations, ${serviceIds.length} recordings`);

  return function stop() {
    clearInterval(tick);
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}
