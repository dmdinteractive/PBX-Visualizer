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

First run copies `config.example.json` → `config.json` and starts in
**simulate** mode, so the board is alive immediately without a PBX.

---

## Settings

Everything is editable in the **admin UI at `/admin`** — exhibit name, node
labels, the switch connection, and the list of phones and automated messages
(with an "add a range" helper for 101–131). Saving writes `config.json` and
applies to the running board immediately; changing the switch connection
reconnects AMI without a restart.

`config.json` is **not tracked in git** — it holds your AMI secret and the admin
UI rewrites it. Keep `config.example.json` as the template.

| Setting | Meaning |
|---|---|
| `mode` | `simulate` (fake traffic) or `ami` (live PBX) |
| `exhibit`, `subtitle` | Title block text |
| `officeName`, `messagesName`, `tollName` | The three node labels |
| `stations[]` | Visitor handsets, `{ "id", "name" }` |
| `services[]` | Ghost extensions 201–207 |
| `ami.*` | FreePBX host / port / username / secret |

Env overrides: `PBXV_MODE`, `PBXV_PORT`, `PBXV_AMI_HOST`, `PBXV_AMI_PORT`,
`PBXV_AMI_USER`, `PBXV_AMI_SECRET`, `PBXV_EXHIBIT`.

---

## Connecting to FreePBX

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
4. In `/admin`, set mode to **Live PBX (AMI)** and fill in the address/secret.

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

- **`lib/ami.js`** — AMI client. Watches `Dial*`, `Bridge*`, `Hangup`. Ghost legs
  are `Local/<exten>@from-internal` channels with no endpoint, so they're
  resolved by the extension in the channel name.
- **`lib/state.js`** — the live picture: stations, services, calls.
- **`lib/simulator.js`** — models the real dialplan (PLAR 75/25, inbound via 501,
  never double-books a phone).
- **`server.js`** — static files, `/api/config`, `/healthz`, WebSocket broadcast.
- **`public/`** — the board (`app.js`) and the admin UI (`admin.js`).
- **`deploy/`** — systemd units, the kiosk launcher and the installer.

---

## Troubleshooting

- **`Authentication failed`** — wrong secret, or the Pi's IP isn't in the manager
  user's **Permit** list.
- **Switch link DOWN** — check the address in `/admin`; from the Pi try
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
