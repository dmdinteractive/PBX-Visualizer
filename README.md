# HELLO! — Live Telephony Diagram

A live, monochrome telephony diagram for the **Hello! Exhibit** phone system,
drawn in the language of the CMD Networking telephony diagrams: a
**CENTRAL SWITCHING OFFICE** with every visitor handset on its own subscriber
line, an **AUTOMATED MESSAGES** node the ghost extensions hang off, and a
bidirectional trunk line out to **LONG LINES**.

A call is shown not by drawing a new line but by **lighting the existing lines
it connects**, in a shared Western Electric colour. Follow a colour from one
phone, through the switching office, to the other to read a connection.

```
FreePBX / Asterisk  ──AMI events──▶  Node service  ──WebSocket──▶  browser (fullscreen TV)
      :5038                            :8080                          └── admin UI at /admin
```

It reads the [Hello! exhibit dialplan](https://github.com/dmdinteractive/Hello_Exhibit_PBX):
a visitor lifts a handset, PLAR dials **500**, and the switch connects them to a
random real phone (101–131, 75%) or a **ghost** recording (201–207, 25%).
Extension **501** carries inbound calls from the published number to real phones
only. Nobody can dial out.

---

## Documentation

| Guide | What's in it |
|---|---|
| [Installing on the Pi](docs/INSTALL.md) | Bare OS to running exhibit, and what the installer sets up |
| [Connecting to FreePBX](docs/CONNECTING-FREEPBX.md) | The manager user, `manager.conf`, and reading the link status |
| [Configuration](docs/CONFIGURATION.md) | `pbx.js`, the secret, `config.json`, the admin UI, env overrides |
| [Running it day to day](docs/OPERATIONS.md) | Updates, logs, health, getting out of the kiosk, backups |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Link failures, kiosk problems, blinking, recovering a lost config |
| [Wiping and rebuilding the Pi](docs/REINSTALL.md) | The full runbook — **back up before you start** |
| [How it works](docs/ARCHITECTURE.md) | Data flow, the AMI client, rendering, endpoints |

---

## Quick start

On any machine, with **Node 18+**:

```bash
npm install
npm run simulate
```

- Board: **http://localhost:8080**
- Settings: **http://localhost:8080/admin**

`npm run simulate` invents plausible traffic and needs no PBX, so the board is
alive immediately. `npm start` talks to the real switch configured in
[`pbx.js`](pbx.js).

On the exhibit Pi:

```bash
git clone https://github.com/dmdinteractive/PBX-Visualizer.git ~/pbx-visualizer
cd ~/pbx-visualizer && ./deploy/install.sh && sudo reboot
```

That installs the board as a service, puts the browser fullscreen on the TV at
boot, and keeps both alive. Full detail in [docs/INSTALL.md](docs/INSTALL.md).

---

## Where settings live

| What | Where |
|---|---|
| Switch address, port, username, mode | [`pbx.js`](pbx.js) — hard-coded, so a reimaged Pi needs no reconfiguration |
| AMI secret | `/etc/default/pbx-visualizer`, root-only — **never committed; this repo is public** |
| Exhibit names, phones, automated messages | `config.json`, edited at `/admin` |

`config.json` and `traffic.json` are not tracked in git. So is the licensed
**Prestige Elite Std** font, which cannot ship here — drop your copy into
`public/fonts/` and it is picked up automatically. See
[docs/CONFIGURATION.md](docs/CONFIGURATION.md).

---

## Checking on it

```bash
curl -s localhost:8080/healthz
```

```json
{"ok":true,"mode":"ami","link":"up","linkDetail":"10.10.2.57:5038",
 "uptimeSec":3600,"viewers":1,"stations":31}
```

`link` reports the real state of the AMI connection, and the board shows the
same thing in words under **Switch link** so it can be read off the TV.
`viewers` of 1 or more means the TV is genuinely displaying the board.

---

## Built to run unattended

- systemd restarts the service if it exits, and never gives up
- a watchdog restarts it if it stops answering `/healthz` — the case systemd
  cannot see
- the kiosk relaunches the browser if it is closed or crashes
- the AMI client reconnects with exponential backoff, survives a half-open
  socket, and reports a rejected login instead of hammering the switch
- the browser reconnects its WebSocket on its own

A service restart or a PBX blip heals without anyone walking up to the TV.
