# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview
CoachMate (bus/coach product family: **BusOps Driver** for the driver PWA, **BusOps Announce**
for the onboard passenger sign) is a real-time bus route timing system for Phil Haines Coaches
drivers, plus an ops back-office dashboard. It has three deployable surfaces sharing one
Supabase backend:

| Surface | Path | Stack | Deploys to |
|---|---|---|---|
| Driver PWA (BusOps Driver) | `pcv-dashboard/busops/driver/` (`index.html`, `src/`) | Vanilla JS, ES modules, no build step | GitHub Pages today (still the live production target); migrating to Cloudflare Workers — `driver-dev.pcvtechnologies.co.uk` (dev Supabase, `deploy-driver-pwa-dev` job, every push to `develop`) and `driver.pcvtechnologies.co.uk` (production Supabase, `deploy-driver-pwa-production` job, every push to `master`) are separate CI jobs in `.github/workflows/ci.yml` (split from one combined `deploy-driver-pwa` job so `develop` pushes stop hitting production Supabase — see commit `7edb0d3`), both gated on tests passing; GitHub Pages is still what serves production until someone explicitly switches it |
| Ops dashboard (PCV Dashboard) | `pcv-dashboard/` | React + Vite | Vercel, auto on push |
| Onboard passenger sign (BusOps Announce) | `pcv-dashboard/busops/announce/` (`onboard.html`, `src/onboard.js`); Controller-side setup in `mele-server/` | Vanilla JS + Node (WebSocket relay, no GPS/DB access) | Bus Controller box (see `docs/HARDWARE.md`) + HDMI display, see `mele-server/DEPLOY.md` |

**Company brand note:** PCV Technologies is the vendor company (`pcvtechnologies.co.uk`); the
ops dashboard above is **PCV Dashboard**, a mandatory umbrella product every customer gets
regardless of which product modules (BusOps today; CoachMate is a reserved, empty placeholder
for a future module — see `pcv-dashboard/coachmate/`) they've signed up for. The user-facing
wordmarks (browser tab title, PWA manifest, login screen, sidebar mark) were repositioned from
"CoachMate Ops Dashboard" to "PCV Dashboard" on 2026-08-21. The repo's folder structure was
restructured the same day to mirror this hierarchy directly: `dashboard/` was renamed to
`pcv-dashboard/`, and `busops/`/`coachmate/` now live inside it as product folders (see "Repo
layout" below). The npm package name (`coachmate-dashboard` in `pcv-dashboard/package.json`)
remains an internal identifier, left unchanged. See `docs/BRAND.md` for the full company/product
brand hierarchy.

Supabase schema lives at `supabase/schema.sql`. `graphhopper/` and `scripts/` are shared infra
used by more than one surface. `pcv-dashboard/busops/shared/` holds what BusOps' two surfaces
(Driver, Announce) genuinely share with each other — **corrected 2026-09-17, this had drifted
from icons/`brand-tokens.css` only**: it's now also the GPS/schedule-matching core
(`gps.js`, `geofence.js`, `engine.js`, `scheduleTimeShift.js`, `geo.js`) and the announcement
stack (`announceStates.js`, `announcementAudio.js`, `announcementCoverage.js`,
`deviceStateSync.js`, `logger.js`, `escapeHtml.js`) — real cross-surface use, not
folder guesswork: Announce Solo's autopilot (`announceSoloAutopilot.js`) imports
`gps.js`/`geofence.js`/`scheduleTimeShift.js` directly, and `onboard.js` reads announcement
state through the same `announceStates.js` Driver uses. `lib/` (Leaflet) and `audio/` (PSVAIR
clips) remain driver-only, living under `pcv-dashboard/busops/driver/`.

**Important:** the driver PWA source is served from `pcv-dashboard/busops/driver/` — there is
no `public/` folder. `pcv-dashboard/busops/server.js` serves `__dirname` (i.e. `busops/`)
as-is, mapping a bare `/` request to `/driver/index.html`; `driver/index.html` loads
`src/main.js` from its own `src/` folder. Do not create or reference a `public/` directory for
the PWA.

## Repo layout

Folder structure mirrors the brand hierarchy in `docs/BRAND.md`: repo root is the implicit PCV
Technologies tier, `pcv-dashboard/` is the PCV Dashboard product (and literally *is* the Vercel
app — its own `package.json`/`src/` sit directly in it), and `busops`/`coachmate` are product
folders nested inside it.

```
pcv-dashboard/                  # PCV Dashboard — Vercel app root
├── src/, package.json, vite.config.js, ...   # the dashboard app itself
├── .vercelignore                # excludes busops/ and coachmate/ from the Vercel build
├── coachmate/                   # empty — reserved for a future product
└── busops/                      # BusOps product (Driver + Announce)
    ├── package.json, wrangler.jsonc, .assetsignore, server.js
    ├── service-worker.js        # sits here, not shared/ — its default scope must cover
    │                             # both driver/ and announce/, which only works if it's
    │                             # in their common parent directory
    ├── tests/                   # cross-cutting Jest suite (staticDeployPaths, brandTokens, ...)
    ├── shared/                  # genuinely shared between driver/ and announce/ -- GPS/
    │   │                         # geofence/engine/schedule-matching core + the announcement
    │   │                         # stack, not just icons/brand-tokens.css (see above)
    │   ├── icons/
    │   ├── brand-tokens.css
    │   ├── gps.js, geofence.js, engine.js, scheduleTimeShift.js, geo.js
    │   └── announceStates.js, announcementAudio.js, announcementCoverage.js,
    │       deviceStateSync.js, logger.js, escapeHtml.js
    ├── driver/                  # BusOps Driver (the PWA)
    │   ├── index.html, manifest.json, style.css, lib/, audio/, cab-device/
    │   └── src/                 # main.js's whole import closure
    └── announce/                # BusOps Announce (onboard sign)
        ├── onboard.html, onboard.css
        ├── src/onboard.js       # zero local imports — pure WebSocket-driven renderer
        └── mele-server/           # Bus Controller-side companion app
```

`src/` was split along the actual import graph at the time (2026-08-21), not folder guesswork:
`onboard.js` had no local imports at all back then, so it was the entirety of `announce/src/`;
everything else `main.js` transitively imported (`supabaseApi.js`, `announcements.js`, etc.)
moved to `driver/src/` unchanged. **That's stale now** — Announce Lite/Solo (built after the
split) gave `onboard.js` three imports (`announceDeviceFeed.js`/`announceDeviceSetup.js`,
both `announce/src/`-only, plus `../../shared/announceStates.js`), and `gps.js`/`engine.js`
never stayed driver-only either — see the corrected `shared/` description above.

