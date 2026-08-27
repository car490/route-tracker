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

**Open problem, not yet solved:** every other flow relies on a driver
manually picking a duty to establish "which scheduled service is running
right now." A driverless Announce has no driver to do that. Solving this
needs schedule-autopilot logic — watching `schedule_view` for the
vehicle's assigned route and auto-selecting whichever duty's scheduled
time window matches now — which doesn't exist in the codebase today and
is real, unscoped work, not a side effect of device registration. Treat
"Announce Lite sold standalone" as blocked on this until it's designed.

**New engineering surface this implies (not built yet):**
- `announce_devices` table (device ↔ company/vehicle registration)
- Dashboard: a device-link-generation flow (mirrors duty-card generation)
- Driver PWA: a link/unlink action, and a Supabase Realtime push channel
  for linked mode (distinct from Standard's local-WebSocket `/driver-push`)
- Schedule-autopilot duty selection, required only for standalone Announce

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
- Schedule-autopilot duty selection is required before Announce Lite can
  be sold standalone (no Driver device) — currently unscoped, blocking
  that scenario specifically, not the paired-install one.
- Confirm with the team whether Lite is being positioned as a genuinely
  separate SKU or as an entry-tier upsell funnel into Standard — affects
  how it's marketed, not the technical plan above.
