# BusOps Announce — Announce / Lite / Solo product tiers

Proposal to formalize three supported product tiers for the passenger-facing
onboard sign, instead of treating the tablet-based install some clients ask
for as a one-off deviation from `docs/HARDWARE.md`. Written up so it can be
read and acted on independently of the conversation that produced it.

**Naming confirmed 2026-09-01:** `BusOps Announce` (Driver → Controller →
Announce), `BusOps Announce Lite` (Driver → Announce, no Controller),
`BusOps Announce Solo` (Announce only, no Driver device). This resolves the
"decide product naming" open item below — the doc previously called the
base tier "Standard" and used "Lite" to cover both the paired and
driverless tablet installs; those are now three distinct names, one per
device-count/architecture combination, not two.

## Context

`docs/HARDWARE.md` documents the confirmed production architecture (call it
**Announce** below — the unmodified base tier): a Bus Controller (MeLE
Quieter4C mini PC) driving a fixed HDMI passenger panel, with the driver
tablet owning GPS and pushing derived state to the Controller over
`/driver-push`. That architecture is real, in progress, and partly
purchased (BETA Controller, Dell panel, RAM mounts).

Some clients — pointing at competitors like StarPAL, who sell an all-in-one
box that moves bus-to-bus with no fixed install — want something lighter:
just a tablet on a mount, no Controller, no fixed panel. Rather than treat
this as a fork away from the confirmed architecture, or a compromise that
waters down the base tier, it should be additional named tiers aimed at
different customers: operators who want a fast, portable, StarPAL-equivalent
install and don't need the fuller compliance/PA/ticketing roadmap Announce
is built toward. Two variants of that lighter install exist, depending on
whether a driver device is part of the purchase — see Lite vs. Solo below.

**This is not a compliance shortcut.** Every PSV(AI)R requirement in
`HARDWARE.md` §6 (≥51% seat visibility, 22mm text, wheelchair/priority seat
visibility) applies identically across all three tiers. Lite/Solo change
the architecture and install, not the regulatory bar.

## Announce tier (base — Controller-based)

Full spec: `docs/HARDWARE.md` §1–§11. One-line summary: Bus Controller +
fixed passenger panel + driver tablet owning GPS, with PA audio, and future
headroom for ticketing/APC hardware that needs the Controller's GPIO/serial.
Flow: **Driver → Controller → Announce**.

**Who it's for:** operators who want the full compliance/feature roadmap —
PA announcements played reliably from fixed hardware (not a phone's
background browser tab), and a path to ticketing/APC later without
replacing the install.

## Lite & Solo tiers — tablet-based, no Controller

