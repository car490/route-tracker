#!/usr/bin/env bash
# Provisions a fixed BusOps Announce Lite/Solo kiosk device (e.g. the
# LEVIRTU 14" Android tablet used for the Solo beta) running Fully Kiosk
# Browser. See ../../driver/cab-device/setup-cab-device.sh for the sibling
# Driver PWA script this is adapted from, and ../../../../SOLO-DEVICE-SETUP.md
# (repo root) for the full picture -- same adb-driven, non-interactive
# approach (Fully Kiosk's own Settings UI fights for focus with itself once
# it's the default Home app, causing stale-frame freezes; see
# SOLO-DEVICE-SETUP.md "Known quirks").
#
# Unlike the Driver script, this one takes the device's install link as a
# required argument -- an Announce device is fully commissioned by which URL
# it loads (the JWT baked into ?announce-device-token= carries device_id/
# company_id/vehicle_id), so there's no on-device vehicle-picker step
# afterwards the way the Driver flow has one.
#
# Usage:
#   1. Dashboard -> Announce Devices -> find/add the device row -> Get
#      Install Link -> copy the full URL.
#   2. Insert a SIM (if this unit uses cellular, not just WiFi) and confirm
#      data works, or confirm WiFi is configured -- required before Kiosk
#      Mode locks Settings away. This script's pre-flight check looks for a
#      ready SIM but does not hard-fail without one (unlike the Driver
#      script) since a fixed WiFi-only bench/beta install is a real option
#      for this tier.
#   3. Enable Developer Options + USB Debugging on the device, connect via
#      USB, accept the "Allow USB debugging?" prompt on-device.
#   4. ./setup-solo-device.sh '<install-link-url>' ['<wifi-ssid>' '<wifi-password>']
#      The WiFi args are optional -- for a unit with no SIM yet (e.g. this
#      beta tablet, running off a phone hotspot until a SIM is fitted, see
#      SOLO-DEVICE-SETUP.md), this saves the network non-interactively so
#      Android auto-reconnects to it on every future boot with zero taps --
#      required, since Kiosk Mode's lockdown means there's no one able to
#      tap a WiFi picker on this device once it's mounted in the vehicle.
#   5. Follow the printed manual steps (screen lock removal).
#
# Requires: adb (Android platform-tools) on PATH, or set ADB=/path/to/adb.

set -euo pipefail

INSTALL_LINK="${1:-}"
WIFI_SSID="${2:-}"
WIFI_PASSWORD="${3:-}"
if [ -z "$INSTALL_LINK" ]; then
  echo "Usage: $0 '<install-link-url>' ['<wifi-ssid>' '<wifi-password>']" >&2
  echo "  Get the install link from the dashboard: Announce Devices -> (device row) -> Get Install Link." >&2
  exit 1
fi

ADB="${ADB:-adb}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="de.ozerov.fully"
# Same Fully Kiosk Browser build already vetted for the Driver PWA cab
# device -- one known-good APK, referenced rather than duplicated.
APK="$DIR/../../driver/cab-device/Fully-Kiosk-Browser-v1.61.2.apk"
SETTINGS_TEMPLATE="$DIR/fully-auto-settings.json"
SETTINGS_OUT="$(mktemp -t fully-auto-settings-XXXXXX.json)"
trap 'rm -f "$SETTINGS_OUT"' EXIT

echo "==> Waiting for an authorized device..."
"$ADB" wait-for-device
STATE=$("$ADB" get-state 2>&1 || true)
if [ "$STATE" != "device" ]; then
  echo "Device not authorized yet — accept the 'Allow USB debugging?' prompt on-device, then re-run." >&2
  exit 1
fi

echo "==> Checking for an active SIM (informational only — this tier can also run WiFi-only)..."
SIM_STATE=$("$ADB" shell getprop gsm.sim.state | tr -d '\r')
if echo "$SIM_STATE" | grep -q "READY"; then
  echo "   SIM detected and ready ($SIM_STATE)."
else
  echo "   No ready SIM detected (gsm.sim.state=$SIM_STATE) — fine if this unit is WiFi-only," >&2
  echo "   but confirm it has a working internet path before relying on it for a real beta." >&2
fi

