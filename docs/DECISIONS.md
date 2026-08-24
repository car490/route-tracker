# Project decisions — what's actually settled

This repo has genuinely flip-flopped on several things (see the git history
on onboard hardware and networking, for example). That's not a documentation
failure by itself — most of those reversals are already tracked in detail
where they happened (`docs/HARDWARE.md` §11 in particular). What's been
missing is one place to check **before** re-opening a question: is this
actually decided, or still open?

This doc is that place. Two rules for using it:

1. **An item under "Decided" is not up for silent re-litigation.** If you
   think it's wrong, say so and change this doc (and its source) — don't
   just quietly build against a different assumption.
2. **An item under "Still open" is open — don't invent an answer and present
   it as settled.** Flag it, or ask, instead of guessing.

Detailed rationale lives in the source docs linked from each row. This page
only exists to give the one-line current answer; it does not replace those
docs and should not duplicate their detail.

---

## Product / branding

| Question | Decided | Source |
|---|---|---|
| Product family name | **CoachMate** — driver PWA is "BusOps Driver", onboard sign is "BusOps Announce" | `CLAUDE.md` Project overview |
| Onboard sign brand mark layout | **Two-line layout**, "BusOps" naming kept (a one-line variant was tried and reverted) | commit `c05ffff` |

## Driver PWA (BusOps Driver)