Shared architecture for both lighter tiers: no Bus Controller, the
passenger display is itself a GPS+cellular-capable tablet, running the
onboard sign UI directly. **Not necessarily the same device class as the
driver tablet** — it also has to pass §6's passenger-display requirements
(seat visibility, 22mm text), which a phone-sized screen like the Blackview
Active 5 can't meet. See `docs/HARDWARE.md` §14 for the concrete
Announce-side candidate (DOOGEE Tab E3 Max, proposed 2026-08-27, ~14"). The
driver tablet pick itself is unaffected — still Blackview Active 5, §8.

**Lite and Solo are the same hardware/software running in one of two
modes**, distinguished purely by whether a driver device is part of the
purchase and linked — not two separate builds:

- **Announce Lite** — a driver tablet is present and paired to the Announce
  tablet over Supabase Realtime (no local link — see "paired install"
  below). Flow: **Driver → Announce**.
- **Announce Solo** — Announce tablet only, no Driver device at all. It
  runs the schedule-autopilot matcher (below) to decide for itself when a
  journey has started, since there's no driver to tap a duty. Flow:
  **Announce only**.

Because linking is reversible at any time (see "Linking is optional and
happens later" below), a single provisioned Announce tablet can move
between Solo and Lite just by linking/unlinking a Driver device — no
reinstall or reflash needed either way.

**This reuses code that already exists rather than requiring new
engineering.** `HARDWARE.md`'s "Model 1" — the Controller-less design where
the passenger display independently polls Supabase and computes its own
progress from its own GPS — was marked *dead, not a fallback* when the base
Announce tier moved to the Controller-fed push model. It should be
**un-deprecated and promoted to Lite/Solo's first-class supported mode**,
not left as unmaintained history:

- Reuses `src/gps.js` / `src/geofence.js` / `src/engine.js` (already pure,
  already shared with the driver PWA) — no new tracking logic.
- The Announce tablet either polls Supabase's `get_duty_card` directly over
  its own cellular connection, or works from a synced schedule cache, the
  same offline-first pattern the driver PWA already uses
  (`src/schedule.json` fallback).
- No local link between Driver and Announce is required at all — both
  devices independently watch the same Supabase state. This deliberately
  avoids reopening the WiFi-Direct/local-hosting question that was
  evaluated and rejected twice already (`HARDWARE.md` §3's networking
  history) — Lite doesn't need a local link, so that rejection doesn't
  need to be revisited for it to work.
- **Done, 2026-08-27 ("Announce Lite tier, Phase 0" commit):** the
  independent-polling path was restored as real scoped work, not a flag
  flip — `announceGps.js`/`shared/gps.js` (internal-mode tracking),
  `announceStandaloneAutopilot.js`/`scheduleAutopilot.js` (the geofence+time
  matcher below), `announceLiteFeed.js` (transport, both modes), the
  `announce_devices` table/RPCs, and the dashboard device-link page all
  exist and are wired in, not just designed here. Tested flow is in
  `docs/TESTING.md` §17 ("Test: BusOps Announce Lite") — it did not
  bit-rot unnoticed. (Note: this commit predates the 2026-09-01 Lite/Solo
  naming split, so its own name and the module names below still say
  "Lite"/"standalone" rather than "Solo" — same code, renamed tier.)
  **Remaining real gaps**, confirmed against the code directly, not
  assumed: no "Link Announce device" button in the Driver PWA yet (the
  underlying API exists — `announceDeviceLinkApi.js` — link today via
  `select link_announce_device(...)` in SQL, per §17's own "Known gap"
  note); no dashboard UI yet for editing a Solo device's
  `candidate_departure_ids`/match-window/terminus-radius columns (SQL
  only, also per §17).

**GPS source should be a config knob, not a hardcoded assumption.** The
independent-polling design above assumes the Announce tablet always uses its
own on-device GPS. Worth building the reused `src/gps.js` engine to accept a
source adapter instead — `internal` (the tablet's own GPS, the default mode
both Lite and Solo need day one) vs. `driver-device` (consume GPS-derived
state pushed from the Driver device, closer to the base Announce tier's
model but without a Controller in between — Lite-only, since Solo has no
Driver device to consume from). Two situations make the second adapter
worth having even though nothing needs it yet: an Announce tablet with weak
GPS/cellular reception in a given vehicle, and any future variant that
wants Lite's cheaper two-tablet hardware with the base tier's lower-latency
push instead of poll-interval-bound updates. This is scoped as an adapter
interface inside the shared Lite/Solo GPS engine, not a new device profile
or operating mode — Lite stays two independent devices either way; only
where one tablet's GPS signal comes from changes.

**Who it's for:** operators who want the StarPAL-equivalent pitch — light,
fast to install, movable between vehicles — and don't need PA/ticketing/APC
now or on a near-term roadmap. Lite if they also want a driver device
paired to it; Solo if they don't want a driver device at all.

## Provisioning & linking

How a vehicle actually gets set up, per purchase scenario. Only the two
Lite/Solo scenarios need anything beyond what exists today.

### Driver only
No change from today: dashboard generates a per-shift duty-card URL,
driver opens it, done. Any future non-Announce feature hangs off this
install the same way. No Announce device involved at all.

### Announce Lite (paired install)
1. Ops creates the vehicle in the dashboard (existing Vehicles slice).
2. Dashboard generates a one-time, vehicle-scoped signed link for the
   Announce tablet — same shape as the duty-card JWT, but persistent and
   device-scoped rather than per-shift-per-driver. Installer opens it once
   in the kiosk browser; it registers the device against
   `company_id`+`vehicle_id` in a new `announce_devices` table, and the
   kiosk retains that identity locally from then on (no re-scan needed).
3. Announce boots straight into self-contained `internal` mode — it's
   already a complete, working **Solo** install at this point, before any
   linking happens (see below).
4. Driver installs separately, unrelated step.
5. **Linking is optional and happens later**, from the Driver PWA: pick
   the Announce device registered to the same vehicle, tap link. This
   flips that device's GPS source to `driver-device`, delivered over
   Supabase Realtime (no local link between the two tablets — consistent
   with Lite's existing "no local link" design; only the payload changes),
   and promotes the device from Solo to Lite. Unlinking drops it back to
   `internal` mode — i.e. back to Solo — reversible in either direction at
   any time, not a one-way install-time choice.

### Announce Solo
Device registration is identical to step 2 above — same one-time signed
link, same `announce_devices` row. It stays permanently in `internal`
mode (Solo) since there's no Driver device to ever link to.

**Every other flow relies on a driver manually picking a duty** to
establish "which scheduled service is running right now." Solo has no
driver to do that, so it needs its own way to decide when to start
tracking.

#### Solo's schedule-autopilot: geofence + time matching (designed for Phil Haines Travel)

Phil Haines Travel only needs Announce Solo on two routes, one
journey each way, and — critically — **neither route shares a start or
end point with any other service**. That non-overlap is what makes a
lightweight matching approach safe, instead of needing full schedule
reasoning:

1. **Commissioning**: one URL param only — `?announce-device-token=`,
   captured once and persisted to `localStorage`, mirroring
   `announceLink.js`'s existing `captureAnnounceSetup()`/`connect()`
   pattern exactly (new sibling module, not a new pattern). The candidate
   departure list is **not** URL-encoded — checked both existing
   commissioning patterns first (`?panel-profile=` is stateless, re-read
   every load; `?announce-setup=`/`?announce-token=` is captured once)
   and neither has precedent for carrying multi-value structured data
   (a JWT plus up to 4 departure IDs) in a URL. Instead
   `candidate_departure_ids` lives on the device's own `announce_devices`
   row (added above) and is fetched via the existing `device_self` anon
   RLS policy — no new policy needed, just read the extra column. This
   also means candidate routes are editable from the dashboard at any
   time without re-touching the physical kiosk, and unifies commissioning
   across both Lite and Solo: which tier a device is in
   falls out of `gps_source`/`link_state`/whether
   `candidate_departure_ids` is populated, not a separate flow per mode.
   Departures are cached client-side via the existing offline-first
   pattern (`preloadAllRoutes()`/`localStore.js`) — no new caching
   mechanism — each carrying its first stop's lat/lon and scheduled
   `departure_time`.
2. **Idle loop**: while no journey is active, the tablet watches its own
   GPS and, for each cached candidate, checks two conditions together:
   - **Geofence** — is the vehicle within `terminus_radius_m` (new
     tunable column, default 150m) of that candidate's *first* stop?
     **Not** `geofence.js`'s existing `GEOFENCE_RADIUS_M` (50m) — that
     constant is sized for street-level stop arrival; a route terminus or
     depot forecourt is plausibly wider than 50m across, and 150m sits
     between it and the file's existing wider-band precedent,
     `APPROACH_FALLBACK_RADIUS_M` (300m, used for a different purpose —
     approach detection). No real timetable/site data exists yet for
     Phil Haines Travel's two routes to validate this number against
     (`supabase/seed.sql` is reference-data-only; operational data is
     "created via the dashboard after setup") — treat 150m as a starting
     default to tune once the real install exists, not a measured value.
   - **Time** — is now within a window around that candidate's scheduled
     `departure_time`: `match_window_before_min`/`match_window_after_min`
     (new tunable columns, default 15/30). Same caveat — starting
     defaults pending real data, not measured. Making both the radius and
     the window per-device dashboard-editable columns (rather than
     hardcoded constants) means they can be tuned after the fact without
     a code deploy, which matters given neither can be validated yet.

   Both signals matter together, not geofence alone: if a route's
   outbound and return share a terminus (there-and-back from one depot
   stop), geofence can't tell the two directions apart — time is what
   disambiguates which of the candidates parked at that same point is
   actually due. Geofence is what makes cross-route confusion impossible
   in the first place, since no other service touches these stops.
3. **Match found** → the exact same calls `manualSelection.js` already
   makes: `get_or_create_manual_journey` → `start_journey`, then normal
   `gps.js`/`engine.js`/`geofence.js` tracking takes over unchanged. No
   new tracking logic, no new schema — this reuses the entire existing
   engine, only the trigger changes from a driver's tap to an automatic
   match.
4. **No match** → stay on the idle screen. Nothing is created or
   mutated, so a near-miss costs nothing.
5. **Completion**: final-stop geofence arrival (existing `isFinal`
   logic), plus a wall-clock timeout past the window as a safety net —
   there's no driver to notice a journey stuck `in_progress`.

**Hard precondition — document this as a guardrail, not an assumption:**
this approach is only safe when the commissioned routes' start/end points
don't overlap with any other service's stops. A future Solo client
whose routes share a terminus with other services needs the fuller
schedule-reasoning approach that was previously scoped here as "unscoped
work" — that general case remains genuinely unsolved. Don't reuse this
shortcut for a client where the precondition doesn't hold.

**Diversion alerts on Announce Solo are auto-detected, not
driver-triggered.** `diversionAlert.js`'s button-press flow still only
exists on the Driver device (base Announce tier, Lite) — Solo has no
driver to press it. Instead, `announceStandaloneAutopilot.js` treats
`shared/geofence.js`'s existing `skipped_detour` classification (more than
one timing-point stop bypassed before rejoining) as "strayed significantly
from the planned route" and fires the same DIVERSION display state
(`shared/announceStates.js`) itself — one-shot per occurrence (there's no
driver to explicitly clear it the way the button-triggered path works), and
spoken locally via `announceSpeech.js`'s speechSynthesis (the one audio path
this tier has — see the PA announcement audio gap below). No ops-pushed
diversion flag from the dashboard exists or is needed for this.

**Idle-screen UI.** `onboard.js` already has a real idle scaffold, not a
blank body — `#onboard-idle` (topbar/main/bottom, same grid shape as the
active sign), shown today only via `?operator-name=`, logo-only, wired to
no data source. Its file-header comment states the device has "no
independent reads" by design — true for the base Announce tier and Lite,
but Solo's entire premise is breaking that (its own GPS + a cached
candidate list), so this is a scoped, intentional exception, not a
violation of that note. Extend `#onboard-idle` (reuse its accent-bar
pattern and `positionBrand()`) to show the next candidate departure's
scheduled time, computed client-side from the already-cached list — no
network call needed. This next-departure content applies **only to Solo's
autopilot mode** — Lite and the base tier keep today's
logo-only idle screen unchanged, since a not-yet-linked Driver has no
future schedule to show anyway.

