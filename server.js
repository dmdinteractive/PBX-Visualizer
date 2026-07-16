// PBX Long Lines Visualizer — web server.
//   * builds the shared CallState
//   * starts either the simulator or the live AMI feed
//   * serves the static UI and pushes state snapshots over WebSocket
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { WebSocketServer } from 'ws';

import { config } from './config.js';
import { CallState } from './lib/state.js';
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
};

const state = new CallState(config.stations);
state.site = config.site;
state.subtitle = config.subtitle;
state.exhibit = config.exhibit;

// --- HTTP: serve the ./public directory -----------------------------------
const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = normalize(join(PUBLIC, urlPath));
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

// --- WebSocket: broadcast state snapshots ---------------------------------
const wss = new WebSocketServer({ server });

function broadcast() {
  const msg = JSON.stringify(state.snapshot());
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify(state.snapshot())); // send current picture immediately
});

// Push on every change, and a low-rate heartbeat so clock/uptime stay fresh.
let dirty = false;
state.on('change', () => { dirty = true; });
setInterval(() => {
  if (dirty) {
    dirty = false;
    broadcast();
  }
}, 200);
setInterval(broadcast, 3000);

// --- Data source ----------------------------------------------------------
let stop = () => {};
if (config.mode === 'ami') {
  console.log('[pbxv] mode: AMI (live PBX)');
  stop = startAmi(state, config.ami);
} else {
  console.log('[pbxv] mode: simulate');
  stop = startSimulator(state);
}

server.listen(config.port, () => {
  console.log(`[pbxv] ${config.site} visualizer on http://0.0.0.0:${config.port}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n[pbxv] shutting down');
    stop();
    server.close();
    process.exit(0);
  });
}
