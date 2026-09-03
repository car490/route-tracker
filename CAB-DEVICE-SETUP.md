# Cab device kiosk setup

Fixed, always-on driver PWA installs for vehicle cabs — the NextStop bridge for
the next ~6 months, until vehicles carry NextStop-native hardware. This is a
different device class from `mele-server/` (that's the *passenger-facing*
onboard sign, one per vehicle, driven by a Bus Controller box with no GPS or
WAN connectivity of its own — see `docs/HARDWARE.md` §1-§3). The cab device is
the **driver PWA** (`driver/index.html`/`driver/src/main.js`) itself, just running without a
driver ever receiving or tapping an install link.

## What this does and doesn't solve

The driver still picks their service and run — that part isn't automated.
What's removed is the install friction: no link to receive, no "Add to Home
Screen" step, no picking their name off a duty list. The screen is just
already there, on, and ready when they get in the cab.

The manual service/run picker this relies on already ships on `develop`
(`driver/src/manualSelection.js`, wired up in `driver/src/main.js`'s `initManualSelection()`)
— it's the same fallback used whenever a driver has no pre-assigned duty, not
anything cab-device-specific. Opening the plain production URL with no
`?duties=` link lands on the "No duty assigned" screen, which has a
**"Select a service manually"** button; tapping it reveals the service/run
picker. That's the one tap a cab-device driver needs — pick service, pick
run, tap Start.

Journeys started this way go through `get_or_create_manual_journey` and are
created with `driver_id` and `vehicle_id` both `null` — there is currently no
ops pre-assignment step to attach either. Fine for now, but any dashboard
report that assumes every journey has a driver/vehicle will show gaps for
cab-device journeys.

`init()` already acquires the screen wake lock unconditionally on boot
(before the picker is even shown), so the display won't sleep while sitting
idle waiting for the driver — no separate config needed for that.

## Hardware

Any Android phone/tablet — the same class of device the driver-phone flow
already targets. No dedicated GPS module needed (the browser's
`navigator.geolocation` is the same source the phone flow already uses).
Power it from an ignition-switched USB supply (like a dashcam) so it boots
with the vehicle.

Vehicle identity is commissioned once per device via `driver/src/vehicleSetup.js`
(see "Device setup" below) and persisted to that device's `localStorage`, not
tied to hardware in any deeper way — swapping a unit to a different vehicle
is a one-tap **Change** in-app, not a factory reset or server-side change.

## The kiosk URL

```
https://<production PWA host>/driver/
```

No query param needed. Every cab unit is pinned to this exact same URL;
nothing per-device or per-vehicle in it.

The `/driver/` path is required, not optional, on the Cloudflare Workers
deploy (`driver.pcvtechnologies.co.uk` — see Project overview in `CLAUDE.md`
for GitHub Pages vs. Workers status): it's a static-assets Worker with no
`server.js`-style aliasing of bare `/` to `driver/index.html`, so the bare
production root 404s. On the old GitHub Pages deploy the driver app lived at
repo root, so the bare production URL worked there — don't reuse that
shortcut once a device is pointed at the Workers host.

No backend config needed: opening the production URL already resolves to
the production Supabase project via the hostname check in
`driver/src/config.js` (only `localhost`/`127.0.0.1` switch to dev).

## Device setup (Fully Kiosk Browser — the actual approach in use)

Android's built-in **Screen Pinning** (Settings → Security → Screen Pinning)
was the first thing tried, but it doesn't survive an ignition-cycled reboot
without someone re-pinning by hand — a dealbreaker for a device that
power-cycles every time the vehicle starts. **Fully Kiosk Browser** is what's
actually deployed instead — free, auto-starts on boot, and survives crashes.

**Get the right app.** Fully Kiosk Browser is a specific app from
`fully-kiosk.com` — don't confuse it with **"Fully Single App Kiosk"**, a
different app from the same publisher that showed up first in a search on
device #1 and cost real setup time before the mixup was caught. Fully Kiosk
Browser is the one with a Start URL and Kiosk Mode; Fully Single App Kiosk is
a generic any-app locker with a paid-trial exit PIN and doesn't apply here.

### Automated path (recommended — one device already proved this out)

`cab-device/setup-cab-device.sh` installs Fully Kiosk Browser, grants every
permission it needs, enables its Accessibility-Service-based Kiosk Lock, sets
it as the default Home app, and pushes a known-good settings file — all via
`adb`, no on-device tapping. See the script's header comment for prerequisites
and usage; it prints the remaining manual steps (screen lock removal, vehicle
pick) when it finishes.

Why non-interactive `adb` instead of the on-device Settings UI: once Fully
Kiosk is the default Home app, Android's own Settings screens intermittently
freeze — the display shows a stale frame of Settings while touch input is
already routed back to the (invisible) Fully Kiosk window underneath. No
crash, no ANR, just a focus/redraw desync between two "home-ish" apps
fighting for focus. Re-launching the target Settings screen fresh
(`am start -a android.settings.X`) generally clears it; a literal human
finger swiping the physical screen hits the same issue. The script sidesteps
the whole problem by using `pm`/`appops`/`dpm`/`settings put` directly instead
of simulating taps through the flaky UI.

### Manual path (if adb isn't available)

1. Sideload **Fully Kiosk Browser** (Play Store needs a Google account this
   kiosk device doesn't need otherwise — sideloading the APK via Chrome
   avoids that; a known-good copy is kept at `cab-device/`). Chrome will
   prompt to allow installs from itself the first time.
2. Set **Start URL** to the kiosk URL below.
3. In Fully's Settings → **Kiosk Mode**: enable **Enable Kiosk Mode** (this
   *is* Kiosk Lock — Accessibility-Service based, free) and **Disable Home
   Button** (its description bundles "auto-run Fully in Kiosk Mode on boot").
   Leave **Single App** off — that's a separate, paid-after-trial,
   Device-Owner-based lockdown mode and isn't what's wanted here.
