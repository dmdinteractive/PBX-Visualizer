#!/usr/bin/env bash
# Restart the board service if it stops answering HTTP.
#
# systemd's Restart=always only catches a process that exits. This catches the
# rarer, worse case: node still running but wedged, so the TV shows a frozen
# board and nobody notices. Run once a minute by pbx-visualizer-watchdog.timer.
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT=pbx-visualizer.service

# Port comes from config.json, which the admin UI can rewrite at any time.
port() {
  local p
  p=$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9]\{1,5\}\).*/\1/p' \
        "$APP_DIR/config.json" 2>/dev/null | head -1)
  echo "${p:-8080}"
}

URL="http://127.0.0.1:$(port)/healthz"

# Don't fight a service that is already coming back up.
active_for() {
  local started now
  started=$(systemctl show -p ActiveEnterTimestampMonotonic --value "$UNIT" 2>/dev/null)
  [[ "$started" =~ ^[0-9]+$ ]] && [ "$started" -gt 0 ] || { echo 999; return; }
  now=$(awk '{printf "%d", $1 * 1000000}' /proc/uptime)
  echo $(( (now - started) / 1000000 ))
}

if [ "$(active_for)" -lt 60 ]; then
  exit 0
fi

for _ in 1 2 3; do
  if curl -fsS --max-time 5 "$URL" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 5
done

echo "health check failed at $URL — restarting $UNIT"
systemctl restart "$UNIT"
