# Changelog

All notable changes to RouteTracker (driver PWA + ops dashboard) are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). One version
number covers the whole solution — PWA and dashboard release together on the
`develop` → `master` merge.

## [1.3.0] - 2026-07-22

### Added
- PSV(A)R 2026 compliance: live audio/visual next-stop announcements (current stop +
  next stop, proper terminus message), driver-triggered diversion alerts wired into
  both the driver PWA and the onboard sign, and fixed-volume audio config calibration
  per vehicle.
- BusHub.NextStop onboard passenger sign redesigned as a fixed landscape e-paper-themed
  display, with the CoachMate/BusHub wordmark, a Raspberry Pi + Fire HD deployment
  backend, and a demo mode that drives it alongside the PWA.
- Route Detail Modal — clicking a route now opens a centred modal with the route
  summary, timetable list, and a per-timetable departures accordion, instead of a card
  that could render off-screen for routes further down the list.
- Sidebar background changed to slate grey.

### Fixed
- Timetable stop-time offsets now anchor to the timetable itself rather than a
  departure record, fixing a silent time-shift bug when departures were edited.
- Race condition that could show the wrong timetable's departures after switching.
- Add Departure silently failing to save when Valid From was left blank.
- A route's single_journey flag can now be edited after creation, and its departure
  time is correctly preset/locked in the Add Journey modal for single-journey routes.
- Several dashboard contrast issues (--text-muted, sidebar text opacity) raised to
  meet WCAG AA; onboard/driver PWA brand mark visibility and overlap fixes.
- NaPTAN parenthetical indicators no longer read aloud in spoken stop announcements.
- Driver-link Copy Link used the production URL even in dev; demo-drive.mjs navigation
  could abort silently with no visible error; onboard.html header squeezed unreadable
  by long service-period text.

### Changed
- Test infra: CI, dashboard lint, and Vitest wired up; dead standalone-picker code path
  removed.

## [1.2.0] - 2026-07-09

### Added
- Guided Route Wizard — a 4-step modal (Route → Stops → Timetable & Review →
  Departures) replacing the old disjointed multi-page route-creation flow.
- Departures now get smarter, journey-type-aware date-range handling: a
  mandatory start / optional end date for every service, a term-date
  auto-fill picker for school-contract routes (seeded from Lincolnshire
  County Council's published term dates), and excursion routes skip
  straight to the single-date one-off form.
- Distinct marker colour for routing point stops in the route planner map.

### Fixed
- Driver PWA's live tracker now rejoins the route after an off-route detour
  or GPS gap instead of stalling permanently — forward-searching geofence
  matching with 2-ping confirmation, classified as a signal gap or a genuine
  detour for reporting.
- A route's journey type is restricted to one everywhere (the "Edit Route"
  modal previously allowed several, inconsistent with the New Route wizard).
- Driver PWA now displays distance in metres and speed in mph, not km/km-h.
- Saving a new timetable onto an existing route no longer leaves the
  timetable pointer stuck on `'__new__'`, which could duplicate it on a
  second save.
- Saving a timetable now rejects it if a timing point has no time set.
- Removed the `excursion_passengers` table, which had silently come back on
  dev via a stale `schema.sql` after being dropped from production months
  ago; added the previously-prod-only `generate_duty_token()` function to
  `schema.sql` and dev so both environments match.

### Changed
- Moved the PWA's Supabase config to `src/config.js`, removing a dead
  duplicate `main.js` at the repo root.

## [1.1.0] - 2026-07-04

First release of the CoachMate rebrand to Production.

### Added
- CoachMate visual rebrand — Plus Jakarta Sans font, cyan/charcoal theme
  tokens, flat sidebar nav with icons.
- Multi-tenant branding ("The Wrap") — per-company logo/colour overrides via
  a new Branding settings page, `system-assets`/`operator-assets` storage
  buckets, `companies.slug`/`primary_color`/`accent_color` columns.
- Ops dashboard is now installable as a standalone app window (PWA manifest
  + service worker), matching the driver app's install behaviour.
- Route Planner's map now centres on the operator's HQ address (geocoded by
  postcode from Company Settings) instead of a wide, unfocused default view.
- One-command local dev startup (`scripts/dev-all.mjs`) — starts the driver
  PWA, dashboard, and local GraphHopper together.

### Fixed
- Production `GRAPHHOPPER_URL` wired to the same Hetzner VPS used by
  Preview/develop — the directions API no longer hard-503s in Production.
- Two CodeQL-flagged XSS findings (logo `src` sanitization).
- Company Settings modal rendering behind the Leaflet map (z-index).
- `dvsa-vol-lookup` Edge Function deployed to the dev Supabase project
  (existed on Production already, was missing on dev).

## [1.0.0] - 2026-07-04

Baseline release marking the start of formal version tracking. Prior history
(driver PWA service-worker cache bumps v1-v21, dashboard at unversioned 0.1.0)
predates this changelog — see `git log` for that history.

### Added
- `VERSION` file as the single source of truth for the solution version.
- Release script (`scripts/release.mjs`) to bump the version, sync it into the
  service worker cache name, the PWA footer, and `dashboard/package.json`, and
  stamp a new changelog entry.
- Version number now visible in both apps: PWA footer, dashboard sidebar.

### Fixed
- Production `GRAPHHOPPER_URL` now points at the same Hetzner VPS
  (`routing.coachmate.uk`) used by Preview/develop — Production directions API
  no longer hard-503s.
