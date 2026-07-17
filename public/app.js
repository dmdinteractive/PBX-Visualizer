/* HELLO! — Live Telephony Diagram.
 *
 * Monochrome line-art after the CMD Networking Telephony Diagram. The plant is
 * drawn once in black; a live call is shown not by a new line but by lighting
 * up the EXISTING subscriber lines it connects, in a shared Western Electric
 * colour (from the 6/83 colour chart). Follow a colour from a phone, through
 * the CENTRAL SWITCHING OFFICE, to the other phone to read a connection.
 *
 *   open circle = on-hook · filled = in use · double ring = ringing
 */

const EXTERNAL = 'EXTERNAL';
const INK = '#000000';
const PAPER = '#ffffff';
const FONT_STACK = `"Prestige Elite Std", "Courier Prime", "Courier New", Courier, monospace`;

// Western Electric telephone colours (code · name · hex), curated for contrast
// on white and ordered so consecutive calls get maximally different colours.
const WE = [
  { code: '-115', name: 'ROYAL BLUE', hex: '#2f66ad' },
  { code: '-114', name: 'BRIGHT RED', hex: '#d8443a' },
  { code: '-111', name: 'HARVEST GOLD', hex: '#e0a72b' },
  { code: '-105', name: 'DARK GREEN', hex: '#3f7a45' },
  { code: '-112', name: 'ORANGE', hex: '#f47b2a' },
  { code: '-59', name: 'ROSE PINK', hex: '#ef83ad' },
  { code: '-64', name: 'TURQUOISE', hex: '#1fa899' },
  { code: '-104', name: 'CHOCOLATE BROWN', hex: '#6b4a2f' },
  { code: '-106', name: 'LIME GREEN', hex: '#6fb52e' },
  { code: '-76', name: 'MUTED BLUE', hex: '#6d9ac2' },
  { code: '-53', name: 'CHERRY RED', hex: '#a23a48' },
  { code: '-100', name: 'AVOCADO', hex: '#8a9550' },
  { code: '-124', name: 'RUST', hex: '#cf6329' },
  { code: '-62', name: 'AQUA BLUE', hex: '#3f9fc7' },
  { code: '-51', name: 'MOSS GREEN', hex: '#6f8f4f' },
  { code: '-109', name: 'WALNUT', hex: '#7a4a24' },
];

const canvas = document.getElementById('scope');
const ctx = canvas.getContext('2d');

let state = { stations: [], services: [], calls: [], stats: {} };
let serviceName = new Map();
let terminals = new Map(); // id -> { x, y, a, kind, host }
let office = { x: 0, y: 0, r: 0 };
let msgs = { x: 0, y: 0, r: 0 };
let toll = { x: 0, y: 0, r: 0 };
let R = 0;
let dpr = 1;

// Stable colour assignment: a call keeps its colour for its whole life.
let colorAssign = new Map(); // callId -> WE index
function assignColors(calls) {
  const present = new Set(calls.map((c) => c.id));
  for (const id of [...colorAssign.keys()]) if (!present.has(id)) colorAssign.delete(id);
  const used = new Set(colorAssign.values());
  for (const c of calls) {
    if (colorAssign.has(c.id)) continue;
    let idx = 0;
    while (idx < WE.length && used.has(idx)) idx++;
    if (idx >= WE.length) idx = colorAssign.size % WE.length; // more calls than colours: reuse
    colorAssign.set(c.id, idx);
    used.add(idx);
  }
}
function colorOf(c) {
  const i = colorAssign.get(c.id);
  return i == null ? INK : WE[i % WE.length].hex;
}

