# Changelog

All notable changes to RouteTracker (driver PWA + ops dashboard) are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). One version
number covers the whole solution — PWA and dashboard release together on the
`develop` → `master` merge.

## [2.2.6] - 2026-09-17

- chore: remove security review docs now that all items are resolved

## [2.2.5] - 2026-09-17

Security hardening pass, from a focused review (`docs/SECURITY_REVIEW_2026-09-17.md`)
verified item-by-item against the real source before each fix
(`docs/SECURITY_FIXES_2026-09-17.md`).

- fix(api): `sign-token`, `sign-announce-token`, and `send-duty-email` (the Vercel API
  routes) only checked that an `Authorization` header was present, never that it was a
  real Supabase session — any caller could mint a duty/device JWT for journeys/devices
  they don't own, or send email via the project's Resend account to an arbitrary address.
  Added a shared `authenticate()` helper plus RLS-scoped ownership checks; also fixed an
  HTML-injection bug found in `send-duty-email`'s email body along the way.
- fix(db): `start_journey`, `complete_journey`, and the three `announce_devices` RPCs were
  `SECURITY DEFINER`, anon-callable, and trusted their id parameter with no ownership
  check. Added `is_jwt_device_allowed()` alongside the existing `is_jwt_journey_allowed()`.
- fix(xss): stop/route/driver/vehicle names and incident free-text were interpolated into
  `innerHTML`/`document.write` with no escaping in the driver PWA and the dashboard's
  printable journey report — a stored-XSS path via any of those DB-sourced fields. Added a
  shared `escapeHtml()` used at every affected call site.
- fix(auth): the driver duty-card token lived in the URL for the whole session with
  nothing ever stripping it; the Announce device token (100-year expiry, required by
  Supabase Realtime) had no revocation path short of rotating the shared secret for every
  device at once. Moved the duty token into `sessionStorage` with the URL stripped after
  capture, and added a per-device `revoked_at` column/check.
- fix(dev-server): the local-only driver PWA dev server had no path-traversal guard.
  Added one, plus URL-decoding so it also catches encoded traversal attempts.
- The report's claim about `announcement_coverage_gap`'s anon insert (Item 5) turned out
  to be based on a stale premise — the referenced columns are already real foreign keys,
  so Postgres already rejects nonexistent ids. Corrected the write-up, no code change.

## [2.2.4] - 2026-09-16

- fix(announce): revert logo wordmark to its original size

## [2.2.3] - 2026-09-16

- fix(announce): decouple top bar/Line 1/logo sizing from the 22mm floor

## [2.2.2] - 2026-09-16

Two fixes from a real on-vehicle test of Driver PWA + Announce Solo (Donington Cowley Academy
route).

- fix(geofence): detect arrival at a close/looped next stop while still dwelling — departure was
  previously judged only by distance from the *current* stop, so on a loop where two stops sit
  close together the vehicle could pass the next stop without it ever being detected. Adds a
  two-fix-confirmed lookahead check.
- fix(announcement-audio) — `announcement_clips` was empty on both dev and production despite the
  pipeline being "live": the enqueue triggers only cover new/edited stops and routes, and every
  stop/route predates them. Backfilled all pre-existing data on both environments (427 clips on
  dev, 362 on production) — no code change needed, the trigger mechanism itself is correct going
  forward. See `docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md`'s "Eighth real bug" entry.

## [2.2.1] - 2026-09-16

- fix(announce-audio): corrected v2.2.0's plan to fully remove the bundled clip fallback —
  `driver/audio/announcements/` isn't a browser transition artifact, it's the Bus Controller's
  only audio source (no live-fetch path to Storage by design). Removed only the *browser-side*
  fallback code (`shared/announcementAudio.js`, `service-worker.js`); the committed clips and
  `scripts/generate-announcement-audio.mjs` stay, permanently, for the Controller.
- fix(announce): `mele-server/audioPlayer.mjs`'s `DEFAULT_AUDIO_DIR` resolved one directory level
  too shallow — every announcement on the real Controller had been silently skipped since it was
  first commissioned. No test caught it; added one that asserts the real default resolves to an
  existing directory.