`wifi-direct-poc/` is a standalone, throwaway Android hardware bench-test app for a possible
future WiFi-Direct-based redesign of how Driver and Announce talk to each other. It is **not**
part of the product build, not deployed anywhere, and not wired into any of the three surfaces
above — treat it as exploratory only.

**This project has a history of flip-flopping on cross-cutting questions (onboard hardware,
architecture, naming).** Before assuming or re-deciding one of those, check
`docs/DECISIONS.md` first — it's the single scannable ledger of what's actually settled vs.
still genuinely open, with pointers to the detailed source (`docs/HARDWARE.md` and
`docs/HARDWARE.md` §1-§5 for hardware/architecture, `docs/BRAND.md` for naming, this file
for everything else). Re-derive it from `origin/develop`, never `master` — `master` is
routinely dozens of commits behind and missing recent decisions entirely.

---

## Accessibility & branding — company-level, mandatory

**`docs/ACCESSIBILITY_BRAND_PLAYBOOK.md` is the company-level accessibility and brand
standard.** It applies to every surface above and to anything built after it — not an
opt-in guideline for one product. PSVAIR (the PSV Accessible Information Regulations 2023 +
PSVAR 2000) is what's driving the current on-board audio/visual announcement feature, but the
playbook extends the same bar — WCAG 2.2 AA contrast, never audio-only, never colour-only,
plain English, RNIB/RNID-aligned typography — to colour tokens, typography, iconography, and
copy across the driver PWA, the ops dashboard, and the onboard sign. Read it before making any
UI, colour-token, copy, or brand-asset change; its Definition of Done checklist (§10) is the
bar new UI work should be held to, the same way `npm test`/`npm run lint` are.

---

## Commands