// ---- deterministic scatter -------------------------------------------------
function hashOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngOf(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- WebSocket -------------------------------------------------------------
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
function setLink(up) { document.getElementById('link').textContent = up ? 'ACTIVE' : 'DOWN'; }

function applyState(msg) {
  state = msg;
  state.services = msg.services || [];
  serviceName = new Map(state.services.map((s) => [s.id, s.name && s.name !== s.id ? s.name : s.id]));
  assignColors(state.calls);

  if (msg.exhibit) document.getElementById('exhibit-title').textContent = msg.exhibit;
  if (msg.subtitle) document.getElementById('subtitle').textContent = msg.subtitle;
  document.getElementById('s-active').textContent = msg.stats.active ?? 0;
  document.getElementById('s-ringing').textContent = msg.stats.ringing ?? 0;
  document.getElementById('s-messages').textContent = msg.stats.messages ?? 0;
  document.getElementById('s-handled').textContent = msg.stats.handled ?? 0;
  document.getElementById('s-lines').textContent = msg.stations.length;
  document.getElementById('s-uptime').textContent = hms(msg.stats.uptimeMs ?? 0);
  renderConnections();
  layout();
}

// ---- geometry --------------------------------------------------------------
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  layout();
}
const deg = (d) => (d * Math.PI) / 180;

function layout() {
  const w = canvas.width, h = canvas.height;
  const m = Math.min(w, h);
  R = m * 0.40;
  office = { x: w / 2 - m * 0.10, y: h / 2 + m * 0.03, r: 52 * dpr };
  toll = { x: office.x + R * 1.34, y: office.y, r: 40 * dpr };
  msgs = { x: office.x + Math.cos(deg(-54)) * R * 0.92, y: office.y + Math.sin(deg(-54)) * R * 0.92, r: 46 * dpr };

  terminals = new Map();
  scatter(state.stations, office, deg(22), deg(268), R * 0.66, R * 1.02, 'phone');
  scatter(state.services, msgs, deg(-186), deg(-6), R * 0.24, R * 0.40, 'ghost');

  function scatter(list, host, a0, a1, rMin, rMax, kind) {
    const n = list.length;
    if (!n) return;
    const span = (a1 - a0) / n;
    for (let i = 0; i < n; i++) {
      const rand = rngOf(hashOf(String(list[i].id)));
      const a = a0 + span * (i + 0.5) + (rand() - 0.5) * span * 0.85;
      const rad = rMin + rand() * (rMax - rMin);
      terminals.set(list[i].id, { x: host.x + Math.cos(a) * rad, y: host.y + Math.sin(a) * rad, a, kind, host });
    }
  }
}

function termRadius() { return 5.5 * dpr; }
function callFor(id) {
  let ringing = null;
  for (const c of state.calls) {
    if (c.fromId !== id && c.toId !== id) continue;
    if (c.state === 'connected') return c;
    ringing = ringing || c;
  }
  return ringing;
}

// The physical line segments a call lights up. Every call meets at the office:
// a phone lights its own subscriber line; a ghost lights its line PLUS the
// office↔messages trunk; the outside world lights the office↔toll trunk.
function segmentsFor(id) {
  if (id === EXTERNAL) return [{ key: 'trunk:toll', geom: trunkGeom(office, toll) }];
  const t = terminals.get(id);
  if (!t) return [];
  const segs = [{ key: 'term:' + id, geom: termGeom(id) }];
  if (t.kind === 'ghost') segs.push({ key: 'trunk:msgs', geom: trunkGeom(office, msgs) });
  return segs;
}
function termGeom(id) {
  const t = terminals.get(id);
  const host = t.host;
  const dx = t.x - host.x, dy = t.y - host.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  return { x1: host.x + ux * host.r, y1: host.y + uy * host.r, x2: t.x - ux * termRadius(), y2: t.y - uy * termRadius() };
}
function trunkGeom(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  return { x1: a.x + ux * a.r, y1: a.y + uy * a.r, x2: b.x - ux * b.r, y2: b.y - uy * b.r };
}

// ---- drawing ---------------------------------------------------------------
function draw() {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  reserved = [];

  drawBasePlant();
  drawConnections();
  for (const s of state.stations) drawTerminal(s, 'phone');
  for (const s of state.services) drawTerminal(s, 'ghost');
  drawNode(office, state.officeName || 'CENTRAL SWITCHING OFFICE');
  drawNode(msgs, state.messagesName || 'AUTOMATED MESSAGES');
  drawNode(toll, state.tollName || 'LONG LINES');
  flushLabels();

  requestAnimationFrame(draw);
}