**Entitlement gating — explicitly deferred, not built now.** Checked and
confirmed nothing like a per-company plan/tier/feature-entitlement concept
exists anywhere in this codebase today: no such column on `companies`, no
feature-flag table, no gating utility in `pcv-dashboard/src/shared/`. Even
`CoachMate` (the other reserved product-module placeholder) has zero
gating logic — it's an empty folder. Building a general entitlement
system is out of scope here; it's the same "genuinely separate SKU or
upsell funnel" business decision already sitting in the open items below,
not a coding prerequisite. For now, ship the new dashboard UI (device-link
page, Solo commissioning) visible to every company — harmless
no-op for companies with no `announce_devices` rows, same as
`VehiclesPage.jsx` being visible regardless of fleet size. Recorded here
explicitly so it doesn't quietly get forgotten once a second Lite/Solo
client shows up.

**New engineering surface this implies:**
- Dashboard: a device-link-generation flow (mirrors duty-card generation)
- Driver PWA: a link/unlink action (see "Link-picker UX" in the technical
  addendum below) — needed for the paired scenario, not this one
- Announce app: a new idle-loop matcher module (geofence + time check
  against the cached candidate list, described above) plus the extended
  idle-screen UI — no new database table required for either piece,
  just the extra `announce_devices` columns added above

