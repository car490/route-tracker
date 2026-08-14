# Bus Controller redesign — 2026-08-14 session

Records a design conversation that revises several open questions in
`docs/HARDWARE.md` — this doc does not edit that file, it supersedes specific
sections of it (flagged inline below) until someone folds the two together.
Written so a coding agent picking this up later has the decisions, the
rationale, and the exact code touchpoints, not just conclusions.

**Status of everything below: agreed direction, not yet implemented.** No
code has changed as a result of this conversation. One item (§6, audio) is
a recommendation pending explicit confirmation, not a locked decision —
flagged separately below.

---

## 1. Why this doc exists

The Bus Controller's hardware pick (`docs/HARDWARE.md` §1 — Waveshare CM5
carrier baseplate + Raspberry Pi CM5108032 module, confirmed 2026-08-13) ran
into a real procurement problem one day later: CM5 modules are expensive and
effectively unavailable through UK supply channels right now. That started a
conversation about replacing the Pi with an x86 mini PC — which, once you
pull on the thread of "what does this box actually need to do," turned into
a broader redesign of what the Controller's job even is, not just what board
it runs on.

## 2. Decision: Bus Controller moves from Raspberry Pi CM5 to an x86 mini PC

Reason: CM5 board/module cost and UK availability. No specific SKU chosen
yet — see §8 below. This alone doesn't require any of the other changes in
this doc; the rest follow from working through what a mini PC changes about
the WiFi/networking story, which then cascaded into simplifying the whole
system.

## 3. Decision: drop "depot WiFi" as a concept entirely

**Old model** (`docs/HARDWARE.md` §7, `pi-server/DEPLOY.md`): the Controller
joins the depot's WiFi once each morning (`wlan0`, standard client mode) to
run `pi-server/sync-schedule.mjs`, which pulls the day's schedule down from
Supabase into a local `schedule-cache.json`. This is gated on the vehicle
being in range of a depot WiFi network that actually works.

**Problem surfaced this session**: the depot doesn't have decent WiFi. The
old model's one and only network dependency doesn't reliably exist.

**New model**: the Controller never talks to Supabase/CoachMate Core
directly, at all. The Driver PWA already does two things that make this
unnecessary:

- It already fetches schedule/duty data straight from Supabase over its own
  connection (`src/supabaseApi.js`), independent of any local network —
  production target device has its own cellular (`docs/HARDWARE.md` §5,
  Blackview Active 5, dual-SIM 4G LTE).
- It already opens a WebSocket to the Controller every journey
  (`src/announceLink.js` → `pi-server/announceRelay.mjs`'s `/driver-push`
  endpoint) to push live tracking state.

The fix is to make the Driver PWA the **sole** sync path to CoachMate Core,
for schedule/duty data as well as live state, and relay it down to the
Controller over the local link it already opens. Concretely:

- `pi-server/sync-schedule.mjs` and its once-a-day boot job
  (`coachmate-sync.service`) are no longer needed and become candidates for
  removal once this ships.
- The `/driver-push` protocol (currently `type: 'state'` only, see
  `buildStatePayload()` in `src/announceLink.js`) needs a new message type —
  e.g. `type: 'schedule'` — carrying the duty/timetable data the Controller
  needs, sent once when the Driver connects (or on schedule change).
  Receiving side: `pi-server/announceRelay.mjs`'s `driverWss` handler
  (currently only forwards `type: 'state'` to sign clients, see line ~52) and
  `pi-server/server.mjs`'s `serveApiSchedule()`, which currently reads
  `schedule-cache.json` written by the old sync job — that needs to become
  "whatever the Driver most recently pushed," held in memory or written to
  the same cache path so it survives a Controller restart mid-shift.
