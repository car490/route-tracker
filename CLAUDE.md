# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview
CoachMate (bus/coach product family: **BusOps Driver** for the driver PWA, **BusOps Announce**
for the onboard passenger sign) is a real-time bus route timing system for Phil Haines Coaches
drivers, plus an ops back-office dashboard. It has three deployable surfaces sharing one
Supabase backend:

| Surface | Path | Stack | Deploys to |
|---|---|---|---|
| Driver PWA (BusOps Driver) | repo root (`index.html`, `src/`) | Vanilla JS, ES modules, no build step | GitHub Pages today; migrating to Cloudflare Workers at `driver.coachmate.uk` (`wrangler.jsonc` + `.assetsignore` are already in place for that, not yet cut over) |
| Ops dashboard (CoachMate Ops Dashboard) | `dashboard/` | React + Vite | Vercel, auto on push |
| Onboard passenger sign (BusOps Announce) | `onboard.html`, `src/onboard.js`; Controller-side setup in `pi-server/` | Vanilla JS + Node (WebSocket relay, no GPS/DB access) | Bus Controller box (see `docs/CONTROLLER-REDESIGN.md`) + HDMI display, see `pi-server/DEPLOY.md` |

Supabase schema lives at `supabase/schema.sql`. Everything else (`graphhopper/`, `lib/`,
`scripts/`, `audio/`) is shared infra used by more than one surface.

**Important:** the driver PWA source is served directly from the repo root — there is no
`public/` folder (the root `README.md` still describes an old `public/`-based layout; it is
stale — do not follow it). `server.js` serves `__dirname` as-is, and `index.html` loads
`src/main.js` straight from the repo root. Do not create or reference a `public/` directory
for the PWA.

`wifi-direct-poc/` is a standalone, throwaway Android hardware bench-test app for a possible
future WiFi-Direct-based redesign of how Driver and Announce talk to each other. It is **not**
part of the product build, not deployed anywhere, and not wired into any of the three surfaces
above — treat it as exploratory only.

---

## Commands

### Run everything locally
```sh
node scripts/dev-all.mjs
```
Starts the driver PWA (`server.js`, :8080), dashboard dev server (`dashboard/`, :5173), and
local GraphHopper (`graphhopper/`, :8989) together, killing anything already bound to those
ports first. Ctrl-C stops all three. Safe to re-run after a crash.

### Run individually
```sh
node server.js              # driver PWA        → http://localhost:8080
cd dashboard && npm run dev # ops dashboard      → http://localhost:5173
```
`http://localhost:8080/?debug` enables the PWA's debug mode (adds a Log tab, hides Directions).

### Tests
Two independent test setups exist for the driver PWA — know which one a file belongs to:
- **`tests/*.test.js`** (older, standalone) → run via **Jest**: `npm test`
- **`src/*.test.js`** (co-located with the module they test, e.g. `src/geofence.test.js`)
  → run via **Vitest**: `npm run test:vitest`

Run a single test file:
```sh
npx jest tests/engine.test.js
npx vitest run src/geofence.test.js
```

`tests/staticDeployPaths.test.js` guards `manifest.json` and both `index.html`/`onboard.html`'s
service-worker registration against hardcoded subpaths (e.g. `/route-tracker/`) — this matters
because the PWA is moving from a GitHub Pages subpath to owning its own origin
(`driver.coachmate.uk`); don't reintroduce an absolute or subpath-prefixed registration.

Dashboard tests (Vitest, co-located `dashboard/src/**/*.test.js`):
```sh
cd dashboard && npm test
```

### Lint / build (dashboard only — the PWA has no build step)
```sh
cd dashboard
npm run lint    # eslint, ratcheted at --max-warnings 7 (see dashboard/eslint.config.js)
npm run build   # vite build
```
CI (`.github/workflows/ci.yml`) runs: root `npm test` (PWA), `dashboard` lint, `dashboard`
build — on every push and PR.

### Demo drives (simulate a run without GPS/hardware)
```sh
node scripts/demo-drive.mjs        # single driver PWA, scripted GPS route
npm run demo:2up:duty              # two windows: driver PWA + BusOps Announce, duty-card start
npm run demo:2up:manual            # same, but via the manual-selection fallback flow
```
All drive the real app code with mocked Geolocation (not a fake simulation) — useful for
testing timing, announcements, and the onboard display end-to-end without being in a moving
vehicle. `demo.html` is a separate, fully scripted/fake visual simulation (no real app code)
used for quick client-facing demos.

### PSVAIR announcement audio
```sh
AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=... npm run generate:audio
```
Regenerates pre-rendered Azure Neural TTS clips into `audio/announcements/`. See "PSVAIR
announcement audio" under Architecture below before running this — order of operations matters
(schedule regen must happen first).

