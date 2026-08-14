# Onboard display — Raspberry Pi + passenger display

Vehicle-mounted GPS + PSVAIR announcement display. The Pi provides real GPS
hardware and a self-contained WiFi hotspot; the passenger display (or Fire HD
tablet) just runs a browser against it. See `onboard.html`/`src/onboard.js` for the
web app itself — this file is Pi-side setup only.

## Operator branding (colours)

The passenger sign picks up `primary_color` and `accent_color` from the
company's Branding settings in the dashboard and applies them as CSS variables
at the moment the driver starts the journey.

**WCAG accessibility requirement for `accent_color`:** the accent colour is
used against the e-paper background (`#ECEAE2`) for the service-code box
border, the topbar separator line, and the at-stop pulse dot. It must achieve
a contrast ratio of **≥ 3:1** against `#ECEAE2` to meet WCAG AA for UI
components. If the colour fails this check it is rejected at runtime (a
console warning is logged) and the display falls back to the default dark ink
(`#1A1A18`).

The default CoachMate Signal Cyan (`#00B4D8`) has a contrast ratio of ~2.1:1
against the e-paper background and will fall back — by design, operators are
expected to set a brand colour that meets the threshold. Tools such as
[WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) or
the browser DevTools colour picker can verify a colour before it is saved.

`primary_color` (the sidebar/header colour) is applied to the display for
future use but is not currently consumed by any visible element on the sign.

## Hardware
Full spec, MUST-vs-nice-to-have breakdown, and rationale now live in
**[`docs/HARDWARE.md`](../docs/HARDWARE.md)** — including the two
WiFi/GPS architecture models (a second-radio hotspot dongle vs. the
proposal doc's single-radio model), which are not yet reconciled. Read
that first if you're planning a build. The setup steps below assume
whichever hardware you land on is already in hand.

## Storage
**No microSD in a vehicle-deployed Pi** — see `docs/HARDWARE.md` §1 for
why (vibration, write endurance, unclean-shutdown corruption). Setup:
- Fit an NVMe HAT to the Pi 5's PCIe slot (e.g. Pimoroni NVMe Base, ~£15)
- Insert any M.2 2230 or 2242 NVMe SSD (32GB+; ~£15–£20)
- Flash Raspberry Pi OS to the NVMe using `rpi-imager` or `dd` from another machine
- In `raspi-config → Advanced → Boot Order`, set NVMe/USB as first boot device
- No microSD card needed at all once the bootloader is set

If you must use a Pi 4 (e.g. existing stock), boot from a USB 3.0 SSD
(e.g. Samsung T7) instead — same principle, just via USB rather than PCIe.

## Why two WiFi radios (Model 1 only — see `docs/HARDWARE.md`)

The steps below assume the second-radio hotspot model (`pi-server/config/
hostapd.conf.example` + `dnsmasq.conf.example`) rather than the proposal
doc's single-radio model — that conflict is tracked in `docs/HARDWARE.md`
§6, not resolved here. If your build uses the single-radio model instead,
skip step 3 below and configure `hostapd` on the Pi's onboard radio per
the proposal's §6.3 commissioning steps.

`wlan0` stays a normal WiFi *client*, joining the depot's WiFi each morning
to sync the schedule. `wlan1` runs its own access point permanently, all
day, for the display device to join (or for Chromium running locally on the Pi
to reach the server on `localhost`). No mode-switching between the two — they
run independently and simultaneously, which is what makes the "syncs at the
depot, then fully offline all day" model work without any custom logic.

The Pi 5's onboard WiFi chip is a single radio (one interface at a time in
AP+client mode is unreliable on-chip). Use a cheap USB WiFi dongle (e.g.
Edimax EW-7811Un) as `wlan1` for the hotspot — same advice as Pi 4.

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

## 3. wlan1 — onboard hotspot
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

## 5. Display setup

### Option A — Fire HD tablet (WiFi client)
- Chrome (or Silk Browser), point it at `http://192.168.4.1:8080/`
- **Settings → Security → Screen pinning** (built into Android/Fire OS, no
  paid kiosk app needed) — pin the browser to that page so the driver can't
  navigate away or reconfigure the tablet
