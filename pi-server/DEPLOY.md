# Onboard display — Raspberry Pi + Fire HD

Vehicle-mounted GPS + PSVAIR announcement display. The Pi provides real GPS
hardware and a self-contained WiFi hotspot; the Fire HD is just a screen
running a browser against it. See `onboard.html`/`src/onboard.js` for the
web app itself — this file is Pi-side setup only.

## Hardware
- Raspberry Pi (any model with two WiFi radios available — onboard `wlan0`
  + a second USB WiFi dongle as `wlan1`)
- USB or UART GPS module (e.g. u-blox NEO-6M/7M/8M)
- Fire HD tablet (WiFi-only, no GPS of its own — doesn't need one, see below)

## Why two WiFi radios
`wlan0` stays a normal WiFi *client*, joining the depot's WiFi each morning
to sync the schedule. `wlan1` runs its own access point permanently, all
day, for the Fire HD to join. No mode-switching between the two — they run
independently and simultaneously, which is what makes the "syncs at the
depot, then fully offline all day" model work without any custom logic.

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

## 3. wlan1 — the Fire HD's hotspot
```bash
sudo apt install hostapd dnsmasq
sudo systemctl unmask hostapd
```
Copy the example configs from `pi-server/config/` and edit the SSID/passphrase:
```bash
sudo cp config/hostapd.conf.example /etc/hostapd/hostapd.conf
sudo cp config/dnsmasq.conf.example /etc/dnsmasq.d/coachmate-ap.conf
```
Set `/etc/default/hostapd`: `DAEMON_CONF="/etc/hostapd/hostapd.conf"`.
Give `wlan1` a static IP in `/etc/dhcpcd.conf`:
```
interface wlan1
static ip_address=192.168.4.1/24
nohook wpa_supplicant
```
`sudo systemctl enable hostapd dnsmasq && sudo reboot`, then confirm
`CoachMate-<name>` shows up as a WiFi network from another device.

## 4. The app itself
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

## 5. Fire HD
- Chrome (or Silk Browser), point it at `http://192.168.4.1:8080/`
- **Settings → Security → Screen pinning** (built into Android/Fire OS, no
  paid kiosk app needed) — pin the browser to that page so the driver can't
  navigate away or reconfigure the tablet
- Set Chrome to reopen the same URL on launch, and have the tablet auto-boot
  into Chrome (Fire OS: disable the default launcher's lockscreen/home
  redirect, or use a boot-to-app config appropriate to the OS version)

## Refreshing the schedule mid-shift
The Fire HD's "Refresh routes" button only re-reads the Pi's *existing*
cache — it can't reach Supabase itself (that's the whole point of the
hotspot-only design) so it can't pull anything newer than what the Pi
already has. If stops change and the vehicle is already out:
- Simplest: it'll pick up the change automatically next morning at the
  depot, when `coachmate-sync` runs again at boot.
- To force it sooner without a depot trip: SSH into the Pi (needs wlan0 in
  range of *some* network) and run `node sync-schedule.mjs` by hand from
  `pi-server/`, or `sudo systemctl restart coachmate-sync`.

## Verifying it's working
```bash
curl http://192.168.4.1:8080/api/schedule    # should return cached rows, not []
curl http://192.168.4.1:8080/api/position    # 503 {"error":"no_fix"} until gpsd gets a fix, then 200 {lat,lon,speed}
journalctl -u coachmate-onboard -f            # tail the server's logs
journalctl -u coachmate-sync                  # check this morning's sync result
```