### Release (version bump across PWA + dashboard together)
```sh
node scripts/release.mjs <major|minor|patch>
```
See "Release / versioning" below.

---

## Supabase: table creation rules

**Every `CREATE TABLE` must have GRANT statements, RLS enable, and RLS policies.** Tables without explicit GRANTs are invisible to supabase-js/PostgREST (changed 2026-05-30). RLS must be enabled on every table.

**Important ordering rule**: If a policy references a helper function (`current_company_id()`, `current_employee_role()`, etc.), the policy **must** come after the function definition. Put simple `using (true)` policies inline with the table. Defer any policy that calls a helper to the main RLS block at the bottom of the file (after all helper functions). Add a comment `-- RLS policy added after helper functions below` as a placeholder.

### Standard pattern (authenticated-only table)
```sql
create table public.my_table ( ... );

grant select on public.my_table to anon;
grant all    on public.my_table to authenticated;

alter table public.my_table enable row level security;

create policy "company_all" on public.my_table
  for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());
```

### When anon also needs INSERT (e.g. PWA writes without a login session)
```sql
create table public.my_table ( ... );

grant select on public.my_table to anon;
grant insert on public.my_table to anon;
grant all    on public.my_table to authenticated;
```

Always follow GRANTs with the appropriate RLS policy.

---

## Supabase: schema.sql hygiene

- `supabase/schema.sql` is the authoritative full schema. Every new table
  and function must be added here so a fresh DB reset needs only `schema.sql + seed.sql`.
- Migration files are applied on top of schema.sql for incremental changes to the live DB.
  Keep them so there is an audit trail. **New migrations go in
  `supabase/migration_<description>.sql`** (flat, descriptive naming) — this is what every
  migration since late July 2026 actually uses. A `supabase/migrations/<timestamp>_<description>.sql`
  folder exists from a brief attempt (June 2026) to adopt the Supabase-CLI timestamped
  convention, but it was abandoned in practice; don't add new files there unless the team
  explicitly revives that convention.
- `supabase/scripts/` holds one-off Node maintenance scripts (e.g. NaPTAN import/backfill),
  distinct from SQL migrations.
- `supabase/functions/` holds Supabase Edge Functions (Deno/TypeScript) — e.g.
  `naptan-import`, `dvsa-vol-lookup`.
- `supabase/tests/` holds RLS policy test SQL, one file per feature (e.g.
  `diversion_alert_event_rls.sql`).
- Helper functions called by RLS policies must be defined **before** the policies that
  use them — order matters in a single-pass SQL script.
- Use `SECURITY DEFINER` on any function called from an anon RLS policy so the function
  runs with the permissions of its owner, not the anon role.

---

## Git / deploy workflow

### Branches
- `develop` — all active development; **always start here**
- `master` — production; merge from `develop` only when tested and approved

### Environments
| Layer | Develop | Production |
|---|---|---|
| **Dashboard** | Vercel preview URL (auto on every push to `develop`) | `route-tracker-iota.vercel.app` (auto on merge to `master`) |
| **PWA** | Local server (`server.js`) — hits dev Supabase automatically | GitHub Pages (deploy from `master`); Cloudflare Workers migration in progress, see Project overview |
| **Supabase** | `cgcbfgceputvdvhzrgio` (`route-tracker-dev`) | `nwhayupsvcelyiwltdqo` (production) |

### Environment switching
- **Dashboard**: `dashboard/.env.development` holds dev Supabase URL/key; Vite's dev server picks
  it up automatically. Vercel production build ignores this file and uses Vercel's own env vars.
- **PWA**: `src/config.js` detects `localhost`/`127.0.0.1` at runtime (`IS_DEV`) and switches
  Supabase project URL/key accordingly. No build step needed.

### Committing
- Commit at logical checkpoints — when a feature or fix is complete and working.
- Always commit before applying a DB migration.
- Always commit at end of session, even if WIP (prefix message with `wip:`).
- The Git repo root **is** the driver PWA root — `index.html`, `src/`, `service-worker.js`,
  `style.css` all live directly at the repo root, alongside `dashboard/` and `supabase/` as
  sibling directories. There is no separate `public/` folder to sync from.
- Dashboard is a separate Vite project in `dashboard/`; Vercel deploys from that directory
  automatically on push.
- `.git` persists between sessions — no need to re-init.

### DB migrations
- Apply to **dev** first via MCP plugin (project ID `cgcbfgceputvdvhzrgio`).
- After testing, apply the same migration to **production** (project ID `nwhayupsvcelyiwltdqo`).
- Keep migration files in `supabase/` for audit trail (see naming conventions above).
- Update `supabase/schema.sql` so a fresh reset only needs `schema.sql + seed.sql`.

