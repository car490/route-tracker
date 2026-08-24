# TODO

General engineering follow-ups that aren't tied to a specific feature spec.
(For the parked vehicle data subsystem work, see `VOL.md`. For driver duties /
drivers'-hours compliance work, see `DRIVER_DUTIES.md`.)

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
`src/manualSelection.js`, `mele-server/TEMP-LAPTOP.md`) is the driver opening
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

## Onboard display — BETA enclosure gap

As of 2026-08-14 the Dell Pro P2426H (VESA 100×100mm, no stand) is
confirmed as the BETA monitor — see `docs/HARDWARE.md` §3/§8. Bought as a
consumer-grade stand-in because industrial-spec panels run ~6 weeks
average lead time, too long for next week's BETA test. Its footprint is
expected to match the eventual production panel, but it currently has no
enclosure.

- [ ] **Urgent — BETA fits without an enclosure.** Order the RAM **E-size**
  VESA mount kit now, bolted straight to the bare P2426H's native VESA
  holes, so BETA can be fitted before the enclosure exists. **Corrected
  2026-08-14 from an earlier D-size pick** — D-size is only rated to
  6 lb/2.72kg dynamic, and the P2426H panel alone weighs 6.88 lb/3.12kg
  without its stand, already over that before an enclosure is added.
  Exact parts (`docs/HARDWARE.md` §8): **RAM-E-246U** (or steel-reinforced
  **RAM-E-246U-IN1**) VESA plate + **RAM-E-202U** (or steel-reinforced
  **RAM-E-202U-IN1**) round base + **RAM-E-201U-D** short double socket
  arm, all at [ram-mount.co.uk](https://www.ram-mount.co.uk/).
- [ ] Source or build the enclosure itself in time for BETA — no
  supplier/spec picked yet (`docs/HARDWARE.md` §8). **Must** expose a
  100×100mm VESA passthrough aligned to the panel's own holes on its back
  panel, so the mount ordered above unbolts from the bare panel and
  rebolts straight to the enclosure later — buy the mount once, not twice.
  If the enclosure design instead buries or offsets the VESA holes, this
  breaks.
- [ ] Once the enclosure's actual weight/mounting depth are known,
  double-check the RAM E-size mount (15 lb/6.8kg dynamic rating) is still
  rated for it — expected to have headroom, but not yet verified.
- [ ] Separately, the **production** ceiling-drop mount (§8) stays TBD
  until the final production panel (§3) is sourced — don't conflate the
  BETA enclosure with solving that.

## Controller audio — drop local Driver fallback once fleet-wide

As of 2026-08-19, `src/announcements.js`'s `announce()` broadcasts to a
commissioned Controller (`docs/CONTROLLER-REDESIGN.md` §8) *and* still
plays locally on the Driver tablet — a deliberate deviation from that
doc's original "Controller only" design, since only one physical
Controller exists today and a hard cutover would silence PSVAIR audio
fleet-wide.

- [ ] Once Controller hardware is deployed to every vehicle, drop the
  local-playback half of `announce()` (and the now-redundant queue/busy
  state machine in `announcements.js` — it only needs to live on the
  Controller once nothing else plays audio, per §8's original reasoning).

## Offline resilience — no "pending sync" indicator

As of 2026-08-23, `src/localStore.js` + `src/main.js`'s `flushPendingTrips()`
queue a trip's stop times/`complete_journey` call locally and retry
automatically (on startup and on the `online` event) if Supabase couldn't be
reached at end-of-trip. There's no UI surfacing this queue today — a driver
or ops staff has no way to see "N trip(s) waiting to sync" short of opening
devtools and reading `localStorage['busops.queue.pendingTrips']`.

- [ ] Small indicator on the duty-card/no-duty-card screen (count + maybe
  oldest-queued-at) once this queue has been live long enough to know how
  often it's actually non-empty in practice.

## Brand — placeholder app icon needs real design

`icons/icon-{192,512}.png` (driver PWA) and `dashboard/public/pwa-{192,512}x512.png` (dashboard)
were, until 2026-08-21, the actual Phil Haines Coaches logo — a single operator's branding baked
into shared source code, used as every install's home-screen/PWA icon regardless of which
operator's deployment it is. Replaced with a plain placeholder (PCV Charcoal background, "CM" in
PCV Cyan, generated programmatically — see chat history, not a designed asset) so nothing
operator-specific ships in the repo. Per `docs/BRAND.md`, no real PCV Technologies/CoachMate logo
exists yet.

- [ ] Commission or design a real app icon and replace these four files (plus the favicons added
  at the same time: `index.html`/`onboard.html`/`dashboard/index.html`'s `<link rel="icon">`,
  currently pointing at the same placeholders).
- [ ] Once a real logo exists, revisit `docs/BRAND.md`'s "Logo — not yet designed" section.

## Accessibility & branding playbook — follow-ups

See `docs/ACCESSIBILITY_BRAND_PLAYBOOK.md` (company-level accessibility/brand standard,
referenced from `CLAUDE.md`). Its §3.2 audit measured actual contrast ratios against the
currently-shipped brand tokens (re-verified 2026-08-23 against the post-restructure
`pcv-dashboard/busops/driver/style.css` — values below are current, not carried over from the
playbook's original 2026-08-20 draft) and found the following gaps — logged here rather than
fixed inline, since this pass was about establishing the playbook, not changing the product:

- [ ] The driver PWA's `#app-brand` corner attribution ("From PCV Technologies") wraps its
  `.cm-powered-by`/`.cm-wordmark` text in `.cm-attribution { opacity: 0.55 }`, which drops both
  below WCAG AA (2.62:1 / 2.68:1, need 4.5:1) — see playbook §3.3. This is the *same* bug
  already fixed in the dashboard's equivalent mark (`pcv-dashboard/src/index.css`
  `.sidebar-coachmate`, see the comment there); the driver PWA's own mark just never got the
  same fix. Removing the wrapper opacity (keeping hierarchy via font-size alone, matching the
  dashboard's approach) brings both to 5.24–5.56:1.
- [ ] `--cm-cyan`/`--operator-accent` (`#00B4D8`) fails WCAG AA (2.46:1, needs 4.5:1 text /
  3:1 UI border) when used as text or a thin border directly on a white/light surface —
  concretely: `pcv-dashboard/src/index.css` `.btn-primary` (white text on cyan fill), `.dm-today`
  numerals, `.form-input:focus` border/box-shadow. Needs either a second "accessible-on-light"
  token for those spots (the same pattern already used once for `--pcv-color-sidebar-accent-tint`,
  playbook §3.2), or contrast validation added to `BrandingPage.jsx`'s colour picker so an
  operator can't save a non-compliant `primary_color`/`accent_color` in the first place — the
  picker has no such check today, so any operator (not just the default theme) can ship a
  non-compliant UI.
- [ ] `late` status colour (`#EF4444`) is 3.64:1 against the driver PWA's card surface
  (`#242F35`), just under the 4.5:1 text minimum — the status most likely to need to be read at
  a glance under time pressure. Needs either a darker red or a heavier font-weight/larger size
  to qualify as "large text" (3:1 threshold).

**Dropped from the original draft, now resolved**: the placeholder-logo item (gradient-fill
Phil Haines Coaches wordmark failing contrast) — the app icon was already replaced with a
neutral placeholder 2026-08-21, tracked separately in "Brand — placeholder app icon needs real
design" above, so it isn't re-listed here as a colour-audit finding.

## Tech debt / refactors

- [ ] `dashboard/src/features/route-planner/RoutePlannerPage.jsx` (1,051 lines)
  is a single monolithic component — route/timetable state, stop management,
  map interaction, BODS fields, departures, and save logic all in one function
  body with little internal separation. Worth splitting into sub-components
  deliberately (not opportunistically), with careful manual verification of
  the whole Route Planner flow afterward given how much shared mutable state
  (stops, routeResult, hqLocation, etc.) flows between those pieces.
