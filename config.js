// Loads config.json and applies optional environment-variable overrides.
// Env overrides are handy for keeping the AMI secret out of the file:
//   PBXV_MODE, PBXV_PORT, PBXV_AMI_HOST, PBXV_AMI_PORT, PBXV_AMI_USER, PBXV_AMI_SECRET
//
// The admin UI writes this file back, so the raw contents are kept around and
// re-merged on save rather than regenerated from scratch (that preserves the
// "//" comment keys people put in the file by hand).
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const configPath = join(__dirname, 'config.json');
const examplePath = join(__dirname, 'config.example.json');

// config.json is per-installation (it holds the AMI secret and is rewritten by
// the admin UI), so it isn't tracked in git. Bootstrap it on first run.
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
    mode: env.PBXV_MODE ?? raw.mode ?? 'simulate',
    port: Number(env.PBXV_PORT ?? raw.port ?? 8080),
    ami: {
      host: env.PBXV_AMI_HOST ?? raw.ami?.host ?? '127.0.0.1',
      port: Number(env.PBXV_AMI_PORT ?? raw.ami?.port ?? 5038),
      username: env.PBXV_AMI_USER ?? raw.ami?.username ?? 'visualizer',
      secret: env.PBXV_AMI_SECRET ?? raw.ami?.secret ?? '',
    },
    stations: (raw.stations ?? []).filter((s) => s && s.id),
    services: (raw.services ?? []).filter((s) => s && s.id),
  };
}

export function loadConfig() {
  raw = JSON.parse(readFileSync(configPath, 'utf8'));
  return applyRaw();
}

export const config = loadConfig();

// Merge an admin edit into config.json and into the live config object.
export function saveConfig(patch) {
  const next = { ...raw };
  for (const k of ['site', 'subtitle', 'exhibit', 'officeName', 'messagesName', 'tollName', 'mode']) {
    if (patch[k] !== undefined) next[k] = patch[k];
  }
  if (patch.port !== undefined) next.port = Number(patch.port);
  if (patch.ami) next.ami = { ...(raw.ami || {}), ...patch.ami, port: Number(patch.ami.port ?? raw.ami?.port ?? 5038) };
  if (patch.stations) next.stations = patch.stations.map((s) => ({ id: String(s.id), name: s.name || '' }));
  if (patch.services) next.services = patch.services.map((s) => ({ id: String(s.id), name: s.name || '' }));

  writeFileSync(configPath, JSON.stringify(next, null, 2));
  raw = next;
  Object.assign(config, applyRaw());
  return config;
}