### Release / versioning
One version number covers the whole solution (PWA + dashboard) — they release
together on the `develop` → `master` merge. Source of truth is the root
`VERSION` file. As of this writing `master` is several dozen commits behind `develop`
(last released v1.4.0) — check `git log origin/master..origin/develop` before assuming
what's live matches what's in the working tree.
- When merging `develop` → `master`, run `node scripts/release.mjs <major|minor|patch>`.
  This bumps `VERSION`, `dashboard/package.json`, the `service-worker.js`
  `CACHE_NAME`, and the version footer in `index.html`, and stamps a new
  `CHANGELOG.md` entry from the commits since the last tag.
- Review/tidy the auto-generated `CHANGELOG.md` entry, then commit, `git tag vX.Y.Z`,
  and push (`git push && git push --tags`).
- The dashboard reads `VERSION` at build time via Vite `define` (`__APP_VERSION__`
  in `vite.config.js`) and shows it in the sidebar footer. The PWA version is a
  plain string in `index.html`'s footer `<p>`, kept in sync by the release script.
- To check what's actually deployed where without guessing: `git tag --sort=-creatordate`
  for release history, and `git log origin/master..origin/develop` to see what's
  pending release.

---

## Architecture

### Driver PWA data flow
```
GPS fix
  └─► gps.js       (haversine distance, stop-advancement radius, arrival timestamps)
        └─► geofence.js   (pure: is-within-radius checks used by gps.js)
        └─► engine.js     (pure: ETA, minutesDifference, on-time/early/late status)
              └─► ui.js         (status card, progress bar, stop list)
              └─► map.js        (Leaflet map, OSRM-routed polyline)
              └─► directions.js (turn-by-turn for the current leg)
              └─► announcements.js / announceStopEvent.js (announcement playback, see below)
```
`main.js` is the entry point wiring the above together (picker logic, wake lock, journey
start/stop, Supabase upload of arrival times via `supabaseApi.js`). Each module is a pure
ES module with no circular imports; `gps.js` and `main.js` are the layers with side effects
(geolocation watch, clock reads, network). `manualSelection.js` provides a fallback path for
picking a service manually when there's no active scheduled duty. `diversionAlert.js` handles
driver-triggered diversion alerts, wired into both the PWA and the onboard sign.

**OSRM/directions must always use scheduled stop coordinates, never the live GPS position** —
this keeps route drawing and turn-by-turn stable regardless of GPS drift.

The PWA falls back to `src/schedule.json` (a static, keyed-by-service-number schedule) when
Supabase is unreachable — see the offline-fallback test flow in `docs/TESTING.md`.
`scripts/generate-schedule.mjs` regenerates this file.

### PSVAIR announcement audio
Live `speechSynthesis` voice quality varies by device/OS and can sound digital. The primary
announcement path is **pre-rendered Azure Neural TTS clips**, generated offline and played
back as audio files; live `speechSynthesis` (`src/announcements.js`) is kept only as the
fallback for a clip that isn't rendered/cached yet.

- Every announcement sentence has exactly one variable slot (a stop name, or a
  service+destination pair) — so clips are rendered **per stop** and **per service/destination**,
  not per route-leg. Keyed by `stops.id` (global, reused across every route/timetable that
  visits that stop), never by `timetable_stop_id`.
- `schedule_view` (and `src/schedule.json`) carry `stop_id` for exactly this reason — if you
  add a column to `schedule_view`, it must go at the **end** of the select list
  (`CREATE OR REPLACE VIEW` requires existing columns to keep their name/order/type).
- Regenerate after any stop rename or route change, in this order:
  1. Apply any pending `schedule_view` migration to Supabase — **to both dev and production**
     if the change (e.g. a `stops.announcement_name` edit) needs to actually ship, not just be
     previewed locally.
  2. `node scripts/generate-schedule.mjs` (refreshes `src/schedule.json`, including `stop_id`).
     `schedule.json` is one static file shipped to both environments (no per-environment build
     step), so this defaults to reading production — pass `--dev` only to preview a change
     that's on dev alone so far; re-run without it (against prod) once the same change is
     applied there too and you're ready to ship.
  3. `AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=... npm run generate:audio` (writes clips +
     `audio/announcements/manifest.json`; skips any clip whose text **or voice** hash hasn't
     changed — the manifest hashes `${AZURE_SPEECH_VOICE}|${text}`).
- `stops.announcement_name` (nullable) overrides `display_name()`'s ATCO-composed name for a
  stop whose real name is too long for the onboard sign's 22mm minimum or unclear when spoken.
  No admin UI yet — set it directly via SQL, on both dev and production, then regenerate per above.
- Requires an Azure AI Speech resource (key + region, e.g. `uksouth`). These are **build-time
  secrets** for a script run locally — never commit them, never put them in `src/config.js`
  (that file is public/client-only). `AZURE_SPEECH_VOICE` overrides the script's default
  (`en-GB-SoniaNeural`); the currently-committed clips were generated with `en-GB-RyanNeural`.
