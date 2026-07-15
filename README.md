# PBX Long Lines Visualizer

A live, retro **AT&T Long Lines / Bell System** style traffic display for your
Crosstalk 760 / FreePBX phone system. Extensions sit around a ring as switching
stations; a central **LONG LINES / PSTN** toll hub represents the outside world.
Ringing calls pulse amber, connected calls flow green, and outside calls route
to the hub — all updating live on a TV.

```
 FreePBX / Asterisk  ──AMI events──▶  this Node service  ──WebSocket──▶  browser (fullscreen TV)
```

It ships with a **simulator** so it looks alive the moment you start it — before
you've touched the PBX. Flip one setting to switch to your live phone system.

---

## 1. Quick start (see it running in 2 minutes)

On any computer with [Node.js 18+](https://nodejs.org):

```bash
cd "PBX Visualizer"
npm install
npm start
```

Open **http://localhost:8080** in a browser. You'll see simulated traffic
immediately. Press F11 for fullscreen. That's the whole look — now let's make it
show *your* phones.

---

## 2. Configure your extensions

Edit [`config.json`](config.json). Replace the sample `stations` with your real
extensions — the `id` must match the extension number in FreePBX; `name` is just
a friendly label shown on screen:

```json
"stations": [
  { "id": "1001", "name": "FRONT DESK" },
  { "id": "1002", "name": "SALES" }
]
```

Anything **not** in this list (mobile numbers, landlines, trunks) is treated as
an outside line and routed to the LONG LINES hub. You can also set `site` and
`subtitle` for the header text.

---

## 3. Connect it to FreePBX (go live)

### a) Create an AMI (Manager) user in FreePBX

1. In the FreePBX web UI: **Settings → Asterisk Manager Users → Add Manager**.
2. Set:
   - **Manager name:** `visualizer`
   - **Manager secret:** a strong password (you'll paste it into config)
   - **Deny:** `0.0.0.0/0.0.0.0`
   - **Permit:** the IP of the device running this visualizer, e.g.
     `192.168.1.50/255.255.255.255` (or your LAN, e.g. `192.168.1.0/255.255.255.0`)
   - **Read permissions:** tick **call** and **system** (read is enough — this
     tool never sends commands that change calls)
   - **Write permissions:** none needed
3. Submit and **Apply Config**.

> Prefer the file? The same thing lives in `/etc/asterisk/manager.conf` (or
> `manager_custom.conf`). AMI listens on TCP **5038**; keep that port on the LAN
> only — never expose it to the internet.

### b) Point the visualizer at your PBX

In `config.json`:

```json
"mode": "ami",
"ami": {
  "host": "192.168.1.10",     // your FreePBX box IP
  "port": 5038,
  "username": "visualizer",
  "secret": "the-password-you-set"
}
```

Restart (`npm start`). The header should read **LINK ACTIVE** and real calls
will appear. To keep the secret out of the file, leave it blank and pass
`PBXV_AMI_SECRET=... npm start` instead.

Make a test call between two extensions — you should see them light up and a line
connect them.

---

## 4. Put it on the TV (single Raspberry Pi)

One Raspberry Pi runs **both** the service and the fullscreen display. A Pi 4 or
Pi 5 is ideal. Use **Raspberry Pi OS (64-bit, Desktop)**.

### a) Install Node + the app

```bash
sudo apt update && sudo apt install -y nodejs npm git
git clone <this-folder-onto-the-pi>   # or copy it over with scp / a USB stick
cd "PBX Visualizer"
npm install
```

Verify it runs: `npm start`, then browse to `http://localhost:8080` on the Pi.

### b) Run it automatically on boot (systemd)

Create `/etc/systemd/system/pbx-visualizer.service` (adjust the paths/user):

```ini
[Unit]
Description=PBX Long Lines Visualizer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/PBX Visualizer
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pbx-visualizer
```

### c) Launch Chromium fullscreen (kiosk) on boot

Install Chromium and an idle-hider:

```bash
sudo apt install -y chromium-browser unclutter
```

Create `~/.config/autostart/kiosk.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=Long Lines Kiosk
Exec=chromium-browser --kiosk --incognito --noerrdialogs --disable-infobars \
     --check-for-update-interval=31536000 --app=http://localhost:8080
X-GNOME-Autostart-enabled=true
```

Prevent the screen from blanking — add to `~/.config/lxsession/LXDE-pi/autostart`:

```
@xset s off
@xset -dpms
@xset s noblank
@unclutter -idle 0
```

Reboot. The Pi boots straight into the fullscreen visualizer. Done.

> Tip: set the Pi to auto-login to the desktop with `sudo raspi-config` →
> *System Options → Boot / Auto Login → Desktop Autologin*.

---

## Configuration reference

| Setting            | Meaning                                                        |
|--------------------|----------------------------------------------------------------|
| `mode`             | `simulate` (fake traffic) or `ami` (live PBX)                  |
| `port`             | Web port (default 8080)                                        |
| `site` / `subtitle`| Header text                                                   |
| `stations[]`       | Your extensions: `{ "id", "name" }`                            |
| `ami.host/port`    | FreePBX IP and AMI port (5038)                                 |
| `ami.username`     | Manager username                                              |
| `ami.secret`       | Manager secret (or via `PBXV_AMI_SECRET` env var)             |

Env overrides: `PBXV_MODE`, `PBXV_PORT`, `PBXV_AMI_HOST`, `PBXV_AMI_PORT`,
`PBXV_AMI_USER`, `PBXV_AMI_SECRET`.

---

## How it works

- **`lib/ami.js`** — connects to AMI, watches `DialBegin/DialEnd`,
  `BridgeEnter/BridgeLeave`, and `Hangup`, and translates them into calls.
- **`lib/state.js`** — the shared live picture of stations and calls.
- **`lib/simulator.js`** — synthesizes realistic traffic for demo/setup.
- **`server.js`** — serves the UI and pushes state over WebSocket.
- **`public/`** — the retro canvas visualizer.

Designed for ordinary two-party calls (the bulk of office traffic). Conference
rooms and complex queue/ring-group flows still show up, just represented as the
individual legs Asterisk reports.

---

## Troubleshooting

- **Header says LINK DOWN, no calls:** you're either in `simulate` mode, or the
  browser can't reach the service. In `ami` mode also check the server console
  for `[ami]` messages.
- **`[ami] error response: Authentication failed`:** wrong username/secret, or
  the device IP isn't in the manager user's **Permit** list.
- **Connected but no calls appear:** confirm the manager user has **call** read
  permission, and that your test call is between IDs listed (or correctly falls
  to the hub as external).
- **Nothing on port 5038:** make sure you're pointing at the FreePBX box IP and
  that a firewall isn't blocking it on the LAN.