### Run everything locally
```sh
node scripts/dev-all.mjs
```
Starts the driver PWA (`pcv-dashboard/busops/server.js`, :8080), dashboard dev server
(`pcv-dashboard/`, :5173), and local GraphHopper (`graphhopper/`, :8989) together, killing
anything already bound to those ports first. Ctrl-C stops all three. Safe to re-run after a
crash.

### Run individually
```sh
cd pcv-dashboard/busops && node server.js   # driver PWA        → http://localhost:8080
cd pcv-dashboard && npm run dev             # ops dashboard      → http://localhost:5173
```
`http://localhost:8080/?debug` enables the PWA's debug mode (adds a Log tab, hides Directions) —
bare `/` maps to `/driver/index.html` server-side, and the browser still carries the query string
through to the client.

### Tests
Two independent test setups exist for the driver PWA — know which one a file belongs to (both
run from `pcv-dashboard/busops/`):
- **`tests/*.test.js`** (older, standalone, cross-cutting — spans `driver/`, `announce/`,
  `shared/`) → run via **Jest**: `npm test`
- **`driver/src/*.test.js`** (co-located with the module they test, e.g.
  `driver/src/geofence.test.js`) → run via **Vitest**: `npm run test:vitest`

Run a single test file (from `pcv-dashboard/busops/`):
```sh
npx jest tests/engine.test.js
npx vitest run driver/src/geofence.test.js
```

`tests/staticDeployPaths.test.js` guards `driver/manifest.json` and both
`driver/index.html`/`announce/onboard.html`'s service-worker registration against hardcoded
subpaths (e.g. `/route-tracker/`) — this matters because the PWA is moving from a GitHub Pages
subpath to owning its own origin (`driver.pcvtechnologies.co.uk`); don't reintroduce an absolute or
subpath-prefixed registration.

Dashboard tests (Vitest, co-located `pcv-dashboard/src/**/*.test.js`):
```sh
cd pcv-dashboard && npm test
```

### Lint / build (dashboard only — the PWA has no build step)
```sh
cd pcv-dashboard
npm run lint    # eslint, ratcheted at --max-warnings 0 (see pcv-dashboard/eslint.config.js)
npm run build   # vite build
```
CI (`.github/workflows/ci.yml`) runs: `pcv-dashboard/busops` `npm test` + `npm run test:vitest`
(PWA, both suites — see "Two independent test setups" above), `pcv-dashboard` lint,
`pcv-dashboard` build — on every push and PR. Once those three jobs pass, a deploy job runs
`wrangler deploy` from `pcv-dashboard/busops` to push the Driver PWA + Announce app to Cloudflare
Workers: `deploy-driver-pwa-dev` on `develop` pushes (dev Supabase, `driver-dev.pcvtechnologies.co.uk`)
and `deploy-driver-pwa-production` on `master` pushes (production Supabase,
`driver.pcvtechnologies.co.uk`) — kept as two separate jobs so a `develop` push can never deploy
against production Supabase. Both require the `CLOUDFLARE_API_TOKEN` repo secret.

