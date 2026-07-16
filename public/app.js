/* Long Lines visualizer — canvas renderer + WebSocket client.
 *
 * Layout: extensions ("switching stations") sit around a ring. A central
 * "LONG LINES / PSTN" toll hub represents the outside world. Internal calls are
 * chords across the ring; external calls are spokes to the hub. Ringing = amber
 * dashed pulse; in progress = solid green with flowing traffic dots. */

const EXTERNAL = 'EXTERNAL';
const COLORS = {
  bg: '#05080a', grid: '#0e1a17', ring: '#183028',
  amber: '#ffb62e', green: '#46f08a', cyan: '#4fd6ff',
  dim: '#4a6b62', ink: '#cfe8df', hub: '#ffb62e',
};

const canvas = document.getElementById('scope');
const ctx = canvas.getContext('2d');

let state = { stations: [], calls: [], stats: {}, now: Date.now() };
let stationPos = new Map(); // id -> {x, y}
let hub = { x: 0, y: 0, r: 0 };
let dpr = 1;

// ---- WebSocket with auto-reconnect ----------------------------------------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => setLink(true);
  ws.onclose = () => { setLink(false); setTimeout(connect, 1500); };
  ws.onerror = () => ws.close();
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state') applyState(msg);
    } catch {}
  };
}

function setLink(up) {
  const el = document.getElementById('link');
  el.textContent = up ? 'LINK ACTIVE' : 'LINK DOWN';
  el.className = 'link ' + (up ? 'up' : 'down');
}

function applyState(msg) {
  state = msg;
  document.getElementById('site').textContent = msg.site || 'BELL SYSTEM';
  document.getElementById('subtitle').textContent = msg.subtitle || '';
  document.getElementById('s-active').textContent = msg.stats.active ?? 0;
  document.getElementById('s-ringing').textContent = msg.stats.ringing ?? 0;
  document.getElementById('s-handled').textContent = msg.stats.handled ?? 0;
  document.getElementById('s-uptime').textContent = hms(msg.stats.uptimeMs ?? 0);
  layout();
}

// ---- geometry -------------------------------------------------------------
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  layout();
}

function layout() {
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) * 0.36;
  hub = { x: cx, y: cy, r: Math.max(34 * dpr, R * 0.16) };
  stationPos = new Map();
  const n = state.stations.length;
  if (!n) return;
  // Start at top, go clockwise.
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    stationPos.set(state.stations[i].id, {
      x: cx + Math.cos(a) * R,
      y: cy + Math.sin(a) * R,
      a,
    });
  }
}

function posOf(partyId) {
  if (partyId === EXTERNAL) return hub;
  return stationPos.get(partyId) || hub;
}

// ---- drawing --------------------------------------------------------------
function draw(t) {
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);

  drawGrid(w, h);
  drawRing();

  // Calls first (under the nodes), ringing under connected.
  const calls = [...state.calls].sort((a, b) => (a.state === 'connected') - (b.state === 'connected'));
  for (const c of calls) drawCall(c, t);

  for (const s of state.stations) drawStation(s, t);
  drawHub(t);

  requestAnimationFrame(draw);
}

function drawGrid(w, h) {
  const step = 46 * dpr;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}

