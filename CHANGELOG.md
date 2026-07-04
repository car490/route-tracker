# Changelog

All notable changes to RouteTracker (driver PWA + ops dashboard) are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). One version
number covers the whole solution — PWA and dashboard release together on the
`develop` → `master` merge.

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
