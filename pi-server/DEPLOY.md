# Onboard display — Bus Controller + passenger display

> **Board/architecture note (2026-08-20):** the Bus Controller has moved to
> an x86 mini PC (MeLE Quieter4C, Ubuntu Server, single onboard WiFi radio,
> AP-only, no depot WiFi/cellular) per `docs/CONTROLLER-REDESIGN.md` — §0
> and §3 below now describe that setup and are the current path for a new
> unit. The Raspberry Pi/two-radio steps this file previously described are
> kept at the bottom under "Legacy: Raspberry Pi hardware" for reference
> only — don't build against them. §4–§7 and "Refreshing the schedule"/
> "Verifying it's working" describe the app itself and are board-agnostic.

Vehicle-mounted PSVAIR announcement display, driven entirely by state and
schedule data pushed from the Driver device — no GPS of its own, no direct
Supabase reads. The Controller provides a self-contained WiFi hotspot; the
passenger display just runs a browser against it. See `onboard.html`/
`src/onboard.js` for the web app itself — this file is Controller-side
setup only.

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

The default PCV Cyan (`#00B4D8`) has a contrast ratio of ~2.1:1
against the e-paper background and will fall back — by design, operators are
expected to set a brand colour that meets the threshold. Tools such as
[WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) or
the browser DevTools colour picker can verify a colour before it is saved.

`primary_color` (the sidebar/header colour) is applied to the display for
future use but is not currently consumed by any visible element on the sign.

## Idle screen branding (logo + name)

Before a journey starts, the sign shows the operator's own logo and name
instead of a blank screen (`docs/CONTROLLER-REDESIGN.md` §7). Unlike the
colours above, this can't be resolved from a journey push — there is no
journey yet — so it's commissioned directly onto the device instead, same
one-time pattern as `&panel-profile=`/`&panel-diagonal=`:

1. **Name** — append `&operator-name=<name>` (URL-encoded) to the fixed
   kiosk URL, e.g. `...onboard.html?announce-token=<token>&panel-profile=monitor&operator-name=Phil%20Haines%20Coaches`.
   Omit entirely and the idle screen stays exactly as it was before (blank
   background, small corner mark only).
2. **Logo** — the Controller has no WAN path at runtime (§5/§6), so the
   image can't be fetched live from Supabase Storage. Instead, from any
   machine with internet access, download the operator's logo from their
   own public Storage URL:
   ```
   curl -o branding-logo.png "https://<project-ref>.supabase.co/storage/v1/object/public/company-logos/<company_id>/logo.<ext>"
   ```
   (`company_id`/logo path come from that operator's `companies.logo_path`
   row — see dashboard Branding settings.) Then copy `branding-logo.png`
   into the repo root on the Controller itself (`~/route-tracker/branding-logo.png`
   — e.g. via `scp` while your laptop is joined to the Controller's own
   hotspot, or a USB stick), alongside `index.html`/`onboard.html`.
   `pi-server/server.mjs` serves it automatically from there, no server
   change needed — it's just another static file under the repo root.
   If the file isn't present, the sign falls back to name-only branding
   (the `<img>` hides itself on a 404) rather than showing a broken image.
3. This file is per-device and gitignored (`branding-logo.png` at repo
   root) — never committed, same treatment as `pi-server/schedule-cache.json`.

## Hardware
Full spec, MUST-vs-nice-to-have breakdown, and rationale live in
**[`docs/HARDWARE.md`](../docs/HARDWARE.md)** — but check
**[`docs/CONTROLLER-REDESIGN.md`](../docs/CONTROLLER-REDESIGN.md)**
alongside it, since it supersedes `HARDWARE.md`'s Bus Controller board
(§1, now MeLE Quieter4C not CM5) and networking model (§7, now single
onboard radio, AP-only, no WAN). Read both before planning a build. The
setup steps below assume the hardware is already in hand.

## Storage
None needed — the Quieter4C boots directly from its internal storage
(ordered as 128GB, no OS). §0's autoinstall handles partitioning. (Pi-era
NVMe/microSD advice moved to the legacy appendix at the bottom.)

## 0. First boot — flashing the OS

Produces a headless, SSH-reachable Ubuntu Server box — no monitor/keyboard
ever needed, matching how this unit is actually commissioned (over
Ethernet + SSH from a laptop).

1. **Download Ubuntu Server 24.04 LTS** (the plain amd64 ISO, not Desktop)
   from ubuntu.com/download/server.
