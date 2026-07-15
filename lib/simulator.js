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

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];

export function startSimulator(state, { maxConcurrent = 4 } = {}) {
  const stationIds = [...state.stations.keys()];
  if (stationIds.length === 0) {
    console.warn('[sim] no stations configured; nothing to simulate');
    return () => {};
  }
  let seq = 0;
  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
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

    if (roll < 0.4) {
      // Inbound from the outside world to a station.
      const to = pick(stationIds);
      const num = pick(OUTSIDE_NUMBERS);
      call = { id, fromId: EXTERNAL, toId: to, fromLabel: num, toLabel: null, external: true };
    } else if (roll < 0.75) {
      // Outbound from a station to the outside world.
      const from = pick(stationIds);
      const num = pick(OUTSIDE_NUMBERS);
      call = { id, fromId: from, toId: EXTERNAL, fromLabel: null, toLabel: num, external: true };
    } else {
      // Internal station-to-station.
      const [from, to] = twoDistinctStations();
      call = { id, fromId: from, toId: to, fromLabel: null, toLabel: null, external: false };
    }

    state.startCall({ ...call, state: 'ringing' });

    // Ring 2–6s, then answer (~70%) or give up.
    const ringMs = 2000 + rnd(4000);
    later(() => {
      if (Math.random() < 0.7) {
        state.updateCall(id, { state: 'connected' });
        const talkMs = 6000 + rnd(45000); // 6–51s conversation
        later(() => state.endCall(id), talkMs);
      } else {
        state.endCall(id); // no answer / abandoned
      }
    }, ringMs);
  }

  // Keep a healthy amount of traffic on screen.
  const tick = setInterval(() => {
    if (state.calls.size < maxConcurrent && Math.random() < 0.7) launchCall();
  }, 2500);
  timers.add(tick);

  // Seed a couple immediately so the screen isn't empty on load.
  later(launchCall, 400);
  later(launchCall, 1600);

  console.log(`[sim] simulating traffic across ${stationIds.length} stations`);

  return function stop() {
    clearInterval(tick);
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}
