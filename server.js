// PBX Long Lines Visualizer — web server.
//   * builds the shared CallState
//   * starts either the simulator or the live AMI feed
//   * serves the board (/) and the admin UI (/admin)
//   * pushes state snapshots over WebSocket
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { WebSocketServer } from 'ws';

import { config, saveConfig, publicConfig } from './config.js';
import { CallState } from './lib/state.js';
import { DailyTraffic } from './lib/traffic.js';
import { startSimulator } from './lib/simulator.js';
import { startAmi } from './lib/ami.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

let dirty = false;
const state = new CallState(config.stations, config.services);

// Today's call volume, bucketed for the graph on the board. Survives restarts,
// resets itself at local midnight.
const traffic = new DailyTraffic(join(__dirname, 'traffic.json'));
state.traffic = traffic;
state.on('call', () => traffic.record());
traffic.on('change', () => { dirty = true; });
function applyNames() {
  state.site = config.site;
  state.subtitle = config.subtitle;
  state.exhibit = config.exhibit;
  state.officeName = config.officeName;
  state.messagesName = config.messagesName;
  state.tollName = config.tollName;
}
applyNames();

// --- Data source (simulator or live AMI), restartable from the admin UI ----
let stopSource = () => {};
function startSource() {
  stopSource();
  state.clearCalls();
  if (config.mode === 'ami') {
    console.log('[pbxv] mode: AMI (live PBX)');
    stopSource = startAmi(state, config.ami);
  } else {
    console.log('[pbxv] mode: simulate');
    stopSource = startSimulator(state);
  }
}

// --- HTTP ------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  // ---- config API (used by /admin) ----
  if (url.pathname === '/api/config') {
    if (req.method === 'GET') return json(200, publicConfig());
    if (req.method === 'POST') {
      try {
        const patch = JSON.parse(await readBody(req));

        // Validate before touching anything on disk.
        for (const key of ['stations', 'services']) {
          if (!patch[key]) continue;
          if (!Array.isArray(patch[key])) return json(400, { error: `${key} must be a list` });
          const ids = new Set();
          for (const s of patch[key]) {
            const id = String(s?.id ?? '').trim();
            if (!/^[0-9*#+]{1,10}$/.test(id)) return json(400, { error: `invalid extension "${id}" in ${key}` });
            if (ids.has(id)) return json(400, { error: `duplicate extension "${id}" in ${key}` });
            ids.add(id);
          }
        }
        const overlap = (patch.stations ?? config.stations).some((s) =>
          (patch.services ?? config.services).some((v) => String(v.id) === String(s.id)));
        if (overlap) return json(400, { error: 'an extension cannot be both a phone and an automated message' });

        saveConfig(patch);
        applyNames();
        state.setStations(config.stations);
        state.setServices(config.services);
        broadcast();
        return json(200, { ok: true, config: publicConfig() });
      } catch (err) {
        return json(400, { error: err.message });
      }
    }
    return json(405, { error: 'method not allowed' });
  }

  // ---- liveness (the kiosk launcher waits on this; the watchdog polls it) ----
  if (url.pathname === '/healthz') {
    return json(200, {
      ok: true,
      mode: config.mode,
      link: state.link.status,
      linkDetail: state.link.detail,
      uptimeSec: Math.round(process.uptime()),
      viewers: wss.clients.size,
      stations: state.stations.size,
    });
  }

  // ---- static files ----
  try {
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    if (p === '/admin' || p === '/admin/') p = '/admin.html';
    const filePath = normalize(join(PUBLIC, p));
    if (!filePath.startsWith(PUBLIC)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

// --- WebSocket -------------------------------------------------------------
const wss = new WebSocketServer({ server });

function broadcast() {
  const msg = JSON.stringify(state.snapshot());
  for (const client of wss.clients) if (client.readyState === 1) client.send(msg);
}

wss.on('connection', (ws) => ws.send(JSON.stringify(state.snapshot())));

state.on('change', () => { dirty = true; });
setInterval(() => { if (dirty) { dirty = false; broadcast(); } }, 200);
setInterval(broadcast, 3000);

startSource();

server.listen(config.port, () => {
  console.log(`[pbxv] ${config.exhibit} board   http://0.0.0.0:${config.port}`);
  console.log(`[pbxv] admin UI                  http://0.0.0.0:${config.port}/admin`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n[pbxv] shutting down');
    stopSource();
    traffic.stop();
    server.close();
    process.exit(0);
  });
}
