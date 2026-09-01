#!/usr/bin/env bash
# Provisions a fixed cab kiosk device (Blackview Active 5 or similar Android
# phone/tablet) running Fully Kiosk Browser as the BusOps Driver cab display.
# See ../CAB-DEVICE-SETUP.md for the full picture and the manual steps this
# script does NOT cover (screen lock removal, vehicle commissioning).
#
# Worked out the hard way on device #1 (2026-08) by driving the phone
# end-to-end over adb instead of tapping through Fully Kiosk's UI blind.
# Everything here is non-interactive on purpose — the UI paths for these same
# settings are real but fragile (Fully Kiosk's Settings screens fight for
# focus with itself once it's the default Home app, causing stale-frame
# freezes; see CAB-DEVICE-SETUP.md "Known quirks").
#
# Usage:
#   1. Insert a SIM and confirm mobile data works (Settings -> Network &
#      internet -> SIM) — required, see CAB-DEVICE-SETUP.md. Must happen
#      before Kiosk Mode locks Settings away; this script's pre-flight
#      check refuses to proceed without a SIM it can detect as ready.
#   2. Enable Developer Options + USB Debugging on the device, connect via
#      USB, accept the "Allow USB debugging?" prompt on-device.
#   3. ./setup-cab-device.sh
#   4. Follow the printed manual steps (screen lock removal, vehicle pick).
#
# Requires: adb (Android platform-tools) on PATH, or set ADB=/path/to/adb.

set -euo pipefail

ADB="${ADB:-adb}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="de.ozerov.fully"
APK="$DIR/Fully-Kiosk-Browser-v1.61.2.apk"
SETTINGS_JSON="$DIR/fully-auto-settings.json"
PROD_URL="https://car490.github.io/route-tracker/index.html"

echo "==> Waiting for an authorized device..."
"$ADB" wait-for-device
STATE=$("$ADB" get-state 2>&1 || true)
if [ "$STATE" != "device" ]; then
  echo "Device not authorized yet — accept the 'Allow USB debugging?' prompt on-device, then re-run." >&2
  exit 1
fi

echo "==> Checking for an active SIM..."
SIM_STATE=$("$ADB" shell getprop gsm.sim.state | tr -d '\r')
if [ "${SKIP_SIM_CHECK:-}" = "1" ]; then
  echo "   SKIP_SIM_CHECK=1 set — skipping SIM check."
elif echo "$SIM_STATE" | grep -q "READY"; then
  echo "   SIM detected and ready ($SIM_STATE)."
else
  echo "SIM not ready (gsm.sim.state=$SIM_STATE)." >&2
  echo "Insert a SIM and confirm mobile data works in Settings -> Network &" >&2
  echo "internet -> SIM before continuing (see CAB-DEVICE-SETUP.md)." >&2
  echo "Re-run once fixed, or set SKIP_SIM_CHECK=1 to proceed without a SIM" >&2
  echo "(bench testing only)." >&2
  exit 1
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
# Lifts the "restricted settings" block Android puts on sideloaded APKs —
# this is what the on-device "Allow restricted settings" menu item does;
# setting it directly here skips that whole confirm-your-PIN dance.
"$ADB" shell appops set "$PKG" ACCESS_RESTRICTED_SETTINGS allow

echo "==> Suppressing boot-time nags (\"Finish setting up your device\","
echo "    \"Set a screen lock\")..."
# Confirmed via `dumpsys notification` + live reboot testing on device #1
# (2026-08-20): "Finish setting up your device" is posted by
# com.google.android.setupwizard (channel suw_consolidate_notification) —
# disabling that package outright is safe post-OOBE, nothing else on a
# kiosk device needs it. "Set a screen lock" is posted by the system
# itself (pkg=android, channel safety_center_recommendation) — Android's
# Safety Center nagging about the exact screen-lock-to-None step this doc
# requires for kiosk mode, so it can never be satisfied; disabled via its
# own device_config flag. That flag gets silently reverted by Android's
# config-sync service on next boot unless sync is frozen first — order
# matters here (freeze, then set), confirmed by testing: setting the flag
# alone did NOT survive a reboot, freezing sync first did.
"$ADB" shell pm disable-user --user 0 com.google.android.setupwizard
"$ADB" shell device_config set_sync_disabled_for_tests persistent
"$ADB" shell device_config put privacy safety_center_notifications_enabled false

