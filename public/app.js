/* HELLO! — Bell System exhibit board.
 *
 * Drawn in the language of the CMD Networking telephony diagrams:
 *   · the PBX is a CLASS 1 NODE at the centre
 *   · every phone hangs off it on a subscriber line ending in an open circle
 *   · the ghosts (recorded messages) hang off the same node as tape reels
 *   · a bidirectional trunk line runs out to the CLASS 3 / LONG LINES node
 *
 * Live calls are drawn over that plant as arcs from CALLER to DESTINATION,
 * with an arrowhead at the destination and pulses flowing the way the call is
 * going. Colour: amber = ringing · cyan = phone-to-phone · green = toll
 * · magenta = ghost / recorded message. */

const EXTERNAL = 'EXTERNAL';
const C = {
  bg: '#000000', grid: '#0b1a16',
  line: '#2b4f47',        // idle subscriber line
  amber: '#ffb000', green: '#33ff77', cyan: '#35e0ff',
  magenta: '#ff5edc', violet: '#8f5ad6',
  dim: '#3f6b60', ink: '#d6f5e8', hub: '#ffb000',
};

const canvas = document.getElementById('scope');
const ctx = canvas.getContext('2d');

let state = { stations: [], services: [], calls: [], stats: {} };
let serviceIds = new Set();
let terminals = new Map(); // id -> { x, y, a, kind }
let node = { x: 0, y: 0, r: 0 };  // CLASS 1 node — the exhibit's switch
let toll = { x: 0, y: 0, r: 0 };  // CLASS 3 node — LONG LINES / PSTN
let R = 0;
let dpr = 1;

// ---- WebSocket ----
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
  state.services = msg.services || [];
  serviceIds = new Set(state.services.map((s) => s.id));
  if (msg.site) document.getElementById('site').textContent = msg.site;
  if (msg.exhibit) document.getElementById('exhibit-title').textContent = msg.exhibit;
  document.getElementById('s-active').textContent = msg.stats.active ?? 0;
  document.getElementById('s-ringing').textContent = msg.stats.ringing ?? 0;
  document.getElementById('s-messages').textContent = msg.stats.messages ?? 0;
  document.getElementById('s-handled').textContent = msg.stats.handled ?? 0;
  document.getElementById('s-uptime').textContent = hms(msg.stats.uptimeMs ?? 0);
  layout();
}

// ---- geometry ----
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  layout();
}

/* Each group gets its own sector off the node, the way the CMD diagrams keep a
 * node's subscribers on one side and its trunks on the other:
 *   ·  24°–264°  the 31 visitor phones, on full-length subscriber lines
 *   · 280°–336°  the ghosts, on shorter lines (they live inside the exhibit)
 *   ·      ~0°   kept clear so the trunk can run due east to the CLASS 3 node
 * (0° = east, angles run clockwise because canvas y points down.) */
const deg = (d) => (d * Math.PI) / 180;

function layout() {
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  const m = Math.min(w, h);
  R = m * 0.40;
  node = { x: cx - m * 0.08, y: cy, r: 44 * dpr };
  toll = { x: node.x + R * 1.20, y: cy, r: 38 * dpr };

  terminals = new Map();
  const place = (list, a0, a1, rad, kind) => {
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? (a0 + a1) / 2 : a0 + (i / (n - 1)) * (a1 - a0);
      terminals.set(list[i].id, {
        x: node.x + Math.cos(a) * rad,
        y: node.y + Math.sin(a) * rad,
        a, kind,
      });
    }
  };
  place(state.stations, deg(24), deg(264), R, 'phone');
  place(state.services, deg(280), deg(336), R * 0.58, 'ghost');
}

function posOf(id) {
  if (id === EXTERNAL) return toll;
  return terminals.get(id) || node;
}
function radiusOf(id) {
  if (id === EXTERNAL) return toll.r;
  const t = terminals.get(id);
  return t && t.kind === 'ghost' ? 9 * dpr : 5.5 * dpr;
}
function kindOf(c) {
  if (serviceIds.has(c.fromId) || serviceIds.has(c.toId)) return 'ghost';
  if (c.fromId === EXTERNAL || c.toId === EXTERNAL) return 'toll';
  return 'phone';
}
function callColor(c) {
  if (c.state !== 'connected') return C.amber;
  const k = kindOf(c);
  return k === 'ghost' ? C.magenta : k === 'toll' ? C.green : C.cyan;
}
// The call a terminal is currently carrying (connected wins over ringing).
function callFor(id) {
  let ringing = null;
  for (const c of state.calls) {
    if (c.fromId !== id && c.toId !== id) continue;
    if (c.state === 'connected') return c;
    ringing = ringing || c;
  }
  return ringing;
}

