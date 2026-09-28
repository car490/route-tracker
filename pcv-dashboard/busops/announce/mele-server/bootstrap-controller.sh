#!/usr/bin/env bash
# Bus Controller (MeLE Quieter4C) first-boot setup — run this ON the
# Controller itself, over SSH, after the autoinstall (see
# mele-server/autoinstall/) has produced a fresh, SSH-reachable Ubuntu Server
# box. Idempotent — safe to re-run.
#
# What this does, per docs/HARDWARE.md:
#   - installs Node.js, hostapd, dnsmasq (mpg123/git already present via
#     autoinstall's package list)
#   - clones/updates this repo
#   - configures ONE onboard WiFi radio as a permanent AP (no depot-WiFi
#     client role, no second USB dongle — §1/§3 of HARDWARE.md)
#   - installs the coachmate-onboard systemd service with a freshly
#     generated DRIVER_PUSH_TOKEN
#   - hardens the box against sudden power loss (docs/HARDWARE.md "Sudden
#     power loss / ignition-off"): hardware watchdog, logs in RAM, services
#     restarted whenever they stop, a 1-minute health check, and — last —
#     a read-only system disk (config/overlayroot.conf) from the next boot.
#     Once that is on, update with update-controller.sh; to re-run this
#     script, switch it off first (DEPLOY.md "Updating the Controller").
#
# What this does NOT do (do these once a display is actually connected):
#   - kiosk browser setup (mele-server/DEPLOY.md §5, Option B)
#   - idle-screen branding commissioning (DEPLOY.md "Idle screen branding")
set -euo pipefail

# With the read-only disk on, everything this script changes would only be
# written to RAM and vanish at the next power-off.
if [ "$(findmnt -n -o FSTYPE /)" = "overlay" ]; then
  echo "ERROR: overlayroot is on (the system disk is read-only), so nothing this"
  echo "script changes would survive a restart. To update the code, use"
  echo "update-controller.sh. To re-run setup, switch the read-only disk off"
  echo "first — see mele-server/DEPLOY.md \"Updating the Controller\"."
  exit 1
fi

REPO_URL="https://github.com/car490/route-tracker.git"
REPO_DIR="$HOME/route-tracker"
# restructure/brand-hierarchy (the mele-server/ layout this script depends
# on) merged into develop via f9fd85b — that branch is now stale, develop
# has it plus everything since. master is still pre-restructure and lags
# develop by dozens of commits (see CLAUDE.md's Release / versioning
# section), so it's the wrong target here too until a formal release ships.
REPO_BRANCH="develop"
AP_SSID="CoachMate-$(hostname)"
AP_IP="192.168.4.1"

echo "== 1. Detecting WiFi interface =="
# /sys/class/net/*/wireless requires no extra package (unlike 'iw', which
# isn't installed on a minimal Ubuntu Server image) — every wifi interface
# has this subdirectory, nothing else does.
WIFI_IFACE=""
for iface_path in /sys/class/net/*/wireless; do
  [ -d "$iface_path" ] || continue
  WIFI_IFACE="$(basename "$(dirname "$iface_path")")"
  break
done
if [ -z "$WIFI_IFACE" ]; then
  echo "ERROR: no WiFi interface found under /sys/class/net/*/wireless. Is the"
  echo "onboard WiFi chip present and not rfkill-blocked? Check 'rfkill list'"
  echo "and 'lspci | grep -i network'."
  exit 1
fi
echo "WiFi interface: $WIFI_IFACE"
sudo rfkill unblock wifi || true

echo "== 2. Installing packages (Node.js LTS, hostapd, dnsmasq) =="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo apt-get install -y hostapd dnsmasq overlayroot
sudo systemctl unmask hostapd
sudo systemctl stop hostapd dnsmasq || true

echo "== 3. Cloning/updating the repo (branch: $REPO_BRANCH) =="
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch origin "$REPO_BRANCH"
  git -C "$REPO_DIR" checkout "$REPO_BRANCH"
  git -C "$REPO_DIR" pull origin "$REPO_BRANCH"
else
  git clone -b "$REPO_BRANCH" "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR/pcv-dashboard/busops/announce/mele-server"
