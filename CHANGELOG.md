# Changelog

All notable changes to RouteTracker (driver PWA + ops dashboard) are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). One version
number covers the whole solution — PWA and dashboard release together on the
`develop` → `master` merge.

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