| Question | Decided | Source |
|---|---|---|
| Deploy target | **GitHub Pages today.** Cloudflare Workers (`driver.coachmate.uk`) is the migration target — config (`wrangler.jsonc`, `.assetsignore`) is in place but the cutover **has not happened yet**. Don't assume the Workers path is live. | `CLAUDE.md` Project overview |
| OSRM/directions source of truth | **Always scheduled stop coordinates, never live GPS position** — keeps route drawing stable under GPS drift | `CLAUDE.md` Architecture |
| Login / driver identity on device | **No login, ever** (passwordless, no login screens is a standing project convention) | `docs/TODO.md` "Manual-selection flow", `feedback_driver_auth` |
| How a manually-started journey gets `vehicle_id` | **Decided and shipped 2026-08-14** — one-time device prompt (`src/vehicleSetup.js`), sourced from Supabase, filtered to `'Local Bus'`-tagged vehicles | `docs/TODO.md` |
| How a manually-started journey gets `driver_id` | **Still open.** No login exists on the device, so this needs a different mechanism than the vehicle picker (e.g. an ops-side reconciliation screen). Not yet decided. | `docs/TODO.md` "Manual-selection flow" |
| Cab-device bridge (what's physically in cabs *today*) | **Decided and shipped**: any Android phone/tablet, driver PWA via "Add to Home Screen" + Screen Pinning, no dedicated hardware. Explicitly a ~6-month stopgap, not the production design. | `CAB-DEVICE-SETUP.md` |

## Onboard passenger sign (BusOps Announce) — architecture

**Still open — the single biggest unresolved decision in the repo.** Two
complete, incompatible system designs exist and nothing has picked one:

| | Model 1 — what's actually built | Model 2 — the formal proposal |
|---|---|---|
| Bus Controller (Pi) GPS | Has its own GPS module, read via `gpsd` | No GPS hardware — GPS lives entirely on the driver tablet, pushed to the Pi over WiFi |
| Passenger display data source | Independently polls Supabase | Receives pushed JSON state from the driver tablet; Pi is a renderer only |
| Driver device ↔ Pi link | None — driver PWA talks to Supabase directly | Driver tablet pushes structured progress events to the Pi over local WiFi |

**Do not silently pick one while doing other work on this system.** This
determines real procurement (does the Pi need a GPS module and a second WiFi
radio, or not?) and needs an explicit team decision, not an assumption.
Full detail: `docs/HARDWARE.md` "Read this first: two competing
architectures, unresolved".

One sub-question **is** resolved regardless of which model wins:

| Question | Decided | Source |
|---|---|---|
| Who hosts the local WiFi hotspot | **The Pi hosts the AP; the driver device joins as a client.** A competing "driver hosts, Pi joins" plan (revisited 2026-08-13) was rejected — the CM5 hardware is already procured for the Pi-hosts model, and the alternative carries MDM/Device-Owner or WiFi-Direct-fragility risk. | `docs/HARDWARE.md` §"Networking (§7) resolved 2026-08-13" |
| `wifi-direct-poc/` (Android WiFi-Direct bench app) | **Exploratory only** — not part of any product surface, not deployed, not wired into Driver or Announce. Superseded design, kept only as a hardware bench test. | `CLAUDE.md` Project overview, `docs/HARDWARE.md` §11 |

## Onboard passenger sign — hardware

Full detail and rationale: `docs/HARDWARE.md` (the source of truth for every
physical component — don't duplicate its detail here, only its bottom line).

| Question | Decided | Source |
|---|---|---|
| Bus Controller board | **Waveshare CM5 carrier + Raspberry Pi CM5108032 module** (wireless, 8GB/32GB eMMC) — ordered and confirmed 2026-08-13. Pi 5/4GB is now fallback-only. | `docs/HARDWARE.md` §1 |
| Storage | **No microSD, ever** (vibration/write-endurance/corruption risk). NVMe HAT + SSD. | `docs/HARDWARE.md` §1 |
| BETA passenger display | **Dell Pro P2426H** (no stand), purchased 2026-08-14, mains-powered via inverter for the demo build only | `docs/HARDWARE.md` §3 |
| Production passenger display | **Still open / unresolved sourcing gap.** No off-the-shelf 12V-native, vehicle-rugged, wiring-compatible panel has been found. Do not assume the Dell or the Fire HD is the production pick. | `docs/HARDWARE.md` §3 |
| BETA ceiling mount | **RAM E-size VESA system** (corrected 2026-08-14 from an earlier, under-rated D-size pick — D-size is rated below the panel's own weight) | `docs/HARDWARE.md` §8, `docs/TODO.md` |
| Driver PWA tablet — production target | **Blackview Active 5** (rugged, IP68/IP69K) — supersedes the earlier Samsung Galaxy Tab A9 LTE pick | `docs/HARDWARE.md` §5 |
| Fire HD 10 tablet as the passenger display | **Still a live, supported option** ("Option A" in `pi-server/DEPLOY.md`), but **not** the confirmed production pick and **not** what's physically in use for BETA today (that's the Dell, above). Don't cite "Fire HD tablet" as the settled onboard-display hardware — it isn't. | `docs/HARDWARE.md` §3 status trail |
| 28"/large-format stretch-bar panel | **Dropped** — the target fleet's existing wiring can't support it without a major rewire | `docs/HARDWARE.md` §3 |
| Power converter | **Victron Orion-Tr Isolated 24/12**, 24/12-20 (240W) tier recommended — chosen for galvanic isolation; two separate generic converters were explicitly rejected | `docs/HARDWARE.md` §6 |

## Supabase / database

| Question | Decided | Source |
|---|---|---|
| New migration file naming | **Flat `supabase/migration_<description>.sql`** at the top of `supabase/`. The timestamped `supabase/migrations/<timestamp>_<description>.sql` folder was a brief June 2026 attempt at the Supabase-CLI convention that was abandoned in practice — **don't add new files there** unless the team explicitly revives it. | `CLAUDE.md` Supabase section |
| Table without GRANT statements | **Not allowed** — invisible to supabase-js/PostgREST since 2026-05-30. Every `CREATE TABLE` needs GRANTs + RLS enabled + policies. | `CLAUDE.md` "Supabase: table creation rules" |
| `staff.name` field | **Single field**, never split into first/last name (table itself renamed to `employees`) | `CLAUDE.md` Domain conventions |
| Stop identifier column | **`atco_code`** (renamed from `naptan_code`) | `CLAUDE.md` Domain conventions, `migration_rename_stops_atco_code.sql` |
| `stops` company scoping | **Global, no `company_id`** — `stop_type` lives on `timetable_stops` instead | `CLAUDE.md` Domain conventions |

## Git / release workflow

| Question | Decided | Source |
|---|---|---|
| Where development happens | **`develop`** — always start here. `master` is production, merged from `develop` only when tested/approved. | `CLAUDE.md` Git / deploy workflow |
| Versioning | **One version number for the whole solution** (PWA + dashboard together), bumped via `scripts/release.mjs` on `develop` → `master` merge | `CLAUDE.md` Release / versioning |
| `master` vs `develop` sync state | **Not assumed in sync** — check `git log origin/master..origin/develop` before assuming what's live matches the working tree | `CLAUDE.md` Release / versioning |

---

## How to keep this from rotting

When a decision above changes: update the row here **and** its source doc in
the same change — this page is a pointer/summary, the source docs
(`docs/HARDWARE.md`, `CLAUDE.md`, migration files, etc.) stay the detailed
record. If you resolve one of the "Still open" items, move it into the
"Decided" table for its section rather than deleting the row, so the trail
of what changed stays visible.