if [ -n "$WIFI_SSID" ]; then
  echo "==> Saving WiFi network '$WIFI_SSID' non-interactively (auto-reconnects on every boot,"
  echo "    no taps needed -- Kiosk Mode leaves nobody able to use a WiFi picker on-device)..."
  # `cmd wifi` (Android 10+) adds this to the device's normal saved-network
  # list -- the same list a manual Settings -> WiFi join would populate, so
  # Android's own auto-reconnect (already always-on) picks it up on every
  # future boot with zero further action. Not fatal if this device/Android
  # build rejects it (e.g. WPA3-only hotspot needing a different auth token,
  # or an OEM that's stripped this shell command) -- falls back to the usual
  # one-time manual join via Settings, which then persists the same way.
  "$ADB" shell cmd wifi add-network "$WIFI_SSID" wpa2 "$WIFI_PASSWORD" || {
    echo "   (add-network failed -- join '$WIFI_SSID' once manually via Settings -> WiFi instead;" >&2
    echo "   it'll auto-reconnect on every boot after that same as if this had succeeded)" >&2
  }
  "$ADB" shell cmd wifi connect-network "$WIFI_SSID" wpa2 "$WIFI_PASSWORD" || true
else
  echo "==> No WiFi SSID/password given -- skipping WiFi provisioning (pass them as args 2 and 3"
  echo "    if this unit needs a phone hotspot rather than a SIM, see usage above)."
fi

echo "==> Installing Fully Kiosk Browser ($APK)..."
"$ADB" install -r "$APK"

echo "==> Granting OS-level permissions non-interactively..."
# Notifications (Android 13+ runtime permission)
"$ADB" shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true
# Display over other apps (needed for Kiosk Mode's overlay lockdown)
"$ADB" shell appops set "$PKG" SYSTEM_ALERT_WINDOW allow
# Usage access (needed for Kiosk Mode's app-switch detection)
"$ADB" shell appops set "$PKG" GET_USAGE_STATS allow
# Schedule exact alarms (idle/reload timers)
"$ADB" shell appops set "$PKG" SCHEDULE_EXACT_ALARM allow
# Lifts the "restricted settings" block Android puts on sideloaded APKs
"$ADB" shell appops set "$PKG" ACCESS_RESTRICTED_SETTINGS allow
# Fine/coarse location -- Solo's whole autopilot depends on the WebView's
# Geolocation API working inside Fully Kiosk (see fully-auto-settings.json's
# geoLocationAccess: true); the OS-level runtime permission is separate from
# that app-level setting and must also be granted non-interactively, same
# reasoning as the notification grant above.
"$ADB" shell pm grant "$PKG" android.permission.ACCESS_FINE_LOCATION || true
"$ADB" shell pm grant "$PKG" android.permission.ACCESS_COARSE_LOCATION || true

echo "==> Suppressing boot-time nags (\"Finish setting up your device\","
echo "    \"Set a screen lock\")..."
"$ADB" shell pm disable-user --user 0 com.google.android.setupwizard || \
  echo "   (com.google.android.setupwizard not present on this OEM build — skipping, not fatal)"
"$ADB" shell device_config set_sync_disabled_for_tests persistent
"$ADB" shell device_config put privacy safety_center_notifications_enabled false

echo "==> Activating Device Admin (needed for 'Lock the screen' kiosk feature)..."
"$ADB" shell dpm set-active-admin "$PKG/de.ozerov.fully.MyDeviceAdmin" || \
  echo "   (already active, or device admin add failed — check manually if Kiosk Mode misbehaves)"

echo "==> Enabling the Accessibility Service (this IS Kiosk Lock)..."
"$ADB" shell settings put secure enabled_accessibility_services "$PKG/de.ozerov.fully.MyAccessibilityService"
"$ADB" shell settings put secure accessibility_enabled 1

