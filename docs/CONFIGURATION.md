# Configuration

Settings live in three places, deliberately separated by how often they change
and by whether they are a secret.

| What | Where | Changed by |
|---|---|---|
| Switch address, port, username, mode | `pbx.js` | Editing the file, then restarting the service |
| AMI secret | `/etc/default/pbx-visualizer` | `install.sh`, or by hand |
| Exhibit names, phones, automated messages | `config.json` | The admin UI at `/admin` |

## pbx.js — the switch connection

Hard-coded on purpose. The point is that reimaging the Pi and cloning this
repository brings the exhibit back with nothing to reconfigure — the mistake it
prevents is losing the connection details along with the SD card.

```js
export const PBX = {
  mode: env.PBXV_MODE ?? 'ami',        // 'ami' | 'simulate'
  host: env.PBXV_AMI_HOST ?? '10.10.2.57',
  port: Number(env.PBXV_AMI_PORT ?? 5038),
  username: env.PBXV_AMI_USER ?? 'visualizer',
  secret: env.PBXV_AMI_SECRET ?? '',   // supplied at runtime, see below
};
```

After editing:

```bash
sudo systemctl restart pbx-visualizer
```

`pbx.js` also carries the link tuning, which you should not normally need to
touch:

| Setting | Default | Meaning |
|---|---|---|
| `connectTimeoutMs` | 10000 | Abandon a connect or login that stalls |
| `heartbeatMs` | 15000 | How often to send an AMI `Ping` |
| `silenceTimeoutMs` | 45000 | No traffic at all for this long means a dead link |
| `backoffMinMs` | 2000 | First retry delay |
| `backoffMaxMs` | 60000 | Ceiling for the exponential backoff |
| `authBackoffMs` | 60000 | Retry delay after a rejected login |

## The AMI secret

**The secret is not in `pbx.js`, and must not be** — this repository is public,
so anything committed to it is world-readable. It lives in
`/etc/default/pbx-visualizer`, which the systemd unit loads as
`PBXV_AMI_SECRET`:

```
PBXV_AMI_SECRET=xxxxxxxx
```

`deploy/install.sh` asks for it once and writes it with mode 0600, owned by
root. To change it later:

```bash
echo 'PBXV_AMI_SECRET=xxxxxxxx' | sudo tee /etc/default/pbx-visualizer
sudo chmod 600 /etc/default/pbx-visualizer
sudo systemctl restart pbx-visualizer
```

Without a secret the board still runs — the link simply reports
`LOGIN REJECTED` and the journal says why.

The unit references the file with `EnvironmentFile=-/etc/default/pbx-visualizer`.
The leading `-` means a missing file does not stop the service from starting.

## config.json — the exhibit

Presentation only; no credentials. Created from `config.example.json` on first
run and rewritten by the admin UI, so it is **not tracked in git**.

| Key | Meaning |
|---|---|
| `exhibit`, `subtitle` | Title block text |
| `site` | Site name |
| `officeName`, `messagesName`, `tollName` | The three node labels on the diagram |
| `port` | HTTP port for the board and admin UI (default 8080) |
| `stations[]` | Visitor handsets, `{ "id", "name" }` — `name` may be blank |
| `services[]` | Automated messages / ghost extensions, `{ "id", "name" }` |

Anything not listed in `stations` or `services` is treated as the outside world
and drawn through the **LONG LINES** toll node.

**Back this file up.** It is not in git, and reimaging the Pi destroys it.

## The admin UI

At `http://<pi>:8080/admin`. It edits exhibit names, node labels, and the two
extension lists, including an "add a range" helper for 101–131. Saving applies
to the running board immediately — no restart, and the TV updates itself.

The switch connection is shown there **read-only**. It cannot be changed from
the browser, and `/api/config` never returns the secret.

There is no authentication on the admin UI. Keep the board on a trusted LAN.

## Environment overrides

Every connection value can be overridden by an environment variable, which is
how to test without editing files:

| Variable | Overrides |
|---|---|
| `PBXV_MODE` | `simulate` or `ami` |
| `PBXV_AMI_HOST`, `PBXV_AMI_PORT` | Switch address |
| `PBXV_AMI_USER`, `PBXV_AMI_SECRET` | Manager credentials |
| `PBXV_PORT` | HTTP port |
| `PBXV_EXHIBIT` | Title block name |
| `PBXV_URL` | Where `kiosk.sh` points the browser |

For example, to run the board with invented traffic and no PBX at all:

```bash
npm run simulate
```
