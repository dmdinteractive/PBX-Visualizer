# Wiping and rebuilding the Pi

Follow this in order. **Step 1 is the one people skip, and it is the one that
loses data permanently.**

## 1. Back up what git does not have

Three things are destroyed by a wipe and cannot be recovered from GitHub:

| What | Where | Recoverable? |
|---|---|---|
| `config.json` | `~/pbx-visualizer/config.json` | No — exhibit names, phone and message lists |
| The licensed font | `~/pbx-visualizer/public/fonts/` | Only from your own copy of the Adobe font |
| The AMI secret | `/etc/default/pbx-visualizer` | Yes — read it again from FreePBX |

```bash
mkdir -p ~/pbxv-backup
cp ~/pbx-visualizer/config.json ~/pbxv-backup/
cp -r ~/pbx-visualizer/public/fonts ~/pbxv-backup/
ls -R ~/pbxv-backup
```

**Do not add `2>/dev/null` to those commands, and read the `ls` output.** A
silenced failure here looks identical to success and you will not find out until
the config is already gone. Copy `~/pbxv-backup` off the Pi entirely — onto a
laptop or a USB stick — since anything left on the card goes with it.

## 2. Note the current IP

```bash
hostname -I
```

The FreePBX manager user permits exactly one address. If the rebuilt Pi comes up
on a different one, the login is refused no matter how correct the secret is.
Either reserve this address for the new Pi on your router, or plan to update
**Permit** in FreePBX afterwards.

## 3. Tear down the old install

```bash
cd ~/pbx-visualizer && ./deploy/uninstall.sh
```

## 4. Delete the checkout and the browser profile

```bash
cd ~                       # <-- do this first
pkill chromium
rm -rf ~/pbx-visualizer
rm -rf ~/.config/pbx-kiosk ~/.cache/pbx-kiosk.log
```

`cd ~` first is not optional. Deleting the directory your shell is sitting in
leaves it with no working directory, and the next `git clone` fails with
`Unable to read current working directory`.

## 5. Reinstall

```bash
sudo apt update && sudo apt install -y git nodejs npm
git clone https://github.com/dmdinteractive/PBX-Visualizer.git ~/pbx-visualizer
cd ~/pbx-visualizer
```

Restore the backup **before** running the installer, so the service starts with
the right settings:

```bash
cp ~/pbxv-backup/config.json ~/pbx-visualizer/
cp ~/pbxv-backup/fonts/* ~/pbx-visualizer/public/fonts/
./deploy/install.sh
```

The installer asks for the AMI secret once. If you have no backup, skip the two
`cp` lines — the installer creates `config.json` from the template and you
rebuild the lists in `/admin`.

## 6. Reboot and verify

```bash
sudo reboot
```

```bash
hostname -I                                    # matches Permit?
systemctl status pbx-visualizer --no-pager
curl -s localhost:8080/healthz                 # want "link":"up"
systemctl list-timers pbx-visualizer-watchdog
curl -s localhost:8080/api/config | head -c 200 # your names, not the template's
```

If `link` is `auth-failed`, go to step 2 — it is almost always the IP.

## 7. Back up again

Now, while it is fresh:

```bash
mkdir -p ~/pbxv-backup && cp ~/pbx-visualizer/config.json ~/pbxv-backup/
```