- **Freshness/fallback**: if the Controller boots before any Driver device
  has connected yet, it has no schedule at all (or whatever it cached from
  the last time a Driver connected, if that cache is persisted across
  reboots). This is a superset of the old model's existing failure mode
  (stale schedule when depot WiFi doesn't cooperate) — not a new risk class,
  just a different trigger for the same "last known cache" fallback that
  `serveApiSchedule()` already implements today.

**Supersedes**: `docs/HARDWARE.md` §7 (both "Model 1" and "Model 2" columns
— neither described this), and the depot-sync-at-boot description throughout
`pi-server/DEPLOY.md`.

## 4. Decision: no USB peripherals on the Controller, at all

Explicit requirement from this session: no USB WiFi dongles, no USB relay
boards, nothing hanging off a USB port for anything load-bearing. Reason:
vibration in a moving vehicle makes USB connections a reliability risk —
this was in fact the original reason the Pi was chosen over an x86 board in
the first place, and it doesn't stop mattering just because the board
changes.

Practical effect: any interface the Controller needs has to be either
onboard/internal (an M.2 WiFi card, a 3.5mm audio jack, HDMI, onboard
Ethernet) or wireless. Ruled out by this: the "second USB WiFi dongle for
the AP" idea floated earlier in this session — moot anyway once §3 and §5
below remove the need for a second radio at all.

## 5. Decision: Controller networking simplifies to one WiFi radio, AP-only

Once §3 removes the Controller's need to ever be a WiFi *client* (no depot
sync to join a network for), its only remaining networking job is **hosting**
an access point for the Driver device to join — the same role
`docs/HARDWARE.md` §7's "Model 2" column already described
(`hostapd`/`dnsmasq`, static AP IP, no depot-client duty on that radio).

This means:
- One onboard WiFi chip, run permanently in AP mode. No dual-radio
  requirement, no AP+STA concurrent-mode driver risk, no mode-switching
  logic, and (per §4) no USB dongle. Any mini PC's stock onboard WiFi
  handles this.
- The Controller needs **no WAN/internet connectivity of any kind** — no
  depot WiFi client role, no cellular modem. Everything it knows comes from
  the Driver device over the local AP link.

**Supersedes**: `docs/HARDWARE.md` §7 in full — both columns of that table
are now wrong in different ways; replace with "single onboard radio, AP-only,
no WAN path" per this section.

## 6. Decision: Controller becomes a formatted-feed renderer

Follows directly from §3 and §5: the Controller no longer independently
polls Supabase (`onboard.js`'s current `waitForJourneyStart()`/`get_duty_card`
polling loop goes away), no longer runs its own GPS
(`pi-server/gpsd-client.mjs` and the Model-1 "Pi's own GPS module" row in
`docs/HARDWARE.md` §2 are dead — Model 2, GPS lives on the Driver tablet
only, is now the confirmed target, not an open question), and no longer
syncs its own schedule cache independently. Its entire job is: host the AP,
receive whatever the Driver pushes over `/driver-push`, and render it —
visually to the HDMI display, and (see §7) possibly audibly too.

**Supersedes**: `docs/HARDWARE.md`'s "Read this first: two competing
architectures, unresolved" section — this resolves it. Model 2 (Driver owns
GPS and all Supabase reads/writes, Controller is receiver/renderer only) is
now the confirmed target. Model 1 (Pi's own GPS + independent Supabase
polling) is dead, not a fallback.

## 7. New requirement: branded idle/default display

Raised this session: it's bad practice for the passenger display to sit on
a generic or blank screen when the vehicle is powered up but no journey has
started yet. Currently (verified in code, not assumed) that's exactly what
happens:

- `onboard.html`'s own comment: the sign "sits on a blank grey screen until
  that journey's status flips to `in_progress`."
- `onboard.js`'s `init()`: if there's no `?journey=` param yet, it logs a
  warning and returns — no branding applied.
