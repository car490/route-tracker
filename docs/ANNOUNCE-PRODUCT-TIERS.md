# BusOps Announce — Standard vs. Lite product tiers

Proposal to formalize two supported product tiers for the passenger-facing
onboard sign, instead of treating the tablet-based install some clients ask
for as a one-off deviation from `docs/HARDWARE.md`. Written up so it can be
read and acted on independently of the conversation that produced it.

## Context

`docs/HARDWARE.md` documents the confirmed production architecture (call it
**Standard** below): a Bus Controller (MeLE Quieter4C mini PC) driving a
fixed HDMI passenger panel, with the driver tablet owning GPS and pushing
derived state to the Controller over `/driver-push`. That architecture is
real, in progress, and partly purchased (BETA Controller, Dell panel, RAM
mounts).

Some clients — pointing at competitors like StarPAL, who sell an all-in-one
box that moves bus-to-bus with no fixed install — want something lighter:
just a tablet on a mount, no Controller, no fixed panel. Rather than treat
this as a fork away from the confirmed architecture, or a compromise that
waters down Standard, it should be a second named tier aimed at a different
customer: operators who want a fast, portable, StarPAL-equivalent install
and don't need the fuller compliance/PA/ticketing roadmap Standard is built
toward.

**This is not a compliance shortcut.** Every PSV(AI)R requirement in
`HARDWARE.md` §6 (≥51% seat visibility, 22mm text, wheelchair/priority seat
visibility) applies identically to both tiers. Lite changes the
architecture and install, not the regulatory bar.

## Standard tier

Full spec: `docs/HARDWARE.md` §1–§11. One-line summary: Bus Controller +
fixed passenger panel + driver tablet owning GPS, with PA audio, and future
headroom for ticketing/APC hardware that needs the Controller's GPIO/serial.

**Who it's for:** operators who want the full compliance/feature roadmap —
PA announcements played reliably from fixed hardware (not a phone's
background browser tab), and a path to ticketing/APC later without
replacing the install.

## Lite tier — Tablet ↔ Tablet, no Controller

No Bus Controller. The passenger display is itself a GPS+cellular-capable
tablet (same device class as the driver tablet, e.g. Blackview Active 5 or
equivalent), running the onboard sign UI directly.

**This reuses code that already exists rather than requiring new
engineering.** `HARDWARE.md`'s "Model 1" — the Controller-less design where
the passenger display independently polls Supabase and computes its own
progress from its own GPS — was marked *dead, not a fallback* when Standard
moved to the Controller-fed push model. It should be **un-deprecated and
promoted to Lite's first-class supported mode**, not left as unmaintained
history:

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
- **Action item for whoever picks this up:** confirm how much of the old
  independent-polling path is still intact in the codebase vs. how much
  was actively removed as part of the Controller-push migration, and treat
  restoring/maintaining it as real scoped work, not "just flip a flag."
  Add it to `docs/TESTING.md` as its own tested flow once it's live, so it
  doesn't silently bit-rot the way the WiFi hotspot flip-flopped once
  already in this repo's history (`HARDWARE.md` §12 decision history).

**GPS source should be a config knob, not a hardcoded assumption.** The
independent-polling design above assumes the Announce tablet always uses its
own on-device GPS. Worth building the reused `src/gps.js` engine to accept a
source adapter instead — `internal` (the tablet's own GPS, the default/only
mode Lite needs day one) vs. `driver-device` (consume GPS-derived state
pushed from the Driver device, closer to Standard's model but without a
Controller in between). Two situations make the second adapter worth having
even though nothing needs it yet: an Announce tablet with weak GPS/cellular
reception in a given vehicle, and any future variant that wants Lite's
cheaper two-tablet hardware with Standard's lower-latency push instead of
poll-interval-bound updates. This is scoped as an adapter interface inside
Lite's existing GPS engine, not a new device profile or operating mode —
Lite stays two independent devices either way; only where one tablet's GPS
signal comes from changes.

**Who it's for:** operators who want the StarPAL-equivalent pitch — light,
fast to install, movable between vehicles — and don't need PA/ticketing/APC
now or on a near-term roadmap.

## Provisioning & linking

How a vehicle actually gets set up, per purchase scenario. Only the two
Announce-Lite scenarios need anything beyond what exists today.

### Driver only
No change from today: dashboard generates a per-shift duty-card URL,
driver opens it, done. Any future non-Announce feature hangs off this
install the same way. No Announce device involved at all.