### Demo drives (simulate a run without GPS/hardware)
Run from `pcv-dashboard/busops/` (they're npm scripts on that `package.json`):
```sh
npm run demo:2up:duty              # two windows: driver PWA + BusOps Announce, duty-card start
npm run demo:2up:manual            # same, but via the manual-selection fallback flow
npm run demo:announce-push         # driver PWA + both Announce display profiles (Bar and Lite), push-feed proof
```
All drive the real app code with mocked Geolocation (not a fake simulation) — useful for
testing timing, announcements, and the onboard display end-to-end without being in a moving
vehicle. `demo.html` is a separate, fully scripted/fake visual simulation (no real app code)
used for quick client-facing demos.

### Measure the real sign on the real tablet (read-only)
```sh
npm run measure:announce-solo      # from pcv-dashboard/busops/ — needs the tablet on USB (adb)
```
Takes one measurement of whatever the Solo tablet is showing and judges it against the approved sizes (22 mm
lowercase x-height on Lines 2/3, measured two independent ways; 13.5 mm top bar/Line 1; 23 mm bar; 21.6 mm Line 1
slot; 24 mm sentence states; 5.5 mm brand mark). Attaches over a temporary DevTools session through `adb forward`,
evaluates one read-only function, takes a screenshot, detaches: it never navigates, never changes a Fully Kiosk or
Android setting, and never records the URL query (it carries the device token). **Needs Fully Kiosk's web-contents
debugging ON** (`webviewDebugging`; Import Settings resets it to off) — the tool says so and stops if it is off, it
does not switch it on. Run it while the sign is showing a stop for the Lines 2/3 checks; on the idle screen it still
checks the bar and the brand mark. Output goes to `scripts/tablet-captures/` (gitignored). Exit 0 pass, 1 a check
failed, 2 could not measure. `--cdp-port <port>` attaches to an existing DevTools port with no adb (how it is
tested: `npm run verify:tablet` in `scripts/announce-replica`).

### PSVAIR announcement audio (Bus Controller's clip generator)
```sh
AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=... npm run generate:audio
```
Run from `pcv-dashboard/busops/`. Predates the server-side clip pipeline (see "PSVAIR
announcement audio" under Architecture below), which is now what generates clips for the Driver
PWA and Announce Solo automatically via a DB trigger + cron + Edge Function — no manual step
required for those two tiers. **This script is still genuinely necessary, indefinitely, for a
third consumer**: it's the only thing that produces `busops/driver/audio/announcements/`, which
the Bus Controller (`mele-server/audioPlayer.mjs`) plays from local disk, having no live-fetch
path of its own (see "PSVAIR announcement audio" under Architecture). Re-run this and commit the
result after any stop rename or route change that affects a Controller-served vehicle — nothing
currently automates or reminds anyone to do so (a real process gap, `docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md`
Phase 4). Not part of CI; also useful for auditioning a wording change locally before it ships.

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
grant select, insert, update, delete on public.my_table to authenticated;

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
grant select, insert, update, delete on public.my_table to authenticated;
```

Always follow GRANTs with the appropriate RLS policy.

**Never `grant all` to `anon`/`authenticated`** — list the DML verbs. `all` includes TRUNCATE
(which RLS does not gate), MAINTAIN (incl. LOCK TABLE), TRIGGER and REFERENCES; these were revoked
schema-wide on 2026-09-24 (`migration_revoke_table_admin_privileges.sql`, also the last block of
`schema.sql`), and a per-table `grant all` puts them straight back. `supabase/tests/revoke_table_admin_privileges.sql`
fails if any client role holds them again.

**If any Edge Function (service-role) code will read/write the table, grant `service_role`
explicitly too** — don't rely on it having implicit access. Found 2026-09-15 while shipping the
announcement-clip pipeline: production's `public` schema has no `pg_default_acl` entry for
`service_role` at all (confirmed via `pg_default_acl`), while dev's does — so a brand-new table
on production gets **zero** service_role access until explicitly granted, while the identical
table on dev "just works" via dev's default privileges. A service-role client hitting this gets a
genuine Postgres `permission denied for table` error, not an RLS deny (RLS/bypass is never even
reached). Production's existing convention has always been per-table explicit `service_role`
grants (e.g. `naptan_stops`) — this wasn't a regression, just a rule that hadn't been written
down. Add `grant all on public.my_table to service_role;` alongside the anon/authenticated grants
above whenever an Edge Function touches the table, on every environment, rather than assuming any
project's default privileges cover it.

**Any anon-callable `security definer` RPC that takes an id parameter must verify the caller is
entitled to that specific id inside the function body — RLS alone doesn't gate an RPC call.**
Found 2026-09-17 during a security review: `start_journey(p_journey_id)`,
`complete_journey(p_journey_id)`, and three `announce_devices` RPCs were anon-granted and
`security definer`, but trusted their id parameter outright — anyone holding the shared anon key
could act on another company's journey/device just by supplying its UUID. Fixed by adding an
ownership check as the first line of the function body, using the caller's JWT claims (not the
parameter alone) as the source of truth: `is_jwt_journey_allowed(j_id)` checks a journey id
against the signed duty token's `journey_ids` claim, and `is_jwt_device_allowed(p_device_id)`
(same pattern, `schema.sql`) checks a device id against either the caller's own `device_id`
claim (self only, mirrors `report_device_heartbeat()`) or the vehicle of one of the caller's
`journey_ids`. Both fall through to `true` for a legacy claim-less anon key, an intentional
compatibility tradeoff for the no-login manual-selection flow — don't remove that branch
assuming it's dead code. Follow this same pattern (an `is_jwt_*_allowed()` check as the RPC
body's first statement) for any new anon-callable RPC that mutates a row by id. Also added
`announce_devices.revoked_at`, checked by the same helper and the `device_self` RLS policy, so
a single leaked/compromised device token can be revoked without rotating the shared JWT secret
for the whole fleet — set directly via SQL, no admin UI (same precedent as
`stops.announcement_name`).

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
| **PWA** | Local server (`pcv-dashboard/busops/server.js`) — hits dev Supabase automatically | GitHub Pages (deploy from `master`); Cloudflare Workers migration in progress, see Project overview |
| **Supabase** | `cgcbfgceputvdvhzrgio` (`route-tracker-dev`) | `nwhayupsvcelyiwltdqo` (production) |

### Environment switching
- **Dashboard**: `pcv-dashboard/.env.development` holds dev Supabase URL/key; Vite's dev server
  picks it up automatically. Vercel production build ignores this file and uses Vercel's own
  env vars.
- **PWA**: `pcv-dashboard/busops/driver/src/config.js` detects `localhost`/`127.0.0.1` at
  runtime (`IS_DEV`) and switches Supabase project URL/key accordingly. No build step needed.

### Committing
- Commit at logical checkpoints — when a feature or fix is complete and working.
- Always commit before applying a DB migration.
- Always commit at end of session, even if WIP (prefix message with `wip:`).
- Folder structure mirrors the brand hierarchy (see "Repo layout" above) — the driver PWA
  (`index.html`, `src/`, `service-worker.js`, `style.css`) lives at
  `pcv-dashboard/busops/driver/`, not the repo root. There is no separate `public/` folder to
  sync from.
- Dashboard is a separate Vite project in `pcv-dashboard/`, and literally *is* that folder
  (product folders `busops/`/`coachmate/` nest inside it); Vercel deploys from `pcv-dashboard/`
  automatically on push, ignoring `busops/`/`coachmate/` via `.vercelignore`.
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
  This bumps `VERSION`, `pcv-dashboard/package.json`, `busops/service-worker.js`'s
  `CACHE_NAME`, and the version footer in `busops/driver/index.html`, and stamps a new
  `CHANGELOG.md` entry from the commits since the last tag.
- Review/tidy the auto-generated `CHANGELOG.md` entry, then commit, `git tag vX.Y.Z`,
  and push (`git push && git push --tags`).
- The dashboard reads `VERSION` at build time via Vite `define` (`__APP_VERSION__`
  in `vite.config.js`) and shows it in the sidebar footer. The PWA version is a
  plain string in `driver/index.html`'s footer `<p>`, kept in sync by the release script.
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

The PWA falls back to a `localStorage` cache when Supabase is unreachable, not to a static
file: `localStore.js` caches the last successful `schedule_view` results
(`getCachedServices`/`getCachedStops`), `supabaseApi.js`'s `fetchAvailableServices()`/
`fetchStopsForDeparture()` are live-first and fall back to that cache on a failed fetch, and
`preloadAllRoutes()` warms it proactively while online. A journey start attempted offline
isn't blocked either — `manualSelection.js` always generates the journey ID client-side and
queues a failed `get_or_create_manual_journey`/`start_journey` call via
`enqueuePendingJourneyStart` (also in `localStore.js`) for `main.js`'s
`flushPendingJourneyStarts()` to retry on reconnect. See the offline-fallback test flow in
`docs/TESTING.md`.

`busops/driver/src/schedule.json` (regenerated by `scripts/generate-schedule.mjs`, still
precached by the service worker) is **not** read by the PWA at runtime any more — nothing in
`busops/driver/src/` fetches or parses it. Its one remaining live purpose is as input to
`scripts/generate-announcement-audio.mjs`, the Bus Controller's clip generator (see "PSVAIR
announcement audio" below — the live server-side clip pipeline for Driver/Solo reads
`stops`/`routes` directly and has no use for this file).
`schedule_view` (and this file) carry `stop_id` for exactly that script's benefit — if you add a
column to `schedule_view`, it must go at the **end** of the select list (`CREATE OR REPLACE VIEW`
requires existing columns to keep their name/order/type).

### PSVAIR announcement audio
Live `speechSynthesis` voice quality varies by device/OS and can sound digital — and per the
PSVAIR requirement it's a hard "never" now, not a quality nice-to-have. Announcements are
**pre-rendered Azure Neural TTS clips**, generated and distributed automatically by a server-side
pipeline (design + full rollout/status ledger: `docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md` — read that
doc for the phase-by-phase history; this section only summarizes the resulting architecture).

**Generation is automatic, no manual step for a normal stop/route change:**
- A DB trigger on `stops` (insert, or update of `announcement_name`/`name`/`atco_code`) and
  another on `routes` (insert, or update of `service_code`/`destination`) enqueues a row into
  `announcement_clip_jobs` the moment the text a clip needs would change — cheap and synchronous,
  no Azure call inline.
- A Supabase cron (`announcement-clip-drain`, every 5 minutes, capped at 20 jobs/cycle so a bulk
  change like a NaPTAN import trickles out instead of bursting Azure's rate limit) drains the
  queue via the `generate-announcement-clip` Edge Function (Deno, `supabase/functions/`), which
  skips any clip whose `voice|text` hash is unchanged, renders the rest via Azure Neural TTS, and
  writes each to the public-read `announcement-audio` Storage bucket plus a row in
  `announcement_clips` (`key`, `storage_path`, `hash`, `text`, `voice`, `rendered_at`).
- Every announcement sentence has exactly one variable slot (a stop name, or a
  service+destination pair) — so clips are rendered **per stop** and **per service/destination**,
  not per route-leg. Keyed by `stops.id` (global, reused across every route/timetable that visits
  that stop), never by `timetable_stop_id`.
- `stops.announcement_name` (nullable) overrides `display_name()`'s ATCO-composed name for a stop
  whose real name is too long for the onboard sign's 22mm minimum or unclear when spoken. No admin
  UI yet — set it directly via SQL, on both dev and production (the trigger picks it up
  automatically on either environment once set there).
- **Audio quality (2026-09-19):** clips are rendered at `audio-24khz-160kbitrate-mono-mp3` — the highest quality at the
  neural voice's native 24 kHz. They were `audio-16khz-64kbitrate-mono-mp3`, Azure's lowest MP3 tier, which sounded thin and
  synthetic on the tablet speaker. Azure bills per character, not per format, so this costs nothing at the API (each clip is
  about 2.5x larger). The format is part of every clip's hash (Edge Function and `scripts/generate-announcement-audio.mjs`
  both), so changing `AUDIO_FORMAT` in both (a Jest test fails if they differ) re-renders every clip instead of skipping them
  as "unchanged". Uploads carry `cacheControl: '300'` so a re-render or a stop rename reaches a tablet within minutes, not
  after storage's one-hour default. To rebuild every clip on an environment: `insert into announcement_clip_jobs (key, text,
  voice) select key, text, voice from announcement_clips;` and let the drain cron work through it (20 clips per 5 minutes).
- `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION`/`AZURE_SPEECH_VOICE` (default `en-GB-RyanNeural`) are
  **Edge Function secrets** on `generate-announcement-clip` (Supabase Dashboard → Edge Functions
  → generate-announcement-clip → Secrets) — never in `busops/driver/src/config.js` (public/
  client-only). Dev and production deliberately share one Azure Speech resource/key to stay
  within its free tier — this function only reads it (TTS synthesis), so sharing carries no
  cross-environment data risk, just a shared rate/cost ceiling.

**Distribution and playback — never synthesizes, on the Driver PWA and Announce Solo:**
- Both surfaces read clips through the same shared code: `shared/announcementAudio.js`'s
  `playClip()` fetches `${SUPABASE_URL}/storage/v1/object/public/announcement-audio/<key>.mp3` —
  the **only** source, no bundled-file fallback (removed 2026-09-16 once parity was proven on dev
  then production; see below for why the bundled files themselves didn't go away).
  `busops/service-worker.js` precaches every row from `announcement_clips` live at `install` time
  (paginated past PostgREST's 1000-row cap) so clips work offline mid-route.
- Phase 3 removed the `speechSynthesis` fallback entirely (`shared/speech.js` itself was deleted
  2026-09-24 along with the driver PWA's now-pointless voice picker). A stop reached with no confirmed clip now plays **no
  audio** (visual text only, which is already required regardless) and calls `onGap`, which
  `shared/announcementCoverage.js` turns into a queryable row in `announcement_coverage_gap` — a
  loud, ops-facing alert, not a silent `console.warn`. Separately,
  `driver/src/journeyAnnouncementPreflight.js` checks the whole route's clip coverage at journey
  start and shows a non-blocking driver-facing warning if anything's missing; journey start itself
  is never blocked, matching this codebase's existing offline-resilience posture (see
  `docs/DECISIONS.md`).
- `speak()`/`playClip()` **queues** a new announcement behind whatever's currently playing rather
  than interrupting it. Only the single most recent queued announcement is kept.
- The clip-key slug logic must stay identical across four independent implementations with no
  shared import between them (SQL, Deno, browser, Node): the DB trigger functions
  (`fn_announcement_clip_enqueue_on_stop_change`/`_on_route_change`), the
  `generate-announcement-clip` Edge Function, `shared/announcementAudio.js`'s `clipKeysFor()`, and
  `scripts/generate-announcement-audio.mjs`'s own `slug()` — keep them in sync by hand.

**A third, separate playback path — the Bus Controller, permanently on the local generator:**
`mele-server/audioPlayer.mjs` (Controller-side, see "Onboard passenger sign" below) plays the same
clips from **local disk only** — `busops/driver/audio/announcements/`, cloned onto the Controller
as part of its own `git clone` of this repo (`mele-server/DEPLOY.md`). The Controller deliberately
has no WAN path (see `docs/HARDWARE.md`), so it can never fetch from Supabase Storage live — this
directory and the local generator that produces it (`node
scripts/generate-announcement-audio.mjs`, see Commands above) are **not** a transition artifact
slated for removal; they're the Controller's only audio source, indefinitely. Only the *browser*
tiers' fallback use of these same files was removed — the committed files stay. A stop/route
rename doesn't reach the Controller automatically; re-run the local generator and commit the
result for it to `git pull` on next deploy. **Found and fixed 2026-09-16**: `DEFAULT_AUDIO_DIR`
had resolved one directory level too shallow for months, meaning the one physical Controller in
service had silently played zero PSVAIR audio since it was commissioned — no test caught it
because every test overrides `audioDir` explicitly. Watch for this class of bug (a real default
path never exercised by any test) elsewhere in this module.

**Deployment status**: as of the `v2.2.0` release (2026-09-16), generation (Phase 1), Driver/Solo
distribution (Phase 2), and the never-synthesize behavior (Phase 3) are all live on **both** dev
and production. Check `docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md` for anything that changes after this
was written.

### Onboard passenger sign (BusOps Announce)
A separate vanilla-JS app (`busops/announce/onboard.html` + `busops/announce/src/onboard.js`)
meant to run full-screen on an HDMI panel mounted in the vehicle, driven by a Bus Controller box
over its own local WiFi hotspot (see `mele-server/DEPLOY.md` for setup,
`mele-server/announceRelay.mjs` for the WebSocket relay). Deliberately siloed from `main.js` — no
login, no duty-card UI, no incident reporting, no writes to Supabase at all. As of the Controller
redesign (`docs/HARDWARE.md` §1-§5) it also has **no reads of its own**: no `get_duty_card`
polling, no GPS (the Controller has no GPS hardware — that lives entirely on the driver device),
no `schedule_view` queries. It's a pure renderer, driven only by what the Driver PWA pushes to it
(`busops/driver/src/announceLink.js` → `mele-server/announceRelay.mjs` → this device's
`/sign-feed` connection): a `{type:'schedule', ...}` message once per journey start (stops,
service code, branding), then `{type:'state', ...}` messages as the journey progresses. Stays
blank until an authenticated push connection delivers a schedule — there's no `?journey=` URL
param or depot-WiFi sync step anymore. Two named display profiles exist (`PANEL_PROFILES` in
`busops/announce/src/panelSizing.js`, commissioned via `?panel-profile=`): **Bar** (28" ultra-wide
destination-board panel, not yet built — see `docs/onboard-widescreen-layout.md`) and **Lite** (the LEVIRTU 14"
Android tablet, lit area measured 289 × 180 mm — the display in use). The Dell Pro P2426H `monitor` profile was
removed 2026-09-19 (owner: not using it).

Sign text sizes are physical (2026-09-19, PRs #65–#68): a profile with a measured `litHeightMm` gets Lines 2/3 at
22.1 mm lowercase x-height, a 0.1 mm margin over the 22 mm rule (sized to exactly 22.0 the real tablet's shortest drawn letter measured 21.92 mm; the owner's strict reading of PSV(AI)R Reg 14(4); not yet confirmed against DfT
guidance) and every other size defined in mm — the pure logic is `busops/announce/src/panelSizing.js` (sizes) and
`headlineLines.js` (three-line split, `data-state`); `onboard.css` hangs the rest off `--header-text`,
`--sentence-text` and `--logo-text`. See `docs/DECISIONS.md` "Announce sign text sizing". Prove a change against the
real sign at true size with `npm run verify` in `scripts/announce-replica` (headless Chromium) before the tablet.

### Dashboard (Vertical Slice Architecture)
`pcv-dashboard/src/features/<slice>/` — each slice owns its own pages/components; shared code
(Supabase client, layout, modals, hooks) lives in `pcv-dashboard/src/shared/`. Current slices:
`auth`, `overview`, `employees`, `vehicles`, `routes`, `route-planner`, `journeys`, `schedule`,
`tracking`, `settings`, `company`, `audio-config`. `route-planner` is the largest/most complex
slice (route + timetable + stop + map + BODS-field + departures editing in one flow, including
its own `WizardModal.jsx`) — see `docs/TODO.md` for a known refactor candidate there
(`RoutePlannerPage.jsx`, ~1000 lines). `pcv-dashboard/api/*.js` holds Vercel serverless functions
(the only place `service_role`/JWT secrets are read, via `process.env`).

### Domain conventions
- `staff.name` (largely renamed to `employees` — see `migration_rename_staff_to_employees.sql`)
  is a **single field** — never `first_name`/`last_name`.
- `stops` are **global** (no `company_id`); `stop_type` lives on `timetable_stops`. The stop
  identifier column is `atco_code` (renamed from `naptan_code` — see
  `migration_rename_stops_atco_code.sql`).
- Public client config (PWA): no build step means no Vite-style env-var injection, so all
  dev/prod Supabase URLs and keys live in `busops/driver/src/config.js`, never inline in
  `main.js` or elsewhere. Only ever put **anon/publishable** keys there — RLS policies are what
  actually gate access, so they're safe to commit. A `service_role` key or
  `SUPABASE_JWT_SECRET` must **never** appear here — those are server-only
  (`pcv-dashboard/api/*.js` pattern).
- `docs/` holds reference and spec material not tied to any one code path: `BRAND.md` (the
  canonical PCV Technologies / product brand hub — company identity, colours, typography,
  the PCV Dashboard/BusOps/CoachMate product hierarchy; see its companion tokens at
  `pcv-dashboard/busops/shared/brand-tokens.css`), `TESTING.md` (manual
  test guide for all three surfaces), `TODO.md` (general engineering follow-ups, e.g. PSVAIR
  2026 compliance items and dashboard tech debt), `VOL.md` (a parked, not-yet-built fleet-data
  subsystem — don't assume it's implemented), `DRIVER_DUTIES.md` (spec for rule-aware
  driver/vehicle duty allocation and drivers'-hours compliance — not yet built; has an open
  blocker on TruTac tacho-vendor access, don't assume that integration exists), plus
  verification write-ups and the BusOps
  Driver hardware proposal. `HARDWARE.md` is the single consolidated spec for every physical
  component in the onboard/vehicle system (Bus Controller, GPS, displays, driver device, power,
  mounting) **and** the Bus Controller's software architecture (§1–§5) — this used to be split
  across that file and a separate `CONTROLLER-REDESIGN.md`, folded together 2026-08-24; the
  standalone file no longer exists, don't look for it. Most of §1–§5's decisions are already
  implemented in code (the MeLE Quieter4C headless setup, the `/driver-push`
  schedule/state/announce protocol, Controller-side audio playback) — the one remaining open
  item is a real-hardware `hostapd` AP-mode bench test (§1), not a design gap. Root `README.md`
  was rewritten 2026-09-12 to match the current three-surface layout and is accurate again;
  this file and `docs/TESTING.md` remain the more detailed references.