2. **Fill in the autoinstall config**: copy
   `pi-server/autoinstall/user-data.example` to `user-data.local`
   (gitignored) and replace the two placeholders — your SSH public key, and
   a password hash from `openssl passwd -6 '<some password>'` (only used if
   a monitor is ever attached directly; SSH password login is disabled).
   `meta-data` next to it needs no changes.
3. **Build the install USB** using
   [Ventoy](https://www.ventoy.net/) (Windows-friendly — no ISO
   remastering): run `Ventoy2Disk.exe` against a spare USB stick, then drag
   the Ubuntu Server ISO onto it like a normal file copy.
4. **Inject the autoinstall data — Ventoy's own mechanism, not a grub
   edit.** Ventoy ships a Debian/Ubuntu boot hook
   (`IMG/cpio/ventoy/hook/debian/default-hook.sh` /
   `ventoy-cloud-init.sh` in the [Ventoy source](https://github.com/ventoy/Ventoy))
   that looks for a single file at **`/ventoy/autoinstall`** on the USB
   drive's Ventoy partition (i.e. `<drive>:\ventoy\autoinstall` in Windows
   Explorer — create the `ventoy` folder if `Ventoy2Disk.exe` didn't
   already). If present, it builds a CIDATA seed image from it and
   auto-adds the `autoinstall` kernel parameter itself — no `ventoy.json`,
   no Plugson plugin config, no grub.cfg editing needed at all. Build that
   one file by concatenating `user-data.local` and `meta-data` with a
   literal `VENTOY_META_DATA_SPLIT` line between them (the hook splits on
   that exact marker):
   ```bash
   cat user-data.local > /path/to/usb/ventoy/autoinstall
   echo "VENTOY_META_DATA_SPLIT" >> /path/to/usb/ventoy/autoinstall
   cat meta-data >> /path/to/usb/ventoy/autoinstall
   ```
5. **Boot the MeLE from the USB**, plug in Ethernet (for package downloads
   during install — see CONTROLLER-REDESIGN.md §5 for why the box needs no
   WAN path at *runtime*, which is a separate question from needing one
   during setup) and power. It partitions, installs, and reboots
   unattended — no prompts, nothing to confirm on a screen.
6. **Find its IP and SSH in**: check your router's DHCP client list for
   `coachmate-controller`, then `ssh pi@<that-ip>`. If nothing shows up
   after ~10 minutes, the most useful next step is a one-off monitor
   connection to see where it's stuck — a silent failure is very hard to
   diagnose blind over the network.
7. **Run the bootstrap script**: `pi-server/bootstrap-controller.sh` (from
   this repo — `curl` it directly, or clone the repo first, either works
   since the script itself does the clone/`npm install` for the app) does
   the rest of this file's §2–§4 for you: installs Node.js/hostapd/dnsmasq,
   configures the WiFi radio as a static-IP AP interface, and installs the
   `coachmate-onboard` systemd service with a freshly generated
   `DRIVER_PUSH_TOKEN`. It prints the AP passphrase and the push token once
   — record both, they aren't stored anywhere else. Safe to re-run; it
   leaves an already-configured hostapd/token alone rather than rotating
   them on every run.

## 1. GPS — not needed on the Controller

**Removed.** GPS lives entirely on the Driver device now (its own GNSS
chip) and reaches the Controller as already-derived state over the push
feed (§6) — see `docs/CONTROLLER-REDESIGN.md` §6. `pi-server/gpsd-client.mjs`
and the `/api/position` endpoint are gone; don't install `gpsd` or wire up
a GPS module for this box.

## 2. WiFi — Controller hotspot (single radio, AP-only)

Per `docs/CONTROLLER-REDESIGN.md` §3/§5, the Controller never joins a
network as a client at all — no depot WiFi sync, no cellular. Its one
onboard WiFi radio runs permanently as an access point (`hostapd`) for the
Driver device to join; Ethernet (used for setup/updates, per §0) stays a
separate, independent uplink. `pi-server/bootstrap-controller.sh` (§0 step
7) does everything below automatically — this is the manual/by-hand
version if you need to redo a piece of it:

```bash
sudo apt install hostapd dnsmasq
sudo systemctl unmask hostapd
```
Find the radio's interface name (Ubuntu on x86 rarely calls it `wlan0` —
expect something like `wlp2s0`):
```bash
iw dev
```
Copy the example configs from `pi-server/config/` and edit
`interface=`/`ssid=`/`wpa_passphrase=` for your interface name and a
freshly generated passphrase (`openssl rand -base64 16` — unique per
vehicle, see the security comments in `hostapd.conf.example`):
```bash
sudo cp config/hostapd.conf.example /etc/hostapd/hostapd.conf
sudo cp config/dnsmasq.conf.example /etc/dnsmasq.d/coachmate-ap.conf
echo 'DAEMON_CONF="/etc/hostapd/hostapd.conf"' | sudo tee /etc/default/hostapd
```
Give the interface a static IP — Ubuntu Server uses `systemd-networkd`
(via netplan), not `dhcpcd`, and netplan's own `wifis:` stanza would start
`wpa_supplicant` on the interface and fight `hostapd` for the same radio
(the same class of conflict Raspberry Pi OS's NetworkManager has with a
manually-run `hostapd` — avoided here by not routing this interface
through netplan at all):
```bash
sudo tee /etc/systemd/network/10-coachmate-ap.network <<EOF
[Match]
Name=<your-interface-name>

[Network]
DHCP=no
Address=192.168.4.1/24
EOF
sudo systemctl enable --now systemd-networkd
```
`sudo systemctl enable --now hostapd dnsmasq`, then confirm
`CoachMate-<name>` shows up as a WiFi network from another device.