// Black plant: idle subscriber lines, and the trunks as bidirectional pairs.
function drawBasePlant() {
  const busy = new Set();
  for (const c of state.calls) { busy.add(c.fromId); busy.add(c.toId); }

  ctx.strokeStyle = INK;
  for (const [id, t] of terminals) {
    if (busy.has(id) && callFor(id)) continue; // lit lines are drawn coloured
    const g = termGeom(id);
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(g.x1, g.y1);
    ctx.lineTo(g.x2, g.y2);
    ctx.stroke();
  }
  drawTrunkBase(office, toll);
  drawTrunkBase(office, msgs);
}

function drawTrunkBase(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, px = -uy, py = ux;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 1.2 * dpr;
  for (const s of [-1, 1]) {
    const ox = px * 3.5 * dpr * s, oy = py * 3.5 * dpr * s;
    const x1 = a.x + ux * a.r + ox, y1 = a.y + uy * a.r + oy;
    const x2 = b.x - ux * b.r + ox, y2 = b.y - uy * b.r + oy;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (s < 0) arrowHead(x2, y2, Math.atan2(uy, ux), 8 * dpr);
    else arrowHead(x1, y1, Math.atan2(-uy, -ux), 8 * dpr);
  }
}

// Colour the existing lines. Segments shared by several calls (a trunk, or a
// ghost line with several listeners) fan out into parallel coloured strands.
function drawConnections() {
  const bySeg = new Map(); // segKey -> [{ geom, color, dashed }]
  for (const c of state.calls) {
    const color = colorOf(c);
    const endpoints = [
      { id: c.fromId, dashed: false },
      { id: c.toId, dashed: c.state !== 'connected' },
    ];
    for (const ep of endpoints) {
      for (const seg of segmentsFor(ep.id)) {
        if (!bySeg.has(seg.key)) bySeg.set(seg.key, []);
        bySeg.get(seg.key).push({ geom: seg.geom, color, dashed: ep.dashed });
      }
    }
  }
  for (const strands of bySeg.values()) {
    const n = strands.length;
    strands.forEach((s, i) => drawStrand(s.geom, s.color, i, n, s.dashed));
  }
}

function drawStrand(g, color, i, n, dashed) {
  const dx = g.x2 - g.x1, dy = g.y2 - g.y1;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;
  const off = (i - (n - 1) / 2) * 4 * dpr;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3 * dpr;
  ctx.lineCap = 'round';
  if (dashed) ctx.setLineDash([7 * dpr, 6 * dpr]);
  ctx.beginPath();
  ctx.moveTo(g.x1 + px * off, g.y1 + py * off);
  ctx.lineTo(g.x2 + px * off, g.y2 + py * off);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
}

