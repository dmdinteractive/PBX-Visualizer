/* HELLO! — Bell System NOC "big board" renderer.
 *
 * Deliberately static: the board is redrawn only when the call state changes
 * or the window resizes — no animation loops, no motion. Stations are lamps
 * on a ring, the LONG LINES hub is the toll gateway, and calls are drawn as
 * plain routes colored by the telephone status code. */

const EXTERNAL = 'EXTERNAL';
const COLORS = {
  navy: '#071320', panel: '#0b1d31', grid: '#0e2135',
  route: '#2f86e0', bell: '#2f86e0', bellDim: '#3d6690',
  green: '#33c26b', amber: '#f2a900', red: '#e43b30', idle: '#37567a',
  ink: '#d7e7fb', inkDim: '#7f9bbd',
};

const canvas = document.getElementById('scope');
const ctx = canvas.getContext('2d');

let state = { stations: [], calls: [], stats: {} };
let stationPos = new Map();
let hub = { x: 0, y: 0, w: 0, h: 0 };
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
  document.title = `${msg.exhibit || 'HELLO!'} — ${msg.site || 'BELL SYSTEM'} NOC`;
  if (msg.exhibit) document.getElementById('exhibit-title').textContent = msg.exhibit;
  if (msg.subtitle) document.getElementById('subtitle').textContent = msg.subtitle;
  if (msg.site) document.querySelector('.wordmark .line1').textContent = msg.site;

  document.getElementById('s-active').textContent = msg.stats.active ?? 0;
  document.getElementById('s-ringing').textContent = msg.stats.ringing ?? 0;
  document.getElementById('s-handled').textContent = msg.stats.handled ?? 0;
  document.getElementById('stations-count').textContent = msg.stations.length;
  document.getElementById('uptime').textContent = hms(msg.stats.uptimeMs ?? 0);
  setSysStatus(msg.stats);

  layout();
  render();
  renderList();
}

function setSysStatus(stats) {
  const el = document.getElementById('sysstatus');
  const active = stats.active ?? 0;
  const ringing = stats.ringing ?? 0;
  let cls = 'normal', txt = 'NORMAL';
  if (active + ringing >= 12) { cls = 'alarm'; txt = 'HEAVY'; }
  else if (active + ringing > 0) { cls = 'busy'; txt = 'ACTIVE'; }
  el.className = 'sys ' + cls;
  el.querySelector('b').textContent = txt;
}

// ---- geometry ----
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  layout();
  render();
}

function layout() {
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) * 0.38;
  hub = { x: cx, y: cy, w: 150 * dpr, h: 66 * dpr, r: R };
  stationPos = new Map();
  const n = state.stations.length;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    stationPos.set(state.stations[i].id, { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, a });
  }
}

function posOf(id) {
  if (id === EXTERNAL) return hub;
  return stationPos.get(id) || hub;
}

function stationColor(status) {
  return status === 'busy' ? COLORS.green : status === 'ringing' ? COLORS.amber : COLORS.idle;
}

// ---- drawing (static) ----
function render() {
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = COLORS.navy;
  ctx.fillRect(0, 0, w, h);
  drawGrid(w, h);
  drawRing();
  for (const c of state.calls) drawRoute(c);
  for (const s of state.stations) drawStation(s);
  drawHub();
}

function drawGrid(w, h) {
  const step = 40 * dpr;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}

function drawRing() {
  if (!hub.r) return;
  ctx.strokeStyle = 'rgba(47,134,224,0.18)';
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.arc(hub.x, hub.y, hub.r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawRoute(c) {
  const p1 = posOf(c.fromId), p2 = posOf(c.toId);
  const ringing = c.state !== 'connected';
  const color = ringing ? COLORS.amber : COLORS.green;
  ctx.strokeStyle = color;
  ctx.lineWidth = (ringing ? 1.4 : 2.4) * dpr;
  if (ringing) ctx.setLineDash([5 * dpr, 5 * dpr]);
  ctx.globalAlpha = ringing ? 0.75 : 1;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawStation(s) {
  const p = stationPos.get(s.id);
  if (!p) return;
  const color = stationColor(s.status);
  const active = s.status !== 'idle';
  const r = 7 * dpr;

  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = active ? color : COLORS.navy;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * dpr;
  if (active) { ctx.shadowColor = color; ctx.shadowBlur = 10 * dpr; }
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // number, pushed radially outward
  const out = p.a;
  const lx = p.x + Math.cos(out) * 18 * dpr;
  const ly = p.y + Math.sin(out) * 18 * dpr;
  ctx.textAlign = Math.cos(out) < -0.25 ? 'right' : Math.cos(out) > 0.25 ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${13 * dpr}px ${cssFont()}`;
  ctx.fillStyle = active ? COLORS.ink : COLORS.inkDim;
  ctx.fillText(s.id, lx, ly);
}

function drawHub() {
  const w = hub.w, h = hub.h;
  const x = hub.x - w / 2, y = hub.y - h / 2;
  roundRect(x, y, w, h, 4 * dpr);
  ctx.fillStyle = COLORS.panel;
  ctx.fill();
  ctx.strokeStyle = COLORS.bell;
  ctx.lineWidth = 2 * dpr;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.bell;
  ctx.font = `700 ${15 * dpr}px ${cssFont()}`;
  ctx.fillText('LONG LINES', hub.x, hub.y - 8 * dpr);
  ctx.fillStyle = COLORS.inkDim;
  ctx.font = `${10 * dpr}px ${cssFont()}`;
  ctx.fillText('PSTN · TOLL GATEWAY', hub.x, hub.y + 10 * dpr);
}

// ---- Alert & Alarm list ----
function renderList() {
  const ul = document.getElementById('calllist');
  const empty = document.getElementById('calllist-empty');
  const calls = [...state.calls].sort((a, b) => a.since - b.since);
  empty.style.display = calls.length ? 'none' : 'block';

  ul.innerHTML = '';
  const rowH = 34;
  const max = Math.max(1, Math.floor((ul.clientHeight || 300) / rowH));
  for (const c of calls.slice(0, max)) {
    const li = document.createElement('li');
    li.className = c.state === 'connected' ? 'busy' : 'ringing';
    const from = c.fromId === EXTERNAL ? (c.fromLabel || 'OUTSIDE') : `STA ${c.fromId}`;
    const to = c.toId === EXTERNAL ? (c.toLabel || 'OUTSIDE') : `STA ${c.toId}`;
    const dur = c.state === 'connected' ? hms(Date.now() - c.since, true) : '';
    li.innerHTML =
      `<span class="state">${c.state === 'connected' ? 'CONN' : 'RING'}</span>` +
      `<span class="route">${esc(from)} <span class="to">▸ ${esc(to)}</span></span>` +
      `<span class="dur">${dur}</span>`;
    ul.appendChild(li);
  }
}

// ---- helpers ----
function cssFont() { return `"Helvetica Neue", Helvetica, Arial, sans-serif`; }
function esc(s) { return String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }

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
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const mons = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  document.getElementById('date').textContent = `${days[d.getDay()]} ${mons[d.getMonth()]} ${d.getDate()}`;
  document.getElementById('clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---- boot ----
window.addEventListener('resize', resize);
setInterval(tickClock, 250);
setInterval(renderList, 1000); // keep connected-call durations current
tickClock();
resize();
connect();
