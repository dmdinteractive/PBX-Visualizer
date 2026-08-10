// ============================================================================
// PBX CONNECTION — hard-coded on purpose.
//
// This is the ONLY place the switch connection lives. It is deliberately not in
// config.json and not editable from /admin, so that wiping and reimaging the Pi
// and cloning this repo brings the exhibit straight back up with no
// reconfiguration.
//
//   >> THE SECRET IS NOT HERE, AND MUST NOT BE. This file is committed to a
//   >> public repository. The secret lives in /etc/default/pbx-visualizer,
//   >> which is root-only and read by the systemd unit as PBXV_AMI_SECRET.
//   >> deploy/install.sh asks for it once and writes it there.
//
// To change the secret on a running exhibit:
//   echo 'PBXV_AMI_SECRET=xxxxxxxx' | sudo tee /etc/default/pbx-visualizer
//   sudo chmod 600 /etc/default/pbx-visualizer
//   sudo systemctl restart pbx-visualizer
//
// The manager user should be read-only (Read: call,system / Write: none) and
// permitted only from this Pi's IP, which limits what a leaked secret is worth.
//
// Every value can be overridden by an environment variable, which is how you
// test against a different switch without editing this file:
//
//   PBXV_MODE=simulate npm start
//   PBXV_AMI_HOST=10.10.2.99 npm start
// ============================================================================

const env = process.env;

export const PBX = {
  // 'ami' talks to the real switch. 'simulate' invents plausible traffic and
  // needs no PBX at all — useful for testing the TV before the phones are live.
  mode: env.PBXV_MODE ?? 'ami',

  host: env.PBXV_AMI_HOST ?? '10.10.2.57',
  port: Number(env.PBXV_AMI_PORT ?? 5038),
  username: env.PBXV_AMI_USER ?? 'visualizer',
  // Deliberately empty: supplied by /etc/default/pbx-visualizer at runtime.
  secret: env.PBXV_AMI_SECRET ?? '',
};

// How hard the client works to stay connected. See lib/ami.js.
export const LINK = {
  connectTimeoutMs: 10000, // give up on a connect attempt that stalls
  heartbeatMs: 15000,      // send an AMI Ping this often
  silenceTimeoutMs: 45000, // no traffic at all for this long = dead link, reconnect
  backoffMinMs: 2000,      // first retry delay
  backoffMaxMs: 60000,     // ceiling for the exponential backoff
  authBackoffMs: 60000,    // a rejected login is a config problem: retry slowly
};