## Technical addendum: Announce Lite implementation contract

The provisioning/linking section above is architecture-level. This section
pins down the exact schema, JWT, message contract, and file placement so a
coding agent can implement the Lite (paired) scenario against this
repo's actual conventions instead of inventing its own. Grounded directly
in the existing duty-card JWT (`generate_duty_token()` in
`supabase/schema.sql`) and Driver→Announce push contract
(`busops/driver/src/announceLink.js`) — not a fresh design. The
`announce_devices` table below is shared by both Lite and Solo (Solo's
commissioning columns are simply unused/empty on a Lite/paired-mode
device); the JWT and Realtime sections are Lite-specific —
Solo's own commissioning and matching design lives in the
"Schedule-autopilot" section above, not here.

### `announce_devices` table

New `supabase/migration_announce_devices.sql` (also added to
`schema.sql`), matching the existing `vehicles`/`employees`
company-scoped pattern:

```sql
create table public.announce_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete set null,
  label text,
  link_state text not null default 'unlinked'
    check (link_state in ('unlinked','linked')),
  gps_source text not null default 'internal'
    check (gps_source in ('internal','driver-device')),
  -- Linked-mode push state (§ Linked-mode Realtime contract below) — no
  -- separate state table, this row IS the push target.
  latest_schedule jsonb,
  latest_state jsonb,
  state_updated_at timestamptz,
  -- Solo-mode commissioning (§ Schedule-autopilot) — null/empty for
  -- Lite/paired-mode devices, populated for Solo ones.
  candidate_departure_ids uuid[] not null default '{}',
  match_window_before_min int not null default 15,
  match_window_after_min int not null default 30,
  terminus_radius_m int not null default 150,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

grant select on public.announce_devices to anon;
grant all    on public.announce_devices to authenticated;

alter table public.announce_devices enable row level security;

create policy "company_all" on public.announce_devices
  for all to authenticated
  using      (company_id = current_company_id())
  with check (company_id = current_company_id());

create policy "device_self" on public.announce_devices
  for select to anon
  using (id = (auth.jwt() ->> 'device_id')::uuid);
```

