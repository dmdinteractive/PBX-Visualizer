# Installing on the Raspberry Pi

From a freshly imaged Pi to a running exhibit. One Pi runs both the board
service and the fullscreen browser on the TV.

## What you need

- A Raspberry Pi (4 or newer) running **Raspberry Pi OS with desktop**, on the
  same LAN as the FreePBX box
- **Node 18 or newer** (Pi OS Trixie ships Node 20, which is fine)
- The **AMI secret** for the `visualizer` manager user, from FreePBX
- The Pi's IP to be in that manager user's **Permit** list — see
  [CONNECTING-FREEPBX.md](CONNECTING-FREEPBX.md)

## Install

```bash
sudo apt update && sudo apt install -y git nodejs npm
git clone https://github.com/dmdinteractive/PBX-Visualizer.git ~/pbx-visualizer
cd ~/pbx-visualizer
./deploy/install.sh
```

Run it **as the desktop user that owns the screen** — not with `sudo`. The
script calls `sudo` itself where it needs to, and refuses to run as root
because it needs your home directory for the kiosk autostart.

It will pause once and ask for the AMI secret. Input is hidden. The secret is
written to `/etc/default/pbx-visualizer`, readable only by root, and is never
stored in the repository.

Then:

```bash
sudo reboot
```

Reboot properly at least once — it is the only way to test the real cold-start
path, which is what the exhibit does every morning.

## What the installer sets up

| Piece | Purpose |
|---|---|
| `/etc/systemd/system/pbx-visualizer.service` | Runs `server.js` at boot; restarts on crash, indefinitely |
| `/etc/systemd/system/pbx-visualizer-watchdog.timer` | Every minute, `GET /healthz`; restarts the service if it stops answering |
| `/etc/default/pbx-visualizer` | The AMI secret, root-only (mode 0600) |
| `~/.config/autostart/pbx-kiosk.desktop` | Launches the kiosk when the desktop session starts |
| `~/.config/labwc/autostart` or `~/.config/wayfire.ini` | Same, for whichever Wayland compositor Pi OS uses |
| `raspi-config` settings | Screen blanking off; boot to desktop with autologin |

`deploy/kiosk.sh` waits for the board to answer before opening the browser,
holds Chromium fullscreen on it, and relaunches it if it is closed or crashes.

## Options

```
--url URL         point the kiosk at a different address
--no-kiosk        install the service only, no browser
--no-autologin    don't change the boot behaviour
--no-deps         don't apt-install chromium/unclutter/curl
```

To install unattended, supply the secret through the environment instead of
being prompted:

```bash
PBXV_AMI_SECRET=xxxxxxxx ./deploy/install.sh
```

## Verify

```bash
systemctl status pbx-visualizer --no-pager
curl -s localhost:8080/healthz
```

Look for `"link":"up"` — that means the switch accepted the login. Other values
are explained in [TROUBLESHOOTING.md](TROUBLESHOOTING.md). `"viewers":1` or more
confirms the TV's browser is actually connected, not just that the server is up.

The TV should show the board fullscreen, with no cursor and no browser chrome.

## Re-running

`install.sh` is safe to re-run and is the normal way to apply an update:

```bash
cd ~/pbx-visualizer && git pull && ./deploy/install.sh
```

It leaves an existing stored secret alone rather than asking again.

## Removing it

```bash
cd ~/pbx-visualizer && ./deploy/uninstall.sh
```

Removes the services and the kiosk autostart. It deliberately leaves the
checkout, `config.json` and the stored secret in place, so `install.sh` puts
everything straight back. Screen blanking and autologin are left as they are.

## The font

The board asks for **Prestige Elite Std** first. It is a licensed Adobe face and
cannot ship in this repository. Drop your copy into `public/fonts/` (see
[`public/fonts/README.md`](../public/fonts/README.md)) and it is picked up
automatically. Without it the board falls back to Courier Prime → Courier New →
system monospace, which reads the same way but is not the exhibit's face.

**This file is not in git.** Reimaging the Pi destroys it. Keep a copy
somewhere else.