echo "==> Activating Device Admin (needed for 'Lock the screen' kiosk feature)..."
"$ADB" shell dpm set-active-admin "$PKG/de.ozerov.fully.MyDeviceAdmin" || \
  echo "   (already active, or device admin add failed — check manually if Kiosk Mode misbehaves)"

echo "==> Enabling the Accessibility Service (this IS Kiosk Lock)..."
"$ADB" shell settings put secure enabled_accessibility_services "$PKG/de.ozerov.fully.MyAccessibilityService"
"$ADB" shell settings put secure accessibility_enabled 1

echo "==> Setting Fully Kiosk as the default Home app..."
# On at least one Android 16 device (confirmed 2026-09-01, provisioning the
# Announce Lite/Solo tablet via the sibling ../../announce/cab-device/
# setup-solo-device.sh) this programmatic path is rejected outright by
# RoleControllerService ("Package does not qualify for the role") even
# though it worked fine on this device's original Android 15 target
# (Blackview Active 5). Not fatal either way: launching Fully Kiosk with
# kioskMode:true (already set below) triggers its own "Switch Kiosk Mode
# on?" prompt -- tapping Yes there drives Android's native interactive
# "Set default home app" chooser, which succeeds where this command
# doesn't. If this line fails, that in-app prompt is the real fallback.
"$ADB" shell cmd package set-home-activity "$PKG/de.ozerov.fully.LauncherReplacement" || \
  echo "   (rejected by this device/Android version — use the in-app 'Switch Kiosk Mode on?' -> Yes prompt after launch instead)"

echo "==> Pushing known-good settings (Start URL, Kiosk Mode on, Single App off)..."
# // (not /) on the on-device path matters under Git Bash on Windows -- MSYS
# rewrites a lone leading / into a Windows path, silently breaking both the
# mkdir and the push destination. Confirmed necessary on Git Bash 2026-09-01;
# harmless on plain Linux/macOS bash, which has no such rewriting to escape.
"$ADB" shell mkdir -p //sdcard/Download
"$ADB" push "$SETTINGS_JSON" //sdcard/Download/fully-auto-settings.json

echo "==> Launching Fully Kiosk once so it picks up the pushed settings..."
"$ADB" shell am force-stop "$PKG"
sleep 1
"$ADB" shell am start -n "$PKG/de.ozerov.fully.MainActivity"
sleep 3

echo ""
echo "=================================================================="
echo " Automated steps done. Now check the device screen and confirm:"
echo ""
echo " 1. It loaded $PROD_URL (not a blank page or Fully's own welcome"
echo "    screen). If it didn't auto-import, open Fully's menu (swipe from"
echo "    left edge or long-press) -> Settings -> Other Settings ->"
echo "    Import Settings -> pick fully-auto-settings.json from Downloads."
echo " 2. It shows the vehicle-commissioning prompt ('WHICH VEHICLE IS"
echo "    THIS?') — pick the correct vehicle for this physical unit."
echo ""
echo " Manual steps still required (see CAB-DEVICE-SETUP.md for why these"
echo " stay manual):"
echo "   - Remove the device's screen lock (Settings -> Security -> Screen"
echo "     lock -> None) so a reboot doesn't sit at a PIN prompt forever."
echo "     Non-interactively: adb shell locksettings clear --old <PIN>"
echo "   - Mount it on ignition-switched USB power in the vehicle."
echo "   - Reboot once and confirm it boots straight to the driver screen"
echo "     with no taps needed (one swipe past Android's normal"
echo "     first-unlock-after-reboot screen is expected and fine)."
echo "=================================================================="
