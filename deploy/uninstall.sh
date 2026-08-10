#!/usr/bin/env bash
# Undo install.sh. Leaves the checkout, config.json and node_modules alone.
set -uo pipefail

echo "==> stopping and disabling services"
sudo systemctl disable --now pbx-visualizer-watchdog.timer 2>/dev/null
sudo systemctl disable --now pbx-visualizer.service 2>/dev/null
sudo rm -f /etc/systemd/system/pbx-visualizer.service \
           /etc/systemd/system/pbx-visualizer-watchdog.service \
           /etc/systemd/system/pbx-visualizer-watchdog.timer
sudo systemctl daemon-reload

echo "==> removing kiosk autostart"
rm -f "$HOME/.config/autostart/pbx-kiosk.desktop" "$HOME/.config/pbx-kiosk.env"
for f in "$HOME/.config/labwc/autostart" "$HOME/.config/wayfire.ini"; do
  [ -f "$f" ] && sed -i '/pbx-kiosk\|pbx.*kiosk\.sh/d' "$f"
done

echo "==> the AMI secret in /etc/default/pbx-visualizer was left in place"
echo "    (remove it by hand if this Pi is leaving the exhibit)"
echo "==> done. Screen blanking and autologin were left as they are."
echo "    Reboot to drop the kiosk browser."
