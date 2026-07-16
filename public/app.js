/* HELLO! — Live Telephony Diagram.
 *
 * Drawn as monochrome line-art after the CMD Networking Telephony Diagram:
 *   · CENTRAL SWITCHING OFFICE — the exhibit's PBX
 *   · every visitor phone on its own subscriber line ending in an open circle,
 *     scattered rather than laid out on a perfect radius
 *   · AUTOMATED MESSAGES — a node the ghost extensions hang off
 *   · LONG LINES — the toll network, over a bidirectional trunk line
 *
 * State is shown without colour, the way the source diagram would:
 *   open circle = on-hook · filled circle = in use · dashed = ringing
 *   solid bold line with an arrowhead = a call, pointing caller -> destination
 */

const EXTERNAL = 'EXTERNAL';
const INK = '#000000';
const PAPER = '#ffffff';
const FONT_STACK = `"Prestige Elite Std", "Courier Prime", "Courier New", Courier, monospace`;

const canvas = document.getElementById('scope');
const ctx = canvas.getContext('2d');

let state = { stations: [], services: [], calls: [], stats: {} };
let serviceIds = new Set();
let terminals = new Map(); // id -> { x, y, a, kind, host }
let office = { x: 0, y: 0, r: 0 };
let msgs = { x: 0, y: 0, r: 0 };
let toll = { x: 0, y: 0, r: 0 };
let R = 0;
let dpr = 1;

// ---- deterministic scatter -------------------------------------------------
// Positions must be stable across redraws and resizes, so the jitter is derived
// from the extension number rather than Math.random().
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
function setLink(up) {
  document.getElementById('link').textContent = up ? 'ACTIVE' : 'DOWN';
}

function applyState(msg) {
  state = msg;
  state.services = msg.services || [];
  serviceIds = new Set(state.services.map((s) => s.id));
  if (msg.exhibit) document.getElementById('exhibit-title').textContent = msg.exhibit;
  if (msg.subtitle) document.getElementById('subtitle').textContent = msg.subtitle;
  document.getElementById('s-active').textContent = msg.stats.active ?? 0;
  document.getElementById('s-ringing').textContent = msg.stats.ringing ?? 0;
  document.getElementById('s-messages').textContent = msg.stats.messages ?? 0;
  document.getElementById('s-handled').textContent = msg.stats.handled ?? 0;
  document.getElementById('s-lines').textContent = msg.stations.length;
  document.getElementById('s-uptime').textContent = hms(msg.stats.uptimeMs ?? 0);
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

  // Visitor phones scatter around the office, over the sector that isn't
  // occupied by the trunk east or the automated-messages node north-east.
  scatter(state.stations, office, deg(22), deg(268), R * 0.66, R * 1.02, 'phone');
  // Ghosts hang off the automated-messages node, fanning away from the office.
  scatter(state.services, msgs, deg(-186), deg(-6), R * 0.24, R * 0.40, 'ghost');

  function scatter(list, host, a0, a1, rMin, rMax, kind) {
    const n = list.length;
    if (!n) return;
    const span = (a1 - a0) / n;
    for (let i = 0; i < n; i++) {
      const rand = rngOf(hashOf(String(list[i].id)));
      const a = a0 + span * (i + 0.5) + (rand() - 0.5) * span * 0.85;
      const rad = rMin + rand() * (rMax - rMin);
      terminals.set(list[i].id, {
        x: host.x + Math.cos(a) * rad,
        y: host.y + Math.sin(a) * rad,
        a, kind, host,
      });
    }
  }
}

function posOf(id) {
  if (id === EXTERNAL) return toll;
  return terminals.get(id) || office;
}
function radiusOf(id) {
  if (id === EXTERNAL) return toll.r;
  return 5.5 * dpr;
}
function callFor(id) {
  let ringing = null;
  for (const c of state.calls) {
    if (c.fromId !== id && c.toId !== id) continue;
    if (c.state === 'connected') return c;
    ringing = ringing || c;
  }
  return ringing;
}

// ---- drawing ---------------------------------------------------------------
function draw(t) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  reserved = [];
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;

  drawTrunk(office, toll);
  drawTrunk(office, msgs);
  drawSubscriberLines();

  const calls = [...state.calls].sort((a, b) => (a.state === 'connected') - (b.state === 'connected'));
  const fan = fanGroups(calls);
  for (const c of calls) drawCall(c, t, fan.get(c.id));

  for (const s of state.stations) drawTerminal(s, 'phone');
  for (const s of state.services) drawTerminal(s, 'ghost');

  drawNode(office, state.officeName || 'CENTRAL SWITCHING OFFICE');
  drawNode(msgs, state.messagesName || 'AUTOMATED MESSAGES');
  drawNode(toll, state.tollName || 'LONG LINES');

  flushLabels();
  requestAnimationFrame(draw);
}

