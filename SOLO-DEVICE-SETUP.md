# Announce Lite/Solo device kiosk setup

> **⚠️ Real incident, 2026-09-01 — read before testing a device that has no
> independent internet connection.** While bench-testing via `adb reverse`
> (tunneling the device's `localhost:<port>` through USB to a machine
> running a local dev server — see "Bench-testing without WiFi/SIM" below),
> a reboot silently dropped the `adb reverse` tunnel. The device came back
> up, Kiosk Lock (Accessibility Service) happened to still be active, and
> Fully Kiosk tried to reload its start URL — which now pointed at nothing
> reachable. Result: a **blank screen with no way out** — Kiosk Lock blocks
> Home/Recents/notification-shade/system-dialogs by design, and there was no
> content to interact with either. **The only way out was a hardware
> long-press of the Power button (~10s) to force a restart** — this is an
> OS-level interrupt no app can block, and it's safe. (A second, unrelated
> scare during the same recovery: `adb` reported the device as
> `unauthorized` with no visible prompt after the forced restart — this
> briefly looked like the settings' `mdmDisableADB: true` field might have
> let Fully Kiosk's Device Admin grant disable USB debugging outright, but
> that theory doesn't hold up — `adb shell dpm list-owners` showed Fully
> Kiosk is only a basic Device Admin, not a Device Owner/Profile Owner, and
> that lower privilege tier can't call the APIs that would do that. The
> mundane explanation fits the evidence just as well: this device doesn't
> retain adb authorization across a reboot, and the re-authorization dialog
> needed the home screen to fully settle before it would render — a few
> USB-cable reconnects and waiting it out was all it took.) **Practical
> rule: never test a reboot on a device whose start URL depends on a USB
> tether to your own machine — use real WiFi/SIM connectivity (even a phone
> hotspot) for any reboot-survival check**, so the device has something to
> actually load when it comes back up regardless of USB/adb state.

Fixed, always-on **BusOps Announce** installs for the Controller-less tiers
(Lite: paired to a Driver device; Solo: driverless schedule-autopilot — see
`docs/ANNOUNCE-PRODUCT-TIERS.md`). This is a different device class from
`CAB-DEVICE-SETUP.md` (that's the **driver PWA** running on a phone) and from
`pcv-dashboard/busops/announce/mele-server/` (that's the base tier's
Controller-driven passenger sign, with no GPS/WAN of its own). This device
**is** the passenger-facing sign itself (`announce/onboard.html`/`onboard.js`),
running standalone with its own GPS and its own direct Supabase connection.

Same underlying kiosk app (Fully Kiosk Browser) and the same `adb`-driven,
non-interactive provisioning approach as `CAB-DEVICE-SETUP.md` — read that
doc's "Known quirks" section too (boot-time system popups, the
`waitInternetOnReload` fix, the Kiosk Lock/Accessibility Service durability
issue); those are bugs in Fully Kiosk itself, not specific to the driver
device, so they apply here unchanged and aren't repeated in full below.

## What's different from the Driver PWA cab device

- **The kiosk URL is per-device, not fixed.** A Driver cab device always
  points at the same production URL — vehicle identity is picked on-device
  afterwards. An Announce Lite/Solo device is fully commissioned by *which*
  URL it loads: the install link (`Dashboard → Announce Devices → (row) →
  Get Install Link`) bakes a signed JWT into `?announce-device-token=` that
  carries `device_id`/`company_id`/`vehicle_id` — there is no on-device
  picker step at all, for either tier.
- **GPS/location permission is load-bearing, not optional.** The Driver
  cab device also uses browser geolocation, but a Lite device (paired,
  mirroring a linked Driver's state) doesn't strictly need working GPS of
  its own to render — a Solo device's entire autopilot depends on it. Both
  Fully Kiosk's own `geoLocationAccess` webview setting **and** the OS-level
  `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` runtime permissions must
  be granted (`setup-solo-device.sh` does both).
- **No SIM hard-requirement.** The Driver script refuses to proceed without
  a detected SIM. This tier's script only warns — a fixed beta/bench
  install on WiFi is a legitimate option here, not just a fallback.

## The kiosk URL

```
https://<host>/announce/onboard.html?announce-device-token=<jwt>&operator-name=<name>
```

Generated per-device by the dashboard's **Get Install Link** button
(`AnnounceDeviceLinkPage.jsx`) — never construct this by hand. The token has
a 100-year expiry (it identifies a fixed kiosk install, not a login session —
see `pcv-dashboard/api/sign-announce-token.js`), so it's safe to mint once at
commissioning time and never needs refreshing.

## Device setup

`pcv-dashboard/busops/announce/cab-device/setup-solo-device.sh` installs
Fully Kiosk Browser (reusing the same known-good APK already vetted for the
Driver cab device, `driver/cab-device/Fully-Kiosk-Browser-v1.61.2.apk` —
not duplicated), grants every permission it needs (including the
location ones above), enables Kiosk Lock, sets it as the default Home app,
and pushes a settings file with this device's install link baked into
`startURL`:

```sh
cd pcv-dashboard/busops/announce/cab-device
./setup-solo-device.sh 'https://<host>/announce/onboard.html?announce-device-token=...&operator-name=...'
```

See the script's own header comment for the full prerequisite list (adb,
USB debugging, SIM/WiFi). It prints the remaining manual steps (screen lock
removal, mounting) when it finishes — same two steps as the Driver cab
device, no vehicle-picker step here since the URL already carries that.

### Manual path (if adb isn't available)

Same as `CAB-DEVICE-SETUP.md`'s manual path, with two differences: set
**Start URL** to this device's install link (above) instead of the fixed
driver URL, and after enabling Kiosk Mode, also grant **Location** under
Fully Kiosk's app permissions (Android Settings → Apps → Fully Kiosk
Browser → Permissions → Location → Allow) — this is the OS-level runtime
grant the script does non-interactively via `pm grant`.

