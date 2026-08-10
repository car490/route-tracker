# Cab device kiosk setup

Fixed, always-on driver PWA installs for vehicle cabs — the NextStop bridge for
the next ~6 months, until vehicles carry NextStop-native hardware. This is a
different device class from `pi-server/` (that's the *passenger-facing*
onboard sign, offline-only, one per vehicle, GPS from a Pi). The cab device is
the **driver PWA** (`index.html`/`src/main.js`) itself, just running without a
driver ever receiving or tapping an install link.

## What this does and doesn't solve

The driver still picks their service and run — that part isn't automated.
What's removed is the install friction: no link to receive, no "Add to Home
Screen" step, no picking their name off a duty list. The screen is just
already there, on, and ready when they get in the cab.

The manual service/run picker this relies on already ships on `develop`
(`src/manualSelection.js`, wired up in `src/main.js`'s `initManualSelection()`)
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

Because the device carries no vehicle identity (nothing on it is bound to a
specific bus), any unit can be swapped between the 4 vehicles with zero
reconfiguration.

## The kiosk URL

```
https://<production PWA URL>/index.html
```

The plain production URL — no query param needed. Every cab unit is pinned
to this exact same URL; nothing per-device or per-vehicle in it.

No backend config needed: opening the production GitHub Pages URL already
resolves to the production Supabase project via the hostname check in
`src/config.js` (only `localhost`/`127.0.0.1` switch to dev).

## Device setup

1. Install Chrome (or the device's default browser).
2. Open the kiosk URL once.
3. **Add to Home Screen** — installs it as the standalone PWA per
   `manifest.json` (chrome-less, own icon), same as the driver-phone install.
4. Set the browser to reopen its last page on launch (Chrome: Settings →
   "Continue where you left off"), and set the device to auto-launch that
   browser/shortcut on boot. Exact steps vary by device/launcher — Android
   kiosk launchers, a boot-to-app config, or simply making the installed
   PWA icon the thing that opens automatically.
5. **Settings → Security → Screen Pinning** (built into Android, no paid
   kiosk app needed — same approach already used for the Fire HD in
   `pi-server/DEPLOY.md`) — pin the browser/PWA to that page so the driver
   can't navigate away or reconfigure the device.
6. Confirm it lands on the **"No duty assigned"** screen with a **"Select a
   service manually"** button — tapping it should reveal the service/run
   picker.

If a device needs to survive unattended reboots without anyone re-pinning it
by hand (screen pinning alone doesn't survive a reboot until someone opens
and re-pins the app), consider **Fully Kiosk Browser** (free Android app) —
it can auto-start on boot, load a fixed URL, and relaunch itself if it
crashes, without any paid MDM. Not required for the 6-month bridge, but worth
it if unattended reboots turn out to be common in practice.

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
un-pinning/repurposing the device — there's no server-side registration to
clean up, since nothing is bound to a specific vehicle or device.