4. Enabling Kiosk Mode triggers an **"Accessibility Service Required"**
   prompt — tap Enable, then toggle Fully Kiosk on in Android's Accessibility
   settings list.
5. If a toggle shows *"Controlled by Restricted Setting"* and won't switch
   (Android blocks some permissions for sideloaded APKs by default): App
   info → ⋮ menu → **"Allow restricted settings"** → confirm with the
   device's screen lock credential. Then the toggle works normally.
6. Confirm it lands on the **"No duty assigned"** screen with a **"Select a
   service manually"** button, and (once `vehicles.journey_types` includes
   `'Local Bus'` for at least one vehicle) the one-time **"WHICH VEHICLE IS
   THIS?"** commissioning prompt from `driver/src/vehicleSetup.js` — pick the
   vehicle this physical unit is mounted in. Re-commission any time via the
   **Change** button next to the vehicle label on the "No duty assigned"
   screen — the device carries no fixed vehicle identity, contrary to what
   this doc used to say; swapping units between vehicles is a one-tap
   in-app action, not zero-touch.

### Required regardless of path: insert and confirm the SIM

A SIM card is now required in every cab device — cellular data gives a more
reliable connection to Supabase than depending on the vehicle having usable
WiFi. Do this **before** running `setup-cab-device.sh` / before Kiosk Mode
is enabled, same reasoning as the screen-lock removal step below: Settings
stays reachable pre-lockdown, not after.

1. Insert the SIM (the Blackview Active 5 is dual-SIM, per
   `docs/HARDWARE.md` §8 — either slot works).
2. Confirm mobile data connects: **Settings → Network & internet →
   SIM/Mobile network**. Most carriers auto-provision their APN from the
   SIM itself; only enter one manually if the carrier needs it (e.g. an
   MVNO).
3. `setup-cab-device.sh`'s pre-flight check refuses to proceed without a
   SIM it can detect as ready (`gsm.sim.state`), so this is enforced by the
   automated path, not just advisory — see the script for the
   `SKIP_SIM_CHECK=1` bench-testing override.

### Required regardless of path: remove the screen lock