## [2.2.0] - 2026-09-16

**PSVAIR announcement audio: server-side pipeline, no more live speech synthesis**
(`docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md`)

- feat(supabase): announcement clip pipeline — `stops`/`routes` triggers enqueue jobs, a capped
  cron drains them through a new `generate-announcement-clip` Edge Function into a public Storage
  bucket + `announcement_clips` table, replacing the old manual "run a script, commit clips"
  workflow. Live on dev and production.
- feat(announce-audio): Driver and Announce Solo now read clips from that live pipeline
  (`shared/announcementAudio.js`), with the service worker precaching every row from
  `announcement_clips` at install time. Live on dev; production still on the prior bundled-clips
  path pending its own rollout.
- feat(announce-audio): eliminated the live `speechSynthesis` fallback entirely — a stop with no
  confirmed clip now plays no audio and raises a queryable `announcement_coverage_gap` ops alert
  instead, with a non-blocking driver-facing warning at journey start. Live on dev.
- fix(supabase): require `pairing_secret` to authorize `link_announce_device` (closed a live
  cross-tenant exposure — anyone with the anon key could link any device to any vehicle sharing a
  company); `pg_net` body param needed `jsonb`, not a `::text` cast (was silently failing the
  drain cron every run); Edge Function caller auth needed a dedicated `CALLER_AUTH_TOKEN` secret.
- fix(busops): two bugs found only by a genuine real-device install pass — the service worker
  failed to register entirely (`config.js` read `window` in a scope that only has `self`), and
  `manifest.json`'s icon paths still pointed at a folder removed in the 2026-08-21 restructure.
- docs: `CLAUDE.md`, `docs/DECISIONS.md`, and `docs/TODO.md` updated to describe the shipped
  pipeline in place of the old manual workflow.

**Announce Solo / Lite — onboard sign polish and reliability**

- feat(announce): Announce Solo gets the same pre-rendered clip audio as Driver/Lite; approved
  off-white/black colour scheme; three-line headline layout with an amber early-wait box; topbar
  marquee for overflowing route/destination and headline text (several follow-up fixes to its
  entry direction, loop/rest behaviour, and cloned-segment styling).
- fix(announce): stop Solo stalling on driver pokes, frozen tracking, and a lit-forever idle
  screen; auto-dismiss the lock screen on boot; ignore a stale pushed schedule/state on Lite
  devices; restore the BusOps corner mark on idle branding load; wrap the
  `report_device_heartbeat` RPC to avoid an uncaught throw.
- fix(announce): idle screen shows next departure per service instead of one merged time, moved
  into the topbar; gate tracking/announcements/sign reveal on real stop arrival, not just a timer.
- feat: real-tablet AV review tooling for S116S/S125S (`scripts/review-announce-solo.mjs`),
  resolving `adb` from known install paths instead of relying on `PATH`.

**Other**

- feat(route-planner): `school_term_time` flag for schoolday-only departures.
- fix(scripts): paginate the `schedule_view` fetch in `generate-schedule.mjs` (was silently
  truncating past 1000 rows).
- docs: rewrote `README.md` for the current three-surface architecture; expanded the induction
  hearing loop compliance gap note; added a lightweight PR template.
- chore: removed stale/orphaned root files and empty pre-restructure directory shells.
- fix(announce): simplify topbar marquee to a single-copy exit-and-restart loop
- fix(announce): fix cloned-segment styling, bound the marquee to 2 loops + rest
- fix(announce): make the topbar marquee loop continuously, not pause-and-snap
- feat(announce): scroll the topbar route/destination line when it overflows
- fix(driver): gate tracking, announcements, and sign reveal on real stop arrival

## [2.1.0] - 2026-09-03

