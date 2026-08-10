#!/usr/bin/env bash
# One-shot installer: board on boot, fullscreen on the TV, and stays there.
#
#   cd ~/pbx-visualizer && ./deploy/install.sh
#
# Run it as the desktop user that owns the screen (not with sudo — the script
# calls sudo itself where it needs to). Safe to re-run after a git pull.
#
# Flags:
#   --url URL         point the kiosk somewhere else (default http://localhost:<port>)
#   --no-kiosk        service only, no browser
#   --no-autologin    don't touch the boot behaviour
#   --no-deps         don't apt-install chromium/unclutter/curl
#
# The AMI secret is asked for once and stored in /etc/default/pbx-visualizer
# (root only). Set PBXV_AMI_SECRET in the environment to supply it unattended.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_USER="$(id -un)"
SERVICE_GROUP="$(id -gn)"
KIOSK=1 AUTOLOGIN=1 DEPS=1 KIOSK_URL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --url) KIOSK_URL="${2:-}"; shift 2 ;;
    --no-kiosk) KIOSK=0; shift ;;
    --no-autologin) AUTOLOGIN=0; shift ;;
    --no-deps) DEPS=0; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n==> %s\n' "$*"; }
warn() { printf '    !! %s\n' "$*"; }

[ "$(id -u)" -ne 0 ] || { echo "Run this as the desktop user, not root or sudo." >&2; exit 1; }
case "$APP_DIR" in
  *[[:space:]]*) echo "The path '$APP_DIR' contains a space; systemd would split it. Move the checkout somewhere like ~/pbx-visualizer." >&2; exit 1 ;;
esac
command -v systemctl >/dev/null || { echo "systemd not found — this installer is for Linux/Raspberry Pi OS." >&2; exit 1; }
sudo -v || { echo "This user needs sudo." >&2; exit 1; }

# --- node ------------------------------------------------------------------
say "checking node"
command -v node >/dev/null || {
  echo "node is not installed. On Pi OS:  sudo apt install -y nodejs npm" >&2; exit 1; }
NODE="$(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "node $(node -v) is too old — the board needs 18 or newer." >&2
  echo "Install a current one:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs" >&2
  exit 1
fi
echo "    $NODE ($(node -v))"

