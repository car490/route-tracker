#!/usr/bin/env bash
# Bench test for the MeLE Quieter4C's onboard WiFi chipset in hostapd
# AP mode — the one action item docs/HARDWARE.md §1 flags as unconfirmed
# before ordering a fleet's worth of these boards. Run this ON the
# Controller itself, over SSH, AFTER bootstrap-controller.sh has already
# set up hostapd/dnsmasq (this script only checks, it doesn't configure
# anything).
#
# What it can verify unattended: which WiFi chipset/driver the unit
# actually has, whether hostapd/dnsmasq start and stay up, and whether a
# client's DHCP lease appears (proof the chip actually accepted an
# association, not just that the daemon started). What it CANNOT verify —
# do these by hand, see the checklist this script prints at the end:
# real-world range through the vehicle ceiling void, behaviour under
# vibration, and client isolation.
set -uo pipefail

WATCH_SECONDS="${1:-120}"
PASS=1

log() { echo "== $* =="; }
ok()  { echo "  [OK] $*"; }
bad() { echo "  [FAIL] $*"; PASS=0; }
note(){ echo "  [i] $*"; }

log "1. Identifying the WiFi chipset/driver"
WIFI_IFACE=""
for iface_path in /sys/class/net/*/wireless; do
  [ -d "$iface_path" ] || continue
  WIFI_IFACE="$(basename "$(dirname "$iface_path")")"
  break
done
if [ -z "$WIFI_IFACE" ]; then
  bad "no WiFi interface found under /sys/class/net/*/wireless"
else
  ok "interface: $WIFI_IFACE"
  DRIVER_PATH="/sys/class/net/$WIFI_IFACE/device/driver"
  KDRIVER="$( [ -e "$DRIVER_PATH" ] && basename "$(readlink -f "$DRIVER_PATH")" || echo unknown)"
  note "kernel driver in use: $KDRIVER"
  # PCIe (onboard/M.2) chips show up via lspci; report both since it's
  # unconfirmed on the Quieter4C whether this is Realtek or Intel AX201.
  if command -v lspci >/dev/null 2>&1; then
    CHIP_DESC="$(lspci -nnk 2>/dev/null | grep -A3 -i 'network controller' | tr '\n' ' ')"
    [ -n "$CHIP_DESC" ] && note "lspci: $CHIP_DESC"
  fi
  if command -v lsusb >/dev/null 2>&1; then
    USB_WIFI="$(lsusb 2>/dev/null | grep -iE 'wireless|wifi|802.11')"
    [ -n "$USB_WIFI" ] && note "lsusb: $USB_WIFI"
  fi
  note "RECORD THIS: update docs/HARDWARE.md §1's 'one remaining risk' line"
  note "with the chipset/driver found above once this test passes."
fi

log "2. hostapd service state"
if systemctl is-active --quiet hostapd; then
  ok "hostapd active"
else
  bad "hostapd not active — run 'systemctl status hostapd' / 'journalctl -u hostapd -n50'"
fi
if systemctl is-enabled --quiet hostapd 2>/dev/null; then
  ok "hostapd enabled at boot"
else
  bad "hostapd not enabled at boot"
fi

log "3. dnsmasq service state"
if systemctl is-active --quiet dnsmasq; then
  ok "dnsmasq active"
else
  bad "dnsmasq not active — run 'systemctl status dnsmasq' / 'journalctl -u dnsmasq -n50'"
fi

log "4. Scanning hostapd logs for driver-level AP-mode failures"
# These are the specific strings a chipset with poor AP-mode Linux
# driver support tends to log — exactly the risk HARDWARE.md flags.
BAD_PATTERNS='Failed to set beacon parameters|AP-DISABLED|Interface .* not supported in AP mode|nl80211: Failed to set|could not configure driver mode'
if journalctl -u hostapd --no-pager -n 500 2>/dev/null | grep -qiE "$BAD_PATTERNS"; then
  bad "hostapd log shows driver-level AP-mode errors — see: journalctl -u hostapd -n200"
else
  ok "no known AP-mode failure strings in recent hostapd log"
fi

log "5. coachmate-onboard HTTP server reachable locally"
if ss -tln 2>/dev/null | grep -q ':8080 '; then
  ok "something is listening on :8080 (expected: coachmate-onboard)"
else
  bad "nothing listening on :8080 — coachmate-onboard may not be running"
fi

log "6. Waiting up to ${WATCH_SECONDS}s for a client to associate"
echo "  >>> NOW join the AP SSID from a phone or laptop (see 'hostname'"
echo "      below for the SSID: CoachMate-\$(hostname)) and note whether"
echo "      it connects immediately or has to retry."
LEASE_FILE="/var/lib/misc/dnsmasq.leases"
DEADLINE=$(( $(date +%s) + WATCH_SECONDS ))
SEEN_LEASE=""
BEFORE="$( [ -f "$LEASE_FILE" ] && wc -l < "$LEASE_FILE" || echo 0)"
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if [ -f "$LEASE_FILE" ]; then
    AFTER="$(wc -l < "$LEASE_FILE")"
    if [ "$AFTER" -gt "$BEFORE" ]; then
      SEEN_LEASE="$(tail -n1 "$LEASE_FILE")"
      break
    fi
  fi
  sleep 2
done
if [ -n "$SEEN_LEASE" ]; then
  ok "client leased an address: $SEEN_LEASE"
else
  bad "no new DHCP lease seen within ${WATCH_SECONDS}s — client may have failed to associate"
fi

echo ""
log "Automated checks: $( [ "$PASS" -eq 1 ] && echo PASS || echo FAIL )"
echo ""
echo "Manual checklist (this script cannot verify these — do them now while"
echo "the AP is up, then record the outcome alongside the chipset in"
echo "docs/HARDWARE.md §1):"
echo "  [ ] From the joined client, curl http://192.168.4.1:8080/ and confirm"
echo "      a response (proves the client can actually reach the app, not"
echo "      just the DHCP server)."
echo "  [ ] Join a SECOND client and confirm the two clients cannot reach"
echo "      each other (ap_isolate=1 in hostapd.conf — try pinging one"
echo "      joined device's DHCP-assigned IP from the other)."
echo "  [ ] Walk the joined client to roughly where the driver tablet and"
echo "      the passenger display will actually sit in a vehicle (through"
echo "      the ceiling void / partitions if you have a mockup) and check"
echo "      the connection holds — real range, not open-bench range."
echo "  [ ] Leave hostapd/dnsmasq running for an extended soak (hours, not"
echo "      this script's ${WATCH_SECONDS}s window) and tap/gently shake the"
echo "      unit occasionally, watching 'journalctl -u hostapd -f' for any"
echo "      drop/reset — this is the closest a bench can get to catching a"
echo "      vibration-related antenna/driver issue before fleet order."
echo "  [ ] Confirm a WPA3/SAE-capable client authenticates via SAE, and an"
echo "      older WPA2-only client still falls back and connects (transition"
echo "      mode, hostapd.conf.example's wpa_key_mgmt=WPA-PSK SAE)."

[ "$PASS" -eq 1 ]
