# TODO

General engineering follow-ups that aren't tied to a specific feature spec.
(For the parked vehicle data subsystem work, see `VOL.md`.)

## PSVAIR 2026 compliance — follow-ups

Live audio/visual next-stop announcements (driver PWA) shipped first — see
`src/announcements.js`, `schedule_view.psvair_in_scope`. Deliberately *not*
built yet, decide if/when needed:

- [ ] Ops-side compliance tracking: per-vehicle AV equipment fitted/install
  date, per-route PSVAIR applicability override (currently inferred purely
  from `journey_types.requires_bods`, no manual override if that ever
  diverges from the legal "local bus service" definition), driver-logged
  equipment fault reports (DVSA/Traffic Commissioner expect a fault log).
- [ ] Phased-deadline awareness by vehicle age (`vehicles.year`) — buses
  first used 1973–2014 must comply by 1 Oct 2026; nothing currently blocks
  or flags an older vehicle running an in-scope service before that date.
- [ ] Pre-recorded audio clips as an alternative to on-device TTS (some
  operators may want branded/human-voiced announcements instead of the
  browser's Web Speech API voice).

## Manual-selection flow — no driver on the journey

As of 2026-08-14 the Driver PWA's default flow (no duty-card link — see
`src/manualSelection.js`, `pi-server/TEMP-LAPTOP.md`) is the driver opening
the plain PWA and picking their service by hand, not an ops-issued duty
card. `journeys.driver_id` is never set for a journey created this way —
there's no login, so no driver identity exists on the device to attach.

**`vehicle_id` is now handled** (2026-08-14): the PWA prompts once per
device for its vehicle (`src/vehicleSetup.js`, "Change vehicle" available
from the No Duty screen), sourced from a live Supabase fetch
(`fetchLocalBusVehicles()`) filtered to vehicles tagged `'Local Bus'` in
the new `vehicles.journey_types` column (set from the dashboard's Vehicles
page). `get_or_create_manual_journey()` now takes an optional `p_vehicle_id`
and sets it on insert (see `migration_vehicle_journey_types_manual_journey.sql`
— **apply to both dev and production**, this session couldn't reach
Supabase directly). `driver_id` remains null/unaddressed — still blocks
driver-hours reporting, though vehicle-side PSVAIR/Live Tracking/Daily
Journeys display is now fixed.

- [ ] Decide how (or whether) a manually-started journey gets a driver
  identity attached — the PWA has no login by design (see
  `feedback_driver_auth` project convention: passwordless, no login
  screens), so this likely needs a different mechanism than the vehicle
  picker above (e.g. an ops-side reconciliation screen, not a device prompt).
- [ ] Audit dashboard pages (Daily Journeys, Duty Cards, Live Tracking,
  Overview) for how they currently render a null `driver_id` — blank,
  "Unknown", or does something break?

## Tech debt / refactors

- [ ] `dashboard/src/features/route-planner/RoutePlannerPage.jsx` (1,051 lines)
  is a single monolithic component — route/timetable state, stop management,
  map interaction, BODS fields, departures, and save logic all in one function
  body with little internal separation. Worth splitting into sub-components
  deliberately (not opportunistically), with careful manual verification of
  the whole Route Planner flow afterward given how much shared mutable state
  (stops, routeResult, hqLocation, etc.) flows between those pieces.
