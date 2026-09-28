# RouteTracker — Testing Guide

Step-by-step instructions for testing every component of the RouteTracker platform.

---

## Contents

1. [One-time setup](#1-one-time-setup)
2. [Run the driver PWA locally](#2-run-the-driver-pwa-locally)
3. [Run the ops dashboard locally](#3-run-the-ops-dashboard-locally)
4. [Test: Supabase data](#4-test-supabase-data)
5. [Test: Dashboard — Login](#5-test-dashboard--login)
6. [Test: Dashboard — Overview](#6-test-dashboard--overview)
7. [Test: Dashboard — Drivers](#7-test-dashboard--drivers)
8. [Test: Dashboard — Vehicles](#8-test-dashboard--vehicles)
9. [Test: Dashboard — Routes & Timetables](#9-test-dashboard--routes--timetables)
10. [Test: Dashboard — Daily Journeys](#10-test-dashboard--daily-journeys)
11. [Test: Dashboard — Live Tracking](#11-test-dashboard--live-tracking)
12. [Test: Driver PWA — normal flow](#12-test-driver-pwa--normal-flow)
13. [Test: Driver PWA — GPS simulation (desktop)](#13-test-driver-pwa--gps-simulation-desktop)
14. [Test: Driver PWA — debug mode](#14-test-driver-pwa--debug-mode)
15. [Test: Driver PWA — offline fallback](#15-test-driver-pwa--offline-fallback)
16. [Test: End-to-end (dashboard + PWA together)](#16-test-end-to-end-dashboard--pwa-together)
17. [Test: BusOps Announce Lite / Solo](#17-test-busops-announce-lite--solo)
18. [Resetting test data](#18-resetting-test-data)
19. [Test: Power cut and first boot (all devices)](#19-test-power-cut-and-first-boot-all-devices)

---

## 1. One-time setup

These steps only need to be done once per machine / Supabase project.

### 1a. Apply Phase 2 RLS policies to Supabase

1. Open [https://supabase.com/dashboard](https://supabase.com/dashboard) and select the RouteTracker project
2. Go to **SQL Editor**
3. Open `supabase/phase2_rls.sql` from this repo
4. Paste the contents into the editor and click **Run**
5. You should see "Success. No rows returned."

> This grants authenticated dashboard users read/write access to all tables. The driver PWA's anon access is unchanged.

### 1b. Create an ops manager login

1. In Supabase dashboard → **Authentication** → **Users**
2. Click **Invite user** (or **Add user** → **Create new user**)
3. Enter an email address and password
4. This account is used to log in to the ops dashboard

### 1c. Install dashboard dependencies (first time only)

```
cd route-tracker/dashboard
npm install
```

---

## 2. Run the driver PWA locally

From the `route-tracker/` directory:

```
node server.js
```

Open: **http://localhost:8080**

The PWA is served from `public/`. The service worker registers on first load.

---

## 3. Run the ops dashboard locally

From the `route-tracker/dashboard/` directory:

```
npm run dev
```

Open: **http://localhost:5173**

Vite's dev server supports hot reload. Changes to any file in `dashboard/src/` update instantly.

---

## 4. Test: Supabase data

Verify the seeded data is present before testing anything else.

1. Open Supabase dashboard → **Table Editor**
2. Check `routes` — should contain 2 rows: **S125S** and **S116S**
3. Check `timetables` — should contain 4 rows (S125S am, S125S pm, S116S am, S116S pm)
4. Check `timetable_stops` — should contain **106 rows** total
5. Check `companies` — should contain 1 row: **Phil Haines Coaches**

If any table is empty, re-run `supabase/schema.sql` then `supabase/seed.sql` in the SQL editor.

---

## 5. Test: Dashboard — Login

1. Open **http://localhost:5173**
2. You should be redirected to `/login` automatically
3. Enter the email and password created in step 1b
4. Click **Sign in**

**Pass:** You are redirected to the Overview page and the sidebar shows your email in the footer.

**Fail scenarios:**
- "Invalid login credentials" → wrong email/password, or user not created
- Page loads but stays on login after clicking → check browser console for Supabase errors; likely phase2_rls.sql has not been run

To test sign-out: click **Sign out** in the sidebar footer → you should be returned to `/login`.

---

## 6. Test: Dashboard — Overview

After logging in, the Overview page loads by default.

**What to check:**
- Four stat cards are visible: **Routes**, **Drivers**, **Vehicles**, **Today's Journeys**
- Routes shows **2** (seeded data)
- Drivers and Vehicles show **0** until you add some
- Today's Journeys shows **0** until you create some
- Today's date is shown correctly in the top-right

**Fail:** All cards show `—` and never update → Supabase queries are failing; open browser DevTools → Network and look for failed requests to `supabase.co`.

---

## 7. Test: Dashboard — Drivers

Navigate to **Drivers** in the sidebar.

### Add a driver
1. Click **+ Add Driver**
2. Enter name: `Test Driver`
3. Role: `driver`
4. Click **Save**
5. The modal closes and the new driver appears in the table

### Edit a driver
1. Click **Edit** next to the driver you just added
2. Change the name to `Test Driver (edited)`
3. Click **Save**
4. The table row updates immediately

### Add an ops manager
1. Click **+ Add Driver**
2. Enter name: `Ops Manager`
3. Role: `ops_manager` (shown as blue badge)
4. Click **Save**

### Delete a driver
1. Click **Delete** next to `Test Driver (edited)`
2. Confirm the prompt
3. The row is removed from the table

**Pass:** All four actions complete without errors and the table reflects changes.

---

## 8. Test: Dashboard — Vehicles

Navigate to **Vehicles** in the sidebar.

### Add a vehicle
1. Click **+ Add Vehicle**
2. Registration: `AB12 CDE` (auto-uppercases as you type)
3. Fleet Number: `1` (optional)
4. Click **Save**

### Edit a vehicle
1. Click **Edit** next to AB12 CDE
2. Change fleet number to `2`
3. Click **Save**

### Delete a vehicle
1. Click **Delete** → confirm

**Pass:** Registration displays in monospace. Fleet number shows `—` when empty.

---

## 9. Test: Dashboard — Routes & Timetables

Navigate to **Routes & Timetables** in the sidebar.

### View seeded routes
1. Two rows should be visible: **S125S** and **S116S**
2. The Timetables column shows a blue badge with `2` for each

### Expand timetables
1. Click anywhere on the **S125S** row
2. A second card appears below showing the AM and PM timetables
3. The Stops column shows `26 stops` for each (fetched live from Supabase)
4. Click the S125S row again to collapse

### Add a test route
1. Click **+ Add Route**
2. Service Code: `TEST1`
3. Name: `Test Route`
4. Click **Save**
5. The new route appears in the table with 0 timetables

### Add a timetable to the test route
1. Click the **TEST1** row to expand
2. Click **+ Add Timetable**
3. Period: `AM`
4. Leave Valid From / To blank
5. Click **Save**
6. The timetable appears with `0 stops`

### Delete the test route
1. Click **Delete** next to TEST1
2. Confirm — the route and its timetable are removed

**Pass:** S125S and S116S remain unchanged throughout.

---

## 10. Test: Dashboard — Daily Journeys

Navigate to **Daily Journeys** in the sidebar.

### Create a journey
1. The date defaults to today
2. Click **+ Add Journey**
3. Timetable: select **S125S AM**
4. Driver: select the driver you added in step 7 (if none, leave unassigned)
5. Vehicle: select AB12 CDE (if none, leave unassigned)
6. Click **Save**
7. The journey appears with status badge **Scheduled**

### Start a journey
1. Click **Start** next to the journey
2. Status changes to **In Progress** (amber badge)

### Complete a journey
1. Click **Complete** next to the in-progress journey
2. Status changes to **Completed** (green badge)

### Change the date filter
1. Change the date picker to yesterday
2. Table shows "No journeys scheduled for this date"
3. Change back to today — your journey reappears

### Edit a journey
1. Create a second journey (S116S PM, unassigned)
2. Click **Edit** → change the driver or vehicle → Save

### Delete a journey
1. Click **Delete** → confirm

**Pass:** Status transitions work correctly; `started_at` and `completed_at` timestamps are written (visible in Supabase Table Editor → journeys).

---

## 11. Test: Dashboard — Live Tracking

Navigate to **Live Tracking** in the sidebar.

1. Using the Journeys page, set one of today's journeys to **In Progress** (click Start)
2. Switch to Live Tracking
3. The journey appears in the "Journeys In Progress Today" table with route, driver, vehicle, and start time
4. The GPS map placeholder card is visible below the table

### Test Supabase Realtime
1. Open a second browser tab to the Journeys page
2. In the second tab, click **Start** on another journey
3. Switch back to the Live Tracking tab
4. Without refreshing, the new in-progress journey should appear within a few seconds

**Pass:** The table updates automatically when a journey's status changes to `in_progress` in any tab.

---

## 12. Test: Driver PWA — normal flow

Open **http://localhost:8080** in Chrome.

### Start screen (picker)
1. **Service** dropdown: select `S125S`
2. **Run** dropdown: defaults to AM (before noon) or PM (after noon) — change if needed
3. **Starting stop**: select any stop from the list (e.g. the first one)
4. Click **Start**

### Tracker screen
- The header shows the service code and route endpoints
- The **List** tab is active — all stops are shown with scheduled times
- Stops before the selected starting stop are greyed out
- Click the **Map** tab — the route map loads (Leaflet, OSRM road-snapped)
- Click the **Directions** tab — turn-by-turn directions for the first leg are shown

**Pass:** All three tabs load without errors. The stop list shows the depot as the first and last stop.

---

## 13. Test: Driver PWA — GPS simulation (desktop)

Chrome DevTools can simulate a GPS position so you can test arrival detection without being in a bus.

1. Open **http://localhost:8080**, start a journey on S125S AM, starting from stop 1
2. Open DevTools (F12) → **More tools** → **Sensors** (or find it in the three-dot menu)
3. In the **Location** section, select **Custom location**
4. Enter the lat/lon of stop 2 (from `supabase/seed.sql` or Supabase Table Editor)
   - Example: `52.807162, -0.074017` (Weston, opp Delgate Bank)
5. The PWA is watching GPS every second — within ~2 seconds it should detect you are within 50 m of stop 2
6. The stop list updates: stop 1 shows a green "on time" or coloured arrival time; the tracker advances to stop 3

### Test early arrival (WAIT HERE banner)
1. Set GPS to a stop that is more than 2 minutes ahead of schedule
2. The **List** tab should show a flashing **WAIT HERE** banner

### Test the jump button (⏭)
1. Click the ⏭ button next to a future stop in the list
2. The tracker jumps to that stop as the next expected stop

### Test automatic mode (no duty card)
**Quick automated check first:** `npm run verify:autostart` (from `pcv-dashboard/busops/`) runs the real
app in headless Chromium with simulated GPS and a local stand-in for Supabase (no network, no data
touched): auto-start after the countdown and a drive through every stop to trip complete, Not now,
Change service, a server refusal, and a duty-card link. About 2 minutes; exit 0 all passed, 1 a check
failed. The manual steps below are for a real device against dev Supabase.

Automatic mode (`driver/src/autostart/`, `docs/DECISIONS.md` "Driver automatic mode") runs on the
waiting ("No duty assigned") screen: a device with a commissioned vehicle and no `?duties=` link. It
checks GPS every 5 seconds and offers a Local Bus departure that runs today when the vehicle is within
150 m of its first stop, from 15 minutes before to 30 minutes after its time.

1. Open **http://localhost:8080/?debug** (debug lets you test at any time of day: the timetable is
   shifted to now, the same as a Solo device's `testing_mode`). Without `?debug`, set your computer's
   clock or pick a departure due within the window.
2. Commission a vehicle if asked. The waiting screen should say *"Your service starts automatically
   when you are at its first stop."*
3. In DevTools **Sensors**, set the location to a departure's first stop
4. Within ~5 seconds an overlay appears: **Starting automatically**, the service and its departure,
   and **Starting in 10 seconds** counting down, with **Start now**, **Change service**, **Not now**
5. Let it reach zero: the journey starts exactly as the manual Start button would (tracker screen,
   announcements if PSVAIR, Controller feed)
6. Repeat and check each button:
   - **Start now** starts at once
   - **Not now** closes it, and the same departure is not offered again today
   - **Change service** opens the manual picker with that service already selected
7. A departure that isn't running today (for example cancelled via a service exception) is refused by
   the server: the overlay says *"Couldn't start … Choose the service yourself."* and nothing starts.
   Offline, it starts anyway and the start is queued, the same as the manual picker.
8. With a duty-card link (`?duties=`), automatic mode must never appear

---

## 14. Test: Driver PWA — debug mode

Open **http://localhost:8080/?debug**

**Differences from normal mode:**
- The **Directions** tab is hidden
- The **Log** tab is visible
- The Log tab shows timestamped events: GPS fixes, arrivals, misses, errors

1. Start a journey in debug mode
2. Simulate GPS arrival at a stop (using DevTools Sensors as above)
3. Click the **Log** tab — you should see `arrived` events with timestamps and coordinates

---

## 15. Test: Driver PWA — offline fallback

Tests that the PWA falls back to its `localStorage` route/schedule cache (`localStore.js`)
when Supabase is unreachable, and that a journey start attempted offline is queued rather
than blocked.

1. Open **http://localhost:8080** **online** and let it fully load (service worker registers,
   and `preloadAllRoutes()` warms the `localStorage` cache with the current `schedule_view`
   data).
2. Open DevTools → **Network** tab → set throttle to **Offline**
3. Refresh the page
4. The PWA should still load (app shell from service worker cache)
5. The picker and stop list should still populate — from the `localStorage` cache
   (`busops.cache.services` / `busops.cache.stops.*` in DevTools → Application → Local
   Storage), not from a live Supabase fetch
6. Select a service and start a journey — the start is accepted immediately rather than
   erroring; check `busops.cache.services`' neighbour key `busops.queue.pendingJourneyStarts`
   in Local Storage — it should contain the queued start

**Pass:** No "Failed to fetch" error in the console; the picker and stop list work normally
offline; the journey start is queued, not rejected.

**To restore:** Set Network throttle back to **No throttling** and refresh — `main.js`'s
`flushPendingJourneyStarts()` should drain the queued journey start on reconnect.

### Verify service worker is registered
1. DevTools → **Application** tab → **Service Workers**
2. You should see `service-worker.js` listed as **Activated and running**
3. The cache name should be `busops-driver-v1.5.1` (visible under **Cache Storage**) — matches
   the current `VERSION` file

---

## 16. Test: End-to-end (dashboard + PWA together)

This verifies the two halves of the system work together.

1. **Dashboard (tab 1):** Create a journey for today — S125S AM, assign a driver and vehicle, leave as Scheduled
2. **PWA (tab 2):** Open http://localhost:8080 — select S125S AM — start the journey
3. **Dashboard (tab 1):** Go to Journeys → click **Start** on the S125S AM journey
4. **Dashboard (tab 1):** Go to **Live Tracking** — the journey should appear in the in-progress list
5. **PWA (tab 2):** Simulate GPS arrival at a stop (DevTools Sensors)
6. **Dashboard (tab 1):** Refresh Live Tracking — the journey is still listed (GPS events not yet wired to Supabase — this is a Phase 2 outstanding item)
7. **Dashboard (tab 1):** Go to Journeys → click **Complete**
8. **Dashboard (tab 1):** Live Tracking — the journey disappears from the list (only shows `in_progress`)

**Pass:** Journey status transitions are reflected across both the dashboard and Supabase in real time.

---

## 17. Test: BusOps Announce Lite / Solo

Covers the two Controller-less tiers (see `docs/ANNOUNCE-PRODUCT-TIERS.md`): a
second GPS-capable tablet running `busops/announce/onboard.html` directly,
either paired to a Driver device (**Lite**) or fully driverless (**Solo**).
Both modes read/write Supabase directly via a device-scoped JWT — no Bus
Controller involved, and both run on the same device/software, distinguished
only by whether a Driver device is linked.

### Register a device and get its install link
1. Dashboard → **Announce Devices** → **+ Add Device**
2. Pick a vehicle, optionally give it a label, save
3. Click **Get Install Link** — a URL like
   `http://localhost:8080/announce/onboard.html?announce-device-token=<jwt>`
   is generated (calls `/api/sign-announce-token`)
4. Open that URL in a **second** browser tab/window — it should render the
   idle screen with the BusOps Announce brand mark and no console errors

### Test: Lite (paired mode, linked to a Driver device)
> **Known gap (not yet built):** there is no "Link Announce device" button
> in the Driver PWA yet — only the underlying RPCs
> (`link_announce_device`/`unlink_announce_device`) and the dashboard-side
> registration exist so far. Until that UI lands, link a device manually:
> ```sql
> select link_announce_device('<announce_devices.id>', '<vehicles.id>');
> ```
1. Link a device to a vehicle (UI once built, or the SQL above for now)
2. Start a duty-card or manual-selection journey on that vehicle in the
   Driver PWA (tab 1)
3. In the Announce tab (tab 2, opened with that device's install link), the
   idle screen should replace itself with the live sign — service code,
   destination, tube-track — within a few seconds of journey start
4. Simulate GPS arrival at a stop in the Driver PWA (DevTools Sensors, see
   §13) — the Announce tab's tube-track should advance to match, without
   reloading
5. Complete the journey in the Driver PWA — the Announce tab returns to idle

**Pass:** the Announce tab mirrors the Driver PWA's tracking state via
Supabase Realtime, with no direct interaction on the Announce device itself.

### Test: Solo (driverless, schedule-autopilot)
Only safe for routes whose start/end stops don't overlap with any other
service (see the doc's "hard precondition") — the seeded S125S route is a
reasonable stand-in for testing.

1. In Supabase SQL Editor, configure the device's candidates directly (no
   dashboard UI for this yet either):
   ```sql
   update announce_devices
   set candidate_departure_ids = array['<timetable_departures.id>']
   where id = '<announce_devices.id>';
   ```
2. No separate active-window table to configure any more (dropped
   2026-09-04 — see `docs/ANNOUNCE-PRODUCT-TIERS.md`'s simplification
   writeup): the device wakes to poll its own GPS only within
   `match_window_before_min`/`match_window_after_min` (already on the
   device row, default 15/30) of one of its candidates' own scheduled
   `departure_time`, on a day that departure's `days_of_week` actually
   includes. To test at an arbitrary time of day rather than waiting for
   the real departure time, temporarily widen those two columns so the
   wake window covers the whole day:
   ```sql
   update announce_devices
   set match_window_before_min = 720, match_window_after_min = 720
   where id = '<announce_devices.id>';
   ```
   Either that, or set `testing_mode = true` on the device (bypasses the
   scheduled-time *match* window entirely, geofence-only — see
   `findTestingScheduleMatch`) — note `testing_mode` alone does **not**
   widen the *wake* window above, so the device still won't poll GPS at all
   unless `now` is within match_window_before_min/after_min of some
   candidate, or you pick a candidate whose scheduled time is close to now,
   or you widen the columns as above too.
3. Open the device's install link — the idle screen should show one
   **"&lt;SERVICE&gt; next departure HH:MM"** caption per distinct service the
   device carries candidates for, once candidates load
4. Open DevTools (F12) → **Sensors** → set **Custom location** to the
   candidate's first stop's lat/lon, within `terminus_radius_m` (150m
   default)
5. Within ~5 seconds (the idle-poll interval) the idle screen should
   disappear and the live sign should appear — a journey has started
   automatically, no driver/manual action involved
6. Simulate GPS progressing through the remaining stops (as in §13) — the
   tube-track should advance normally, using the same tracking engine as
   the Driver PWA
7. Simulate GPS arrival at the final stop — the journey should complete and
   the device return to the idle/next-departure screen automatically, with
   the previous journey's sign fully hidden (not left showing underneath)

**Pass:** a fully driverless device starts, tracks, and completes a journey
on its own, matching only when both the geofence and the scheduled-time
window agree (test outside either condition and confirm it stays idle), and
never polls GPS at all outside the wake window around its candidate
departures.

**Live-verified 2026-09-01** (not just a written procedure — see
`docs/ANNOUNCE-PRODUCT-TIERS.md`'s status entry): scripted against dev
Supabase with a real device row, real minted JWT, and a real browser
(Playwright driving Chromium's geolocation override in place of manual
DevTools Sensors clicks). Found and fixed one real bug in the process:
`announceSoloAutopilot.js`'s `completeActiveJourney()` called
`client.rpc(...).catch(...)` directly, which threw against the real
vendored supabase-js client (its query builder is thenable but not an
actual `Promise`, so it has no `.catch()`) — silently breaking journey
completion. Fixed with `Promise.resolve(client.rpc(...)).catch(...)`.

**To restore:** clear the test device's `candidate_departure_ids`,
`link_state`/`gps_source` back to defaults (`'{}'`, `'unlinked'`,
`'internal'`), reset `match_window_before_min`/`match_window_after_min`
back to their defaults (`15`/`30`) if you widened them for testing above,
and clear DevTools' Sensors override back to **No override**.

### Bench-testing with real devices (real GPS, not DevTools simulation)

Unlike the base Announce tier (needs the Bus Controller + its own WiFi
hotspot, see `mele-server/`), Lite/Solo need no local link at all — any
phone/tablet with a browser and an internet connection (mobile data or the
same WiFi as your laptop) can run it, moving/walking it physically instead
of simulating GPS.

**Gotcha**: `driver/src/config.js`'s `IS_DEV` check only matches hostname
`localhost`/`127.0.0.1` — a real device reaching your laptop over its LAN IP
(e.g. `192.168.1.42:8080`) fails that check and silently points at
**production** Supabase instead of dev. For a bench test:
1. Temporarily edit `IS_DEV` in `config.js` to also match your LAN IP (or
   just hardcode it `true`) — never commit this, revert with
   `git checkout -- pcv-dashboard/busops/driver/src/config.js` when done.
2. `node scripts/dev-all.mjs` (or just `cd pcv-dashboard/busops && node server.js`),
   find your laptop's LAN IP (`ipconfig`), and both real devices browse to
   `http://<LAN-IP>:8080/...` instead of `localhost`.
3. Register/link Announce devices exactly as above, but build install
   links against `http://<LAN-IP>:8080/announce/onboard.html?...` instead
   of the dashboard's auto-generated `localhost` one.
4. Physically walk/drive the devices between real stops rather than using
   DevTools Sensors.

---

## 18. Resetting test data

To clear test drivers, vehicles, and journeys between test runs without touching the seeded routes/timetables:

In **Supabase SQL Editor**, run:

```sql
-- Remove all journeys (safe to run repeatedly)
delete from journey_events;
delete from journeys;

-- Remove test drivers and vehicles (keep if you want to reuse them)
delete from drivers;
delete from vehicles;
```

To fully reset to the seeded state (routes + timetables only):

```sql
delete from journey_events;
delete from journeys;
delete from drivers;
delete from vehicles;
```

> **Do not delete from `routes`, `timetables`, or `timetable_stops`** — re-seeding the 106 stops requires re-running `seed.sql` in full.

---

## 19. Test: Power cut and first boot (all devices)

What happens when the isolator cuts everything, the tablets' batteries go completely flat, and
the ignition comes back. Background and options: `docs/HARDWARE.md` "Power loss and first boot".
Do part A before anything else: parts B and C mean nothing if a device doesn't switch itself on.

**Record results in the [Power-cut bench test checklist](https://claude.ai/code/artifact/d17b484d-cf48-4acb-8895-1e690b001ba0)**
(a shared doc: the same steps as below, with tick boxes, a table per test and a Pass/Fail sign-off).
This section stays the reference; if the two ever disagree, fix the doc to match this file.

### A. Bench test: does each device switch itself on? (hardware, no app needed)

For **each** device: the Driver tablet, the Announce tablet, and the Bus Controller.

1. Charge fully, then set it up exactly as fitted (Fully Kiosk installed and set up, same cable
   and charger or PD module).
2. **Tablets:** unplug and leave the screen on (Fully keeps it on) until the battery is
   completely flat and the tablet switches itself off. Leave it off for at least 30 minutes.
   **Controller:** it has no battery; just cut its supply.
3. Restore power the way the ignition would: supply on, **nobody touches the device**.
4. Record, from the moment power returns:

   | Device | Model | Started by itself? (Y/N) | What it showed instead, if N | Time to Android/OS | Time to app on screen |
   |---|---|---|---|---|---|
   | Driver tablet | | | | | |
   | Announce tablet | | | | | |
   | Bus Controller | MeLE Quieter4C | | | | |

5. **Controller only** (after `bootstrap-controller.sh` and one restart —
   `mele-server/DEPLOY.md` §0):
   1. **BIOS:** set "Restore on AC power loss" (or similar) to **Power On**; record the exact
      menu path in `mele-server/DEPLOY.md` §0 step 8.
   2. **Read-only disk is on:** `findmnt /` shows FSTYPE `overlay`. Create a test file
      (`touch ~/probe`), cut and restore power: it must be gone.
   3. **Watchdog:** `sudo wdctl` shows a device and a 30 s timeout. Freeze the box on purpose
      (`echo c | sudo tee /proc/sysrq-trigger`, which crashes the kernel): it must restart by
      itself within about a minute. If `wdctl` finds nothing, record it in `docs/HARDWARE.md` §1.
   4. **Hung server:** `sudo kill -STOP $(pgrep -f 'node server.mjs')`. Within 2 minutes the
      health check must restart it (`journalctl -u coachmate-healthcheck` says so, and
      `curl -k https://localhost:8080/api/schedule` answers again).
   5. **Update script:** `update-controller.sh`, then `sudo reboot`; the new commit must be
      running (`git -C ~/route-tracker log -1`). This also confirms the chroot has network.
   6. **20 cuts:** cut and restore power 20 times in a row, some mid-boot. Note any boot that
      fails, stops for a disk check, or comes up without the hotspot or `coachmate-onboard`.
6. If a tablet shows a "charging" screen or stays off, **stop and report it**. The fix is a
   hardware choice (`docs/HARDWARE.md` lists the options), not something the app can solve.
   Don't unlock the bootloader to work around it.

### B. On the real tablets: does the app pick up where it left off?

Only once part A passes. Use dev Supabase and a test journey.

1. **Duty card survives:** open a duty-card link on the Driver tablet. Pull the power until the
   tablet switches off, restore it. **Expect:** the same duty card, without re-opening the link.
2. **Trip carries on with no signal:** start the trip and drive (or walk the GPS simulator)
   past two stops. Turn mobile data and WiFi **off**, then cut the power. Restore it.
   **Expect:** "Carry on your trip" with the stop the vehicle was heading for already selected.
   Tap Start, finish the trip. **Expect:** "Trip Ended … saved on this device".
3. Turn data back on. **Expect:** in the dashboard, the journey is completed and has stop times
   for **every** stop, including the two reached before the power cut.
4. **Old trip not offered:** start a trip, cut power, wait more than 2 hours, restore.
   **Expect:** the normal waiting screen or duty card, not "Carry on your trip". The stops it
   reached still show in the dashboard, and the journey is **not** marked complete.
5. **End of shift:** complete every duty on a duty card, then restart the tablet.
   **Expect:** the duty card does not come back (the link has been removed from the device).

**Announce Solo tablet** (dev Supabase, a Solo device commissioned for a test departure):

6. **Trip carries on with no signal:** let Solo start the trip at the first stop and drive past
   two stops. Turn WiFi/data **off**, cut the power, keep driving, restore power. **Expect:** the
   sign comes back on its own and shows and says "The next stop is …" for the stop ahead, then
   carries on normally. Finish the trip.
7. Turn data back on. **Expect:** in the dashboard the journey is completed, with stop times for
   **every** stop, including those before the power cut.
8. **Starts with no signal:** with data **off**, restart the tablet at the first stop of a
   departure due now. **Expect:** the trip starts as normal. Turn data on. **Expect:** the
   journey appears in the dashboard as started, then completed at the end.
9. **Revoked tablet:** run it once online, then with data off restart it (it runs from its copy).
   Revoke it (`update announce_devices set revoked_at = now() where id = …` on dev), turn data
   on. **Expect:** the sign goes dark within a few seconds and stays dark after a restart.

### C. Automated check (no tablet needed)

```sh
cd pcv-dashboard/busops
npm run verify:power-cut
npm run verify:solo-power-cut
```

Runs the real Driver app in headless Chromium through B1–B5 with simulated GPS and a local
Supabase stand-in (nothing leaves the machine). `npm run verify:solo-power-cut` does the same
for the Announce Solo sign (B6–B9, real `onboard.html`). Exit 0 all passed, 1 a check failed. Useful
before and after any change to boot, the duty link or trip saving, but it is **not** a
substitute for part A or B: it can't tell you whether a real tablet switches itself on.