- Set Chrome to reopen the same URL on launch, and have the tablet auto-boot
  into Chrome (Fire OS: disable the default launcher's lockscreen/home
  redirect, or use a boot-to-app config appropriate to the OS version)

### Panel physical size (PSV(AI)R 22mm text sizing)

`onboard.css`'s default text sizing (`--min-text: 17vh`) is only correct for
the two panels it was originally calibrated against (Fire HD 10, 28" wide
sign) — browsers have no reliable API for a screen's physical size, so a
different panel needs its physical diagonal supplied once, via
**`&panel-diagonal=<inches>`** appended to whatever fixed kiosk URL Option
A/B below already uses (same pattern as `&announce-token=`, see §6). Omit
it entirely and the CSS default applies unchanged — safe for existing
Fire HD/wide-sign deployments. Example for the Dell Pro P2426H used in
demo/validation builds: `...onboard.html?journey=<id>&panel-diagonal=23.8`.
See `computeMinTextVh()` in `src/onboard.js` for the underlying math if a
different panel is ever used — it only needs the diagonal size; resolution
and aspect ratio are already known automatically at runtime.

### Option B — HDMI stretch-bar display (Chromium kiosk on Pi)
The display connects directly to the Pi's micro-HDMI port. Chromium runs on
the Pi itself and renders `onboard.html` locally — no tablet, no hotspot
needed for the display (you still want `wlan1` as a hotspot for other devices
or for SSH access).

Install Chromium and set it up as a kiosk service:
```bash
sudo apt install chromium-browser
```
Create `/etc/systemd/system/coachmate-kiosk.service`:
```ini
[Unit]
Description=CoachMate BusOps Announce kiosk
After=coachmate-onboard.service graphical.target
Requires=coachmate-onboard.service

[Service]
User=pi
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/pi/.Xauthority
ExecStart=/usr/bin/chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --disable-translate \
  http://localhost:8080/onboard.html
Restart=on-failure

[Install]
WantedBy=graphical.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now coachmate-kiosk
```
Set the Pi to boot to desktop (not console) via `raspi-config → System →
Boot / Auto Login → Desktop Autologin`. Chromium will launch in full-screen
kiosk mode on the stretch bar automatically on every boot.

> **Resolution note**: the VSDISPLAY 28" bar is 1920×360. Set this explicitly
> in `/boot/firmware/config.txt` if the Pi doesn't detect it automatically:
> ```
> hdmi_group=2
> hdmi_mode=87
> hdmi_cvt=1920 360 60 6 0 0 0
> ```

#### Alternative: `cage` instead of a full desktop
The X11/desktop-autologin approach above works, but it boots a full desktop
environment just to run one fullscreen browser. `cage` is a minimal Wayland
kiosk compositor that launches a single client fullscreen with nothing else
running — it works on Pi OS **Lite**, no desktop image or autologin config
needed. It also supports the Wayland idle-inhibit protocol, so the existing
`navigator.wakeLock` call in `src/onboard.js` does real work keeping the
screen from blanking (under X11 you'd want `xset s off`/`xset -dpms`
alongside it instead).
```bash
sudo apt install cage chromium-browser
sudo cp config/coachmate-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now coachmate-kiosk
```
`pi-server/config/coachmate-kiosk.service` in this repo is the `cage`
version — install *either* that file *or* the X11 unit above, not both, they
both claim the `coachmate-kiosk` service name. Adjust its `XDG_RUNTIME_DIR`
UID if `pi`'s UID isn't 1000 (`id -u pi`), and re-verify PSVAIR announcement
audio autoplay on real hardware either way
(`--autoplay-policy=no-user-gesture-required` is already in its `ExecStart`).

### Option B panel: which one to actually buy
The `VSDISPLAY 28" 1920×360` example above is **stale** — see
`docs/HARDWARE.md` §3 for the current MUST-vs-nice-to-have breakdown, the
full status trail (why that panel was dropped, what's TBD for production,
and the still-open beta pick question), and don't order against this file.