- `speak()` in `announcements.js` **queues** a new announcement behind whatever's currently
  playing rather than interrupting it. Only the single most recent queued announcement is kept.
- `service-worker.js` precaches every clip listed in `audio/announcements/manifest.json` on
  install, so announcements still work offline mid-route.
- The clip-key slug logic in `src/announcements.js` (`slug()`) must stay identical to the one
  in `scripts/generate-announcement-audio.mjs` — no shared import between a browser module and
  a Node script here, so keep them in sync by hand.

### Onboard passenger sign (BusOps Announce)
A separate vanilla-JS app (`onboard.html` + `src/onboard.js`) meant to run full-screen on an
HDMI panel mounted in the vehicle, driven by a Bus Controller box over its own local WiFi
hotspot (see `pi-server/DEPLOY.md` for setup, `pi-server/announceRelay.mjs` for the WebSocket
relay). Deliberately siloed from `main.js` — no login, no duty-card UI, no incident reporting,
no writes to Supabase at all. As of the Controller redesign (`docs/CONTROLLER-REDESIGN.md`) it
also has **no reads of its own**: no `get_duty_card` polling, no GPS (the Controller has no GPS
hardware — that lives entirely on the driver device), no `schedule_view` queries. It's a pure
renderer, driven only by what the Driver PWA pushes to it (`src/announceLink.js` →
`pi-server/announceRelay.mjs` → this device's `/sign-feed` connection): a `{type:'schedule', ...}`
message once per journey start (stops, service code, branding), then `{type:'state', ...}`
messages as the journey progresses. Stays blank until an authenticated push connection delivers
a schedule — there's no `?journey=` URL param or depot-WiFi sync step anymore. Two named display
profiles exist (`PANEL_PROFILES` in `src/onboard.js`, commissioned via `?panel-profile=`):
**Bar** (28" ultra-wide destination-board panel, not yet built — see
`docs/onboard-widescreen-layout.md`) and **Monitor** (Dell Pro P2426H, the confirmed
demo/validation display).

### Dashboard (Vertical Slice Architecture)
`dashboard/src/features/<slice>/` — each slice owns its own pages/components; shared code
(Supabase client, layout, modals, hooks) lives in `dashboard/src/shared/`. Current slices:
`auth`, `overview`, `employees`, `vehicles`, `routes`, `route-planner`, `journeys`, `schedule`,
`tracking`, `settings`, `company`, `audio-config`. `route-planner` is the largest/most complex
slice (route + timetable + stop + map + BODS-field + departures editing in one flow, including
its own `WizardModal.jsx`) — see `docs/TODO.md` for a known refactor candidate there
(`RoutePlannerPage.jsx`, ~1000 lines). `dashboard/api/*.js` holds Vercel serverless functions
(the only place `service_role`/JWT secrets are read, via `process.env`).

### Domain conventions
- `staff.name` (largely renamed to `employees` — see `migration_rename_staff_to_employees.sql`)
  is a **single field** — never `first_name`/`last_name`.
- `stops` are **global** (no `company_id`); `stop_type` lives on `timetable_stops`. The stop
  identifier column is `atco_code` (renamed from `naptan_code` — see
  `migration_rename_stops_atco_code.sql`).
- Public client config (PWA): no build step means no Vite-style env-var injection, so all
  dev/prod Supabase URLs and keys live in `src/config.js`, never inline in `main.js` or
  elsewhere. Only ever put **anon/publishable** keys there — RLS policies are what actually
  gate access, so they're safe to commit. A `service_role` key or `SUPABASE_JWT_SECRET` must
  **never** appear here — those are server-only (`dashboard/api/*.js` pattern).
- `docs/` holds reference and spec material not tied to any one code path: `TESTING.md` (manual
  test guide for all three surfaces), `TODO.md` (general engineering follow-ups, e.g. PSVAIR
  2026 compliance items and dashboard tech debt), `VOL.md` (a parked, not-yet-built fleet-data
  subsystem — don't assume it's implemented), plus verification write-ups and the BusOps
  Driver hardware proposal. `HARDWARE.md` is the consolidated spec for every physical component
  in the onboard/vehicle system (Bus Controller, GPS, displays, driver device, power, mounting)
  — start there for any hardware question, but check `CONTROLLER-REDESIGN.md` alongside it: that
  doc supersedes several of `HARDWARE.md`'s sections (Bus Controller board, GPS ownership,
  networking model, audio pipeline) with decisions from a 2026-08-14 session that haven't been
  folded back into `HARDWARE.md` itself yet, and are agreed direction but **not yet implemented
  in code** — read both, don't assume `HARDWARE.md` alone is current. Root `README.md` is stale
  (describes an old `public/`-based PWA layout) — prefer this file and `docs/TESTING.md` over it.
