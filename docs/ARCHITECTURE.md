# How it works

```
FreePBX / Asterisk  ──AMI events──▶  Node service  ──WebSocket──▶  browser (fullscreen TV)
      :5038                            :8080                          └── admin UI at /admin
```

One Node process reads AMI events, keeps a single picture of what the phone
system is doing, and pushes snapshots to every connected browser. The browser
draws the diagram on a canvas. There is no database and no build step.

## Files

| File | Responsibility |
|---|---|
| `pbx.js` | The hard-coded switch connection and link tuning. The only file to edit to point at a different PBX |
| `config.js` | Loads `config.json`, merges admin edits, and exposes `publicConfig()` — the redacted view handed to browsers |
| `server.js` | Static files, `/api/config`, `/healthz`, WebSocket broadcast |
| `lib/state.js` | `CallState` — the live picture: stations, services, calls, link status |
| `lib/ami.js` | AMI client and event translator |
| `lib/simulator.js` | Invents plausible traffic, modelling the real dialplan |
| `lib/traffic.js` | Today's call counts in 15-minute buckets |
| `public/app.js` | The board |
| `public/admin.js` | The admin UI |
| `deploy/` | systemd units, kiosk launcher, watchdog, installer |

## The data flow

`CallState` is the single source of truth. Both the AMI adapter and the
simulator feed it identically, and it emits `change` whenever the picture moves.
`server.js` serialises `snapshot()` to every client — coalesced to at most one
message per 200ms, plus an unconditional snapshot every 3 seconds as a
keepalive.

A snapshot carries the exhibit names, the station and service lists with each
one's status, the live calls, aggregate stats, the link status, and today's
traffic counts.

Three kinds of party can appear on a call:

- a **station** — one of your extensions, from `config.stations`
- a **service** — a recorded message, from `config.services`
- **EXTERNAL** — anything else, drawn through the LONG LINES toll node

## Reading the board

The plant is drawn once in black. A live call is shown not by adding a new line
but by **lighting the existing lines it connects**, in a shared Western Electric
colour from the 6/83 colour chart. Follow a colour from a phone, through the
CENTRAL SWITCHING OFFICE, to the other phone to read a connection.

| Mark | Meaning |
|---|---|
| Open circle | On-hook |
| Filled circle | In use |
| Double ring | Ringing |
| Solid coloured line | Connected |
| Dashed coloured line | Ringing |
| Parallel coloured strands | Several calls sharing one trunk |

A call keeps its colour for its whole life, and the CONNECTIONS panel ties each
colour to a caller and destination.

## The AMI client

Watches `Newchannel`, `Newstate`, `DialBegin`, `DialEnd`, `BridgeEnter`,
`BridgeLeave` and `Hangup`.

Recorded messages need special handling. Asterisk usually plays an announcement
on the caller's own channel rather than dialling a second one, so there is no
bridge to watch. Those legs are `Local/<exten>@from-internal` channels with no
real endpoint, and are resolved by the extension in the channel name — which is
why ghost extensions must be listed under `services`.

It is built to survive months unattended:

- exponential backoff with jitter, so a switch returning from an outage is not
  hit by every retry on the same tick
- TCP keepalive and `setNoDelay`
- separate timeouts for connecting and for the login reply
- an AMI `Ping` heartbeat every 15s, and a silence detector — a half-open TCP
  socket accepts writes forever and never delivers events, so silence, not a
  write error, is what proves the switch is gone
- a rejected login is treated as a configuration problem: reported clearly and
  retried slowly, not hammered
- losing the link clears the live calls, so the TV cannot show phantom traffic
- a periodic sweep of channel records, in case a `Hangup` is ever missed

## Rendering

Nothing on the canvas is animated — the plant only moves when the state or the
window size changes — so the board repaints on demand rather than running a
continuous animation loop. An idle board repaints nothing at all.

Incoming snapshots are compared against cheap signatures for the plant, the
calls and the traffic, so an unchanged snapshot costs a few string comparisons
instead of a full rebuild. Elapsed call times tick in place rather than
rebuilding rows.

Everything is sized relative to the display's short side rather than in device
pixels, so the board looks identical at 1080p and 4K and is legible from across
a gallery.

The canvas also handles `contextlost` / `contextrestored`: a lost 2D context
leaves the canvas blank, and Chromium only restores it if the loss event is
cancelled.

## Today's traffic

`lib/traffic.js` counts each new call into one of 96 fifteen-minute buckets of
local time. The day rolls over at local midnight — not UTC, and not 24 hours
after boot — so the graph always reads as "today".

Counts are written to `traffic.json` with write-then-rename, so a power cut
cannot leave a half-written file that would throw away the day on the next boot.

## HTTP endpoints

| Endpoint | Purpose |
|---|---|
| `GET /` | The board |
| `GET /admin` | The admin UI |
| `GET /api/config` | Current settings — **never** includes the AMI secret |
| `POST /api/config` | Apply an admin edit. `mode` and `ami` are ignored |
| `GET /healthz` | Liveness: mode, link status, uptime, viewer count, station count |
| WebSocket on `/` | State snapshots |

There is no authentication. Keep the board on a trusted LAN.
