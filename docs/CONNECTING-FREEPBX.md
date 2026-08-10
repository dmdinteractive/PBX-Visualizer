# Connecting to FreePBX

The board reads call activity over the **Asterisk Manager Interface** (AMI), a
line-based TCP protocol on port 5038. It only ever reads — it cannot place,
answer or end a call, and the manager user it uses should have no write
permissions at all.

## 1. Create the manager user

**Settings → Asterisk Manager Users → Add Manager**

| Field | Value |
|---|---|
| Manager name | `visualizer` |
| Secret | a strong secret — you will enter this once during install |
| Deny | `0.0.0.0/0.0.0.0` |
| Permit | the Pi's IP, e.g. `10.10.2.156/255.255.255.255` |
| Read | tick **Call** and **System** |
| Write | none |

**Submit**, then **Apply Config**.

`Deny` plus a single-host `Permit` means the credentials are only usable from
the Pi. This is what limits the damage if the secret ever leaks.

## 2. Let AMI listen beyond loopback

In `/etc/asterisk/manager.conf`:

```ini
[general]
enabled = yes
port = 5038
bindaddr = 0.0.0.0
```

Then:

```bash
asterisk -rx "manager reload"
ss -tlnp | grep 5038
```

Keep port 5038 on the LAN. Never expose it to the internet.

## 3. Point the board at it

Host and username live in [`pbx.js`](../pbx.js); the secret is asked for by
`deploy/install.sh`. See [CONFIGURATION.md](CONFIGURATION.md).

```bash
sudo systemctl restart pbx-visualizer
```

## 4. Confirm

```bash
curl -s localhost:8080/healthz
```

`"link":"up"` means connected and authenticated. The board shows the same thing
in words under **Switch link**, so you can read it off the TV without a
terminal:

| Readout | `healthz` | Meaning |
|---|---|---|
| `ACTIVE` | `up` | Connected and authenticated |
| `CONNECTING` | `connecting` | Opening the TCP connection |
| `LOGGING IN` | `authenticating` | Connected, waiting on the login reply |
| `LOGIN REJECTED` | `auth-failed` | Wrong secret, **or** this Pi is not in the Permit list |
| `DOWN` | `down` | Cannot reach the switch at all |
| `SIMULATED` | `simulate` | Running on invented traffic, no PBX |
| `NO DATA` | — | The browser cannot reach the Pi (says nothing about the PBX) |

## The Permit list is the usual culprit

`LOGIN REJECTED` with a correct secret almost always means the Pi's address
changed and no longer matches Permit. Asterisk returns the same
"Authentication failed" for a wrong password and for a denied host, so the two
are indistinguishable from the client.

```bash
hostname -I
```

If that is not the address in Permit, either give the Pi a DHCP reservation for
the old one, or update Permit in FreePBX and **Apply Config**.

## Testing reachability by hand

```bash
nc -zv 10.10.2.57 5038
timeout 3 bash -c 'exec 3<>/dev/tcp/10.10.2.57/5038; head -1 <&3'
```

The second prints Asterisk's banner, e.g. `Asterisk Call Manager/8.0.0`, which
proves you are talking to AMI and not merely to something that answers.

To find the switch if its address has changed:

```bash
sudo apt install -y nmap
sudo nmap -p 5038 --open 10.10.2.0/24
```

## What the board reads

`lib/ami.js` watches `Newchannel`, `Newstate`, `DialBegin`, `DialEnd`,
`BridgeEnter`, `BridgeLeave` and `Hangup`, and translates them into calls.

Recorded messages are a special case. Asterisk usually plays an announcement on
the caller's own channel rather than dialling a second one, so there is no
bridge to watch. Those legs appear as `Local/<exten>@from-internal` channels
with no real endpoint, and are resolved by the extension in the channel name —
which is why the ghost extensions must be listed under `services` in
`config.json` for the board to draw them correctly.

Ordinary two-party calls are what this targets, which covers effectively all
exhibit traffic.