## 4. The app itself
`mpg123` plays PSVAIR announcement audio locally on the Controller
(`pi-server/audioPlayer.mjs`, docs/CONTROLLER-REDESIGN.md §8) — install it
before starting the service:
```bash
sudo apt install mpg123
```
Clone this repo onto the Controller (anywhere — the systemd unit below
assumes `/home/pi/route-tracker`, adjust `WorkingDirectory` if different):
```bash
git clone <repo-url> ~/route-tracker
cd ~/route-tracker/pi-server
sudo cp config/coachmate-onboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now coachmate-onboard
```
`coachmate-onboard` (`server.mjs`) runs continuously, serving the app,
`/api/schedule`, the `/driver-push`/`/sign-feed` WebSocket endpoints, and
PSVAIR announcement audio playback, on port 8080. There's no separate sync
job to install — `/api/schedule` is now written whenever the Driver device
pushes a fresh schedule (see §6). The announcement clips themselves
(`audio/announcements/*.mp3`) need no separate deploy step either — they're
already part of the same repo checkout above.

## 5. Display setup

Two named display profiles exist — **Bar** (the original ultra-wide
destination-board panel, 28", not yet sourced/built — kept for later, see
`docs/CONTROLLER-REDESIGN.md`) and **Monitor** (Dell Pro P2426H, 24"/23.8"
diagonal, the confirmed unit in use for demo/validation builds today). Both
are commissioned the same way, via `&panel-profile=bar` or
`&panel-profile=monitor` appended to the fixed kiosk URL (same pattern as
`&announce-token=`, see §6) — this sets the correct layout (wide/narrow, see
`PANEL_PROFILES` in `src/onboard.js`) and PSVAIR text sizing together, so no
other display param is normally needed. Example for the Dell Pro P2426H:
`...onboard.html?announce-token=<token>&panel-profile=monitor`.

### Option A — WiFi-client display
No specific device is deployed this way today — the tablet originally used
here has been dropped in favour of the HDMI-wired Option B panels below
(see `docs/CONTROLLER-REDESIGN.md`). The mechanism itself is
still supported by `pi-server/server.mjs` if a WiFi-client display is ever
used again: point its browser at `http://192.168.4.1:8080/`, pin/kiosk-lock
it to that page using whatever mechanism its OS provides, and set it to
reopen the same URL on boot.

### Panel physical size (PSV(AI)R 22mm text sizing)

