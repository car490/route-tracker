# CoachMate

A real-time bus route timing system for Phil Haines Coaches drivers, plus an ops back-office
dashboard. Three deployable surfaces share one Supabase backend:

| Surface | Path | Stack | Deploys to |
|---|---|---|---|
| **BusOps Driver** (driver PWA) | `pcv-dashboard/busops/driver/` | Vanilla JS, ES modules, no build step | GitHub Pages today (live production); migrating to Cloudflare Workers (`driver.pcvtechnologies.co.uk`), auto-deployed from `develop` |
| **PCV Dashboard** (ops back office) | `pcv-dashboard/` | React + Vite | Vercel, auto on push |
| **BusOps Announce** (onboard passenger sign) | `pcv-dashboard/busops/announce/` + `mele-server/` | Vanilla JS + Node (WebSocket relay) | Bus Controller box + HDMI display |

PCV Dashboard is the mandatory umbrella product every customer gets; BusOps (Driver + Announce)
is the first product module built on it. See `docs/BRAND.md` for the full brand hierarchy.

---

## Purpose

Drivers open **BusOps Driver** on a phone before departure, pick their scheduled duty (or a
service manually), then tap Start. The app uses the device GPS to measure distance to each
upcoming stop, computes an ETA against the timetable, and shows whether the run is on time,
early, or late — advancing to the next stop automatically via geofencing, recording actual
arrival times, and playing PSVAIR-compliant audio/visual announcements. **BusOps Announce** is a
separate onboard sign, driven only by what the driver's device pushes to it over a local WiFi
link — no GPS or database access of its own. **PCV Dashboard** is where ops staff manage routes,
timetables, vehicles, employees, and live tracking.

---

## Repo layout

```
pcv-dashboard/                  # PCV Dashboard — Vercel app root
├── src/, package.json, vite.config.js, ...   # the dashboard app itself
├── coachmate/                   # empty — reserved for a future product
└── busops/                      # BusOps product (Driver + Announce)
    ├── package.json, wrangler.jsonc, server.js
    ├── service-worker.js
    ├── tests/                   # cross-cutting Jest suite
    ├── shared/                  # shared between driver/ and announce/ (icons, gps/geofence, brand tokens)
    ├── driver/                  # BusOps Driver (the PWA)
    │   ├── index.html, manifest.json, style.css, lib/, audio/, cab-device/
    │   └── src/
    └── announce/                # BusOps Announce (onboard sign)
        ├── onboard.html, onboard.css, src/onboard.js
        └── mele-server/         # Bus Controller-side companion app

supabase/           # Schema, migrations, RLS tests, edge functions — shared backend
graphhopper/        # Local routing engine, shared infra
scripts/            # Dev/release tooling shared across surfaces
docs/               # Reference docs — see docs/DECISIONS.md for what's settled vs. open
```

There is no `public/` folder anywhere in this repo — the driver PWA is served directly from
`pcv-dashboard/busops/driver/`.

---

## Running it locally

Start all three local dev pieces (driver PWA, dashboard, local GraphHopper) together:

```sh
node scripts/dev-all.mjs
```

Or run pieces individually:

```sh
cd pcv-dashboard/busops && node server.js   # driver PWA        → http://localhost:8080
cd pcv-dashboard && npm run dev             # ops dashboard      → http://localhost:5173
```

`http://localhost:8080/?debug` enables the PWA's debug mode (adds a Log tab, hides Directions).

GPS and service workers require HTTPS in production; both work without it on `localhost`. To
test on a phone, tunnel port 8080 (e.g. with ngrok) and open the HTTPS URL in Chrome/Safari, then
**Add to Home Screen** to install the PWA.

The PWA and dashboard both talk to a shared Supabase backend — dev vs. production project is
selected automatically based on hostname (see `pcv-dashboard/busops/driver/src/config.js` and
`pcv-dashboard/.env.development`).

---

## Tests

The driver PWA has two independent test setups (both run from `pcv-dashboard/busops/`):

```sh
npm test              # Jest — tests/*.test.js (cross-cutting: driver/, announce/, shared/)
npm run test:vitest   # Vitest — driver/src/*.test.js (co-located with the module they test)
```

The dashboard has its own Vitest suite:

```sh
cd pcv-dashboard && npm test
```

CI (`.github/workflows/ci.yml`) runs all of the above plus dashboard lint/build on every push
and PR.

## Lint / build (dashboard only — the PWA has no build step)

```sh
cd pcv-dashboard
npm run lint
npm run build
```

---

## Architecture

### Driver PWA data flow
```
GPS fix
  └─► gps.js       (haversine distance, arrival timestamps)
        └─► geofence.js   (pure: is-within-radius checks)
        └─► engine.js     (pure: ETA, minutesDifference, on-time/early/late status)
              └─► ui.js         (status card, progress bar, stop list)
              └─► map.js        (Leaflet map, OSRM-routed polyline)
              └─► directions.js (turn-by-turn for the current leg)
              └─► announcements.js (PSVAIR announcement playback)
```

`main.js` wires the above together (picker/duty-card logic, wake lock, journey start/stop,
Supabase upload of arrival times). The app falls back to a `localStorage` cache when Supabase is
unreachable, and can start a journey offline, queuing the write for retry on reconnect.

### Onboard sign (BusOps Announce)
A pure renderer with no reads of its own — no GPS, no schedule queries, no logins. It's driven
entirely by pushes from the driver's device (schedule at journey start, then live state updates)
relayed through the Bus Controller box. See `docs/HARDWARE.md`.

### Dashboard
Vertical Slice Architecture — `pcv-dashboard/src/features/<slice>/` (e.g. `routes`,
`route-planner`, `journeys`, `schedule`, `tracking`, `employees`, `vehicles`); shared code lives
in `pcv-dashboard/src/shared/`.

---

## Where to look next

- **`CLAUDE.md`** — the canonical, detailed guide to this codebase (commands, Supabase schema
  rules, git/release workflow, full architecture).
- **`docs/DECISIONS.md`** — scannable ledger of settled vs. still-open architecture/hardware
  decisions.
- **`docs/HARDWARE.md`** — Bus Controller, GPS, displays, driver device, and onboard software
  architecture.
- **`docs/BRAND.md`** — company/product brand hierarchy and accessibility standard.
- **`docs/TESTING.md`** — manual test guide for all three surfaces.
- **`docs/TODO.md`** — known engineering follow-ups.