- chore: complete changelog for v2.0.0, add production PWA deploy job
- Fix Announce idle-lock and PWA approach-audio repeat from first beta test
- feat(announce): Solo device sleeps outside its active windows, not just GPS polling
- fix(announce): fix dead approaching signal, drop repeated route text, lock TTS voice
- feat(announce): reduce announcement repetition, add terminus notice state
- feat(announce): enlarge idle screen's company logo ~3x
- fix(announce): unify topbar height, disable pinch-zoom on the sign
- Revert "fix(announce): use dvh/dvw for the sign's full-screen containers"
- fix(announce): use dvh/dvw for the sign's full-screen containers
- fix(announce): Lite/Solo idle branding, panel sizing, PSVAIR text corrections
- fix(announce): correct Solo install-link generation and stale GitHub Pages base URL
- docs(announce): document a real kiosk-lock lockout incident from bench testing
- feat(announce): Solo beta readiness — active-window scheduling, journey-end fix, live-tested, kiosk script
- refactor(announce): align code identifiers with Announce Lite/Solo naming
- docs: split Announce Lite into Announce Lite / Announce Solo tiers
- fix(announce): restore the 5-state announcement model
- Fix onboard idle screen: kiosk URL missing params, wrong logo bucket
- Realign PSVAIR announcement sequence to target passenger-facing design
- feat(announce): rebuild onboard sign around a linked state/announcement model
- feat(busops): generic device state-reconciliation pattern for Announce Lite
- Fix Announce Lite paired mode: JWT exp, Realtime publication, missing pieces
- feat(dashboard): replace COACHMate footer mark with PCV Dashboard wordmark
- feat(dashboard): show which Supabase environment the sidebar is pointed at
- chore: add SessionStart hook forcing repo orientation on every session
- docs: correct stale Announce Lite status in ANNOUNCE-PRODUCT-TIERS.md
- docs: log Announce Lite stanchion mount decision and visibility compliance risk
- docs: add Announce Lite tablet hardware section (DOOGEE Tab E3 Max)
- fix: stop develop from writing to production Supabase
- fix(busops): Announce Lite paired-mode push never fired (RLS gap)
- fix(busops): redirect bare / to /driver/ instead of rewriting in place
- fix(busops): serve the Driver PWA at driver.pcvtechnologies.co.uk's bare root
- docs: correct Driver PWA deploy-pipeline description
- fix(ci): deploy job needs Node 22+ for wrangler 4.x
- ci: auto-deploy Driver PWA to driver.pcvtechnologies.co.uk on develop
- Add testing-mode time-shift fallback to Announce Lite standalone autopilot
- docs: add real-device bench-testing steps for Announce Lite

## [2.0.0] - 2026-08-27

