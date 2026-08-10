// Loads config.json — the exhibit's *presentation* settings only: names, node
// labels, and the lists of phones and automated messages. The admin UI writes
// this file back, so the raw contents are kept around and re-merged on save
// rather than regenerated from scratch (that preserves the "//" comment keys
// people put in the file by hand).
//
// The switch connection is NOT here. It is hard-coded in pbx.js so that a
// reimaged Pi comes straight back up. Nothing in this file or in /admin can
// change it.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PBX } from './pbx.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const configPath = join(__dirname, 'config.json');
const examplePath = join(__dirname, 'config.example.json');

// config.json is per-installation (the admin UI rewrites it), so it isn't
// tracked in git. Bootstrap it on first run.
if (!existsSync(configPath) && existsSync(examplePath)) {
  copyFileSync(examplePath, configPath);
  console.log('[pbxv] created config.json from config.example.json');
}

const env = process.env;
let raw = {};

function applyRaw() {
  return {
    site: raw.site ?? 'BELL SYSTEM',
    subtitle: raw.subtitle ?? 'LIVE TELEPHONY DIAGRAM',
    exhibit: env.PBXV_EXHIBIT ?? raw.exhibit ?? 'HELLO!',
    officeName: raw.officeName ?? 'CENTRAL SWITCHING OFFICE',
    messagesName: raw.messagesName ?? 'AUTOMATED MESSAGES',
    tollName: raw.tollName ?? 'LONG LINES',
    port: Number(env.PBXV_PORT ?? raw.port ?? 8080),
    stations: (raw.stations ?? []).filter((s) => s && s.id),
    services: (raw.services ?? []).filter((s) => s && s.id),

    // Read-only mirrors of pbx.js, so the rest of the app has one place to look.
    mode: PBX.mode,
    ami: { host: PBX.host, port: PBX.port, username: PBX.username, secret: PBX.secret },
  };
}

export function loadConfig() {
  raw = JSON.parse(readFileSync(configPath, 'utf8'));
  return applyRaw();
}

export const config = loadConfig();

// Merge an admin edit into config.json and into the live config object.
// `mode` and `ami` are deliberately not accepted — they belong to pbx.js.
export function saveConfig(patch) {
  const next = { ...raw };
  for (const k of ['site', 'subtitle', 'exhibit', 'officeName', 'messagesName', 'tollName']) {
    if (patch[k] !== undefined) next[k] = patch[k];
  }
  if (patch.port !== undefined) next.port = Number(patch.port);
  if (patch.stations) next.stations = patch.stations.map((s) => ({ id: String(s.id), name: s.name || '' }));
  if (patch.services) next.services = patch.services.map((s) => ({ id: String(s.id), name: s.name || '' }));

  // Old files may still carry these; drop them so nobody edits them expecting
  // an effect.
  delete next.mode;
  delete next.ami;

  writeFileSync(configPath, JSON.stringify(next, null, 2));
  raw = next;
  Object.assign(config, applyRaw());
  return config;
}

// What /api/config is allowed to hand to a browser — never the secret.
export function publicConfig() {
  const { ami, ...rest } = config;
  return { ...rest, ami: { host: ami.host, port: ami.port, username: ami.username } };
}