npm ci --omit=dev   # exact versions from package-lock.json

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
# bind-dynamic (not bind-interfaces) — only binds the AP interface, same as
# bind-interfaces, but tolerates the interface not existing/having an address
# yet at dnsmasq's own startup instant. Confirmed needed live on the first
# real unit: hostapd and dnsmasq both start around the same moment at boot,
# and dnsmasq's static bind-interfaces check can lose that race ("unknown
# interface") since the wireless interface isn't really live until hostapd
# has initialized it — bind-dynamic retries/adjusts instead of failing once.
echo "bind-dynamic" | sudo tee -a /etc/dnsmasq.d/coachmate-ap.conf >/dev/null

# Belt-and-braces for the same race: make systemd order dnsmasq after
# hostapd explicitly, and retry if it still loses the race occasionally.
sudo mkdir -p /etc/systemd/system/dnsmasq.service.d
sudo tee /etc/systemd/system/dnsmasq.service.d/override.conf >/dev/null <<'EOF'
[Unit]
After=hostapd.service
Wants=hostapd.service

[Service]
Restart=on-failure
RestartSec=3
EOF
sudo systemctl daemon-reload

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

echo "== 8. Power-cut hardening: watchdog, logs in RAM, restarts, health check =="
# Drop-ins layer the restart rule (and, for coachmate-onboard, its RAM
# directory) over whichever unit is installed, without rewriting it — an
# existing coachmate-onboard unit keeps its push token and TLS lines, and a
# hand-installed kiosk unit keeps its URL.
sudo install -D -m 0644 config/coachmate-onboard-hardening.conf /etc/systemd/system/coachmate-onboard.service.d/hardening.conf
sudo install -D -m 0644 config/coachmate-kiosk-hardening.conf /etc/systemd/system/coachmate-kiosk.service.d/hardening.conf
sudo install -D -m 0644 config/coachmate-watchdog.conf /etc/systemd/system.conf.d/coachmate-watchdog.conf
sudo install -D -m 0644 config/coachmate-journald.conf /etc/systemd/journald.conf.d/coachmate-volatile.conf
sudo install -D -m 0755 config/coachmate-healthcheck.sh /usr/local/bin/coachmate-healthcheck
sudo install -D -m 0644 config/coachmate-healthcheck.service /etc/systemd/system/coachmate-healthcheck.service
sudo install -D -m 0644 config/coachmate-healthcheck.timer /etc/systemd/system/coachmate-healthcheck.timer
sudo systemctl daemon-reload
sudo systemctl restart systemd-journald
sudo systemctl restart coachmate-onboard
sudo systemctl enable --now coachmate-healthcheck.timer
if [ -e /dev/watchdog ]; then
  echo "  Hardware watchdog found (/dev/watchdog) — active from the next boot. Check with: sudo wdctl"
else
  echo "  WARNING: no /dev/watchdog — this board's watchdog isn't available, so a"
  echo "  frozen box will NOT restart itself. Record this in docs/HARDWARE.md §1."
fi

echo "== 9. Read-only system disk (from the next boot) =="
# Last, deliberately: everything above is written to the real disk first.
sudo install -D -m 0644 config/overlayroot.conf /etc/overlayroot.local.conf
echo "  From the next boot the system disk is read-only: nothing written while"
echo "  the Controller runs survives a restart, so a power cut can't damage it."
echo "  Update the code with ./update-controller.sh from now on."

echo "== Done =="
echo "AP SSID: $AP_SSID  (device joins as: http://$AP_IP:8080/)"
echo "Restart now to switch the read-only disk on: sudo reboot"
echo "Check status with:"
echo "  systemctl status hostapd dnsmasq coachmate-onboard coachmate-healthcheck.timer"
echo "  findmnt /          # FSTYPE 'overlay' = read-only disk is on"
echo "  journalctl -u coachmate-onboard -f"
echo ""
echo "First unit off the line? Run bench-test-ap.sh next — it's the one"
echo "unconfirmed risk in docs/HARDWARE.md §1 (this chipset's AP-mode"
echo "support under hostapd):"
echo "  ./bench-test-ap.sh"
