#!/usr/bin/env bash
# Fullscreen kiosk browser for the exhibit TV.
#
# Launched from ~/.config/autostart/pbx-kiosk.desktop once the desktop session
# is up. Waits for the board to answer, kills the screensaver, then holds
# Chromium on the board — relaunching it forever if it is closed or crashes.
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="$HOME/.config/pbx-kiosk"

port() {
  local p
  p=$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9]\{1,5\}\).*/\1/p' \
        "$APP_DIR/config.json" 2>/dev/null | head -1)
  echo "${p:-8080}"
}

# Written by install.sh --url, for pointing the TV at something other than
# this machine. The desktop session gives us almost no environment, so the
# setting has to live on disk rather than in the autostart entry.
# shellcheck disable=SC1091
[ -f "$HOME/.config/pbx-kiosk.env" ] && . "$HOME/.config/pbx-kiosk.env"

URL="${PBXV_URL:-http://localhost:$(port)}"

LOG="${XDG_CACHE_HOME:-$HOME/.cache}/pbx-kiosk.log"
mkdir -p "$(dirname "$LOG")"
# Months of uptime shouldn't fill the SD card.
[ -f "$LOG" ] && [ "$(wc -c <"$LOG" 2>/dev/null || echo 0)" -gt 5000000 ] && : > "$LOG"

log() { echo "[kiosk] $*" | tee -a "$LOG"; }

# --- 1. wait for the board -------------------------------------------------
# The service and the desktop start in parallel; without this the TV shows
# Chromium's "site can't be reached" page and stays there.
log "waiting for ${URL}/healthz"
for _ in $(seq 1 120); do
  curl -fsS --max-time 2 "${URL}/healthz" >/dev/null 2>&1 && break
  sleep 1
done

# --- 2. no blanking, no cursor ---------------------------------------------
# X11 only. On Wayland (Pi OS Bookworm and later) blanking is off via
# `raspi-config nonint do_blanking 1`, which install.sh sets.
if [ "${XDG_SESSION_TYPE:-x11}" = "x11" ]; then
  xset s off        2>/dev/null
  xset -dpms        2>/dev/null
  xset s noblank    2>/dev/null
fi
pgrep -x unclutter >/dev/null 2>&1 || (unclutter -idle 0 >/dev/null 2>&1 &)

# --- 3. find Chromium ------------------------------------------------------
CHROME=""
for c in chromium-browser chromium google-chrome-stable google-chrome; do
  command -v "$c" >/dev/null 2>&1 && { CHROME=$c; break; }
done
if [ -z "$CHROME" ]; then
  log "no chromium found — install it with: sudo apt install -y chromium-browser"
  exit 1
fi

# --- 4. hold the browser on the board --------------------------------------
while true; do
  # A yanked power cord leaves a dirty profile, and Chromium then covers the
  # board with a "Restore pages?" bubble that nobody is there to dismiss.
  if [ -f "$PROFILE/Default/Preferences" ]; then
    sed -i 's/"exit_type":"[^"]*"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' \
      "$PROFILE/Default/Preferences" 2>/dev/null
  fi

  log "starting $CHROME on $URL"
  "$CHROME" \
    --user-data-dir="$PROFILE" \
    --kiosk "$URL" \
    --start-fullscreen \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --hide-crash-restore-bubble \
    --disable-features=Translate,TranslateUI,InfiniteSessionRestore \
    --no-first-run \
    --no-default-browser-check \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --autoplay-policy=no-user-gesture-required \
    --check-for-update-interval=31536000 \
    --password-store=basic \
    >>"$LOG" 2>&1

  log "browser exited — relaunching in 5s"
  sleep 5
done
