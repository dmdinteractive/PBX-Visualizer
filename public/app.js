/* HELLO! — Bell System Long Lines board.
 *
 * Layout:  stations ring the outside · recorded messages sit on an inner ring
 *          · the LONG LINES toll gateway is dead center.
 * Calls:   drawn as arcs from CALLER to DESTINATION, with an arrowhead at the
 *          destination and pulses flowing in the direction of the call, so it's
 *          always clear who placed it and where it went.
 * Color:   amber = ringing · cyan = station-to-station · green = toll/outside
 *          · magenta = recorded message. */

const EXTERNAL = 'EXTERNAL';
const C = {
  bg: '#000000', grid: '#0b1a16', ringLine: 'rgba(63,107,96,0.35)',
  amber: '#ffb000', green: '#33ff77', cyan: '#35e0ff',
  magenta: '#ff5edc', violet: '#b06bff',
  dim: '#3f6b60', ink: '#d6f5e8', hub: '#ffb000',
};

const canvas = document.getElementById('scope');
const ctx = canvas.getContext('2d');

let state = { stations: [], services: [], calls: [], stats: {} };
let serviceIds = new Set();
let stationPos = new Map();
let servicePos = new Map();
let hub = { x: 0, y: 0, w: 0, h: 0, R: 0, rs: 0 };
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

function layout() {
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  const m = Math.min(w, h);
  hub = { x: cx, y: cy, w: 150 * dpr, h: 62 * dpr, R: m * 0.40, rs: m * 0.205 };

  stationPos = new Map();
  const n = state.stations.length;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    stationPos.set(state.stations[i].id, { x: cx + Math.cos(a) * hub.R, y: cy + Math.sin(a) * hub.R, a });
  }

  servicePos = new Map();
  const k = state.services.length;
  for (let i = 0; i < k; i++) {
    const a = -Math.PI / 2 + (i / k) * Math.PI * 2;
    servicePos.set(state.services[i].id, { x: cx + Math.cos(a) * hub.rs, y: cy + Math.sin(a) * hub.rs, a });
  }
}

function posOf(id) {
  if (id === EXTERNAL) return hub;
  return stationPos.get(id) || servicePos.get(id) || hub;
}
function radiusOf(id) {
  if (id === EXTERNAL) return 40 * dpr;      // toll box, roughly
  if (serviceIds.has(id)) return 13 * dpr;   // recording reel
  return 7 * dpr;                            // station lamp
}
function kindOf(c) {
  if (serviceIds.has(c.fromId) || serviceIds.has(c.toId)) return 'service';
  if (c.fromId === EXTERNAL || c.toId === EXTERNAL) return 'toll';
  return 'internal';
}
function callColor(c) {
  if (c.state !== 'connected') return C.amber;
  const k = kindOf(c);
  return k === 'service' ? C.magenta : k === 'toll' ? C.green : C.cyan;
}

