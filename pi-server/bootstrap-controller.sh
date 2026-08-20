#!/usr/bin/env bash
# Bus Controller (MeLE Quieter4C) first-boot setup — run this ON the
# Controller itself, over SSH, after the autoinstall (see
# pi-server/autoinstall/) has produced a fresh, SSH-reachable Ubuntu Server
# box. Idempotent — safe to re-run.
#
# What this does, per docs/CONTROLLER-REDESIGN.md:
#   - installs Node.js, hostapd, dnsmasq (mpg123/git already present via
#     autoinstall's package list)
#   - clones/updates this repo
#   - configures ONE onboard WiFi radio as a permanent AP (no depot-WiFi
#     client role, no second USB dongle — §4/§5 of the redesign doc)
#   - installs the coachmate-onboard systemd service with a freshly
#     generated DRIVER_PUSH_TOKEN
#
# What this does NOT do (do these once a display is actually connected):
#   - kiosk browser setup (pi-server/DEPLOY.md §5, Option B)
#   - idle-screen branding commissioning (DEPLOY.md "Idle screen branding")
set -euo pipefail

REPO_URL="https://github.com/car490/route-tracker.git"
REPO_DIR="$HOME/route-tracker"
AP_SSID="CoachMate-$(hostname)"
AP_IP="192.168.4.1"

echo "== 1. Detecting WiFi interface =="
WIFI_IFACE="$(iw dev 2>/dev/null | awk '$1=="Interface"{print $2; exit}')"
if [ -z "$WIFI_IFACE" ]; then
  echo "ERROR: no WiFi interface found via 'iw dev'. Is the onboard WiFi chip"
  echo "present and not rfkill-blocked? Check 'rfkill list' and 'lspci | grep -i network'."
  exit 1
fi
echo "WiFi interface: $WIFI_IFACE"
sudo rfkill unblock wifi || true

echo "== 2. Installing packages (Node.js LTS, hostapd, dnsmasq) =="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo apt-get install -y hostapd dnsmasq
sudo systemctl unmask hostapd
sudo systemctl stop hostapd dnsmasq || true

echo "== 3. Cloning/updating the repo =="
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" pull
else
  git clone "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR/pi-server"
npm install --omit=dev

echo "== 4. Static IP for $WIFI_IFACE (systemd-networkd, bypasses netplan/wpa_supplicant) =="
sudo tee /etc/systemd/network/10-coachmate-ap.network >/dev/null <<EOF
[Match]
Name=$WIFI_IFACE

[Network]
DHCP=no
Address=$AP_IP/24
EOF
sudo systemctl enable --now systemd-networkd
sudo networkctl reload || true

echo "== 5. hostapd config =="
if [ ! -f /etc/hostapd/hostapd.conf ]; then
  AP_PASSPHRASE="$(openssl rand -base64 16)"
  sudo sed \
    -e "s/^interface=.*/interface=$WIFI_IFACE/" \
    -e "s/^ssid=.*/ssid=$AP_SSID/" \
    -e "s/^wpa_passphrase=.*/wpa_passphrase=$AP_PASSPHRASE/" \
    config/hostapd.conf.example | sudo tee /etc/hostapd/hostapd.conf >/dev/null
  echo ""
  echo "  >>> AP passphrase (record this — it is NOT stored anywhere else): $AP_PASSPHRASE"
  echo ""
else
  echo "  /etc/hostapd/hostapd.conf already exists — leaving it alone."
  echo "  (delete it and re-run this script to regenerate with a new passphrase)"
fi
echo 'DAEMON_CONF="/etc/hostapd/hostapd.conf"' | sudo tee /etc/default/hostapd >/dev/null

echo "== 6. dnsmasq config =="
sudo sed -e "s/^interface=.*/interface=$WIFI_IFACE/" \
  config/dnsmasq.conf.example | sudo tee /etc/dnsmasq.d/coachmate-ap.conf >/dev/null
# Only bind to the AP interface, never the Ethernet uplink used for setup.
echo "bind-interfaces" | sudo tee -a /etc/dnsmasq.d/coachmate-ap.conf >/dev/null

sudo systemctl enable --now hostapd dnsmasq

echo "== 7. coachmate-onboard service =="
if [ ! -f /etc/systemd/system/coachmate-onboard.service ]; then
  DRIVER_PUSH_TOKEN="$(openssl rand -hex 24)"
  sudo cp config/coachmate-onboard.service /etc/systemd/system/
  sudo sed -i "/^\[Service\]/a Environment=DRIVER_PUSH_TOKEN=$DRIVER_PUSH_TOKEN" \
    /etc/systemd/system/coachmate-onboard.service
  echo ""
  echo "  >>> DRIVER_PUSH_TOKEN (needed to commission the Driver device, see"
  echo "      DEPLOY.md \"6. Driver -> Controller push feed\"): $DRIVER_PUSH_TOKEN"
  echo ""
else
  echo "  coachmate-onboard.service already installed — leaving its token alone."
fi
sudo systemctl daemon-reload
sudo systemctl enable --now coachmate-onboard

echo "== Done =="
echo "AP SSID: $AP_SSID  (device joins as: http://$AP_IP:8080/)"
echo "Check status with:"
echo "  systemctl status hostapd dnsmasq coachmate-onboard"
echo "  journalctl -u coachmate-onboard -f"
