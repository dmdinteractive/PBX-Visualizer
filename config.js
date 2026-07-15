// Loads config.json and applies optional environment-variable overrides.
// Env overrides are handy for keeping the AMI secret out of the file:
//   PBXV_MODE, PBXV_PORT, PBXV_AMI_HOST, PBXV_AMI_PORT, PBXV_AMI_USER, PBXV_AMI_SECRET
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const raw = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));
const env = process.env;

export const config = {
  site: raw.site ?? 'BELL SYSTEM',
  subtitle: raw.subtitle ?? 'LONG LINES — LIVE TRAFFIC',
  mode: env.PBXV_MODE ?? raw.mode ?? 'simulate',
  port: Number(env.PBXV_PORT ?? raw.port ?? 8080),
  ami: {
    host: env.PBXV_AMI_HOST ?? raw.ami?.host ?? '127.0.0.1',
    port: Number(env.PBXV_AMI_PORT ?? raw.ami?.port ?? 5038),
    username: env.PBXV_AMI_USER ?? raw.ami?.username ?? 'visualizer',
    secret: env.PBXV_AMI_SECRET ?? raw.ami?.secret ?? '',
  },
  // Keep only real station entries (drop the "//stations" doc key etc.)
  stations: (raw.stations ?? []).filter((s) => s && s.id),
};