If the device has any screen lock (PIN/pattern/password), every reboot stops
at Android's lock screen before Fully Kiosk can even attempt to auto-launch
— completely defeating "boots straight into BusOps, no one touches it" for
an ignition-cycled device. Remove it: **Settings → Security → Screen lock →
None** (enter the current credential to confirm), or non-interactively:
```
adb shell locksettings clear --old <current PIN>
```
With no lock, a reboot still shows Android's one-time
first-unlock-after-reboot screen (file encryption related, unrelated to any
PIN) — a single swipe clears it, no credential needed. That's the practical
floor for "zero-touch reboot" on stock Android; it's not a Fully Kiosk
limitation.

### Known quirks: boot-time system popups

Confirmed on device #1 via `adb shell dumpsys notification` plus live
reboot testing (2026-08-20, not guessed): even with the screen lock removed
and Fully Kiosk set as Home, two Android notifications show up on the lock
screen during boot, before Fully Kiosk takes over —

- **"Finish setting up your device — just a few more steps"**, posted by
  `com.google.android.setupwizard` (channel `suw_consolidate_notification`)
- **"Set a screen lock — now, for added security..."**, posted by the
  system itself (`pkg=android`, channel `safety_center_recommendation`) —
  Android's Safety Center nagging about the exact thing "Required
  regardless of path: remove the screen lock" above requires *not* having,
  so this one can never resolve itself on its own.

`setup-cab-device.sh` now fixes both non-interactively as part of the
automated path — no separate step needed:
```
adb shell pm disable-user --user 0 com.google.android.setupwizard
adb shell device_config set_sync_disabled_for_tests persistent
adb shell device_config put privacy safety_center_notifications_enabled false
```
Disabling `setupwizard` outright is safe once a device is past initial
setup (which every provisioned kiosk unit is) — nothing else on the device
needs it. The Safety Center flag needs `set_sync_disabled_for_tests`
called first: tested setting the flag alone, and it silently reverted to
`true` on the very next reboot (Android's device-config sync service
overwrites local overrides); freezing sync first makes it stick. Only the
proactive notification is disabled — Settings → Security & Privacy still
works normally if anyone opens it pre-lockdown. **Both require a reboot to
take effect**, not live — confirmed clean on device #1 after reboot, via
screenshot, not just the settings readback. Reversible:
```
adb shell pm enable com.google.android.setupwizard
adb shell device_config put privacy safety_center_notifications_enabled true
adb shell device_config set_sync_disabled_for_tests none
```

### Known quirk: "Waiting for Connection" blocks the PWA from loading on boot

Fully Kiosk's `waitInternetOnReload` setting ("Wait for Internet Connection"
in Other Settings) made it hold up on a **"Waiting for Connection"** splash
before it would even attempt to load the Start URL — on a slow ignition-boot
connect (cold SIM/cellular handshake), this could sit indefinitely, never
handing control to the PWA at all. Since the PWA's own service worker is
already cache-first and handles a real connectivity gap fine on its own (see
"Offline behaviour" below), waiting for Fully Kiosk's own internet check
first was pure downside — it blocks the one thing (loading from cache) that
would work regardless of connectivity. Fixed by setting
`waitInternetOnReload: false` in `cab-device/fully-auto-settings.json`
(2026-08-20).

**Already-provisioned devices won't pick this up automatically** —
`autoImportSettings` only re-imports from the copy of the file already
pushed to `/sdcard/Download/fully-auto-settings.json` on that device, not
from the repo. Re-push the updated file and restart Fully Kiosk once to
apply:
```
adb push cab-device/fully-auto-settings.json //sdcard/Download/fully-auto-settings.json
adb shell am force-stop de.ozerov.fully
adb shell am start -n de.ozerov.fully/de.ozerov.fully.MainActivity
```
(`//sdcard/...`, not `/sdcard/...` — see the Git Bash quirk below if running this on Windows.)

### Known quirk: a failed/never-cached first load needs a manual reload to recover