- docs: add Announce Lite manual test section to TESTING.md
- Announce Lite: standalone schedule-autopilot wiring + idle-screen extension
- Announce Lite: standalone schedule-autopilot matcher (TDD)
- Announce Lite: persist the device token instead of one-shot URL read
- Announce Lite tier: paired-mode Realtime push/pull, both directions
- Announce Lite tier: dashboard device registration/install-link page
- Announce Lite tier: Driver PWA device-link primitives (TDD)
- Announce Lite tier, Phase 0: schema, device JWT, shared GPS relocation
- docs: close remaining gaps in Lite spec before implementation starts
- docs: design standalone-Announce autopilot via geofence + time matching
- docs: pin down execute-ready technical contract for Lite paired install
- docs: add Lite provisioning & linking flow, incl. standalone-Announce gap
- docs: scope Lite's GPS source as an adapter, not a hardcoded assumption
- docs: propose BusOps Announce Standard/Lite product tiers
- Keep the real-Controller bench demo script, move token out of source
- Centre tube-track block via fixed-height label reservation, widen labels
- Remove bottom-bar auto-scroll, back to fixed ellipsis truncation
- Move tube line down, shrink labels, arrow to the line's end
- Centre tube-track dots on the line, thicken it, flip the start arrow
- Revert onboard bottom bar to a single clause, not a combined line
- Replace onboard bottom-bar Announcing hint with a combined status line
- Fix onboard tube-track oscillating between arrival and departure
- Fix onboard tube-track label crossing, wrap long names to 2 lines
- Rework onboard tube-track: drop departed stop, angle labels, add direction arrow
- Revert corner brand mark to text-only, keep the z-index stacking fix
- Fix operator logo never appearing in the corner brand mark
- Idle sign: white middle band, brand mark pinned above bottom bar everywhere
- Simplify onboard idle screen: logo only, add branded top/bottom bars
- Correct seatd group to video, confirm fix verified live on Controller
- Fix cage kiosk failing to start on Controller: force seatd backend
- Fix stale offline-fallback docs: describe the real localStorage cache + queues, not dead schedule.json
- chore(busops): add wrangler as a devDependency
- Sync schema.sql with the client-generated journey id migration
- Make manual journey-start work offline via a client-generated journey id
- Fix branding logo bucket mismatch (Layout/CompanyModal vs BrandingPage) (#15)
- Add hostapd AP-mode bench-test script for the Quieter4C Controller (#14)
- Update deploy-status docs: Cloudflare Workers Builds fixed, cutover still pending
- Clean up remaining stale Pi/pi-server references after the Controller redesign
- Fold docs/CONTROLLER-REDESIGN.md into docs/HARDWARE.md
- Rebuild docs/DECISIONS.md against develop's actual current state
- Add docs/DECISIONS.md: single ledger of settled vs. still-open project decisions
- fix(mele-server): point bootstrap-controller.sh's clone at develop
- fix(cab-device): update template Start URL to Cloudflare Workers domain
- fix(busops): pin Node 22 for Cloudflare Workers Builds
- fix(busops): declare the custom domain route on env.production too
- docs: fix cab-device paths and kiosk URL for pcv-dashboard restructure
- docs: remove stale demo-drive.mjs references
- Update driver PWA domain references to pcvtechnologies.co.uk
- docs: add company-level accessibility & brand playbook
- docs: add branding consolidation plan (updated for pcv-dashboard restructure)
- docs: add branding consolidation plan
- Fix Vercel build: don't strip busops/shared/ from the dashboard build
- Add offline resilience: cache routes, queue failed trip uploads
- docs(mele-server): document wss:// requirement and cert-trust commissioning step
- fix(mele-server): serve over HTTPS/WSS to fix mixed-content block on Driver push
- fix(mele-server): dnsmasq loses a startup race against hostapd
- fix(mele-server): detect WiFi interface without depending on iw
- fix(mele-server): bootstrap script clones restructure/brand-hierarchy, not default branch
- Rename pi-server/ to mele-server/, pi commissioning user to mele
- Finalize deploy config and docs for the brand-hierarchy restructure
- Move pi-server/ into busops/announce/, fix its own served paths
- Split BusOps Driver/Announce into pcv-dashboard/busops/{driver,announce}
- Rename dashboard/ -> pcv-dashboard/, add coachmate/ placeholder
- Exclude cab-device/ from Cloudflare Workers deploy assets
- Centre the monitor-vertical tube-track with visible margins
- Reposition brand attribution to PCV Technologies, rename dashboard to PCV Dashboard
- Close remaining brand metadata gaps (category E)
- Replace hardcoded "Phil Haines Coaches" with the real per-tenant name
- Fix stale product naming and add missing PCV attribution (category C)
- Wire PCV Technologies brand typeface through the same token source
- Wire PCV Technologies brand colours through a single token source
- docs: correct Controller autoinstall delivery mechanism
- Bus Controller: headless setup for MeLE Quieter4C, single-radio AP model
- docs: log open issue — Kiosk Lock accessibility service doesn't survive restart
- fix: disable Fully Kiosk's wait-for-internet on reload
- Add driver duties / drivers'-hours compliance spec
- Suppress boot-time system nags on cab kiosk devices
- Require a SIM in every cab kiosk device before Kiosk Mode lockdown
- feat(dashboard): add CoachMate Operations brand mark
- Add DEBUG-only 'use current time' testing toggle to journey start
- Driver side: broadcast PSVAIR announcements to a commissioned Controller
- Controller-side audio playback subsystem (docs/CONTROLLER-REDESIGN.md §8)
- Onboard sign: branded idle screen before a journey starts
- Fix driver display: stop-list hidden behind brand mark, make trip-leave button visible
- Onboard sign: Bar/Monitor/Monitor-vertical display profiles, brand badge fix, Fire HD purge
- Bus Controller: schedule via push, onboard.js is now push-only
- Point CLAUDE.md at HARDWARE.md and CONTROLLER-REDESIGN.md
- Automate cab kiosk device provisioning (Fully Kiosk Browser)
- docs: record the exact Quieter4C order spec for the BETA unit
- docs: confirm Quieter4C audio-out, close out the audio hardware question
- docs: rule out Quieter3Q (audio-out not supported), flag Quieter4C audio unverified
- docs: add minimum-viable-spec purchasing note for BETA hardware
- docs: pick MeLE Quieter4C for the Bus Controller in redesign notes
- docs: decide idle-screen content for Controller redesign
- docs: correct stale outstanding-items note in Controller redesign doc
- docs: decide audio-out hardware and message transport for Controller redesign
- docs: confirm audio-to-Controller decision in Controller redesign notes
- Add Bus Controller redesign notes (mini PC, drop depot WiFi, audio question)
- docs: correct onboard display mount from RAM D-size to E-size, add ordered parts
- docs: require VESA passthrough on onboard display enclosure so BETA mount reuses without a second purchase
- docs: flag RAM D-size VESA mount system for onboard display (BETA + production), exact parts TBD
- docs: add onboard display BETA enclosure gap to TODO
- docs: confirm Dell Pro P2426H as BETA monitor unit, note enclosure gap
- fix: replace em-dashes with hyphens in start-temp-pi.example.ps1
- chore: release v1.5.0

## [1.5.1] - 2026-08-19

- Fix driver display: stop-list hidden behind brand mark, make trip-leave button visible
- docs: correct onboard display mount from RAM D-size to E-size, add ordered parts
- docs: require VESA passthrough on onboard display enclosure so BETA mount reuses without a second purchase
- docs: flag RAM D-size VESA mount system for onboard display (BETA + production), exact parts TBD
- docs: add onboard display BETA enclosure gap to TODO
- docs: confirm Dell Pro P2426H as BETA monitor unit, note enclosure gap
- fix: replace em-dashes with hyphens in start-temp-pi.example.ps1

## [1.5.0] - 2026-08-14

- Harden the onboard hotspot config against in-vehicle attackers
- Filter the manual picker's route list to Local Bus services only
- Add panel-agnostic text sizing for onboard display, config updates
- Prompt for a vehicle on install, sourced from Supabase Local Bus fleet
- Log manual-selection journeys missing vehicle_id/driver_id in TODO
- Replace hardcoded manual-picker route list with a live Supabase fetch
- Add temporary laptop-as-Pi controller setup for BusOps Announce
- Forward the full stopStates array through the Driver -> Pi push protocol
- Implement Driver -> Pi push path for BusOps Announce (NextStop architecture)
- chore: npm audit fix (4 vulnerabilities resolved)
- Add cab-device bridge to docs/HARDWARE.md as its own section
- Consolidate hardware specs into docs/HARDWARE.md
- Reconcile onboard-display docs with both deployment options
- Restore wlan1 hotspot config examples lost in the develop merge
- Log beta monitor pick vs. production candidates in DEPLOY.md
- Update onboard display spec: Fire HD tablet -> 24-28" HDMI monitor
- Consolidate PSVAIR approach announcement onto the stopStates model
- docs: rewrite CLAUDE.md against develop's current state
- Unify per-stop geofence tracking into a single state model
- docs: cab device kiosk setup guide
- docs: mark interior display panel as an open sourcing decision
- docs: correct proposal hardware specs, add PSV(AI)R compliance appendix
- prep driver PWA for driver.coachmate.uk: add wrangler.jsonc + assetsignore
- fix: onboard sign attribution stacked "Powered by"/CoachMate on separate lines
- revert brand mark to two-line layout, keep BusOps naming
- rebrand: Pi kiosk systemd description -> BusOps Announce
- rebrand: WiFi-Direct POC .Driver/.NextStop -> Driver/Announce
- rebrand: BusHub/NextStop -> BusOps/Announce in docs, demo, and comments
- rebrand: BusHub.NextStop -> BusOps Announce, single-line brand mark
- rebrand: BusHub.Driver -> BusOps Driver, single-line brand mark
- chore: remove unused code found in dead-code sweep
- refactor: move WizardModal into route-planner feature slice
- refactor: rename stops.naptan_code to atco_code; sweep removed NaPTAN stops
- feat: move Incident/Diversion to top bars, auto-complete trips
- fix: allow GPS arrival detection at the actual final stop
- fix: single-row route-header, drop service period text
- fix: grant screen-wake-lock permission in demo scripts
- feat: simulate a random skipped stop in demo-drive/demo-2up
- fix: left-align service badge text with route-header line below it
- fix: stack route-header text under service badge, strip NaPTAN indicators
- fix: stop synthesizing depot start/end stops in driver PWA and NextStop
- feat: collapse PSVAIR announcement banner by default in driver PWA
- fix: acquire wake lock on driver PWA boot, not just on Start
- docs: document announcement_name workflow and queue-not-interrupt behavior
- feat: switch announcement voice to en-GB-RyanNeural; fix Boston College text
- feat: add --dev flag to generate-schedule.mjs; regenerate with announcement_name override
- feat: add stops.announcement_name override for display_name()
- fix: queue announcements instead of interrupting one mid-playback
- chore: add reusable reset script for both PSVAIR demo journeys
- chore: add migration to remove orphaned Phil Haines depot stop row
- feat: rework PSVAIR announcements into the 4 regulation-required events
- fix: stop any in-progress announcement before starting a new one
- chore: remove temporary speak() debug log; hash voice into clip cache key
- fix: carry stop_id through onboard.js's own fetchStops path too
- debug: log every speak() call's audioKeys for live diagnosis
- fix: log why a pre-rendered announcement clip failed to play
- fix: don't re-announce the starting stop as a new arrival
- fix: serve .mp3 with the correct Content-Type in the local dev server
- fix: carry stop_id through fetchStopsForDeparture
- feat: add pre-rendered Azure Neural TTS announcement audio clips
- chore: regenerate schedule.json with stop_id
- docs: document PSVAIR announcement audio pipeline in CLAUDE.md
- feat: pre-rendered Azure Neural TTS announcement audio, replacing live speechSynthesis
- style: widen the gap between tube-track labels and the line further
- style: move tube-track stop labels above the line, not below
- style: dial back tube-label size and tighten logo corner position
- fix: keep NextStop brand mark visible, moved out from under the topbar
- style: bigger tube-track stop-name labels for readability
- style: switch NextStop tube-track/upcoming-list to slate, keep bars purple
- feat: demo-2up.mjs starts/stops the local dev server itself
- fix: restore dark-purple NextStop bars lost in a bad merge, fix manual-flow journey status, add 2-window client demo
- feat: manual service selection fallback + PSVAIR announcement voice picker
- feat: add interactive simulation demo page (demo.html)
- feat: ThemeProvider branding integration for onboard passenger display
- docs: update DEPLOY.md — Pi 5 + NVMe HAT, stretch bar display option, storage guidance
- polish: bigger upcoming-stops box text on the wide sign
- feat: left-align topbar, wide-only upcoming-stops box, re-centre tube-track
- feat: single-sentence bottom bar, dark-purple palette, wide-only ETA, 24h clock
- feat: rework onboard sign to meet PSVAIR 22mm text minimum
- feat: unify onboard sign design across Fire HD and wide displays
- feat: redesign wide onboard sign top bar, add live demo tooling
- feat: implement 16:3 ultra-wide onboard sign layout
- docs: consolidate reference docs into docs/
- docs: pull in verification/design docs stranded on abandoned Copilot branches
- feat: add WiFi Direct bench-test harness for NextStop hardware selection

## [1.4.0] - 2026-07-22

- feat: manual service selection fallback for no-active-duty dead-end

## [1.3.0] - 2026-07-22

### Added
- PSV(A)R 2026 compliance: live audio/visual next-stop announcements (current stop +
  next stop, proper terminus message), driver-triggered diversion alerts wired into
  both the driver PWA and the onboard sign, and fixed-volume audio config calibration
  per vehicle.
- BusOps Announce onboard passenger sign redesigned as a fixed landscape e-paper-themed
  display, with the CoachMate/BusOps wordmark, a Raspberry Pi + Fire HD deployment
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
