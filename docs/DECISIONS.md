# Project decisions — what's actually settled

This repo has genuinely flip-flopped on several things, and — worth saying openly — the
first version of this exact page got it wrong for that same reason: it was written from a
branch cut off `master`, which is regularly dozens of commits behind `develop` (CLAUDE.md
already warns about this under "Release / versioning"). Onboard-hardware and architecture
decisions logged on `develop` in the days before that draft simply weren't visible from
`master`, so the draft stated several things as current that had already been superseded.

**Rule for anyone updating this page: always check the current state on `origin/develop`,
never `master`.** `master` only reflects the last release cut, not current decisions.

Two rules for using this page day-to-day:

1. **An item under "Decided" is not up for silent re-litigation.** If you think it's wrong,
   say so and change this doc (and its source) — don't just quietly build against a
   different assumption.
2. **An item under "Still open" is open — don't invent an answer and present it as settled.**
   Flag it, or ask, instead of guessing.

Detailed rationale lives in the source docs linked from each row. This page only exists to
give the one-line current answer; it does not replace those docs and should not duplicate
their detail.

---

## Product / branding

| Question | Decided | Source |
|---|---|---|
| Company / product hierarchy | **PCV Technologies** (company, `pcvtechnologies.co.uk`) → **PCV Dashboard** (mandatory umbrella product every customer gets) → **BusOps** (first product module: BusOps Driver PWA + BusOps Announce onboard sign). **CoachMate is now a reserved, empty placeholder for a future module** — it is *not* the product family name any more. Decided 2026-08-21. | `docs/BRAND.md`, `CLAUDE.md` Project overview |
| Repo layout | Restructured 2026-08-21/23 to mirror the hierarchy above: `dashboard/` → `pcv-dashboard/`; driver PWA → `pcv-dashboard/busops/driver/`; onboard sign → `pcv-dashboard/busops/announce/`; Controller-side app → `pcv-dashboard/busops/announce/mele-server/` (was `pi-server/`). Don't reference the old paths. | `CLAUDE.md` "Repo layout" |
| Visual identity | **PCV Cyan** `#00B4D8` / **PCV Charcoal** `#242F35`, **Plus Jakarta Sans** — reused directly from the prior CoachMate look, no new colours invented for the company tier | `docs/BRAND.md` |
| Logo | **Not yet designed.** Current app icons are a plain generated placeholder ("CM" on PCV Charcoal) — don't treat it as a final asset, and don't let a real operator's logo ship in shared source code again (that's exactly what the old Phil Haines Coaches icon was, removed 2026-08-21). | `docs/BRAND.md`, `docs/TODO.md` "Brand — placeholder app icon" |
| Attribution strapline | **"From PCV Technologies"**, applied on all three product brand marks (driver PWA, onboard sign, dashboard) | `docs/BRAND.md` |
| Onboard sign brand mark layout | **Two-line layout**, "BusOps" naming kept (a one-line variant was tried and reverted) | commit `c05ffff` |
| Branding data cleanup (bucket mismatch, orphaned files, `system-assets`) | **Partially done, not finished.** The hardcoded-operator-name item is done (2026-08-23). The **logo bucket mismatch is a live bug**: `BrandingPage.jsx` writes logos to `operator-assets`, but `Layout.jsx`/`CompanyModal.jsx` still read from the legacy `company-logos` bucket — same DB column, different bucket, so uploads via one path 404 in the other. Not yet fixed. | `docs/branding-consolidation-plan.md` |
| Which branding doc is current | **`docs/branding-consolidation-plan.md`** — it supersedes `docs/coachmate-branding-summary.md` (the plan's own step 7 says to delete/fold the summary once the plan ships, which hasn't happened yet, so both docs still exist — prefer the plan). | `docs/branding-consolidation-plan.md` |

## Driver PWA (BusOps Driver)