// A subscriber line takes the colour of the call it's carrying, so a line and
// its arc always agree (green would otherwise read as "toll" on a ghost call).
function terminalColor(id, kind) {
  const c = callFor(id);
  if (c) return callColor(c);
  return kind === 'ghost' ? C.violet : C.line;
}

// ---- drawing ----
function draw(t) {
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  reserved = [];
  drawGrid(w, h);

  drawTrunk();
  drawSubscriberLines();

  const calls = [...state.calls].sort((a, b) => (a.state === 'connected') - (b.state === 'connected'));
  const fan = fanGroups(calls);
  for (const c of calls) drawCall(c, t, fan.get(c.id));

  for (const s of state.stations) drawTerminal(s, 'phone', t);
  for (const s of state.services) drawTerminal(s, 'ghost', t);
  drawNode();
  drawToll();
  flushLabels();

  requestAnimationFrame(draw);
}

function drawGrid(w, h) {
  const step = 46 * dpr;
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}

// Every phone/ghost is wired to the node, drawn whether or not it's in use.
function drawSubscriberLines() {
  const byId = new Map();
  for (const s of state.stations) byId.set(s.id, s.status);
  for (const s of state.services) byId.set(s.id, s.status);

  for (const [id, t] of terminals) {
    const status = byId.get(id) || 'idle';
    const lit = status !== 'idle';
    const color = terminalColor(id, t.kind);
    const ux = Math.cos(t.a), uy = Math.sin(t.a);
    const x1 = node.x + ux * node.r, y1 = node.y + uy * node.r;
    const x2 = t.x - ux * radiusOf(id), y2 = t.y - uy * radiusOf(id);
    ctx.strokeStyle = lit ? color : C.line;
    // kept lighter than the call arc so the arc stays the thing you read
    ctx.lineWidth = (lit ? 1.4 : 1) * dpr;
    ctx.globalAlpha = lit ? 0.75 : 0.55;
    if (lit) { ctx.shadowColor = color; ctx.shadowBlur = 5 * dpr; }
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

// Bidirectional tandem trunk: two parallel lines, an arrow at each far end.
function drawTrunk() {
  const dx = toll.x - node.x, dy = toll.y - node.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const busy = state.calls.some((c) => c.fromId === EXTERNAL || c.toId === EXTERNAL);
  const color = busy ? C.green : C.line;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.4 * dpr;
  ctx.globalAlpha = busy ? 0.95 : 0.7;

  for (const s of [-1, 1]) {
    const ox = px * 3.5 * dpr * s, oy = py * 3.5 * dpr * s;
    const ax = node.x + ux * node.r + ox, ay = node.y + uy * node.r + oy;
    const bx = toll.x - ux * toll.r + ox, by = toll.y - uy * toll.r + oy;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    // one line points out to the toll node, the other points back in
    if (s < 0) arrowHead(bx, by, Math.atan2(uy, ux), 7 * dpr, color);
    else arrowHead(ax, ay, Math.atan2(-uy, -ux), 7 * dpr, color);
  }
  ctx.globalAlpha = 1;

  const mx = (node.x + toll.x) / 2, my = node.y - 14 * dpr;
  ctx.font = `${9 * dpr}px ${FONT}`;
  ctx.fillStyle = C.dim;
  ctx.textAlign = 'center';
  ctx.fillText('TRUNK', mx, my);
  ctx.textAlign = 'start';
}

function fanGroups(calls) {
  const groups = new Map();
  for (const c of calls) {
    const k = [c.fromId, c.toId].sort().join('|');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c.id);
  }
  const info = new Map();
  for (const ids of groups.values()) ids.forEach((id, i) => info.set(id, { idx: i, count: ids.length }));
  return info;
}

// Bow perpendicular to the chord so long arcs sweep clear of the node.
function controlPoint(c, p1, p2, fan) {
  const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  let cp = { x: mx + (-dy / len) * len * 0.26, y: my + (dx / len) * len * 0.26 };
  if (fan && fan.count > 1) {
    const off = (fan.idx - (fan.count - 1) / 2) * 34 * dpr;
    cp = { x: cp.x + (-dy / len) * off, y: cp.y + (dx / len) * off };
  }
  return cp;
}

function drawCall(c, t, fan) {
  const p1 = posOf(c.fromId), p2 = posOf(c.toId);
  const cp = controlPoint(c, p1, p2, fan);
  const ringing = c.state !== 'connected';
  const color = callColor(c);

  ctx.strokeStyle = color;
  ctx.lineWidth = (ringing ? 1.6 : 2.4) * dpr;
  ctx.globalAlpha = ringing ? 0.8 : 0.95;
  if (ringing) ctx.setLineDash([6 * dpr, 7 * dpr]);
  ctx.shadowColor = color;
  ctx.shadowBlur = (ringing ? 6 : 11) * dpr;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.quadraticCurveTo(cp.x, cp.y, p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // arrowhead at the destination
  const tx = 2 * (p2.x - cp.x), ty = 2 * (p2.y - cp.y);
  const l = Math.hypot(tx, ty) || 1;
  const back = radiusOf(c.toId) + 5 * dpr;
  arrowHead(p2.x - (tx / l) * back, p2.y - (ty / l) * back, Math.atan2(ty, tx), 8 * dpr, color);

  if (!ringing) {
    for (let i = 0; i < 3; i++) {
      const pt = quad(p1, cp, p2, ((t / 1500) + i / 3) % 1);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10 * dpr;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    const mid = quad(p1, cp, p2, 0.5);
    label(mid.x, mid.y - 11 * dpr, hms(Math.max(0, Date.now() - c.since), true), color, 11);
  }

  const extLabel = c.fromId === EXTERNAL ? c.fromLabel : (c.toId === EXTERNAL ? c.toLabel : null);
  if (extLabel) {
    const at = quad(p1, cp, p2, c.fromId === EXTERNAL ? 0.22 : 0.78);
    label(at.x, at.y, extLabel, color, 11);
  }
}

// A phone is a small open circle on the end of its line; a ghost is a reel.
function drawTerminal(s, kind, t) {
  const term = terminals.get(s.id);
  if (!term) return;
  const active = s.status !== 'idle';
  const color = terminalColor(s.id, kind);
  const r = radiusOf(s.id);

  if (s.status === 'ringing') ring(term.x, term.y, r + (4 + 3 * Math.sin(t / 130)) * dpr, C.amber, 0.5);

  ctx.beginPath();
  ctx.arc(term.x, term.y, r, 0, Math.PI * 2);
  ctx.fillStyle = active ? color : C.bg;
  ctx.strokeStyle = color;
  ctx.lineWidth = (kind === 'ghost' ? 2 : 1.6) * dpr;
  if (active) { ctx.shadowColor = color; ctx.shadowBlur = 12 * dpr; }
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (kind === 'ghost') { // reel hub
    ctx.beginPath();
    ctx.arc(term.x, term.y, 3 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#000' : color;
    ctx.fill();
  }

  // label just beyond the terminal, reading outward
  const lx = term.x + Math.cos(term.a) * (r + 9 * dpr);
  const ly = term.y + Math.sin(term.a) * (r + 9 * dpr);
  const right = Math.cos(term.a) > 0.15, left = Math.cos(term.a) < -0.15;
  ctx.textAlign = left ? 'right' : right ? 'left' : 'center';
  ctx.textBaseline = 'middle';

  let text = s.id;
  if (kind === 'ghost') {
    const listeners = state.calls.filter(
      (c) => c.state === 'connected' && (c.toId === s.id || c.fromId === s.id)
    ).length;
    text = (s.name && s.name !== s.id ? s.name : `GHOST ${s.id}`) + (listeners > 1 ? `  ×${listeners}` : '');
    ctx.font = `700 ${10 * dpr}px ${FONT}`;
  } else {
    ctx.font = `${12 * dpr}px ${FONT}`;
  }
  ctx.fillStyle = active ? C.ink : (kind === 'ghost' ? C.violet : C.dim);
  ctx.fillText(text, lx, ly);

  const tw = ctx.measureText(text).width;
  reserved.push({
    x: (left ? lx - tw : right ? lx : lx - tw / 2) - 3 * dpr,
    y: ly - 8 * dpr, w: tw + 6 * dpr, h: 16 * dpr,
  });
  ctx.textAlign = 'start';
}

// The exhibit's switch.
function drawNode() {
  ctx.beginPath();
  ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
  ctx.fillStyle = '#050d0b';
  ctx.strokeStyle = C.cyan;
  ctx.lineWidth = 2.4 * dpr;
  ctx.shadowColor = C.cyan;
  ctx.shadowBlur = 14 * dpr;
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.cyan;
  ctx.font = `700 ${11 * dpr}px ${FONT}`;
  ctx.fillText('CLASS 1', node.x, node.y - 6 * dpr);
  ctx.font = `${10 * dpr}px ${FONT}`;
  ctx.fillText('NODE', node.x, node.y + 7 * dpr);
  ctx.font = `${9 * dpr}px ${FONT}`;
  ctx.fillStyle = C.dim;
  ctx.fillText('HELLO! EXHIBIT', node.x, node.y + node.r + 12 * dpr);
  ctx.textAlign = 'start';
  reserved.push({ x: node.x - node.r, y: node.y - node.r, w: node.r * 2, h: node.r * 2 + 20 * dpr });
}

// The toll network.
function drawToll() {
  ctx.beginPath();
  ctx.arc(toll.x, toll.y, toll.r, 0, Math.PI * 2);
  ctx.fillStyle = '#120c00';
  ctx.strokeStyle = C.hub;
  ctx.lineWidth = 2.4 * dpr;
  ctx.shadowColor = C.hub;
  ctx.shadowBlur = 12 * dpr;
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.hub;
  ctx.font = `700 ${11 * dpr}px ${FONT}`;
  ctx.fillText('CLASS 3', toll.x, toll.y - 6 * dpr);
  ctx.font = `${10 * dpr}px ${FONT}`;
  ctx.fillText('NODE', toll.x, toll.y + 7 * dpr);
  ctx.font = `${9 * dpr}px ${FONT}`;
  ctx.fillStyle = C.dim;
  ctx.fillText('LONG LINES · PSTN', toll.x, toll.y + toll.r + 12 * dpr);
  ctx.textAlign = 'start';
  reserved.push({ x: toll.x - toll.r, y: toll.y - toll.r, w: toll.r * 2, h: toll.r * 2 + 20 * dpr });
}

// ---- helpers ----
const FONT = `"DejaVu Sans Mono", Menlo, monospace`;
let labelQueue = [];
let reserved = [];

function arrowHead(x, y, ang, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * Math.cos(ang - 0.42), y - size * Math.sin(ang - 0.42));
  ctx.lineTo(x - size * Math.cos(ang + 0.42), y - size * Math.sin(ang + 0.42));
  ctx.closePath();
  ctx.fill();
}

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
  labelQueue.push({ x, y, text, color, size });
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function flushLabels() {
  const placed = [...reserved];
  const h = 16 * dpr;
  for (const L of labelQueue) {
    ctx.font = `${L.size * dpr}px ${FONT}`;
    const w = ctx.measureText(L.text).width + 8 * dpr;
    let y = L.y;
    for (let i = 1; i <= 14; i++) {
      if (!placed.some((r) => overlaps(r, { x: L.x - w / 2, y: y - h / 2, w, h }))) break;
      y = L.y + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (h + 3 * dpr);
    }
    const rect = { x: L.x - w / 2, y: y - h / 2, w, h };
    placed.push(rect);
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(rect.x, rect.y, w, h);
    ctx.fillStyle = L.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(L.text, L.x, y);
  }
  ctx.textAlign = 'start';
  labelQueue = [];
}

function quad(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
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
}

// ---- boot ----
window.addEventListener('resize', resize);
setInterval(tickClock, 250);
tickClock();
resize();
connect();
requestAnimationFrame(draw);