function drawTerminal(s, kind) {
  const t = terminals.get(s.id);
  if (!t) return;
  const call = callFor(s.id);
  const color = call ? colorOf(call) : INK;
  let mode = 'idle';
  if (call) mode = call.state === 'connected' ? 'use' : (call.fromId === s.id ? 'use' : 'ring');
  const r = termRadius();

  if (mode === 'ring') { // static double ring
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4 * dpr;
    ctx.beginPath();
    ctx.arc(t.x, t.y, r + 3 * dpr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
  ctx.fillStyle = mode === 'use' ? color : PAPER;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4 * dpr;
  ctx.fill();
  ctx.stroke();

  const lx = t.x + Math.cos(t.a) * (r + 8 * dpr);
  const ly = t.y + Math.sin(t.a) * (r + 8 * dpr);
  const right = Math.cos(t.a) > 0.15, left = Math.cos(t.a) < -0.15;
  ctx.textAlign = left ? 'right' : right ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${(kind === 'ghost' ? 11 : 12) * dpr}px ${FONT_STACK}`;
  ctx.fillStyle = INK;

  let text = kind === 'ghost' ? (serviceName.get(s.id) || s.id) : s.id;
  if (kind === 'ghost') {
    const listeners = state.calls.filter((c) => c.state === 'connected' && (c.toId === s.id || c.fromId === s.id)).length;
    if (listeners > 1) text += `  x${listeners}`;
  }
  ctx.fillText(text, lx, ly);
  const tw = ctx.measureText(text).width;
  reserved.push({ x: (left ? lx - tw : right ? lx : lx - tw / 2) - 3 * dpr, y: ly - 8 * dpr, w: tw + 6 * dpr, h: 16 * dpr });
  ctx.textAlign = 'start';
}

function drawNode(n, name) {
  ctx.beginPath();
  ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6 * dpr;
  ctx.fill();
  ctx.stroke();

  const lines = wrap(String(name).toUpperCase(), 11);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  const size = lines.length > 2 ? 9 : 10;
  ctx.font = `${size * dpr}px ${FONT_STACK}`;
  const lh = (size + 2) * dpr;
  const y0 = n.y - ((lines.length - 1) * lh) / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, n.x, y0 + i * lh));
  ctx.textAlign = 'start';
  reserved.push({ x: n.x - n.r, y: n.y - n.r, w: n.r * 2, h: n.r * 2 });
}

function wrap(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---- connections legend panel ---------------------------------------------
function partyLabel(id, fallback) {
  if (id === EXTERNAL) return fallback || 'OUTSIDE';
  if (serviceName.has(id)) return serviceName.get(id);
  return id;
}
function renderConnections() {
  const box = document.getElementById('connections');
  if (!box) return;
  const calls = [...(state.calls || [])].sort((a, b) => a.since - b.since);
  if (!calls.length) { box.innerHTML = '<div class="none">— all lines idle —</div>'; return; }
  box.innerHTML = calls.map((c) => {
    const col = colorOf(c);
    const from = partyLabel(c.fromId, c.fromLabel);
    const to = partyLabel(c.toId, c.toLabel);
    const dur = c.state === 'connected' ? hms(Date.now() - c.since, true) : 'RING';
    return `<div class="conn"><i style="background:${col}"></i>` +
           `<span class="p">${esc(from)} › ${esc(to)}</span>` +
           `<span class="d">${dur}</span></div>`;
  }).join('');
}

// ---- helpers ---------------------------------------------------------------
let labelQueue = [];
let reserved = [];
function esc(s) { return String(s ?? '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }

function arrowHead(x, y, ang, size) {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * Math.cos(ang - 0.38), y - size * Math.sin(ang - 0.38));
  ctx.lineTo(x - size * Math.cos(ang + 0.38), y - size * Math.sin(ang + 0.38));
  ctx.closePath();
  ctx.fill();
}

function overlaps(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function flushLabels() {
  const placed = [...reserved];
  const h = 15 * dpr;
  for (const L of labelQueue) {
    ctx.font = `${L.size * dpr}px ${FONT_STACK}`;
    const w = ctx.measureText(L.text).width + 7 * dpr;
    let y = L.y;
    for (let i = 1; i <= 14; i++) {
      if (!placed.some((r) => overlaps(r, { x: L.x - w / 2, y: y - h / 2, w, h }))) break;
      y = L.y + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (h + 3 * dpr);
    }
    const rect = { x: L.x - w / 2, y: y - h / 2, w, h };
    placed.push(rect);
    ctx.fillStyle = PAPER;
    ctx.fillRect(rect.x, rect.y, w, h);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(L.text, L.x, y);
  }
  ctx.textAlign = 'start';
  labelQueue = [];
}

function hms(ms, short = false) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return short && hh === 0 ? `${p(mm)}:${p(ss)}` : `${p(hh)}:${p(mm)}:${p(ss)}`;
}
function tickClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  document.getElementById('clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  renderConnections(); // keep durations ticking
}

// ---- boot ------------------------------------------------------------------
window.addEventListener('resize', resize);
setInterval(tickClock, 1000);
tickClock();
resize();
connect();
requestAnimationFrame(draw);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
