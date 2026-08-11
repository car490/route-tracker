# Onboard display — Raspberry Pi + HDMI monitor

Vehicle-mounted GPS + PSVAIR announcement display. The Pi provides real GPS
hardware and drives the saloon monitor directly over HDMI, running the app
itself in a local kiosk browser. See `onboard.html`/`src/onboard.js` for the
web app itself — this file is Pi-side setup only.

## Hardware
- Raspberry Pi (any model with an HDMI output; only one WiFi radio is
  needed — onboard `wlan0` for the morning depot sync)
- USB or UART GPS module (e.g. u-blox NEO-6M/7M/8M)
- 24"–28" non-touch monitor, Full HD (1920×1080, 16:9), HDMI input — no
  WiFi, no OS of its own, it purely displays whatever's on the HDMI cable

## 1. GPS — gpsd
```bash
sudo apt install gpsd gpsd-clients
```
Point it at the GPS module's device (commonly `/dev/ttyUSB0` or
`/dev/ttyAMA0`) in `/etc/default/gpsd`:
```
DEVICES="/dev/ttyUSB0"
GPSD_OPTIONS="-n"
```
Verify with `cgps -s` before moving on — confirm it gets a fix outdoors
before assuming anything downstream is broken.

## 2. wlan0 — depot WiFi client
Standard Raspberry Pi OS WiFi client setup (`raspi-config` or
`/etc/wpa_supplicant/wpa_supplicant.conf`) with the depot's SSID/password.
Nothing CoachMate-specific here.

## 3. The app itself
Clone this repo onto the Pi (anywhere — the systemd units below assume
`/home/pi/route-tracker`, adjust `WorkingDirectory` if different):
```bash
git clone <repo-url> ~/route-tracker
cd ~/route-tracker/pi-server
sudo cp config/coachmate-sync.service config/coachmate-onboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now coachmate-sync coachmate-onboard
```
`coachmate-sync` runs once at boot (schedule fetch, see `sync-schedule.mjs`),
`coachmate-onboard` (`server.mjs`) runs continuously, serving the app +
`/api/schedule` + `/api/position` on port 8080.

## 4. The kiosk display — Chromium over HDMI
The monitor has no browser of its own, so the Pi runs one locally and drives
the HDMI output directly. `cage` is a minimal Wayland kiosk compositor —
it launches a single client fullscreen with nothing else running, so this
works on Pi OS Lite without a full desktop environment.
```bash
sudo apt install cage chromium-browser
sudo cp config/coachmate-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now coachmate-kiosk
```
A few things worth knowing:
- `cage` supports the Wayland idle-inhibit protocol, so the existing
  `navigator.wakeLock` call in `src/onboard.js` now does real work keeping
  the monitor from blanking — under the old Fire HD setup that same call
  relied on Fire OS's own wake lock support instead. No app changes needed.
- PSVAIR announcement audio autoplay should be re-verified on real hardware.
  `coachmate-kiosk.service` launches Chromium with
  `--autoplay-policy=no-user-gesture-required`, but there's no kiosk browser
  to hand-test in this repo — confirm it behaves the same as it did on Fire
  OS's Chrome once it's on a real Pi.

## Refreshing the schedule mid-shift
The onboard display can't reach Supabase itself — it only ever reads the
Pi's local `/api/schedule` cache, and there's no touch input to trigger a
manual refresh from the screen. If stops change and the vehicle is already
out:
- Simplest: it'll pick up the change automatically next morning at the
  depot, when `coachmate-sync` runs again at boot.
- To force it sooner without a depot trip: SSH into the Pi (needs wlan0 in
  range of *some* network) and run `node sync-schedule.mjs` by hand from
  `pi-server/`, or `sudo systemctl restart coachmate-sync`. No browser
  reload is needed either way — `onboard.js` already polls on a loop, so the
  refreshed cache shows up on its own.

## Verifying it's working
```bash
curl http://localhost:8080/api/schedule    # should return cached rows, not []
curl http://localhost:8080/api/position    # 503 {"error":"no_fix"} until gpsd gets a fix, then 200 {lat,lon,speed}
journalctl -u coachmate-onboard -f          # tail the server's logs
journalctl -u coachmate-sync                # check this morning's sync result
systemctl status coachmate-kiosk            # confirm the kiosk browser is running
journalctl -u coachmate-kiosk -f            # tail Chromium/cage's logs
```
If the monitor stays blank, check `coachmate-kiosk`'s logs first, then
confirm the monitor's actually set to the HDMI input the Pi is plugged into
— a monitor with no OS of its own won't show anything if it's just idling on
a different input.