# --- dependencies ----------------------------------------------------------
if [ "$DEPS" -eq 1 ] && command -v apt-get >/dev/null; then
  want=()
  command -v curl >/dev/null || want+=(curl)
  if [ "$KIOSK" -eq 1 ]; then
    command -v unclutter >/dev/null || want+=(unclutter)
    command -v chromium-browser >/dev/null || command -v chromium >/dev/null || want+=(chromium-browser)
  fi
  if [ ${#want[@]} -gt 0 ]; then
    say "installing ${want[*]}"
    sudo apt-get update -qq
    sudo apt-get install -y "${want[@]}" || warn "apt install failed — carrying on, install ${want[*]} by hand"
  fi
fi

# --- app -------------------------------------------------------------------
if [ ! -d "$APP_DIR/node_modules/ws" ]; then
  say "installing npm dependencies"
  (cd "$APP_DIR" && npm install --omit=dev)
fi
chmod +x "$APP_DIR/deploy/kiosk.sh" "$APP_DIR/deploy/watchdog.sh" "$APP_DIR/deploy/uninstall.sh"

# --- AMI secret ------------------------------------------------------------
# pbx.js is committed to a public repo, so the secret cannot live there. It goes
# in a root-only env file that the systemd unit reads. Asked for once; re-running
# the installer after a git pull leaves an existing secret alone.
SECRET_FILE=/etc/default/pbx-visualizer
write_secret() {
  printf 'PBXV_AMI_SECRET=%s\n' "$1" | sudo tee "$SECRET_FILE" >/dev/null
  sudo chown root:root "$SECRET_FILE"
  sudo chmod 600 "$SECRET_FILE"
}
if sudo grep -qE '^PBXV_AMI_SECRET=.+' "$SECRET_FILE" 2>/dev/null; then
  say "AMI secret already stored in $SECRET_FILE"
elif [ -n "${PBXV_AMI_SECRET:-}" ]; then
  say "storing the AMI secret from the environment"
  write_secret "$PBXV_AMI_SECRET"
  echo "    $SECRET_FILE (root only)"
elif [ -t 0 ]; then
  say "AMI secret"
  echo "    FreePBX: Settings -> Asterisk Manager Users -> the 'visualizer' user."
  printf '    Secret (input hidden, blank to skip): '
  IFS= read -rs ENTERED || ENTERED=""
  echo
  if [ -n "$ENTERED" ]; then
    write_secret "$ENTERED"
    unset ENTERED
    echo "    saved to $SECRET_FILE (root only)"
  else
    warn "no secret entered — the switch will reject the login until you set one"
  fi
else
  warn "no AMI secret stored, and no terminal to ask on. Set it with:"
  warn "  echo 'PBXV_AMI_SECRET=xxxx' | sudo tee $SECRET_FILE && sudo chmod 600 $SECRET_FILE"
fi

# --- systemd ---------------------------------------------------------------
say "installing systemd units"
render() {
  sed -e "s|@USER@|$SERVICE_USER|g" \
      -e "s|@GROUP@|$SERVICE_GROUP|g" \
      -e "s|@DIR@|$APP_DIR|g" \
      -e "s|@NODE@|$NODE|g" "$1" | sudo tee "$2" >/dev/null
}
render "$APP_DIR/deploy/pbx-visualizer.service"          /etc/systemd/system/pbx-visualizer.service
render "$APP_DIR/deploy/pbx-visualizer-watchdog.service" /etc/systemd/system/pbx-visualizer-watchdog.service
render "$APP_DIR/deploy/pbx-visualizer-watchdog.timer"   /etc/systemd/system/pbx-visualizer-watchdog.timer

sudo systemctl daemon-reload
sudo systemctl enable --now pbx-visualizer.service
sudo systemctl restart pbx-visualizer.service
sudo systemctl enable --now pbx-visualizer-watchdog.timer

# --- wait for it to answer -------------------------------------------------
PORT="$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9]\{1,5\}\).*/\1/p' "$APP_DIR/config.json" 2>/dev/null | head -1)"
PORT="${PORT:-8080}"
URL="${KIOSK_URL:-http://localhost:$PORT}"

say "waiting for the board on port $PORT"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" -eq 1 ]; then
  echo "    up: $(curl -fsS "http://127.0.0.1:$PORT/healthz")"
else
  warn "the board is not answering yet — check: journalctl -u pbx-visualizer -n 50"
fi

# --- kiosk -----------------------------------------------------------------
if [ "$KIOSK" -eq 1 ]; then
  say "installing the kiosk autostart"
  mkdir -p "$HOME/.config/autostart"
  sed -e "s|@DIR@|$APP_DIR|g" "$APP_DIR/deploy/pbx-kiosk.desktop" \
    > "$HOME/.config/autostart/pbx-kiosk.desktop"
  echo "    ~/.config/autostart/pbx-kiosk.desktop"

  # Pi OS Bookworm runs a Wayland compositor that may not read XDG autostart,
  # so register with whichever one this machine actually uses as well.
  if [ -f "$HOME/.config/labwc/autostart" ] || command -v labwc >/dev/null 2>&1; then
    mkdir -p "$HOME/.config/labwc"
    touch "$HOME/.config/labwc/autostart"
    grep -q 'deploy/kiosk.sh' "$HOME/.config/labwc/autostart" \
      || echo "$APP_DIR/deploy/kiosk.sh &" >> "$HOME/.config/labwc/autostart"
    echo "    ~/.config/labwc/autostart"
  fi
  if [ -f "$HOME/.config/wayfire.ini" ]; then
    if ! grep -q 'deploy/kiosk.sh' "$HOME/.config/wayfire.ini"; then
      if grep -q '^\[autostart\]' "$HOME/.config/wayfire.ini"; then
        sed -i "0,/^\[autostart\]/s||[autostart]\npbxkiosk = $APP_DIR/deploy/kiosk.sh|" "$HOME/.config/wayfire.ini"
      else
        printf '\n[autostart]\npbxkiosk = %s/deploy/kiosk.sh\n' "$APP_DIR" >> "$HOME/.config/wayfire.ini"
      fi
    fi
    echo "    ~/.config/wayfire.ini"
  fi

  # kiosk.sh reads this, so a custom URL applies however the session starts it.
  if [ -n "$KIOSK_URL" ]; then
    echo "PBXV_URL=$KIOSK_URL" > "$HOME/.config/pbx-kiosk.env"
    echo "    ~/.config/pbx-kiosk.env -> $KIOSK_URL"
  else
    rm -f "$HOME/.config/pbx-kiosk.env"
  fi
fi

# --- screen and boot behaviour --------------------------------------------
if command -v raspi-config >/dev/null 2>&1; then
  say "Raspberry Pi settings"
  if sudo raspi-config nonint do_blanking 1; then
    echo "    screen blanking off"
  else
    warn "could not disable screen blanking"
  fi
  if [ "$AUTOLOGIN" -eq 1 ] && [ "$KIOSK" -eq 1 ]; then
    if sudo raspi-config nonint do_boot_behaviour B4; then
      echo "    boot to desktop, autologin as $SERVICE_USER"
    else
      warn "could not set desktop autologin — set it in raspi-config by hand"
    fi
  fi
elif [ "$KIOSK" -eq 1 ]; then
  warn "not a Pi: set desktop autologin and disable the screensaver yourself"
fi

if ! sudo grep -qE '^PBXV_AMI_SECRET=.+' "$SECRET_FILE" 2>/dev/null; then
  say "ACTION NEEDED"
  warn "No AMI secret is stored, so the switch will reject the login."
  warn "  echo 'PBXV_AMI_SECRET=xxxx' | sudo tee $SECRET_FILE"
  warn "  sudo chmod 600 $SECRET_FILE && sudo systemctl restart pbx-visualizer"
fi

cat <<EOF

==> Installed.

    Board      $URL
    Admin      $URL/admin
    Health     $URL/healthz

    Logs       journalctl -u pbx-visualizer -f
    Restart    sudo systemctl restart pbx-visualizer
    Update     cd $APP_DIR && git pull && ./deploy/install.sh
    Remove     ./deploy/uninstall.sh

    Reboot now to test the whole cold-start path:  sudo reboot
EOF
