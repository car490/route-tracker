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
17. [Resetting test data](#17-resetting-test-data)

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

Tests that the PWA loads schedule data from `schedule.json` when Supabase is unreachable.

1. Open **http://localhost:8080** — wait for it to fully load (service worker registers)
2. Open DevTools → **Network** tab → set throttle to **Offline**
3. Refresh the page
4. The PWA should still load (served from service worker cache)
5. Select a service and start a journey — stop data loads from `schedule.json`

**Pass:** No "Failed to fetch" error in the console; the picker and stop list work normally.

**To restore:** Set Network throttle back to **No throttling** and refresh.

### Verify service worker is registered
1. DevTools → **Application** tab → **Service Workers**
2. You should see `service-worker.js` listed as **Activated and running**
3. The cache name should be `route-tracker-v7` (visible under **Cache Storage**)

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

## 17. Resetting test data

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