### Driver + Announce Lite (paired install)
1. Ops creates the vehicle in the dashboard (existing Vehicles slice).
2. Dashboard generates a one-time, vehicle-scoped signed link for the
   Announce tablet — same shape as the duty-card JWT, but persistent and
   device-scoped rather than per-shift-per-driver. Installer opens it once
   in the kiosk browser; it registers the device against
   `company_id`+`vehicle_id` in a new `announce_devices` table, and the
   kiosk retains that identity locally from then on (no re-scan needed).
3. Announce boots straight into self-contained `internal` mode — it's a
   complete, working product at this point, before any linking happens.
4. Driver installs separately, unrelated step.
5. **Linking is optional and happens later**, from the Driver PWA: pick
   the Announce device registered to the same vehicle, tap link. This
   flips that device's GPS source to `driver-device`, delivered over
   Supabase Realtime (no local link between the two tablets — consistent
   with Lite's existing "no local link" design; only the payload changes).
   Unlinking drops it back to `internal` — reversible in either direction
   at any time, not a one-way install-time choice.

### Announce Lite only, no Driver device
Device registration is identical to step 2 above — same one-time signed
link, same `announce_devices` row. It stays permanently in `internal`
mode since there's no Driver device to ever link to.

**Every other flow relies on a driver manually picking a duty** to
establish "which scheduled service is running right now." A driverless
Announce has no driver to do that, so it needs its own way to decide when
to start tracking.

#### Schedule-autopilot: geofence + time matching (designed for Phil Haines Travel)

Phil Haines Travel only needs standalone Announce on two routes, one
journey each way, and — critically — **neither route shares a start or
end point with any other service**. That non-overlap is what makes a
lightweight matching approach safe, instead of needing full schedule
reasoning:

1. **Commissioning**: the box is preloaded with its small, fixed set of
   candidate departures — 2 routes × 2 directions, up to 4
   `timetable_departure_id`s — cached via the existing offline-first
   pattern (`preloadAllRoutes()`/`localStore.js`), each carrying its
   first stop's lat/lon and scheduled `departure_time`. No new caching
   mechanism.
2. **Idle loop**: while no journey is active, the tablet watches its own
   GPS and, for each cached candidate, checks two conditions together:
   - **Geofence** — is the vehicle within the existing stop-radius
     (reusing `geofence.js`'s current constant, not a new one) of that
     candidate's *first* stop?
   - **Time** — is now within a window around that candidate's scheduled
     `departure_time` (generous enough for early running, e.g. −15/+30
     min)?

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
don't overlap with any other service's stops. A future standalone client
whose routes share a terminus with other services needs the fuller
schedule-reasoning approach that was previously scoped here as "unscoped
work" — that general case remains genuinely unsolved. Don't reuse this
shortcut for a client where the precondition doesn't hold.

**Diversion alerts are explicitly out of scope for standalone Announce.**
`diversionAlert.js` is driver-triggered; a driverless install has no one
to trigger it. Decided as an accepted limitation for now, not something
to silently work around — standalone Announce trades diversion-alert
capability for zero-interaction operation. Revisit only if a client
specifically needs it (would require ops pushing a diversion flag
centrally from the dashboard, which is real new scope, not free).

**New engineering surface this implies:**
- Dashboard: a device-link-generation flow (mirrors duty-card generation)
- Driver PWA: a link/unlink action, and a Supabase Realtime push channel
  for linked mode (distinct from Standard's local-WebSocket `/driver-push`)
  — needed for the paired scenario, not this one
- Announce app: a new idle-loop matcher module (geofence + time check
  against the cached candidate list, described above) — no new database
  schema required for this piece, unlike `announce_devices` above

## Technical addendum: paired-install implementation contract

The provisioning/linking section above is architecture-level. This section
pins down the exact schema, JWT, message contract, and file placement so a
coding agent can implement the paired-install scenario against this
repo's actual conventions instead of inventing its own. Grounded directly
in the existing duty-card JWT (`generate_duty_token()` in
`supabase/schema.sql`) and Driver→Announce push contract
(`busops/driver/src/announceLink.js`) — not a fresh design. Standalone
Announce (no Driver device) is deliberately **not** covered here; it's
still blocked on the schedule-autopilot problem noted above.

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

**Deliberately no `exp` claim** (or a very long one) — unlike the
duty-card's 24h shift-scoped token, this identifies a fixed kiosk
installation and must not expire and blank the passenger sign daily. This
is an intentional deviation from the duty-card pattern, stated explicitly
here so it doesn't read as an oversight later.

*Before implementing:* confirm whether the dashboard actually mints
duty-card tokens via direct `supabase.rpc('generate_duty_token', ...)` or
via `pcv-dashboard/api/sign-token.js` — both exist in the codebase and
which one `DutyCardsPage.jsx` really calls wasn't pinned down. Mirror
whichever is the live path, not both.

### Linked-mode Realtime contract

Reuse `announceLink.js`'s `buildSchedulePayload`/`buildStatePayload`
field shapes **verbatim** — do not redesign the message shape — delivered
over a Supabase Realtime broadcast channel named `announce-device:<device_id>`,
with broadcast events `schedule` and `state`. No `announce` (PSVAIR audio
cue) event: Standard's relay already never forwards that to the sign
today, which matches Lite's own "no PA from Announce" limitation in the
tier-comparison table below — this carries an existing limitation forward
rather than opening a new gap.

### File placement

- **Dashboard**: a flat page in the `vehicles` slice (the device is
  vehicle-scoped), e.g.
  `pcv-dashboard/src/features/vehicles/AnnounceDeviceLinkPage.jsx`,
  following `VehiclesPage.jsx`'s existing pattern of direct Supabase calls
  (no `api/*.js` round-trip needed unless the JWT step requires it — see
  above).
- **Driver PWA**: new module
  `pcv-dashboard/busops/driver/src/announceDeviceLink.js` — **explicitly
  not** `announceLink.js`, which already exists and stays Standard-only
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

| Aspect | Standard | Lite |
|---|---|---|
| Hardware per vehicle | 1 driver tablet + Bus Controller + fixed panel | 2 GPS+cellular tablets (driver + announce) |
| GPS/tracking compute | Driver tablet only (single source) | Each tablet independently, off shared Supabase state — not duplicated *logic*, but duplicated *computation* |
| Driver↔Announce link | Local WebSocket (`/driver-push`), push, ~instant | None — both poll Supabase independently |
| Diversion alert latency | Near-instant (pushed) | Bound by Announce's poll interval |
| PA announcement audio | Plays from the Controller (moved there 2026-08-19 specifically to escape browser-tab throttling/battery variance on the driver device) | No Controller to host it — falls back to the driver tablet's AUX-cable path, the interim hack Standard moved *away* from |
| Ticketing / APC upgrade path | Yes, via Controller GPIO/serial (§11) — not built yet, but architecturally possible | No — adding these means adding a Controller, i.e. moving to Standard, not extending Lite |
| Install | Ceiling-void Controller + panel mount, vehicle wiring (§9) | Two tablet mounts, no fixed wiring — genuinely closer to a StarPAL-style install |
| Compliance requirements | PSV(AI)R Appendix A, `HARDWARE.md` §6 | Identical — not relaxed for Lite |
| Cost | Not yet fully priced | Not yet fully priced — **do not assume Lite is cheaper** until both are actually quoted; two rugged GPS+cellular tablets may cost more than one tablet + Controller + a sourced display panel |

## Open items / next steps

- Price both tiers properly (component cost, not guesswork) before
  presenting either as the "budget" option to a client.
- Decide product naming — suggest `BusOps Announce — Standard` /
  `BusOps Announce — Lite`, consistent with the existing BusOps Driver /
  BusOps Announce naming in `CLAUDE.md`.
- Add a Lite row/flow to `docs/TESTING.md` once the independent-polling
  path is confirmed working, so it's a tested product, not a resurrected
  code path nobody exercises.
- When restoring the independent-polling path, build it behind a GPS source
  adapter (`internal` / `driver-device`) in `src/gps.js` rather than assuming
  `internal` is the only option forever — see the Lite section above.
- Design and build the `announce_devices` registration + link/unlink flow
  (dashboard device-link generation, Driver PWA link/unlink UI, Supabase
  Realtime push channel for linked mode) before Lite can actually ship the
  paired-install scenario described above.
- Build the geofence + time idle-loop matcher for standalone Announce
  (Phil Haines Travel's two-route case) — see "Schedule-autopilot" above.
  Its safety depends on the routes' start/end points not overlapping any
  other service's stops; verify that holds before commissioning it for
  any additional client, not just this one.
- The general standalone-Announce case (routes that *do* share stops with
  other services) still has no schedule-autopilot design — remains
  genuinely unscoped, distinct from the Phil Haines Travel shortcut above.
- Diversion alerts are accepted as out of scope for standalone Announce
  (no driver to trigger them) — revisit only if a client needs it; would
  require an ops-side dashboard control to push diversions centrally.
- Confirm with the team whether Lite is being positioned as a genuinely
  separate SKU or as an entry-tier upsell funnel into Standard — affects
  how it's marketed, not the technical plan above.