echo "==> Setting Fully Kiosk as the default Home app..."
# Confirmed 2026-09-01 on a PIXGOOD M328-EEA (Android 16, SDK 36): this
# programmatic path is rejected outright -- "RoleControllerServiceImpl:
# Package does not qualify for the role, package: de.ozerov.fully" -- on at
# least this Android 16 build, whatever eligibility check RoleControllerService
# runs for the HOME role doesn't pass for this Fully Kiosk Browser version.
# Not fatal: when Fully Kiosk itself is launched with kioskMode:true (already
# set by the settings push below) it shows its own "Switch Kiosk Mode on?"
# prompt -- tapping Yes there drives Android's own interactive "Set default
# home app" chooser, which DOES succeed where this adb command doesn't
# (confirmed live). If this command below fails, that in-app prompt is the
# real fallback, not a manual Settings hunt.
"$ADB" shell cmd package set-home-activity "$PKG/de.ozerov.fully.LauncherReplacement" || \
  echo "   (rejected by this device/Android version — use the in-app 'Switch Kiosk Mode on?' -> Yes prompt after launch instead, see below)"

echo "==> Baking this device's install link into the settings payload..."
# The install link is a per-device secret (JWT) -- never baked into the
# committed fully-auto-settings.json template, only substituted in here at
# provisioning time for this one physical unit.
#
# Every real install link contains a literal & (it's always
# ...token=...&operator-name=...), which is NOT safe to drop into a sed
# replacement unescaped: & is sed's own "insert the matched text" token in
# the replacement half of s///, so an un-escaped & silently splices the
# literal string __START_URL__ back into the output right where the & was
# -- confirmed live 2026-09-01, produced a startURL of
# "...<token>__START_URL__operator-name=..." that Fully Kiosk then 404'd on
# forever with no error surfaced anywhere. \ is also special in sed
# replacement text and must be escaped for the same reason; | is escaped
# because it's this substitution's own delimiter.
ESCAPED_LINK=$(printf '%s' "$INSTALL_LINK" | sed -e 's/[\&|]/\\&/g')
sed "s|__START_URL__|$ESCAPED_LINK|" "$SETTINGS_TEMPLATE" > "$SETTINGS_OUT"

echo "==> Pushing settings (Start URL = this device's install link, Kiosk Mode on)..."
# The leading // (not /) on the on-device path matters when this script runs
# under Git Bash on Windows -- MSYS rewrites a lone leading / as a Windows
# path (e.g. /sdcard/... -> C:/Program Files/Git/sdcard/...), silently
# breaking both the mkdir and the push destination. // is MSYS's own escape
# to suppress that rewrite; confirmed necessary on Git Bash, harmless
# elsewhere (plain Linux/macOS bash has no such rewriting to escape).
"$ADB" shell mkdir -p //sdcard/Download
"$ADB" push "$SETTINGS_OUT" //sdcard/Download/fully-auto-settings.json

echo "==> Launching Fully Kiosk once so it picks up the pushed settings..."
"$ADB" shell am force-stop "$PKG"
sleep 1
"$ADB" shell am start -n "$PKG/de.ozerov.fully.MainActivity"
sleep 3

echo ""
echo "=================================================================="
echo " Automated steps done. Now check the device screen and confirm:"
echo ""
echo " 1. It loaded the Announce idle screen (operator name/logo, or a"
echo "    'Next departure HH:MM' caption for Solo) -- not a blank page or"
echo "    Fully's own welcome screen. If it didn't auto-import, open"
echo "    Fully's menu (swipe from left edge or long-press) -> Settings ->"
echo "    Other Settings -> Import Settings -> pick fully-auto-settings.json"
echo "    from Downloads."
echo " 2. No 'location permission' prompt is stuck on screen -- Solo can't"
echo "    poll GPS without it. If one appears, grant it once (should not"
echo "    recur after the OS-level grants above take effect on next launch)."
echo ""
echo " Manual steps still required (see ../../../../SOLO-DEVICE-SETUP.md"
echo " for why these stay manual on this whole device class):"
echo "   - Remove the device's screen lock (Settings -> Security -> Screen"
echo "     lock -> None) so a reboot doesn't sit at a PIN prompt forever."
echo "     Non-interactively: adb shell locksettings clear --old <PIN>"
echo "   - Mount it and connect it to permanent/ignition-switched power."
echo "   - Reboot once and confirm it boots straight to the Announce idle"
echo "     screen with no taps needed (one swipe past Android's normal"
echo "     first-unlock-after-reboot screen is expected and fine)."
echo "=================================================================="