- `applyOperatorBranding()` only runs after `waitForJourneyStart()` resolves,
  i.e. only once a journey exists. Before that, the sign shows only the
  generic `#onboard-brand` wordmark ("BusOps Announce / Powered by
  CoachMate") — no operator identity.

**Requirement**: show the operator's own branding (logo + fixed wording,
e.g. a PSVAIR-style accessibility statement) as the default/idle state,
before any journey exists — not just after one starts.

**Why this is harder than it sounds**: everything that currently resolves
"which company is this" comes from `get_duty_card()`, which is
journey-scoped — it returns nothing until a journey exists. The idle screen
by definition has no journey yet, so there's no company context to hang a
logo on today.

**Implementation direction** (not yet built):
- Company identity needs to be known to the Controller independent of any
  journey — most natural fit is a `company_id` (or the logo/name directly)
  baked in at commissioning time, same pattern as the existing
  `?panel-diagonal=` param (`pi-server/DEPLOY.md` "Panel physical size").
  This is a fixed, one-time, per-vehicle setting, not something that changes
  journey to journey, so commissioning-time is the right point to set it.
- The logo itself (`companies.logo_path`, stored in Supabase Storage bucket
  `operator-assets` — see `supabase/schema.sql` line ~42) should be cached
  locally on the Controller at commissioning time, not fetched live at every
  boot — consistent with §5/§6's "Controller has no WAN path" decision.
- New idle-state markup/CSS needed in `onboard.html`/`onboard.css` — the
  current `#onboard-brand` block (always-visible CoachMate wordmark) needs
  to become conditional/replaceable by an operator-branded version when a
  company identity is available.