### Bench-testing without WiFi/SIM (adb reverse)

A device connected only via USB, with no SIM and no configured WiFi, can
still load a real dev-Supabase-backed install link by tunneling through the
USB connection instead of a network:

```sh
adb reverse tcp:8080 tcp:8080   # device's localhost:8080 -> this machine's localhost:8080
```

Then use an install link built against `http://localhost:8080/...` (dev
Supabase, per `driver/src/config.js`'s `IS_DEV` check) as the `startURL`
argument to `setup-solo-device.sh`. This is genuinely useful for a first
smoke test (confirms permissions, Kiosk Lock, rendering) without needing
real connectivity sorted first — **but see the warning at the top of this
doc**: `adb reverse` mappings don't survive a reboot, so never combine this
with a reboot-survival test. For anything beyond an initial smoke test,
get the device onto real WiFi (even a phone hotspot) or a SIM instead —
`https://driver-dev.pcvtechnologies.co.uk/announce/...` is the equivalent
real, network-independent dev-Supabase target once the device has its own
connectivity, with no tether/tunnel fragility at all.

## The LEVIRTU 14" tablet (beta unit)

The physical unit sourced for the Solo beta: **LEVIRTU 14" Android tablet**
— actual OEM/model identifies itself as **PIXGOOD M328-EEA**, Android 16
(SDK 36), 1200×1920 native panel resolution, no SIM inserted as shipped
(confirmed via `adb shell getprop`; this is a common rebadging pattern for
budget Android tablets — the retail brand and the manufacturer in
`ro.product.manufacturer` often differ). Provisioned and verified live
2026-09-01 via `setup-solo-device.sh` against a real dev-Supabase device
(GPS overridden to a real stop, `onboard.html` loaded over `adb reverse` to
a local dev server). Real findings from that session, not guesses:

- **Android 16 rejects the scripted Home-app assignment outright.**
  `cmd package set-home-activity`/`cmd role add-role-holder` both fail with
  `RoleControllerServiceImpl: Package does not qualify for the role,
  package: de.ozerov.fully` — some eligibility check this Fully Kiosk
  Browser build (v1.61.2) doesn't satisfy on this Android version. **Not a
  blocker**: `setup-solo-device.sh` treats this as non-fatal now. The
  confirmed working fallback is Fully Kiosk's own in-app flow — on first
  launch with `kioskMode: true` (already set by the pushed settings), it
  shows a **"Switch Kiosk Mode on?"** dialog; tapping **Yes** drives
  Android's native interactive "Set default home app" chooser
  (`Fully Kiosk Browser` vs `Quickstep`/whatever the OEM launcher is) —
  selecting Fully Kiosk Browser there and confirming **succeeds**, verified
  via `adb shell cmd role get-role-holders android.app.role.HOME` returning
  `de.ozerov.fully` afterwards, and pressing the physical/soft Home button
  afterwards stayed on the Announce screen (Kiosk Lock held). Whether this
  is an Android-16-wide platform change or a PIXGOOD-specific
  RoleController customization isn't determined — treat any future
  Android-16-or-later device the same way (script does the automated
  attempt first, falls back to this in-app prompt if it fails).
- **Location permissions worked exactly as scripted** — `pm grant` for
  both `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` confirmed
  `granted=true` via `dumpsys package`, no on-device prompt needed. This is
  the one permission Solo can't function without, so it was checked
  explicitly, not assumed.
- **The pre-existing "Accessibility Service doesn't stay enabled" issue
  (`CAB-DEVICE-SETUP.md`'s "Known open issue") reproduces on this device
  too** — confirmed by the same on-screen "Android Accessibility Service
  was disabled for Fully Kiosk Browser" notification appearing here. This
  is a Fully Kiosk app-level bug, not brand/OS-specific — it was already
  documented as unresolved for the Blackview Active 5, and this session
  didn't root-cause it further. Re-applying the `settings put secure
  enabled_accessibility_services`/`accessibility_enabled` pair and
  confirming Home-button-press no longer exits held for the rest of this
  session, but per the existing doc's own caution, **verify Kiosk Lock
  survives an actual Fully Kiosk restart/reboot before trusting any device
  long-term** — don't assume a one-time check is durable.
- **Not yet reconciled with the physical mount.** `docs/HARDWARE.md` §14 /
  `docs/DECISIONS.md` record the Announce Lite/Solo mount decision
  (stanchion clamp, 9"–11" tablet class) as in tension with the previously
  *proposed* 14.6" DOOGEE Tab E3 Max pick — a 14" tablet doesn't fit that
  mount class either. The LEVIRTU unit supersedes the DOOGEE as the actual
  beta hardware (already purchased, per the user), but the mount conflict
  is carried forward unresolved, not solved by this doc — flag it before
  committing to a permanent in-vehicle mounting solution. This is a
  physical/procurement question, not a software one.
- **`adb shell wm size` reports the native panel matrix as 1200×1920**
  (portrait numbers), which looked concerning at first glance since the
  onboard sign's layout assumes landscape — but every screenshot taken
  during this session (via `adb exec-out screencap`, both before and after
  explicitly forcing `user_rotation`) rendered correctly in landscape,
  legible and properly proportioned, with Fully Kiosk's default
  orientation handling alone. `wm size`'s figure is the panel's physical
  matrix regardless of current rotation, not a landscape-support problem —
  confirmed a non-issue, not left open.

## Retiring this

Same as `CAB-DEVICE-SETUP.md` — no server-side registration to clean up on
the device side (deleting the `announce_devices` row itself, from the
dashboard, is the actual retirement step; the physical device just gets
wiped/repurposed).