// Thin line from the node out to the terminal; dashed while it's ringing.
function drawSubscriberLines() {
  const status = new Map();
  for (const s of state.stations) status.set(s.id, s.status);
  for (const s of state.services) status.set(s.id, s.status);

  for (const [id, t] of terminals) {
    const st = status.get(id) || 'idle';
    const host = t.host;
    const dx = t.x - host.x, dy = t.y - host.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    ctx.strokeStyle = INK;
    ctx.lineWidth = (st === 'idle' ? 1 : 1.6) * dpr;
    if (st === 'ringing') ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(host.x + ux * host.r, host.y + uy * host.r);
    ctx.lineTo(t.x - ux * radiusOf(id), t.y - uy * radiusOf(id));
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// Bidirectional trunk: two parallel lines, an arrowhead at each far end.
function drawTrunk(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 1.3 * dpr;
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

function controlPoint(p1, p2, fan) {
  const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  let cp = { x: mx + (-dy / len) * len * 0.22, y: my + (dx / len) * len * 0.22 };
  if (fan && fan.count > 1) {
    const off = (fan.idx - (fan.count - 1) / 2) * 30 * dpr;
    cp = { x: cp.x + (-dy / len) * off, y: cp.y + (dx / len) * off };
  }
  return cp;
}

function drawCall(c, t, fan) {
  const p1 = posOf(c.fromId), p2 = posOf(c.toId);
  const cp = controlPoint(p1, p2, fan);
  const ringing = c.state !== 'connected';

  ctx.strokeStyle = INK;
  ctx.lineWidth = (ringing ? 1.5 : 2.6) * dpr;
  if (ringing) ctx.setLineDash([7 * dpr, 6 * dpr]);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.quadraticCurveTo(cp.x, cp.y, p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);

  const tx = 2 * (p2.x - cp.x), ty = 2 * (p2.y - cp.y);
  const l = Math.hypot(tx, ty) || 1;
  const back = radiusOf(c.toId) + 5 * dpr;
  arrowHead(p2.x - (tx / l) * back, p2.y - (ty / l) * back, Math.atan2(ty, tx), 9 * dpr);

  if (!ringing) {
    for (let i = 0; i < 3; i++) {
      const pt = quad(p1, cp, p2, ((t / 1600) + i / 3) % 1);
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    const mid = quad(p1, cp, p2, 0.5);
    label(mid.x, mid.y - 11 * dpr, hms(Math.max(0, Date.now() - c.since), true), 11);
  }

  const ext = c.fromId === EXTERNAL ? c.fromLabel : (c.toId === EXTERNAL ? c.toLabel : null);
  if (ext) {
    const at = quad(p1, cp, p2, c.fromId === EXTERNAL ? 0.24 : 0.76);
    label(at.x, at.y, ext, 11);
  }
}

// Open circle = on-hook, filled = in use.
function drawTerminal(s, kind) {
  const t = terminals.get(s.id);
  if (!t) return;
  const inUse = s.status === 'busy';
  const r = radiusOf(s.id);

  ctx.beginPath();
  ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
  ctx.fillStyle = inUse ? INK : PAPER;
  ctx.strokeStyle = INK;
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

  let text = kind === 'ghost' ? (s.name && s.name !== s.id ? s.name : s.id) : s.id;
  if (kind === 'ghost') {
    const n = state.calls.filter((c) => c.state === 'connected' && (c.toId === s.id || c.fromId === s.id)).length;
    if (n > 1) text += `  x${n}`;
  }
  ctx.fillText(text, lx, ly);

  const tw = ctx.measureText(text).width;
  reserved.push({
    x: (left ? lx - tw : right ? lx : lx - tw / 2) - 3 * dpr,
    y: ly - 8 * dpr, w: tw + 6 * dpr, h: 16 * dpr,
  });
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

// ---- helpers ---------------------------------------------------------------
let labelQueue = [];
let reserved = [];

function arrowHead(x, y, ang, size) {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * Math.cos(ang - 0.38), y - size * Math.sin(ang - 0.38));
  ctx.lineTo(x - size * Math.cos(ang + 0.38), y - size * Math.sin(ang + 0.38));
  ctx.closePath();
  ctx.fill();
}

function label(x, y, text, size) {
  labelQueue.push({ x, y, text, size });
}
function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
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
    // knock the line out behind the text, as a draughtsman would
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

// ---- boot ------------------------------------------------------------------
window.addEventListener('resize', resize);
setInterval(tickClock, 250);
tickClock();
resize();
connect();
requestAnimationFrame(draw);
// Re-layout once the webfont lands so label metrics are right.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
