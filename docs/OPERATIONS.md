# Running it day to day

## The commands you actually need

| Task | Command |
|---|---|
| Live logs | `journalctl -u pbx-visualizer -f` |
| Is it alive? | `curl -s localhost:8080/healthz` |
| Restart the service | `sudo systemctl restart pbx-visualizer` |
| Restart just the TV browser | `pkill chromium` (the kiosk relaunches it) |
| Update | `cd ~/pbx-visualizer && git pull && ./deploy/install.sh` |
| Browser log | `tail -40 ~/.cache/pbx-kiosk.log` |
| Watchdog history | `journalctl -t pbxv-watchdog` |

Most exhibit settings need no restart at all — use `/admin`.

## Applying an update

Front-end only (anything under `public/`) — the files are served from disk on
each request, so no restart is needed:

```bash
cd ~/pbx-visualizer && git pull && pkill chromium
```

The kiosk relaunches the browser within 5 seconds with the new code.

Anything else:

```bash
cd ~/pbx-visualizer && git pull && ./deploy/install.sh
```

## Getting out of the kiosk

The board hides the cursor deliberately, so the mouse will feel dead. Use the
keyboard: **Ctrl+Alt+T** for a terminal over the top, **Ctrl+Alt+F2** for a text
console (**Alt+F7** or **Alt+F1** returns), or SSH in from another machine.

**Order matters in both cases below.**

Close the browser — kill the relaunch loop *first*, or it comes back in five
seconds:

```bash
pkill -f deploy/kiosk.sh
pkill chromium
```

Stop the board service — stop the watchdog *first*, or it restarts the service
within a minute:

```bash
sudo systemctl stop pbx-visualizer-watchdog.timer
sudo systemctl stop pbx-visualizer
```

Put it all back:

```bash
sudo reboot
```

or, without rebooting:

```bash
sudo systemctl start pbx-visualizer pbx-visualizer-watchdog.timer
~/pbx-visualizer/deploy/kiosk.sh >/dev/null 2>&1 &
```

## What keeps it running

Four independent mechanisms, because the exhibit runs unattended:

1. **systemd** restarts `server.js` if the process exits. `StartLimitIntervalSec=0`
   means it never gives up — without it, five crashes in ten seconds would leave
   the service dead until someone drove out to the gallery.
2. **The watchdog timer** polls `/healthz` every minute and restarts the service
   if it stops answering. This catches the case systemd cannot see: the process
   alive but wedged, showing a frozen board.
3. **The kiosk loop** relaunches Chromium if it is closed or crashes, and scrubs
   the profile's crash flags first so a yanked power cord cannot leave a
   "Restore pages?" bubble sitting over the board.
4. **The AMI client** reconnects on its own with exponential backoff, and the
   browser reconnects its WebSocket every 1.5 seconds. A service restart or a
   PBX blip heals without anyone touching the TV.

## Health endpoint

```bash
curl -s localhost:8080/healthz
```

```json
{"ok":true,"mode":"ami","link":"up","linkDetail":"10.10.2.57:5038",
 "uptimeSec":3600,"viewers":1,"stations":31}
```

`viewers` is the number of connected browsers — at least 1 means the TV is
actually showing the board, not just that the server is up.

## Backups

Two things are not in git and are destroyed by reimaging the Pi:

```bash
mkdir -p ~/pbxv-backup
cp ~/pbx-visualizer/config.json ~/pbxv-backup/
cp -r ~/pbx-visualizer/public/fonts ~/pbxv-backup/
```

`config.json` holds the exhibit names and both extension lists;
`public/fonts/` holds the licensed typeface. Copy them somewhere off the Pi.
The AMI secret lives in `/etc/default/pbx-visualizer` and is also lost on a
wipe, but you can always read it again from FreePBX.

See [REINSTALL.md](REINSTALL.md) before wiping anything.

## Today's traffic

The graph at the bottom left counts calls in 15-minute buckets across the day.
It resets at **local midnight**, and is written to `traffic.json` so a restart —
the watchdog, an update, a power cut — does not erase the morning.
"Calls today" reads from the same counter, so it no longer resets when the
service does.

`traffic.json` is not tracked in git. Deleting it simply starts today over.
