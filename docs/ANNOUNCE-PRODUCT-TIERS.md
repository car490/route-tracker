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

**Who it's for:** operators who want the StarPAL-equivalent pitch — light,
fast to install, movable between vehicles — and don't need PA/ticketing/APC
now or on a near-term roadmap.

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
- Confirm with the team whether Lite is being positioned as a genuinely
  separate SKU or as an entry-tier upsell funnel into Standard — affects
  how it's marketed, not the technical plan above.
