// Generates believable phone traffic so the visualizer looks alive without a PBX.
// It drives CallState with exactly the same calls the AMI adapter would, so the
// front end can't tell the difference. Great for demos and for setting up the TV
// before the AMI credentials are wired in.
import { EXTERNAL } from './state.js';

const OUTSIDE_NUMBERS = [
  '1 (212) 555-0147', '1 (415) 555-0192', '1 (312) 555-0168',
  '1 (617) 555-0133', '1 (206) 555-0119', '1 (305) 555-0176',
  '1 (404) 555-0158', '1 (702) 555-0184', '1 (800) 555-0100',
];

// Stand-in recordings used only when no `services` are configured, so a fresh
// `npm start` still demonstrates the recorded-message display.
const DEMO_SERVICES = [
  { id: '9001', name: 'HELLO! GREETING' },
  { id: '9002', name: 'TIME-OF-DAY' },
  { id: '9003', name: 'DIAL-A-JOKE' },
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

  function twoDistinctStations() {
    const a = pick(stationIds);
    let b = pick(stationIds);
    let guard = 0;
    while (b === a && guard++ < 10) b = pick(stationIds);
    return [a, b];
  }

  function launchCall() {
    const id = `sim-${++seq}`;
    const roll = Math.random();
    let call;

    if (roll < 0.3 && serviceIds.length) {
      // Someone calls a recorded message — from a station or from outside.
      const svc = pick(serviceIds);
      if (Math.random() < 0.5) {
        const num = pick(OUTSIDE_NUMBERS);
        call = { id, fromId: EXTERNAL, toId: svc, fromLabel: num, toLabel: null, external: true };
      } else {
        call = { id, fromId: pick(stationIds), toId: svc, fromLabel: null, toLabel: null, external: false };
      }
    } else if (roll < 0.5) {
      // Inbound from the outside world to a station.
      call = { id, fromId: EXTERNAL, toId: pick(stationIds), fromLabel: pick(OUTSIDE_NUMBERS), toLabel: null, external: true };
    } else if (roll < 0.75) {
      // Outbound from a station to the outside world.
      call = { id, fromId: pick(stationIds), toId: EXTERNAL, fromLabel: null, toLabel: pick(OUTSIDE_NUMBERS), external: true };
    } else {
      // Internal station-to-station.
      const [from, to] = twoDistinctStations();
      call = { id, fromId: from, toId: to, fromLabel: null, toLabel: null, external: false };
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