| Question | Decided | Source |
|---|---|---|
| Deploy target | **GitHub Pages today — still the live production target.** Cloudflare Workers (`driver.pcvtechnologies.co.uk`, config at `pcv-dashboard/busops/`) is the migration target. **The Cloudflare Workers Builds Git integration was never actually wired up** — despite an earlier version of this row claiming the pipeline was "confirmed working on `develop`" (2026-08-24), every deployment in the Worker's history through 2026-08-27 was a manual local `wrangler deploy`, and the custom domain had drifted two days and a full version behind. **Fixed 2026-08-27**: replaced with a `deploy-driver-pwa` job in `.github/workflows/ci.yml` that runs `wrangler deploy` on every push to `develop`, gated on the existing test/lint/build jobs (which now include the previously-ungated Vitest suite too). GitHub Pages remains the production source of truth until someone explicitly switches it. | `CLAUDE.md` Project overview, `.github/workflows/ci.yml` |
| OSRM/directions source of truth | **Always scheduled stop coordinates, never live GPS position** | `CLAUDE.md` Architecture |
| Login / driver identity on device | **No login, ever** (standing project convention) | `docs/TODO.md` "Manual-selection flow" |
| Manually-started journey → `vehicle_id` | **Decided and shipped 2026-08-14** — one-time device prompt, sourced from Supabase, filtered to `'Local Bus'`-tagged vehicles | `docs/TODO.md` |
| Manually-started journey → `driver_id` | **Still open.** No login exists on the device, so this needs an ops-side mechanism, not a device prompt. `docs/DRIVER_DUTIES.md` is a related but separate planned compliance subsystem (rules-aware roster allocation) — it does not fix this specific gap on its own. | `docs/TODO.md` "Manual-selection flow" |
| Cab-device bridge (what's physically in cabs *today*) | **Any Android phone/tablet**, driver PWA via "Add to Home Screen" + Screen Pinning. **A SIM card is now required as of 2026-08-19** (cellular data, more reliable than depot/vehicle WiFi) — supersedes the earlier "no LTE requirement." Must be confirmed working before Kiosk Mode locks the device. | `CAB-DEVICE-SETUP.md`, `docs/HARDWARE.md` §4 |
| Offline resilience | **Shipped, in three parts.** (1) 2026-08-23: route/schedule data (`fetchAvailableServices`/`fetchStopsForDeparture`) falls back to a `localStorage` cache (`localStore.js`) warmed while online, instead of a static `schedule.json` file — that file is no longer read by the PWA at runtime. (2) 2026-08-23: failed stop-time/`complete_journey` calls at end of trip are queued locally and auto-retried on reconnect. (3) 2026-08-25: a manual journey **start** attempted offline is no longer blocked either — the journey ID is always generated client-side and a failed start is queued (`enqueuePendingJourneyStart`) for retry. **No UI indicator yet** for a driver/ops to see any of these queues — still open. | `CLAUDE.md` "Driver PWA data flow", `docs/TODO.md` "Offline resilience" |

## Onboard passenger sign (BusOps Announce) — architecture

**This was "still open" in an earlier version of this page. It's resolved — decided
2026-08-14. It used to be written up in a separate `docs/CONTROLLER-REDESIGN.md`; that file
has now been folded into `docs/HARDWARE.md` §1–§5 (2026-08-24), so `HARDWARE.md` is the single
place to read this, not two documents:**

- **Model 2 is the confirmed target: the driver tablet owns GPS and all Supabase
  reads/writes; the Bus Controller is a push-only renderer with no GPS, no independent
  Supabase polling, and no WAN connectivity of any kind.**
- **Model 1 (the Controller having its own GPS module and independently polling Supabase) is
  dead — not a fallback, not an open option.**
- **Depot WiFi sync is dropped as a concept entirely.** The Controller never talks to
  Supabase directly. The driver PWA is now the sole sync path for schedule/duty data as well
  as live state, relayed down to the Controller over the same local WebSocket link it already
  opens for tracking state (`/driver-push`). `mele-server/sync-schedule.mjs` and its boot-time
  sync job are candidates for removal.
- **Networking simplifies to one onboard WiFi radio, AP-only.** No second-radio dongle, no
  AP+STA concurrent mode, no depot-client role on that radio at all.
- **No load-bearing USB peripherals on the Controller, ever** — vibration risk in a moving
  vehicle. Anything the box depends on must be onboard/internal or wireless. **This conflicts
  with an older assumption** that future ticketing/APC hardware would use USB/serial — flagged
  as an open tension in `docs/HARDWARE.md` §11, not resolved.

`docs/HARDWARE.md`'s "Read this first" section states this resolution directly now — its old
"two competing architectures, unresolved" framing is gone, not just superseded in a second
document.

| Question | Decided | Source |
|---|---|---|
| Who hosts the local WiFi hotspot | **The Controller hosts the AP; the driver device joins as a client.** A competing "driver hosts, Controller joins" plan was rejected (MDM/Device-Owner and WiFi-Direct-fragility risk). | `docs/HARDWARE.md` "Read this first" |
| Where announcement audio plays | **Decided: moves to the Controller** — matches the visual/audio passenger-facing split, and the driver tablet is a worse home for unattended continuous PA audio. **Deviation, decided 2026-08-19**: the driver PWA does **not** stop playing locally yet — only one physical Controller exists so far, and a hard cutover would silence PSVAIR audio on every other vehicle. Drop local playback only once Controller hardware is deployed fleet-wide. | `docs/HARDWARE.md` §4, `docs/TODO.md` "Controller audio" |
| Onboard idle-screen branding | **Decided**: show the operator's logo + name as text before a journey starts (currently a blank/generic screen). No PSVAIR/accessibility statement text — checked against the actual regulation and there's no requirement for pre-journey display content. Commissioned once via URL params at setup time (no live fetch — the Controller has no WAN path). | `docs/HARDWARE.md` §5, `mele-server/DEPLOY.md` "Idle screen branding" |
| `wifi-direct-poc/` (Android WiFi-Direct bench app) | **Exploratory only** — not part of any product surface, not deployed | `CLAUDE.md` Project overview |

## Onboard passenger sign — hardware

Full detail: `docs/HARDWARE.md` — one file now, covering the Bus Controller board (§1), GPS
(§2), networking/software architecture (§3), audio (§4), idle-screen branding (§5), the
passenger display (§6), and everything downstream of those (cab device, driver tablet, power,
mounting, cabling).

| Question | Decided | Source |
|---|---|---|
| Bus Controller board | **MeLE Quieter4C** (x86, fanless, Intel N150, 8GB RAM/128GB storage, No OS — Ubuntu/Debian installed directly). **Replaces the Raspberry Pi CM5 pick outright** (cost/UK availability problem), not a fallback. One real unconfirmed risk: exact WiFi chipset AP-mode support under Linux `hostapd` — bench-test one unit before ordering a fleet's worth (this bench test is the one remaining open action item on the whole redesign — everything else is either decided or already implemented in code). | `docs/HARDWARE.md` §1 |
| Ruled-out Controller candidate | **MeLE Quieter3Q rejected** — its 3.5mm jack is combo mic-in/line-in only, no audio output, confirmed directly with the seller | `docs/HARDWARE.md` §1 |
| BETA passenger display | **Dell Pro P2426H** (no stand), purchased 2026-08-14, mains-powered via inverter for the demo build only | `docs/HARDWARE.md` §6 |
| Production passenger display | **Still open / unresolved sourcing gap.** No off-the-shelf 12V-native, vehicle-rugged, wiring-compatible panel has been found. | `docs/HARDWARE.md` §6 |
| Fire HD tablet as the passenger display | **Dropped/purged**, not just "not the confirmed pick" — `mele-server/DEPLOY.md` "Option A" no longer names a specific device. Do not cite Fire HD as live onboard-display hardware. | `docs/HARDWARE.md` §6 status trail, commit `6bc2f8f` |
| BETA ceiling mount | **RAM E-size VESA system** (corrected from an earlier, under-rated D-size pick) | `docs/HARDWARE.md` §8, `docs/TODO.md` |
| Driver PWA tablet — production target | **Blackview Active 5** (rugged, IP68/IP69K) — not affected by the Controller redesign | `docs/HARDWARE.md` §5 |
| 28"/large-format stretch-bar panel | **Dropped** — target fleet's existing wiring can't support it without a major rewire | `docs/HARDWARE.md` §3 |
| Power converter | **Victron Orion-Tr Isolated 24/12**, 24/12-20 (240W) tier — chosen for galvanic isolation | `docs/HARDWARE.md` §6 |

## Accessibility

| Question | Decided | Source |
|---|---|---|
| Standard scope | **`docs/ACCESSIBILITY_BRAND_PLAYBOOK.md` is company-level and mandatory** across all three surfaces, not an opt-in guideline for one product — WCAG 2.2 AA contrast, never audio-only, never colour-only, plain English. Its Definition of Done checklist is meant to gate new UI work the same way `npm test`/`npm run lint` do. | `CLAUDE.md` "Accessibility & branding" |
| Known contrast failures | **Not yet fixed** — logged, not resolved: driver PWA's `#app-brand` attribution text, `--cm-cyan` used as text/border on light surfaces, the `late` status colour. | `docs/TODO.md` "Accessibility & branding playbook — follow-ups" |

## Supabase / database

| Question | Decided | Source |
|---|---|---|
| New migration file naming | **Flat `supabase/migration_<description>.sql`** — the timestamped `supabase/migrations/` folder was an abandoned June 2026 attempt; don't add new files there. | `CLAUDE.md` Supabase section |
| Table without GRANT statements | **Not allowed** — invisible to supabase-js/PostgREST. Every `CREATE TABLE` needs GRANTs + RLS enabled + policies. | `CLAUDE.md` "Supabase: table creation rules" |
| `staff.name` field | **Single field**, never split first/last (table renamed to `employees`) | `CLAUDE.md` Domain conventions |
| Stop identifier column | **`atco_code`** (renamed from `naptan_code`) | `CLAUDE.md` Domain conventions |
| `stops` company scoping | **Global, no `company_id`** | `CLAUDE.md` Domain conventions |

## Git / release workflow

| Question | Decided | Source |
|---|---|---|
| Where development happens | **`develop`** — always start here, including for a new branch/session. `master` is production only, and is routinely dozens of commits behind — **never treat `master`'s state as current**. | `CLAUDE.md` Git / deploy workflow |
| Versioning | **One version number for the whole solution**, bumped via `scripts/release.mjs` on `develop` → `master` merge | `CLAUDE.md` Release / versioning |

---

## How to keep this from rotting

When a decision above changes: update the row here **and** its source doc in the same
change — this page is a pointer/summary, the source docs stay the detailed record. If you
resolve a "Still open" item, move it into that section's "Decided" table rather than deleting
the row, so the trail of what changed stays visible. And re-derive this page's content from
`origin/develop`, not from whatever branch you happened to start on — see the note at the top.