// ---- drawing ----
function draw(t) {
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  reserved = [];
  drawGrid(w, h);
  drawRings();

  const calls = [...state.calls].sort((a, b) => (a.state === 'connected') - (b.state === 'connected'));
  const fan = fanGroups(calls);
  for (const c of calls) drawCall(c, t, fan.get(c.id));
  for (const s of state.stations) drawStation(s, t);
  for (const s of state.services) drawService(s);
  drawHub();
  flushLabels(); // labels last, on top of everything

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

function drawRings() {
  ctx.strokeStyle = C.ringLine;
  ctx.lineWidth = 1.2 * dpr;
  ctx.setLineDash([2 * dpr, 6 * dpr]);
  for (const r of [hub.R, hub.rs]) {
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// Several calls can share the same endpoints (e.g. three visitors listening to
// the same recording). Group them so their arcs can be fanned apart instead of
// drawing exactly on top of each other.
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

// Control point for the call arc: station-to-station bows toward the center,
// anything radial (toll / recording) bows gently to one side. Calls sharing the
// same endpoints get fanned out so each one stays readable.
function controlPoint(c, p1, p2, fan) {
  const radial = c.fromId === EXTERNAL || c.toId === EXTERNAL ||
                 serviceIds.has(c.fromId) || serviceIds.has(c.toId);
  const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;

  // Always bow perpendicular to the chord. (Bowing toward the centre collapses
  // to a straight line for near-opposite stations and skewers the toll box.)
  // Station-to-station bows harder so long chords sweep clear of the middle.
  const bow = radial ? 0.13 : 0.30;
  let cp = { x: mx + (-dy / len) * len * bow, y: my + (dx / len) * len * bow };

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
  ctx.lineWidth = (ringing ? 1.6 : 2.6) * dpr;
  ctx.globalAlpha = ringing ? 0.8 : 0.95;
  if (ringing) ctx.setLineDash([6 * dpr, 7 * dpr]);
  ctx.shadowColor = color;
  ctx.shadowBlur = (ringing ? 6 : 12) * dpr;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.quadraticCurveTo(cp.x, cp.y, p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // Arrowhead at the destination — shows which way the call is going.
  drawArrowAt(p1, cp, p2, radiusOf(c.toId) + 5 * dpr, color);

  // Pulses travelling caller -> destination on connected calls.
  if (!ringing) {
    for (let i = 0; i < 3; i++) {
      const phase = ((t / 1500) + i / 3) % 1;
      const pt = quad(p1, cp, p2, phase);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10 * dpr;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.6 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    // Duration sits at the crown of the arc, which now bows clear of the middle.
    const mid = quad(p1, cp, p2, 0.5);
    label(mid.x, mid.y - 11 * dpr, hms(Math.max(0, Date.now() - c.since), true), color, 11);
  }

  // Outside number tag, placed at the first point along the arc that clears
  // the LONG LINES box (otherwise the box draws straight over it).
  const extLabel = c.fromId === EXTERNAL ? c.fromLabel : (c.toId === EXTERNAL ? c.toLabel : null);
  if (extLabel) {
    const at = pointClearOfHub(p1, cp, p2, c.fromId === EXTERNAL);
    label(at.x, at.y, extLabel, color, 11);
  }
}

// Walk the arc from whichever end sits at the toll gateway and return the first
// point that clears the LONG LINES box, so labels never hide behind it.
function pointClearOfHub(p1, cp, p2, fromHubEnd) {
  const clearance = hub.w / 2 + 18 * dpr;
  for (let i = 0; i <= 24; i++) {
    const t = fromHubEnd ? i / 24 : 1 - i / 24;
    const pt = quad(p1, cp, p2, t);
    if (Math.hypot(pt.x - hub.x, pt.y - hub.y) > clearance) return pt;
  }
  return quad(p1, cp, p2, 0.5);
}

// Place an arrowhead on the curve, backed off `back` px from the end point.
function drawArrowAt(p0, cp, p2, back, color) {
  const tx = 2 * (p2.x - cp.x), ty = 2 * (p2.y - cp.y); // tangent at t=1
  const len = Math.hypot(tx, ty) || 1;
  const ux = tx / len, uy = ty / len;
  const tipX = p2.x - ux * back, tipY = p2.y - uy * back;
  const size = 8 * dpr;
  const ang = Math.atan2(uy, ux);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8 * dpr;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - size * Math.cos(ang - 0.42), tipY - size * Math.sin(ang - 0.42));
  ctx.lineTo(tipX - size * Math.cos(ang + 0.42), tipY - size * Math.sin(ang + 0.42));
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawStation(s, t) {
  const p = stationPos.get(s.id);
  if (!p) return;
  const color = s.status === 'busy' ? C.green : s.status === 'ringing' ? C.amber : C.dim;
  const active = s.status !== 'idle';
  const r = 7 * dpr;

  if (s.status === 'ringing') ring(p.x, p.y, r + (4 + 3 * Math.sin(t / 130)) * dpr, C.amber, 0.5);

  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = active ? color : C.bg;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * dpr;
  if (active) { ctx.shadowColor = color; ctx.shadowBlur = 12 * dpr; }
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  const lx = p.x + Math.cos(p.a) * 18 * dpr;
  const ly = p.y + Math.sin(p.a) * 18 * dpr;
  ctx.textAlign = Math.cos(p.a) < -0.25 ? 'right' : Math.cos(p.a) > 0.25 ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${13 * dpr}px ${FONT}`;
  ctx.fillStyle = active ? C.ink : C.dim;
  ctx.fillText(s.id, lx, ly);
  if (s.name && s.name !== s.id) {
    ctx.font = `${10 * dpr}px ${FONT}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(s.name, lx, ly + 13 * dpr);
  }
  ctx.textAlign = 'start';
}

// Recorded message: drawn as a little tape reel.
function drawService(s) {
  const p = servicePos.get(s.id);
  if (!p) return;
  const active = s.status !== 'idle';
  const color = active ? C.magenta : C.violet;
  const r = 13 * dpr;

  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#160a18';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2 * dpr;
  if (active) { ctx.shadowColor = color; ctx.shadowBlur = 16 * dpr; }
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  // reel hub
  ctx.beginPath();
  ctx.arc(p.x, p.y, 4 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // name, pushed outward from center
  const lx = p.x + Math.cos(p.a) * (r + 10 * dpr);
  const ly = p.y + Math.sin(p.a) * (r + 10 * dpr);
  ctx.textAlign = Math.cos(p.a) < -0.25 ? 'right' : Math.cos(p.a) > 0.25 ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${11 * dpr}px ${FONT}`;
  ctx.fillStyle = active ? C.magenta : C.violet;
  // Several visitors can be on one recording at once — show how many.
  const listeners = state.calls.filter(
    (c) => c.state === 'connected' && (c.toId === s.id || c.fromId === s.id)
  ).length;
  const text = (s.name || s.id) + (listeners > 1 ? `  ×${listeners}` : '');
  ctx.fillText(text, lx, ly);
  ctx.textAlign = 'start';

  // Reserve the reel + its name so call labels don't land on top of them.
  const tw = ctx.measureText(text).width;
  reserved.push({ x: Math.min(lx - tw, p.x - r) - 4 * dpr, y: p.y - r - 8 * dpr,
                  w: tw + 2 * r + 8 * dpr, h: 2 * r + 16 * dpr });
}

function drawHub() {
  const x = hub.x - hub.w / 2, y = hub.y - hub.h / 2;
  roundRect(x, y, hub.w, hub.h, 4 * dpr);
  ctx.fillStyle = '#120c00';
  ctx.fill();
  ctx.strokeStyle = C.hub;
  ctx.lineWidth = 2.4 * dpr;
  ctx.shadowColor = C.hub;
  ctx.shadowBlur = 14 * dpr;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.hub;
  ctx.font = `700 ${14 * dpr}px ${FONT}`;
  ctx.fillText('LONG LINES', hub.x, hub.y - 7 * dpr);
  ctx.fillStyle = C.dim;
  ctx.font = `${9 * dpr}px ${FONT}`;
  ctx.fillText('PSTN · TOLL', hub.x, hub.y + 9 * dpr);
  ctx.textAlign = 'start';
}

// ---- helpers ----
const FONT = `"DejaVu Sans Mono", Menlo, monospace`;

function ring(x, y, r, color, alpha) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/* Labels are queued while the arcs are drawn, then flushed last so they sit on
 * top of everything. Each one is nudged vertically until it stops colliding with
 * a label already placed (or with the toll box), which keeps the busy middle of
 * the board readable. */
let labelQueue = [];
let reserved = []; // areas call labels must avoid (recording reels + names)

function label(x, y, text, color, size) {
  labelQueue.push({ x, y, text, color, size });
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function flushLabels() {
  // Seed with the toll box and the recording reels so labels never cover them.
  const placed = [{ x: hub.x - hub.w / 2, y: hub.y - hub.h / 2, w: hub.w, h: hub.h }, ...reserved];
  const h = 16 * dpr;

  for (const L of labelQueue) {
    ctx.font = `${L.size * dpr}px ${FONT}`;
    const w = ctx.measureText(L.text).width + 8 * dpr;
    let y = L.y;
    for (let i = 1; i <= 14; i++) {
      const rect = { x: L.x - w / 2, y: y - h / 2, w, h };
      if (!placed.some((r) => overlaps(r, rect))) break;
      // alternate above / below, stepping further out each time
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

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
