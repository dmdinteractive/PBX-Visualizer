# Troubleshooting

Work from the outside in: is the service up, is the browser showing it, is the
switch connected.

```bash
systemctl status pbx-visualizer --no-pager   # the service
curl -s localhost:8080/healthz               # the board and the switch link
tail -40 ~/.cache/pbx-kiosk.log              # the browser
journalctl -u pbx-visualizer -n 50           # what the service has been doing
```

## The switch link

### `LOGIN REJECTED` / `"link":"auth-failed"`

Either the secret is wrong, or **this Pi's IP is not in the manager user's
Permit list**. Asterisk returns the same "Authentication failed" for both, so
they cannot be told apart from the client.

The Permit list is the more common cause, especially after reimaging:

```bash
hostname -I
```

If that does not match Permit in **Settings → Asterisk Manager Users →
visualizer**, either give the Pi a DHCP reservation for the old address or
update Permit and **Apply Config**.

To re-check the secret:

```bash
sudo cat /etc/default/pbx-visualizer
```

The client backs off 60 seconds between rejected logins rather than hammering
the switch, so give it a minute after a change, or restart the service.

### `DOWN` / `"link":"down"`

Cannot reach the switch at all.

```bash
nc -zv 10.10.2.57 5038
timeout 3 bash -c 'exec 3<>/dev/tcp/10.10.2.57/5038; head -1 <&3'
```

"Connection refused" means AMI is not listening beyond loopback — check
`bindaddr` in `/etc/asterisk/manager.conf`. A hang usually means the wrong
address or a firewall.

### `SIMULATED`

The board is running on invented traffic. `mode` in `pbx.js` is `simulate`, or
`PBXV_MODE=simulate` is set in the environment.

### `NO DATA`

The **browser** cannot reach the Pi. This says nothing about the PBX. Check the
service is running and that the kiosk is pointed at the right URL.

### A real call shows as an outside call

That extension is missing from the phones list in `/admin`. Anything not listed
under `stations` or `services` is treated as the outside world.

## The TV

### The board is fine over the network, but the TV shows a desktop

The session is not running the kiosk.

```bash
journalctl -b | grep -i kiosk
tail -40 ~/.cache/pbx-kiosk.log
~/pbx-visualizer/deploy/kiosk.sh          # run it by hand to see the error
```

Check autologin is on: `sudo raspi-config` → *System Options → Boot / Auto Login
→ Desktop Autologin*.

### The TV shows "site can't be reached"

The browser beat the service to it. `systemctl status pbx-visualizer` will say
why the service did not come up; `pkill chromium` retries once it has.

### The screen goes black after a few minutes

Blanking came back on:

```bash
sudo raspi-config nonint do_blanking 1
```

### The mouse cursor is invisible

Deliberate — `cursor: none` in the board's CSS, plus `unclutter`. Use the
keyboard to get out of the kiosk; see [OPERATIONS.md](OPERATIONS.md).

## The board blinks or flickers

**This one is not fully resolved, so diagnose rather than assume.** Two causes
have already been found and fixed, and a third may remain.

Already fixed:

- The board used to repaint the whole diagram 60 times a second even though
  nothing on the canvas is animated. Fixed in `V1.1` — it now repaints only when
  the picture changes.
- Every 3-second snapshot from the server used to rebuild the connections list,
  all 96 bars of the traffic graph and the diagram layout, whether or not
  anything had changed. Fixed in `a7e9447` — an idle board now does zero
  repaints, zero list rebuilds and zero layouts.

If it still blinks, **first find out whether the app is involved at all**. Put a
plain white page on the TV:

```bash
pkill -f deploy/kiosk.sh && pkill chromium
chromium-browser --kiosk --user-data-dir=/tmp/blanktest "data:text/html,<body style='background:white'>"
```

If a blank page still blinks, the visualizer is not the cause — look at the
compositor, GPU driver, HDMI link or power. If it is steady, the cause is in the
board.

Then gather evidence:

```bash
grep -icE "gpu|crash|lost|context" ~/.cache/pbx-kiosk.log
grep -c "starting chromium" ~/.cache/pbx-kiosk.log   # relaunch count; climbing = crashing
vcgencmd get_throttled                                # anything but 0x0 is power/thermal
vcgencmd measure_temp
dmesg | grep -iE "hdmi|drm|vc4" | tail -20
journalctl -t pbxv-watchdog --since "1 hour ago"      # empty = not being cycled
```

What the symptom tells you:

| Looks like | Points at |
|---|---|
| Whole screen goes **black** briefly | HDMI link, cable, or power |
| Whole screen goes **white** briefly | Browser compositor or GPU process |
| The diagram flickers, panel steady | The board's own rendering |
| Board disappears and reloads | Chromium crashing; the kiosk loop relaunching it |

If it is the compositor, add `--disable-gpu-compositing` to the Chromium
command in `deploy/kiosk.sh`. The board is cheap enough to draw that software
compositing keeps up comfortably.

## The service

### It will not start

```bash
journalctl -u pbx-visualizer -n 50
```

A corrupt `config.json` is the usual cause. Delete it and the service recreates
it from `config.example.json` on the next start — you will lose your extension
lists and names, so keep a backup.

### It keeps restarting

```bash
journalctl -t pbxv-watchdog --since "1 hour ago"
```

Entries here mean the watchdog is finding `/healthz` unresponsive and cycling
the service. The service journal will say why.

### Port already in use

Something else is on 8080. Change `port` in `config.json` and restart. Note the
kiosk and watchdog both read the port back out of `config.json`, so they follow
automatically.

## Recovering a lost configuration

If `config.json` is gone, the extension lists for this exhibit are 101–131 for
the phones and 201–207 for the automated messages:

| Extension | Name |
|---|---|
| 201 | OPERATOR |
| 202 | TIME-OF-DAY |
| 203 | WEATHER |
| 204 | DIAL-A-JOKE |
| 205 | STORY LINE |
| 206 | PRANK CALL |
| 207 | PARTY LINE |

Delete `config.json`, restart, then use `/admin` — the "add a range" helper
takes `101-131` in one go.
