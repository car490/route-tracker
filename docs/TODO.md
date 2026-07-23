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

## Tech debt / refactors

- [ ] `dashboard/src/features/route-planner/RoutePlannerPage.jsx` (1,051 lines)
  is a single monolithic component — route/timetable state, stop management,
  map interaction, BODS fields, departures, and save logic all in one function
  body with little internal separation. Worth splitting into sub-components
  deliberately (not opportunistically), with careful manual verification of
  the whole Route Planner flow afterward given how much shared mutable state
  (stops, routeResult, hqLocation, etc.) flows between those pieces.