`onboard.css`'s default text sizing (`--min-text: 17vh`) is only correct for
the Bar profile it was originally calibrated against — browsers have no
reliable API for a screen's physical size, so any other panel needs its
physical diagonal supplied once, via **`&panel-diagonal=<inches>`** (a named
`&panel-profile=` above already supplies this for Bar/Monitor automatically;
this param remains as an escape hatch for any future third panel that
doesn't have a named profile yet). Omit both entirely and the CSS default
applies unchanged — correct for Bar, **not** for Monitor-class panels (the
Dell P2426H needs ~7.42vh, well under half the 17vh default). See
`computeMinTextVh()` in `src/onboard.js` for the underlying math if a
different panel is ever used — it only needs the diagonal size; resolution
and aspect ratio are already known automatically at runtime.

### Option B — HDMI display (Chromium kiosk on the Controller)

> **Not yet re-verified on the Quieter4C/Ubuntu Server** — everything below
> (Chromium install, autologin, kiosk service) was written and tested
> against Raspberry Pi OS. Ubuntu Server ships Chromium as a snap, not an
> apt package (`chromium-browser` below won't resolve as-is), and has no
> `raspi-config`/`/boot/firmware/config.txt`. Revisit this section once a
> display is actually connected to the Quieter4C — until then, treat it as
> a description of the mechanism (systemd unit driving a kiosk browser
> against `localhost:8080/onboard.html`), not copy-pasteable commands.
> Pi-specific specifics (desktop autologin, `config.txt` HDMI timing) moved
> to the legacy appendix at the bottom.

The display connects directly to the Controller's HDMI port. Chromium runs
on the Controller itself and renders `onboard.html` locally — no tablet, no
hotspot needed for the display itself (you still want the AP from §2 for
other devices or for SSH access).

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
Pi-specific autologin/resolution-forcing steps for this approach moved to
the legacy appendix at the bottom.

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

## 6. Driver → Controller push feed (required — the only source of data)

The Controller has no GPS and no direct Supabase access at all — everything
it shows comes from what the Driver device pushes to it over a local
WebSocket: schedule/stops once per journey start, then tracking state
(next stop, ETA, diversion/final-stop flags — never raw GPS) on every
update. `onboard.js` shows nothing until this connection has delivered at
least a schedule message. See `pi-server/announceRelay.mjs` and
`src/announceLink.js`.

**Set a shared token** (a commissioning-time secret, not "on this network =
trusted") — both endpoints reject every connection until it's set:
```ini
# add to coachmate-onboard.service's [Service] section
Environment=DRIVER_PUSH_TOKEN=<a long random string, same on both ends>
```
```bash
sudo systemctl daemon-reload
sudo systemctl restart coachmate-onboard
```

**Connect the Driver tablet to the Controller's hotspot once** — no native
app or auto-join yet, just join `CoachMate-<name>` (the SSID from step 2)
from the tablet's normal Android WiFi settings, the same as joining any WiFi
network. It stays connected/reconnects automatically after that, same as any
remembered WiFi network.

**Commission the Driver device once** by opening (on that tablet, once):
```
http://<driver-pwa-url>/?announce-setup=ws://192.168.4.1:8080/driver-push&announce-token=<same token>
```
This saves both values to `localStorage` — the Driver PWA never needs the
query param again, and pushes schedule/state automatically for every journey
started from that device from then on. A device that was never commissioned
this way simply never connects — the Controller stays blank for that
vehicle's journeys, not degraded, since there's no other data source left.

**onboard.js side** needs no separate commissioning: it already knows its own
host (it's served by this same Pi), and reads the token from its own URL —
add `&announce-token=<same token>` to whatever fixed URL Option A/B above
already uses to open `onboard.html`.

## 7. Announcement audio (Controller-side playback)

PSVAIR announcement audio plays from the Controller itself, not the Driver
tablet (`docs/CONTROLLER-REDESIGN.md` §8) — the Driver resolves which clips
to play and pushes `{type:'announce', text, audioKeys}` over the same
`/driver-push` connection as §6; `pi-server/audioPlayer.mjs` plays them via
`mpg123` (installed in §4) from the local `audio/announcements/` clip set
already part of this repo checkout. No separate commissioning step beyond
§6's shared token — this rides the same connection.

**Wiring**: interim AUX only, no amp yet (§8's explicit decision) — run a
3.5mm cable from the Controller's own headphone/audio-out jack into the
vehicle head unit's AUX-IN, same test methodology `docs/HARDWARE.md` §9
already describes (listening test against the PSVAIR 3dB-above-ambient/
84dB-ceiling bar), just sourced from the Controller's jack instead of the
Driver tablet's.

**Missing clip**: unlike the Driver PWA (which falls back to live
`speechSynthesis`), there's no synthesis fallback on the Controller — a
missing or corrupt clip file means that one announcement is silently
skipped, logged via `journalctl` (below), never partially played.

## Refreshing the schedule mid-shift
The Controller never reaches Supabase itself — its only source of schedule
data is whatever the Driver device last pushed (§6). It refreshes
automatically whenever the Driver's push connection (re)opens (e.g. it
reconnects after a WiFi drop, or the driver ends and restarts tracking), not
on any fixed schedule. **Known gap, not built**: nothing today re-triggers a
push mid-journey if stops change *while* a journey is already in progress
and the connection hasn't dropped — the Driver PWA doesn't currently expose
a manual "resend schedule" action. Ending and restarting the trip is the
only way to force it right now.

## Verifying it's working
```bash
curl http://192.168.4.1:8080/api/schedule   # from another device on the hotspot (diagnostic only — onboard.js doesn't poll this)
curl http://localhost:8080/api/schedule     # from the Controller itself (Option B/kiosk)
journalctl -u coachmate-onboard -f          # tail the server's logs
systemctl status coachmate-kiosk            # Option B only — confirm the kiosk browser is running
journalctl -u coachmate-kiosk -f            # Option B only — tail Chromium's (or cage's) logs
```
`/api/schedule` returns `[]` until either a Driver has pushed a schedule
since this boot, or a previous push's disk cache exists — that's expected
before anyone has started a journey today, not a fault.

For announcement audio (§7), `journalctl -u coachmate-onboard -f` also
surfaces `[audioPlayer]` warnings for a missing clip or failed playback —
otherwise silence in the logs during a live announcement just means it
played normally (there's no success-path logging, only failures).

If an Option B monitor stays blank, check `coachmate-kiosk`'s logs first,
then confirm the monitor's actually set to the HDMI input the Controller is
plugged into — a monitor with no OS of its own won't show anything if it's
just idling on a different input.

Verify the push feed (section 6 — required, not optional) separately with
any WebSocket client, e.g. `npx wscat`:
```bash
npx wscat -c "ws://192.168.4.1:8080/sign-feed?token=<token>"   # should connect and stay open
npx wscat -c "ws://192.168.4.1:8080/sign-feed?token=wrong"     # should be rejected (401)
```
A driver on a commissioned device should show up as one more open connection
in `coachmate-onboard`'s logs, and `onboard.js` should un-hide `#onboard-sign`
once it receives the schedule message that starting a journey sends.

---

## Legacy: Raspberry Pi hardware (superseded)

Kept for audit trail / in case a Pi build ever recurs — not the current
path (§0–§2 above, MeLE Quieter4C, are current). See
`docs/CONTROLLER-REDESIGN.md` §2/§9 for why the board changed.

**Storage** — no microSD in a vehicle-deployed Pi (vibration, write
endurance, unclean-shutdown corruption):
- Fit an NVMe HAT to the Pi 5's PCIe slot (e.g. Pimoroni NVMe Base, ~£15)
- Insert any M.2 2230 or 2242 NVMe SSD (32GB+; ~£15–£20)
- Flash Raspberry Pi OS to the NVMe using `rpi-imager` or `dd` from another machine
- In `raspi-config → Advanced → Boot Order`, set NVMe/USB as first boot device
- If using a Pi 4 instead, boot from a USB 3.0 SSD (e.g. Samsung T7) instead

**Why two WiFi radios**: the Pi 5's onboard WiFi chip is a single radio
(one interface at a time in AP+client mode is unreliable on-chip), and the
old architecture needed the Controller to be a WiFi client too (morning
depot-WiFi schedule sync — dropped entirely in the redesign, see
`docs/CONTROLLER-REDESIGN.md` §3). `wlan0` stayed a normal WiFi client for
that sync; `wlan1`, a cheap USB dongle (e.g. Edimax EW-7811Un), ran the
permanent hotspot. No mode-switching — both ran simultaneously.

**wlan0 — depot WiFi client**: standard Raspberry Pi OS WiFi client setup
(`raspi-config` or `/etc/wpa_supplicant/wpa_supplicant.conf`) with the
depot's SSID/password.

**wlan1 — onboard hotspot**, `dhcpcd`-based static IP (Ubuntu's
`systemd-networkd` equivalent is in §2 above):
```
interface wlan1
static ip_address=192.168.4.1/24
nohook wpa_supplicant
```
in `/etc/dhcpcd.conf`, alongside the same `hostapd`/`dnsmasq` config as §2.

**Kiosk display (Option B)**: boot the Pi to desktop (not console) via
`raspi-config → System → Boot / Auto Login → Desktop Autologin` so Chromium
launches in full-screen kiosk mode automatically. For the VSDISPLAY 28" bar
(1920×360), force the resolution in `/boot/firmware/config.txt` if the Pi
doesn't detect it automatically:
```
hdmi_group=2
hdmi_mode=87
hdmi_cvt=1920 360 60 6 0 0 0
```