## 6. Driver → Pi push feed (optional, additive)

By default the Pi still runs its own `gpsd` GPS and `onboard.js` polls
Supabase directly — nothing above changes. This section adds an *additional*
path: the Driver device pushes its already-computed tracking state
(next stop, ETA, diversion/final-stop flags — never raw GPS) to this Pi over
a local WebSocket, and `onboard.js` prefers that pushed state when a
connection is live, falling back to today's polling/GPS behavior otherwise.
See `pi-server/announceRelay.mjs` and `src/announceLink.js`.

**Set a shared token** (a commissioning-time secret, not "on this network =
trusted") before enabling this — both endpoints reject every connection
until it's set:
```ini
# add to coachmate-onboard.service's [Service] section
Environment=DRIVER_PUSH_TOKEN=<a long random string, same on both ends>
```
```bash
sudo systemctl daemon-reload
sudo systemctl restart coachmate-onboard
```

**Connect the Driver tablet to this Pi's hotspot once** — no native app or
auto-join yet, just join `CoachMate-<name>` (the `wlan1` SSID from step 3)
from the tablet's normal Android WiFi settings, the same as joining any WiFi
network. It stays connected/reconnects automatically after that, same as any
remembered WiFi network.

**Commission the Driver device once** by opening (on that tablet, once):
```
http://<driver-pwa-url>/?announce-setup=ws://192.168.4.1:8080/driver-push&announce-token=<same token>
```
This saves both values to `localStorage` — the Driver PWA never needs the
query param again, and pushes state automatically for every journey started
from that device from then on. A device that was never commissioned this way
simply never connects — the whole feature is a silent no-op for it.

**onboard.js side** needs no separate commissioning: it already knows its own
host (it's served by this same Pi), and reads the token from its own URL —
add `&announce-token=<same token>` to whatever fixed URL Option A/B above
already uses to open `onboard.html`.

## Refreshing the schedule mid-shift
The display's "Refresh routes" button only re-reads the Pi's *existing*
cache — it can't reach Supabase itself (that's the whole point of the
hotspot-only design) so it can't pull anything newer than what the Pi
already has. If stops change and the vehicle is already out:
- Simplest: it'll pick up the change automatically next morning at the
  depot, when `coachmate-sync` runs again at boot.
- To force it sooner without a depot trip: SSH into the Pi (needs wlan0 in
  range of *some* network) and run `node sync-schedule.mjs` by hand from
  `pi-server/`, or `sudo systemctl restart coachmate-sync`. No browser
  reload is needed either way — `onboard.js` already polls on a loop, so the
  refreshed cache shows up on its own.

## Verifying it's working
```bash
curl http://192.168.4.1:8080/api/schedule   # from another device on the hotspot
curl http://localhost:8080/api/schedule     # from the Pi itself (Option B/kiosk)
curl http://localhost:8080/api/position     # 503 {"error":"no_fix"} until gpsd gets a fix, then 200 {lat,lon,speed}
journalctl -u coachmate-onboard -f          # tail the server's logs
journalctl -u coachmate-sync                # check this morning's sync result
systemctl status coachmate-kiosk            # Option B only — confirm the kiosk browser is running
journalctl -u coachmate-kiosk -f            # Option B only — tail Chromium's (or cage's) logs
```
If an Option B monitor stays blank, check `coachmate-kiosk`'s logs first,
then confirm the monitor's actually set to the HDMI input the Pi is plugged
into — a monitor with no OS of its own won't show anything if it's just
idling on a different input.

If the push feed (section 6) is set up, verify it separately with any
WebSocket client, e.g. `npx wscat`:
```bash
npx wscat -c "ws://192.168.4.1:8080/sign-feed?token=<token>"   # should connect and stay open
npx wscat -c "ws://192.168.4.1:8080/sign-feed?token=wrong"     # should be rejected (401)
```
A driver on a commissioned device should show up as one more open connection
in `coachmate-onboard`'s logs, and `onboard.js`'s status line should stop
requesting its own GPS permission once it's receiving pushed state instead.
