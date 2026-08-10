# HELLO! — Live Telephony Diagram

A live, monochrome telephony diagram for the **Hello! Exhibit** phone system,
drawn in the language of the CMD Networking telephony diagrams: a
**CENTRAL SWITCHING OFFICE** with every visitor handset on its own subscriber
line, an **AUTOMATED MESSAGES** node the ghost extensions hang off, and a
bidirectional trunk line out to **LONG LINES**.

Calls appear live as arcs from caller to destination:
open circle = on-hook · filled circle = in use · dashed = ringing.

```
 FreePBX / Asterisk  ──AMI events──▶  this Node service  ──WebSocket──▶  browser (fullscreen TV)
                                            └── admin UI at /admin
```

It reads the [Hello! exhibit dialplan](https://github.com/dmdinteractive/Hello_Exhibit_PBX):
a visitor lifts a handset, PLAR dials **500**, and the switch connects them to a
random real phone (101–131, 75%) or a **ghost** recording (201–207, 25%).
Extension **501** carries inbound calls from the published number to real phones
only. Nobody can dial out.

---

## Quick start

```bash
npm install
npm start
```

- Board: **http://localhost:8080**
- Settings: **http://localhost:8080/admin**

First run copies `config.example.json` → `config.json`. The switch connection
comes from [`pbx.js`](pbx.js); to see the board without a PBX at all:

```bash
npm run simulate
```

---

## Settings

The **admin UI at `/admin`** covers the presentation: exhibit name, node labels,
and the list of phones and automated messages (with an "add a range" helper for
101–131). Saving writes `config.json` and applies to the running board
immediately.

The **switch connection is not there**. Host, port and username are hard-coded
in [`pbx.js`](pbx.js), so reimaging the Pi and cloning this repo brings the
exhibit back with nothing to reconfigure. `/admin` shows it read-only. To change
it, edit `pbx.js` and `sudo systemctl restart pbx-visualizer`.

**The secret is deliberately not in `pbx.js`** — this repository is public. It
lives in `/etc/default/pbx-visualizer`, root-readable only, which the systemd
unit loads as `PBXV_AMI_SECRET`. `deploy/install.sh` asks for it once. To change
it later:

```bash
echo 'PBXV_AMI_SECRET=xxxxxxxx' | sudo tee /etc/default/pbx-visualizer
sudo chmod 600 /etc/default/pbx-visualizer
sudo systemctl restart pbx-visualizer
```

Without it the board still runs — the link just reports `LOGIN REJECTED` and the
journal says why.

`config.json` is **not tracked in git** — the admin UI rewrites it. Keep
`config.example.json` as the template. It holds no credentials.

| Setting | Where | Meaning |
|---|---|---|
| `mode` | `pbx.js` | `ami` (live PBX) or `simulate` (fake traffic) |
| `host`, `port`, `username` | `pbx.js` | Where the switch is |
| secret | `/etc/default/pbx-visualizer` | Kept out of git — see above |
| `exhibit`, `subtitle` | `config.json` | Title block text |
| `officeName`, `messagesName`, `tollName` | `config.json` | The three node labels |
| `stations[]` | `config.json` | Visitor handsets, `{ "id", "name" }` |
| `services[]` | `config.json` | Ghost extensions 201–207 |

Env overrides, for testing without editing files:
`PBXV_MODE=simulate`, `PBXV_AMI_HOST`, `PBXV_AMI_PORT`, `PBXV_AMI_USER`,
`PBXV_AMI_SECRET`, `PBXV_PORT`, `PBXV_EXHIBIT`.

### Today's traffic

The board draws call volume across the day in 15-minute buckets, bottom left.
It resets at **local midnight**, and it is written to `traffic.json` so a
restart — the watchdog, an update, a power cut — doesn't erase the morning.
"Calls today" counts the same thing, so it no longer resets when the service
does.

---

## Connecting to FreePBX

Put the host/username into [`pbx.js`](pbx.js) (the secret is asked for by
`deploy/install.sh`), then set up the manager user:

1. **Settings → Asterisk Manager Users → Add Manager**
   - Manager name: `visualizer`, and a strong secret
   - **Deny:** `0.0.0.0/0.0.0.0` · **Permit:** the Pi's IP, e.g. `10.10.2.156/255.255.255.255`
   - **Read:** tick **Call** and **System**. **Write:** none.
2. **Submit**, then **Apply Config**.
3. AMI must listen beyond loopback — in `/etc/asterisk/manager.conf`:
   ```ini
   [general]
   enabled = yes
   port = 5038
   bindaddr = 0.0.0.0
   ```
   then `asterisk -rx "manager reload"`. Verify with `ss -tlnp | grep 5038`.
4. Restart the service. The board's **Switch link** readout reports the real
   state of the AMI connection — `ACTIVE`, `CONNECTING`, `LOGIN REJECTED` or
   `DOWN` — so it tells you directly whether step 1–3 worked.

Keep port 5038 on the LAN. Never expose it to the internet.

---

## The font

The pages ask for **Prestige Elite Std** first. It's a licensed Adobe face, so
it can't ship here — drop your copy into `public/fonts/` and it's picked up
automatically. See [`public/fonts/README.md`](public/fonts/README.md). Until
then it falls back to Courier Prime → Courier New → system monospace.

---

## Running it on the TV (Raspberry Pi)

One Pi runs both the service and the fullscreen browser. `deploy/install.sh`
sets up the whole cold-start path — board on boot, browser fullscreen on the
board, and both kept alive.

```bash
sudo apt update && sudo apt install -y nodejs npm git
git clone https://github.com/dmdinteractive/PBX-Visualizer.git ~/pbx-visualizer
cd ~/pbx-visualizer
./deploy/install.sh
sudo reboot
```

Run it as the desktop user that owns the screen — **not** with `sudo`; it calls
`sudo` itself where it needs to. It is safe to re-run after a `git pull`.

What it puts in place:

| Piece | What it does |
|---|---|
| `pbx-visualizer.service` | Runs `server.js` on boot, restarts on crash, forever (no start-limit lockout) |
| `pbx-visualizer-watchdog.timer` | Every minute, `GET /healthz`; restarts the service if it stops answering |
| `deploy/kiosk.sh` via autostart | Waits for the board, then holds Chromium fullscreen on it — relaunching if it is closed or crashes |
| Chromium crash-flag scrub | A yanked power cord can't leave a "Restore pages?" bubble over the board |
| `raspi-config` | Screen blanking off, boot to desktop with autologin |
| `/etc/default/pbx-visualizer` | The AMI secret, asked for once, root-only, kept out of git |

The kiosk registers with XDG autostart *and* with labwc or wayfire if the Pi is
running one, so it survives whichever session Pi OS boots into.

Options: `--url URL` (point the TV elsewhere), `--no-kiosk` (service only),
`--no-autologin`, `--no-deps`. `./deploy/uninstall.sh` removes the lot.

Nothing here needs the browser to be touched again: the page reconnects its
WebSocket on its own, so a service restart or a PBX blip heals without anyone
walking up to the TV.

---

## Day to day

| Task | Command |
|---|---|
| Live logs | `journalctl -u pbx-visualizer -f` |
| Restart | `sudo systemctl restart pbx-visualizer` |
| Is it alive? | `curl localhost:8080/healthz` |
| Update | `cd ~/pbx-visualizer && git pull && ./deploy/install.sh` |
| Restart just the TV browser | `pkill chromium` (the kiosk relaunches it) |
| Watchdog history | `journalctl -t pbxv-watchdog` |

Most settings no longer need a restart — use `/admin`.

---

## How it works

- **`pbx.js`** — the hard-coded switch connection and the link tuning
  (backoff, heartbeat, timeouts). The only file to edit to point at a new PBX.
- **`lib/ami.js`** — AMI client. Watches `Dial*`, `Bridge*`, `Hangup`. Ghost legs
  are `Local/<exten>@from-internal` channels with no endpoint, so they're
  resolved by the extension in the channel name. Built to stay up unattended:
  exponential backoff with jitter, TCP keepalive, an AMI `Ping` heartbeat that
  catches a half-open socket, and a rejected login backed off slowly and
  reported rather than retried in a hot loop. Losing the link clears the live
  calls so the TV can't show phantom traffic.
- **`lib/traffic.js`** — today's call counts in 15-minute buckets; resets at
  local midnight, survives restarts.
- **`lib/state.js`** — the live picture: stations, services, calls.
- **`lib/simulator.js`** — models the real dialplan (PLAR 75/25, inbound via 501,
  never double-books a phone).
- **`server.js`** — static files, `/api/config` (never serves the AMI secret),
  `/healthz`, WebSocket broadcast.
- **`public/`** — the board (`app.js`) and the admin UI (`admin.js`).
- **`deploy/`** — systemd units, the kiosk launcher and the installer.

---

## Troubleshooting

- **Board says `LOGIN REJECTED`** — wrong secret in `pbx.js`, or the Pi's IP
  isn't in the manager user's **Permit** list. `journalctl -u pbx-visualizer`
  prints the switch's own words.
- **Switch link DOWN** — check the address in `pbx.js`; from the Pi try
  `nc -zv <pbx-ip> 5038`. "Connection refused" means AMI isn't listening on the
  LAN (see `bindaddr` above).
- **A real call shows as an outside call** — that extension is missing from the
  phones list in `/admin`.
- **Board is fine but the TV shows a desktop** — the session isn't running the
  kiosk. Check `journalctl -b | grep kiosk`, and that autologin is on
  (`sudo raspi-config` → *System Options → Boot / Auto Login → Desktop Autologin*).
  Run `~/pbx-visualizer/deploy/kiosk.sh` by hand to see the error.
- **TV shows "site can't be reached"** — the browser beat the service to it.
  `systemctl status pbx-visualizer` will say why the service didn't come up;
  `pkill chromium` retries once it has.
- **Screen goes black after ten minutes** — blanking came back on. Re-run
  `sudo raspi-config nonint do_blanking 1`.
- **The board blinks white** — the canvas only repaints when the state changes,
  so a flash means the browser dropped a frame, not the app. Check
  `~/.cache/pbx-kiosk.log` for GPU process crashes; if there are any, add
  `--disable-gpu-compositing` to the Chromium line in `deploy/kiosk.sh`. The
  board is cheap enough to draw that software compositing keeps up.