First-beta-test incident, 2026-09-03 (Announce Solo tablet): powered on with
no internet at all, so there was nothing cached yet to fall back to (see
"Offline behaviour" below — cache-first only helps once something has been
cached once) and the initial load simply failed. It sat there until a hotspot
was connected and the page was reloaded **by hand** — Fully Kiosk doesn't
retry a failed load or reload itself on its own once connectivity shows up,
by default. Fixed by three Fully Kiosk settings in
`fully-auto-settings.json`: `reloadOnInternet: true` and `reloadOnWifiOn:
true` (reload automatically the moment connectivity/WiFi comes up) and
`reloadPageFailure: "10"` (if a load still fails, keep retrying every 10s
instead of giving up after one attempt) — applied to
`announce/cab-device/fully-auto-settings.json` (the Announce Solo/Lite
tablet; this is the device the incident happened on). The same three
settings default to `false`/`"0"` in `driver/cab-device/fully-auto-settings.json`
too — apply the identical fix there if this failure mode is ever seen on a
Driver cab device. Same re-push-and-restart caveat as above applies to
already-provisioned units.

### Known quirk: Git Bash on Windows mangles `/sdcard/...` paths

Confirmed 2026-09-01 while provisioning the Announce Lite/Solo tablet
(`../announce/cab-device/setup-solo-device.sh`, same underlying pattern as
this script): running any `adb shell`/`adb push` command from **Git Bash on
Windows** with a plain `/sdcard/...` argument gets silently rewritten by
MSYS's path conversion into a Windows path (e.g.
`C:/Program Files/Git/sdcard/Download/...`), which then fails on-device with
`mkdir: 'C:': Read-only file system` or a push destination error — nothing
wrong with the device or the command itself. Fix: prefix the on-device path
with a second slash, `//sdcard/...` — MSYS treats a leading `//` as an
escape and leaves it alone, while `adb` itself is unaffected by the extra
slash. Both `setup-cab-device.sh` and `setup-solo-device.sh` already use
this form. Not an issue on plain Linux/macOS bash, which has no such
rewriting to escape.

### Known open issue: Kiosk Lock (Accessibility Service) doesn't stay enabled

Found 2026-08-20 while testing the `waitInternetOnReload` fix above on device
#1 (bench, not yet in a vehicle): forcing `enabled_accessibility_services` /
`accessibility_enabled` on via `adb shell settings put secure ...` works and
sticks — right up until Fully Kiosk itself restarts, at which point it
silently reverts to disabled and Fully posts a notification: **"Android
Accessibility Service was disabled for Fully Kiosk Browser. Please
check..."**. Net effect: **Kiosk Lock is not actually enforced** whenever
this happens — nothing stops exiting to the home screen or Settings.

`appops get de.ozerov.fully ACCESS_RESTRICTED_SETTINGS` already reports
`allow` (the override `setup-cab-device.sh` applies), so the usual
"Controlled by Restricted Setting" fix alone isn't sufficient here — the
service still doesn't stay bound. Not yet root-caused or fixed; suspect it
needs the on-device confirm-with-screen-lock-credential path done by hand at
least once (App info → ⋮ → "Allow restricted settings" → confirm with
credential), which can't be driven over `adb`. **Before shipping any device
to a vehicle long-term, verify Kiosk Lock actually survives a Fully Kiosk
restart** (check Settings → Security → Accessibility-service list on-device,
or watch for the "was disabled" notification) — don't assume the script's
`adb` step alone is durable.

## Offline behaviour

The PWA's existing cache-first service worker applies unchanged — a brief
connectivity gap won't break an already-loaded session. Same cache-version
bump discipline as any other release applies (see `README.md` §"Updating
cached assets").

## Possible follow-up (not built)

The "No duty assigned" wording and the extra "Select a service manually" tap
are copy/flow written for a driver's own phone that's missing its link — a
cab device never has a link to be missing. If that one tap ever turns out to
be a real problem in practice, a `?kiosk=1`-style URL param that skips
straight to the picker (bypassing the "no duty" messaging) would be a small,
self-contained addition — not needed to ship this.

## Retiring this

When NextStop-native hardware replaces this bridge, retiring a unit is just
wiping/repurposing the device — there's no server-side registration to clean
up. The only device-local state is the commissioned vehicle in
`localStorage`, which a factory reset or fresh Fully Kiosk install clears
along with everything else.