function drawRing() {
  if (!stationPos.size) return;
  const R = Math.hypot([...stationPos.values()][0].x - hub.x, [...stationPos.values()][0].y - hub.y);
  ctx.strokeStyle = COLORS.ring;
  ctx.lineWidth = 1.5 * dpr;
  ctx.setLineDash([2 * dpr, 6 * dpr]);
  ctx.beginPath();
  ctx.arc(hub.x, hub.y, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCall(c, t) {
  const p1 = posOf(c.fromId), p2 = posOf(c.toId);
  const ringing = c.state !== 'connected';
  const color = ringing ? COLORS.amber : (c.external ? COLORS.green : COLORS.cyan);

  // Curve internal (both ends on ring) calls slightly toward center for clarity.
  const bend = c.fromId !== EXTERNAL && c.toId !== EXTERNAL;
  const mx = (p1.x + p2.x) / 2 + (bend ? (hub.x - (p1.x + p2.x) / 2) * 0.35 : 0);
  const my = (p1.y + p2.y) / 2 + (bend ? (hub.y - (p1.y + p2.y) / 2) * 0.35 : 0);

  ctx.lineWidth = (ringing ? 1.6 : 2.6) * dpr;
  ctx.strokeStyle = color;
  ctx.globalAlpha = ringing ? 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(t / 200)) : 0.85;
  if (ringing) ctx.setLineDash([6 * dpr, 7 * dpr]);
  ctx.shadowColor = color;
  ctx.shadowBlur = (ringing ? 6 : 12) * dpr;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.quadraticCurveTo(mx, my, p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // Flowing traffic dots on connected calls.
  if (!ringing) {
    const dots = 3;
    for (let i = 0; i < dots; i++) {
      const phase = ((t / 1400) + i / dots) % 1;
      const pt = quad(p1, { x: mx, y: my }, p2, phase);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10 * dpr;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.6 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    // Live duration near the midpoint.
    const dur = hms(Math.max(0, Date.now() - c.since), true);
    label(mx, my - 12 * dpr, dur, color, 11);
  }

  // External number tag near the hub end.
  const extLabel = c.fromId === EXTERNAL ? c.fromLabel : (c.toId === EXTERNAL ? c.toLabel : null);
  if (extLabel) {
    const near = c.fromId === EXTERNAL ? p1 : p2;
    const tx = near.x + (hub.x - near.x) * 0.18;
    const ty = near.y + (hub.y - near.y) * 0.18;
    label(tx, ty, extLabel, ringing ? COLORS.amber : COLORS.green, 11);
  }
}

function drawStation(s, t) {
  const p = stationPos.get(s.id);
  if (!p) return;
  const color =
    s.status === 'busy' ? COLORS.green :
    s.status === 'ringing' ? COLORS.amber : COLORS.dim;
  const active = s.status !== 'idle';
  const r = 9 * dpr;

  if (s.status === 'ringing') {
    const pr = r + (4 + 4 * Math.sin(t / 120)) * dpr;
    ring(p.x, p.y, pr, COLORS.amber, 0.5);
  }

  // node
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = active ? color : COLORS.bg;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * dpr;
  ctx.shadowColor = active ? color : 'transparent';
  ctx.shadowBlur = active ? 12 * dpr : 0;
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // labels, pushed outward from center
  const out = p.a;
  const lx = p.x + Math.cos(out) * 20 * dpr;
  const ly = p.y + Math.sin(out) * 20 * dpr;
  const alignRight = Math.cos(out) < -0.2;
  const alignLeft = Math.cos(out) > 0.2;
  ctx.textAlign = alignRight ? 'right' : alignLeft ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${13 * dpr}px "DejaVu Sans Mono", Menlo, monospace`;
  ctx.fillStyle = active ? COLORS.ink : COLORS.dim;
  ctx.fillText(s.id, lx, ly);
  // Only show the secondary label when it's a real name (not a repeat of the number).
  if (s.name && s.name !== s.id) {
    ctx.font = `${10 * dpr}px "DejaVu Sans Mono", Menlo, monospace`;
    ctx.fillStyle = COLORS.dim;
    ctx.fillText(s.name, lx, ly + 14 * dpr);
  }
  ctx.textAlign = 'start';
}

function drawHub(t) {
  const active = state.calls.some((c) => c.fromId === EXTERNAL || c.toId === EXTERNAL);
  ring(hub.x, hub.y, hub.r + 4 * dpr * (1 + 0.15 * Math.sin(t / 300)), COLORS.hub, 0.25);

  ctx.beginPath();
  ctx.arc(hub.x, hub.y, hub.r, 0, Math.PI * 2);
  ctx.fillStyle = '#120d02';
  ctx.strokeStyle = COLORS.hub;
  ctx.lineWidth = 2.5 * dpr;
  ctx.shadowColor = COLORS.hub;
  ctx.shadowBlur = (active ? 22 : 12) * dpr;
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = COLORS.hub;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${13 * dpr}px "DejaVu Sans Mono", Menlo, monospace`;
  ctx.fillText('LONG LINES', hub.x, hub.y - 6 * dpr);
  ctx.font = `${10 * dpr}px "DejaVu Sans Mono", Menlo, monospace`;
  ctx.fillStyle = COLORS.dim;
  ctx.fillText('PSTN · TOLL', hub.x, hub.y + 10 * dpr);
  ctx.textAlign = 'start';
}

// ---- small helpers --------------------------------------------------------
function ring(x, y, r, color, alpha) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function label(x, y, text, color, size) {
  ctx.font = `${size * dpr}px "DejaVu Sans Mono", Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 8 * dpr;
  ctx.fillStyle = 'rgba(5,8,10,0.85)';
  ctx.fillRect(x - w / 2, y - 8 * dpr, w, 16 * dpr);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.textAlign = 'start';
}

function quad(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

function hms(ms, short = false) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  if (short && hh === 0) return `${p(mm)}:${p(ss)}`;
  return `${p(hh)}:${p(mm)}:${p(ss)}`;
}

function tickClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  document.getElementById('clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---- boot -----------------------------------------------------------------
window.addEventListener('resize', resize);
setInterval(tickClock, 250);
tickClock();
resize();
connect();
requestAnimationFrame(draw);