- Open question, not yet decided: does the idle screen show *only* the logo,
  or logo + a fixed PSVAIR-style accessibility statement (e.g. "This vehicle
  provides audio-visual next-stop announcements")? The latter would pair a
  branding fix with a small compliance improvement — `docs/HARDWARE.md` §9
  already tracks PSVAIR gaps as unowned; worth deciding together rather than
  bolting on later.

## 8. Open question, recommended direction pending confirmation: move audio to the Controller

**Current state** (unchanged by anything above, confirmed in code):
announcement audio is issued entirely from the Driver PWA. Pre-rendered
Azure TTS clips (`audio/announcements/`, manifest-driven, precached by
`service-worker.js`) play on the driver's own tablet; live `speechSynthesis`
(`src/announcements.js`) is the fallback for a clip not yet rendered. The
onboard sign never plays audio — `onboard.html` says so explicitly
(`#sign-announcing` is a text-only echo of what the Driver is currently
announcing). Physically, audio reaches the vehicle PA via the Driver
tablet's headphone jack into the head unit's AUX-IN — logged in
`docs/HARDWARE.md` §9 explicitly as "a listening test, not a committed
design."

**Question raised this session**: now that the Controller is "just a
formatted feed to the monitor" (§6), should audio move there too, since it's
really part of the same passenger-facing Announce output as the display?

**Recommendation: yes, move it**, for these reasons:
- Matches the split this whole doc establishes: PWA = driver duty + sync to
  Core, Controller = passenger-facing output (visual *and* audio). Splitting
  audio onto the driver's personal phone while the screen lives on a
  dedicated box is the inconsistent part of the current design, not the
  natural boundary.
- The Driver tablet is a worse place for unattended, continuous PA audio
  than a stationary, hardwired, always-on box: mobile browser background-tab
  throttling, phone hardware/battery variance, and the AUX-IN-via-headphone-
  jack path is already logged as an interim hack, not a committed design.
  PSVAIR's audio requirements (Appendix A §2.2/§2.3) are a compliance
  obligation, not a nice-to-have, and want a reliable source.
- Not new scope — `docs/HARDWARE.md` §10 already anticipated the Controller
  growing a PA/amp role ("amplifier control, I2S audio out, spare fused 12V
  branch"). This pulls that forward rather than inventing a new direction.
- Trigger logic gets simpler, not harder: once §3's expanded push protocol
  is in place, the Controller already has everything `announceStopEvent.js`
  needs to decide *when* to announce (`atStop`, `approaching`, `stopStates`,
  `diversionActive`, `isFinal` — see `buildStatePayload()`). It can derive
  announcement triggers from the same state driving the visual sign, instead
  of the Driver deciding and the Controller only echoing a string for
  display as it does today.

**Real costs, not yet resolved — needs a decision before implementation**:
- Pre-rendered clips need to ship as part of the Controller's own deployed
  software/image, not streamed live over the local WebSocket link at
  announce-time — treat it as a build/deploy artifact, same as the Driver's
  service-worker precache does today, just targeting the Controller instead.
- The live `speechSynthesis` fallback in `src/announcements.js` is
  browser-only. Moving audio to a Node-based Controller likely means
  dropping that fallback entirely (pre-rendered clips only) rather than
  porting it — needs an explicit decision, not an assumption.
- Needs audio-out hardware on the Controller BOM (a 3.5mm jack is enough for
  an interim AUX-IN cable, same physical pattern as today just sourced from
  the Controller instead of the tablet; a real PA amp is the §10-anticipated
  longer-term path). Worth deciding whether this ships as an interim
  AUX-cable step or waits for dedicated PA hardware.
- The `slug()` clip-key logic already has to be kept in sync by hand between
  `src/announcements.js` (browser) and `scripts/generate-announcement-audio.mjs`
  (Node) per existing CLAUDE.md guidance — a Controller-side player would be
  a *third* place implementing the same slug logic, worth designing against
  up front (e.g. a shared manifest lookup rather than three independent
  slug implementations).

**This is not yet a locked decision** — recorded here as the recommended
direction from this session's discussion, pending explicit sign-off before
any code changes.

## 9. Hardware shortlist (reference only — not finalized)

Deferred until the software architecture above is settled, since it changes
the requirements substantially (no WAN needed at all, single WiFi radio,
possibly needs audio-out). Two tiers discussed:

- **Tier A — consumer fanless mini PC** (Intel N100/N150 class: Beelink
  EQ12/Mini S12 Pro, GMKtec G3/NucBox, MeLE Quieter3Q, ASUS NUC 14
  Essential). ~£120–200, fanless, 6–12W idle, HDMI, onboard WiFi, M.2 NVMe.
  Likely sufficient now that the Controller's job has shrunk to
  "host an AP, render a pushed feed, maybe play audio."
- **Tier B — industrial/vehicle-rated fanless mini PC** (Logic Supply,
  Advantech ARK series, Axiomtek). £300–600+, wide DC input, extended
  operating temp range, vibration-rated. Worth it mainly if Tier A's
  operating-temp/vibration tolerance proves inadequate in the ceiling-void
  install — not clearly justified by the (now much lighter) compute
  workload alone.

No specific SKU chosen. Exact pick should happen after §8 (audio) is
confirmed, since it affects whether audio-out hardware needs to be in the
spec.

## 10. Summary of doc sections superseded

| `docs/HARDWARE.md` section | Status per this doc |
|---|---|
| §1 Bus Controller board | Superseded — CM5 pick replaced by x86 mini PC (§2, §9 above) |
| §2 GPS | Model 1 row (Pi's own GPS module) is dead, not a fallback — Model 2 (Driver tablet GNSS only) is the confirmed target (§6) |
| §7 Networking | Superseded in full — single onboard radio, AP-only, no WAN path (§5) |
| §9 PA/audio interim test | Likely superseded if §8 is confirmed — audio path moves off the Driver tablet entirely rather than AUX-cabling from it |
| §10 Near-term Controller roles | PA/audio role (first bullet) is being pulled forward by §8, not just reserved headroom anymore |
| "Two competing architectures, unresolved" header | Resolved — Model 2 confirmed (§6) |

`docs/HARDWARE.md` itself has **not** been edited — this doc stands alongside
it until the open items (mainly §8's audio confirmation, and §9's hardware
pick) are settled, at which point someone should fold the two together.