`device_self` reads a raw JWT claim rather than calling a helper function,
so — per this repo's SQL ordering rule — it can stay inline with the
table instead of being deferred to the bottom RLS block.

### Device-link JWT

A new `generate_announce_device_token(p_device_id uuid, p_company_id uuid,
p_vehicle_id uuid)` function in `schema.sql`, structurally mirroring
`generate_duty_token()`: `security definer`, signs with `pgcrypto`'s
`hmac()`, same secret via `current_setting('app.settings.jwt_secret',
true)`. Claims:

```json
{ "iss": "supabase", "role": "anon", "device_id": "...", "company_id": "...", "vehicle_id": "...", "iat": 0 }
```

**A 100-year `exp` claim, not no `exp`** — unlike the duty-card's 24h
shift-scoped token, this identifies a fixed kiosk installation and must not
expire and blank the passenger sign daily. The original design here chose
literally no `exp` claim at all (this section's own first draft flagged "or
a very long one" as the alternative, but the shipped code took the "no exp"
branch) — **confirmed broken live, 2026-08-28**: Supabase Realtime's
`setAuth()` hard-rejects any token missing `exp` with `CHANNEL_ERROR
"InvalidJWTToken: Fields \`role\` and \`exp\` are required in JWT"`. This
silently broke every paired-mode Realtime subscription while plain REST
reads (the initial `announce_devices` row fetch) kept working fine, since
PostgREST doesn't require `exp` — which is exactly why this took a full
testing session to pin down: the device could always read its own row once
on load, it just never received a live update afterwards. Fixed by moving
to a 100-year expiry (`api/sign-announce-token.js` /
`vite.config.js`'s `localSignAnnounceTokenApi`) — satisfies Realtime's
requirement without ever practically expiring in this device's operational
lifetime.

*Before implementing:* confirm whether the dashboard actually mints
duty-card tokens via direct `supabase.rpc('generate_duty_token', ...)` or
via `pcv-dashboard/api/sign-token.js` — both exist in the codebase and
which one `DutyCardsPage.jsx` really calls wasn't pinned down. Mirror
whichever is the live path, not both.

### Linked-mode Realtime contract

**Correction:** an earlier draft of this section specified a Supabase
Realtime *Broadcast* channel. Checked against the only Realtime usage that
actually exists in this codebase — `pcv-dashboard/src/features/tracking/
LiveTracking.jsx` — and it uses **Postgres Changes**
(`supabase.channel(...).on('postgres_changes', {event, schema, table}, cb)`)
subscribed to row writes on `journeys`/`journey_events`, not Broadcast.
There's no Broadcast precedent anywhere in this repo, so linked mode should
follow the pattern that already exists:

- Driver writes state via a new `security definer` RPC —
  `update_announce_device_state(p_device_id uuid, p_schedule jsonb,
  p_state jsonb)`, `grant execute to anon` — into `announce_devices`'
  `latest_schedule`/`latest_state`/`state_updated_at` columns (added
  above; no separate state table). This matches how `start_journey`/
  `complete_journey`/`get_or_create_manual_journey` already handle anon
  writes: validated inside the function, not via an RLS+JWT-claim check.
  That matters concretely here — manual-selection-flow driver devices
  often run under the bare anon key with **no JWT claims at all**
  (`supabaseApi.js`'s `driverToken()` falls back to the plain
  `SUPABASE_KEY` when there's no `?token=` present), so an RLS policy
  requiring a JWT `vehicle_id`/`company_id` match would silently break
  that path.
- Announce subscribes:
  ```js
  supabase.channel('announce-device')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public',
        table: 'announce_devices', filter: `id=eq.${deviceId}` }, cb)
    .subscribe()
  ```
- The JSON **shapes inside** `latest_schedule`/`latest_state` are still
  exactly `announceLink.js`'s `buildSchedulePayload`/`buildStatePayload`
  fields, unchanged from the original design — only the transport
  changed, not the message contract. No `announce` (PSVAIR audio cue)
  event: the base Announce tier's relay already never forwards that to the
  sign today, matching Lite's own "no PA from Announce" limitation in the
  tier-comparison table below — this carries an existing limitation
  forward rather than opening a new gap.

### Link-picker UX (Driver PWA → Announce device)

"Pick the Announce device registered to the same vehicle" (provisioning
step 5 above) needs a concrete `vehicle_id` to filter
`announce_devices` by, and the Driver PWA has two different sources for
one depending on which flow started the journey: prefer the active
journey's `journeys.vehicle_id` (duty-card flow); fall back to
`vehicleSetup.js`'s locally-commissioned vehicle (manual-selection flow)
— the same conditional already threaded through `manualSelection.js`'s
`selectServiceManually(..., vehicleId, ...)`. UI-wise, add a small "Link
Announce device" action near the existing vehicle-commissioning prompt
(the "WHICH VEHICLE IS THIS?" flow `cab-device/setup-cab-device.sh`
references), listing matching `announce_devices` rows. This is a
reasonable first design, not a pixel-verified one — exact placement in
`ui.js` needs a look once building starts.

### File placement

- **Dashboard**: a flat page in the `vehicles` slice (the device is
  vehicle-scoped), e.g.
  `pcv-dashboard/src/features/vehicles/AnnounceDeviceLinkPage.jsx`,
  following `VehiclesPage.jsx`'s existing pattern of direct Supabase calls
  (no `api/*.js` round-trip needed unless the JWT step requires it — see
  above).
- **Driver PWA**: new module
  `pcv-dashboard/busops/driver/src/announceDeviceLink.js` — **explicitly
  not** `announceLink.js`, which already exists and stays base-tier-only
  (Controller push). Supabase calls go in the existing centralized
  `supabaseApi.js`, wired into `main.js` alongside the other module
  imports.
- **Announce app**: relocate `gps.js`, `geofence.js`, `engine.js` from
  `driver/src/` to `pcv-dashboard/busops/shared/` (already the folder for
  code genuinely shared between `driver/` and `announce/`), so both
  surfaces import the same files instead of `announce/` reaching into
  `driver/src/` or duplicating logic — update `driver/src/`'s imports
  accordingly. Add a new `announce/src/announceGps.js` (or similar) for
  Lite's `internal`-mode polling loop. This ends `onboard.js`'s
  zero-local-imports property (true today) — an intentional, known
  change for Lite, not a regression.

## Tier comparison

| Aspect | Announce | Announce Lite | Announce Solo |
|---|---|---|---|
| Flow | Driver → Controller → Announce | Driver → Announce | Announce only |
| Hardware per vehicle | 1 driver tablet + Bus Controller + fixed panel | 2 GPS+cellular tablets (driver + announce) | 1 GPS+cellular tablet (announce only) |
| GPS/tracking compute | Driver tablet only (single source) | Each tablet independently, off shared Supabase state — not duplicated *logic*, but duplicated *computation* | Announce tablet only |
| Driver↔Announce link | Local WebSocket (`/driver-push`), push, ~instant | None — both poll Supabase independently | N/A — no Driver device |
| What starts a journey | Driver picks a duty/service | Driver picks a duty/service (on the Driver device; Announce follows via Realtime) | Automatic — Solo's geofence+time schedule-autopilot (see above) |
| Diversion alert latency / trigger | Near-instant (pushed), driver-triggered button | Bound by Announce's poll interval, driver-triggered button | Auto-detected off `skipped_detour`, no button — see above |
| PA announcement audio | Plays from the Controller (moved there 2026-08-19 specifically to escape browser-tab throttling/battery variance on the driver device) | No Controller to host it — falls back to the driver tablet's AUX-cable path, the interim hack the base tier moved *away* from | Same as Lite — the Announce tablet's own AUX/speechSynthesis path |
| Ticketing / APC upgrade path | Yes, via Controller GPIO/serial (§11) — not built yet, but architecturally possible | No — adding these means adding a Controller, i.e. moving to the base Announce tier, not extending Lite | No — same as Lite |
| Install | Ceiling-void Controller + panel mount, vehicle wiring (§9) | Two tablet mounts, no fixed wiring — genuinely closer to a StarPAL-style install | One tablet mount, no fixed wiring |
| Compliance requirements | PSV(AI)R Appendix A, `HARDWARE.md` §6 | Identical — not relaxed for Lite | Identical — not relaxed for Solo |
| Cost | Not yet fully priced | Not yet fully priced — **do not assume Lite is cheaper** until both are actually quoted; two rugged GPS+cellular tablets may cost more than one tablet + Controller + a sourced display panel | Not yet fully priced — one tablet, so likely the true low-cost entry point, but unconfirmed |

## Open items / next steps

**Status check, 2026-08-27: most of this list was actually built the same
day it was written (see the "Done" note in the Lite section above) — this
list undersold what existed for a while and was corrected once that was
caught. Re-verify against the actual code before trusting any "not built"
claim in this file again; the items below are what's genuinely still
open, confirmed against the code directly, not carried over from an
earlier draft.**

- Price all three tiers properly (component cost, not guesswork) before
  presenting any as the "budget" option to a client. **Still open.**
- ~~Decide product naming — suggest `BusOps Announce — Standard` /
  `BusOps Announce — Lite`~~ — **Resolved 2026-09-01**: `BusOps Announce`
  / `BusOps Announce Lite` / `BusOps Announce Solo`, consistent with the
  existing BusOps Driver / BusOps Announce naming in `CLAUDE.md`. Docs in
  this file updated to match; `docs/DECISIONS.md` still needs its naming
  row added/updated, and no code identifiers were renamed (module/table
  names still say "Lite"/"standalone" — see the note in the "Done,
  2026-08-27" callout above).
- **Driver PWA "Link Announce device" UI** — `announceDeviceLinkApi.js`
  exists and is imported into `main.js`, but there's no picker action to
  actually trigger a link yet; linking today is a manual
  `select link_announce_device(...)` SQL call (`docs/TESTING.md` §17).
  This is the one piece of the Lite (paired) scenario still missing a UI.
- **Dashboard UI for Solo commissioning** — `AnnounceDeviceLinkPage.jsx`
  covers device registration, install-link generation, and a testing-mode
  toggle, but there's no UI yet for setting a Solo device's
  `candidate_departure_ids`/`match_window_before_min`/
  `match_window_after_min`/`terminus_radius_m` — SQL only for now
  (`docs/TESTING.md` §17).
- The general Solo case (routes that *do* share stops with
  other services) still has no schedule-autopilot design — remains
  genuinely unscoped, distinct from the Phil Haines Travel shortcut above.
  **Still open** — the shipped matcher only covers the non-overlapping
  case.
- ~~Diversion alerts are accepted as out of scope for standalone
  Announce~~ — superseded: Solo now auto-detects a diversion off
  `skipped_detour` and announces it itself, see the auto-detect section
  above. **Resolved.**
- Confirm with the team whether Lite/Solo are being positioned as
  genuinely separate SKUs or as an entry-tier upsell funnel into the base
  Announce tier — affects how they're marketed, not the technical plan
  above. **Still open.**
- Tune `terminus_radius_m`/`match_window_before_min`/
  `match_window_after_min`'s defaults (150m / 15 / 30) against Phil
  Haines Travel's real timetable and site geography once that data
  exists — currently starting defaults, not measured values. **Still open.**

**Done, not open any more** (kept here briefly so this list doesn't read
as if these were never tracked): the `announce_devices` table/RPCs, the
device JWT, the dashboard device-link/registration page, the geofence+time
matcher and its `internal`/`driver-device` GPS-source adapter, and both
the Jest suite (`tests/scheduleAutopilot.test.js`,
`tests/scheduleTimeShift.test.js`) and the manual test flow
(`docs/TESTING.md` §17) for it — see the "Done" note in the Lite section
above for the full list and what's still missing around it.
