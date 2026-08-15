# Bus Controller redesign — 2026-08-14 session

Records a design conversation that revises several open questions in
`docs/HARDWARE.md` — this doc does not edit that file, it supersedes specific
sections of it (flagged inline below) until someone folds the two together.
Written so a coding agent picking this up later has the decisions, the
rationale, and the exact code touchpoints, not just conclusions.

**Status of everything below: agreed direction, not yet implemented.** No
code has changed as a result of this conversation, including §8 (audio),
which is now a confirmed decision, not just a recommendation.

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

**Requirement**: show the operator's own branding as the default/idle state,
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
- **Decided: logo + operator name as text, no accessibility statement.**
  This was checked against `docs/BusOpsDriver_Proposal.source.html`'s
  Appendix A (the full PSV(AI)R compliance mapping) — there is no
  requirement anywhere in it about what the display shows before a journey
  starts; A1–A4 are entirely about in-service behaviour (text height, seat
  visibility, announcement timing, alert tones). An earlier framing of this
  as "pair the branding fix with a PSVAIR statement" was speculation, not
  grounded in the actual regulation text — corrected here. So this is a pure
  branding/UX call: show the logo plus the operator name as text (in case
  the logo graphic alone isn't legible/recognisable at typical viewing
  distance), nothing more. No compliance-flavoured copy to source or get
  signed off.

## 8. Decision: move audio issuance to the Controller

**Current state** (confirmed in code): announcement audio is issued entirely
from the Driver PWA. Pre-rendered Azure TTS clips (`audio/announcements/`,
manifest-driven, precached by `service-worker.js`) play on the driver's own
tablet; live `speechSynthesis` (`src/announcements.js`) is the fallback for a
clip not yet rendered. The onboard sign never plays audio — `onboard.html`
says so explicitly (`#sign-announcing` is a text-only echo of what the
Driver is currently announcing). Physically, audio reaches the vehicle PA
via the Driver tablet's headphone jack into the head unit's AUX-IN — logged
in `docs/HARDWARE.md` §9 explicitly as "a listening test, not a committed
design."

**Decided**: yes, move it. Reasons — matches the PWA/Controller split this
whole doc establishes (driver duty + sync vs. passenger-facing output,
visual *and* audio); the Driver tablet is a worse home for unattended,
continuous PA audio than a stationary, hardwired, always-on box (mobile
browser background-tab throttling, phone hardware/battery variance, and
today's AUX-cable path is already logged as an interim hack, not a
committed design, while PSVAIR's audio requirements — Appendix A §2.2/§2.3 —
are a compliance obligation); and it's not new scope — `docs/HARDWARE.md`
§10 already anticipated the Controller growing a PA/amp role, this pulls it
forward rather than inventing a new direction.

### Protocol design: the Driver stays the decision-maker, the Controller just plays

Every announcement already funnels through one function —
`announce(text, audioKeys)` in `src/announcements.js:222` — *after* all the
PSVAIR-event logic and `slug()`-based clip-key resolution has already
happened (`announceAtStop()`, `announceApproaching()`, etc. do that work
before calling it). `audioKeys` arriving at that point is already a plain,
ready list of clip filenames (e.g. `['service/x1__town-centre',
'stop/abc123']`).

That means the Controller does **not** need to re-derive triggers from
pushed state (`atStop`/`approaching`/`stopStates`/etc.) — that would
duplicate the PSVAIR-event decision logic and the `slug()` scheme in a
second runtime, which is exactly the kind of drift risk CLAUDE.md already
flags for the existing browser/Node `slug()` duplication. Instead:

- `announce()` gets one addition: alongside (in place of) calling `speak()`,
  it broadcasts `{ type: 'announce', text, audioKeys }` to the Controller
  over the existing local link (`src/announceLink.js` →
  `pi-server/announceRelay.mjs`'s `/driver-push` endpoint), same channel and
  pattern as the `type: 'schedule'` message from §3.
- The Controller becomes a genuinely dumb player: receive `audioKeys`, play
  the matching mp3s in sequence from local disk, done. No PSVAIR logic, no
  `slug()`, no TTS fallback, no knowledge of stop IDs or service codes at
  all on the Controller side.
- The queue/busy state machine that exists today to stop a new announcement
  cutting off one still playing (`isBusy`, `queued`, `playNow()` in
  `announcements.js:31-40,178-190`) has to **move to the Controller, not be
  duplicated** — once real playback happens there, the Controller is the
  one that owns real-world timing. The Driver side becomes a fire-and-forget
  sender.
- **Mute** stays a Driver-side control (`isMuted()`/`setMuted()` unchanged),
  but now gates whether the `announce` message is sent at all, rather than
  gating local playback.
- **Missing clip on the Controller**: since the live `speechSynthesis`
  fallback doesn't port to Node, a missing clip means that one announcement
  is silently skipped and logged, not crashed and not synthesized. Accepted
  given clip generation is already a controlled build step, not a runtime
  risk in practice.
- Pre-rendered clips ship as part of the Controller's own deployed
  software/image (same `audio/announcements/` set, treated as a build/deploy
  artifact), not streamed live over the WebSocket link at announce-time.

### The on-screen caption bar (Driver PWA) stays exactly as it is

`#psvair-banner` in `index.html:114` (running caption text, mute button,
voice-settings button) is a driver-facing convenience, not part of the audio
path being moved. It's wired via `onAnnouncementChange(text => {...})` in
`main.js:175`, fed by the `onAnnounce` callback inside `announce()` — which
fires **before** the function decides what to do with the audio, so it's
unaffected by switching from local playback to a Controller broadcast. Zero
changes needed here.

One explicit constraint carried forward from this decision: the banner shows
**what the app instructed to be announced (intent, resolved locally)**, not
confirmation that the Controller actually played it. No return channel from
Controller → Driver should be built for this. Today's `/driver-push`
connection is one-way (Driver → Controller only); adding inbound traffic
would mean the Driver device has to accept and parse network messages from
the Controller — new attack surface on a device that also carries driver
credentials and talks to Supabase, for a feature that doesn't need it. A
Controller-side playback fault (e.g. a missing clip file) belongs in a
Controller-side log, not piped back to the driver's screen.

### Decided: audio-out hardware ships as interim AUX, amp deferred

The demo bus has no amp, and buying one now would be speculative. This isn't
a new call — `docs/HARDWARE.md` §9 already has an "interim test plan": try
the vehicle's existing speakers via its head unit's AUX-IN, measure SPL
against the PSVAIR 3dB-above-ambient/84dB-ceiling bar, and only spend on a
dedicated amp if that test fails. That plan just relocates: the AUX source
becomes the Controller's own 3.5mm jack instead of the Driver tablet's
headphone jack — same cable, same test methodology, no new hardware
commitment now. A PA amp stays a reserved-but-unpurchased line in §10's
headroom list, revisited only if the AUX/existing-speakers test comes back
short.

### Decided: one socket, multiplexed by `type`

`type: 'announce'` rides the same `/driver-push` connection as `type:
'state'` and `type: 'schedule'` — no separate audio endpoint. Reasons:

- `pi-server/announceRelay.mjs`'s receiving side is already a single
  `message` handler on one connection; adding message types is a branch on
  `msg.type`, not new plumbing.
- A second socket would mean a second token-auth check, a second
  reconnect/backoff cycle in `src/announceLink.js`, and a new class of
  partial-failure mode (e.g. state connected but audio stuck reconnecting)
  that nothing today has to reason about.
- All three payload types are small text/JSON — no realistic head-of-line-
  blocking case for splitting them across connections.
- The three types don't even converge on the same handling once received —
  `state` updates `latestState` and relays to `signWss` clients (as today);
  `schedule` updates whatever `serveApiSchedule()` reads from; `announce`
  drives the Controller's local audio-playback queue and never touches
  `signWss` clients at all. That's a branch in the existing handler, not a
  reason to separate transport.

## 9. Hardware pick

Derived fresh from §2–§8 above — deliberately not carried over from the old
CM5/Pi spec or from this doc's own earlier Tier A/B sketch, both superseded
by this section.

**Requirements, from the decisions actually made:**

| From | Requirement |
|---|---|
| §2 | x86, not ARM/Pi |
| §3, §5, §6 | No WAN of any kind — no depot WiFi client, no cellular. Ethernet/WiFi-as-client are unused, not required |
| §5 | One onboard WiFi radio, run as AP only (`hostapd`) |
| §4 | No load-bearing USB — anything the box depends on must be onboard |
| §6 | Light compute — it's a JSON-over-WebSocket renderer now, no GPS, no independent DB polling |
| §8 | A real 3.5mm audio-out jack (interim AUX cable to the head unit) |
| Carried over from §4's reasoning | Fanless — the same vibration/no-moving-parts logic that ruled out USB dongles applies just as much to a spinning fan |
| `docs/HARDWARE.md` §6 (unchanged) | Power chain already has a **12V-in USB-C PD point-of-load module** as a standard, already-sourced component (used for the Pi and driver tablet today) — a board that powers over USB-C PD reuses this rather than needing a new power-module type for a fixed-voltage barrel jack |

**Pick: MeLE Quieter4C** (Intel N100, fanless). Checked against the table
above, spec-sheet-verified (see sources), not carried over from memory:

- Fanless, 18.3mm thick — no moving parts, small footprint for the
  ceiling-void enclosure.
- USB-C PD input (12–20V) — plugs straight into the existing PD
  point-of-load module, no new power-chain component.
- 3.5mm audio jack — **confirmed as genuine audio-out** (not the
  input-only trap the Quieter3Q turned out to be, see below), user-verified
  directly rather than taken from spec-sheet text.
- Dual HDMI, onboard WiFi 5 + Gigabit Ethernet, N100 CPU — comfortably more
  than this workload needs now that GPS/Supabase-polling/dual-radio are
  gone.
- No microSD dependency for the OS — boots from internal storage.

Sources: [MeLE Quieter4C product page](https://www.mele.cn/product/Quieter4C-en.html),
[CNX Software launch coverage](https://www.cnx-software.com/2023/12/05/mele-quieter4c-ultrathin-fanless-intel-n100-mini-pc-supports-up-to-three-displays/),
[CNX Software Quieter3C Linux review](https://www.cnx-software.com/2022/08/30/mele-quieter3c-fanless-mini-pc-review-with-ubuntu-22-04-windows-11/)
(sibling model, cited for Linux driver behaviour context).

**Candidate ruled out during BETA sourcing: MeLE Quieter3Q** (N5105, 8GB/128GB
— otherwise an exact match on RAM/storage/fanless/USB-C-power). User
confirmed directly with the seller that its 3.5mm jack is a combo
mic-in/line-in jack — **it does not support audio output at all.** Physical
presence of a 3.5mm jack in a spec sheet is not evidence it does audio-out
on this device class — confirmed the hard way here. Ruled out on §8 grounds
alone; everything else about it matched well.

**Audio-out: resolved.** Confirmed (user-verified, not spec-sheet text) that
the Quieter4C's 3.5mm jack does genuine audio output — unlike the Quieter3Q
above, this one isn't the input-only trap. §8's audio-out requirement is
satisfied by this pick. The HDMI-audio-extractor fallback discussed
previously is no longer needed.

**One remaining real risk, not papered over**: the exact WiFi chipset in the
Quieter4C couldn't be confirmed from public specs (older MeLE models used
Realtek; a newer sibling model uses Intel AX201 — unclear which this one
ships). This matters specifically because §5 depends on that chip running
reliably in AP mode under Linux `hostapd` — cheap WiFi chips are exactly
where AP-mode Linux driver support gets patchy. **Do not order a fleet's
worth on the spec sheet alone** — buy one unit, bench-test `hostapd` AP
mode on it directly, and only then commit to the rest.

**Also flagged, not a blocker**: this is a consumer-grade board, no stated
operating-temp/vibration certification. Since the workload is now light
enough that raw compute headroom isn't a reason to reach for an industrial
board, only escalate to a Logic Supply/Advantech-class unit if the
Quieter4C actually fails in the ceiling-void environment during testing —
not pre-emptively.

### Purchasing note: minimum-viable spec for the BETA unit, cost closely managed

Explicit requirement from this session: don't overspec any component for
the BETA build. Applied to this pick specifically — a £489-listed
Quieter4C configuration turned out to be 16GB RAM / 512GB storage **with
Windows 11 Pro bundled**, none of which this workload needs:

- **No OS** — the Controller runs Linux (same as the rest of `pi-server/`),
  not Windows. Buy a "No OS" / barebone listing and flash Debian/Ubuntu
  directly rather than paying for an unused Windows licence.
- **8GB RAM, not 16GB** — `docs/HARDWARE.md` originally judged 4GB
  "sufficient for kiosk browser + hostapd + one WebSocket link" against the
  *old*, heavier Pi workload (own GPS daemon, independent Supabase
  polling). Today's Controller does less than that (§6) — 8GB is
  comfortable headroom, not a stretch.
- **128GB storage, not 512GB** — the `audio/announcements/` clip set is a
  modest collection of short mp3s, not gigabytes of media; OS + Node app +
  clips fits with room to spare.

This isn't specific to the Quieter4C — treat "buy the minimum spec that
comfortably covers the actual workload, not the manufacturer's default
bundle" as a standing principle for BETA-stage hardware decisions on this
project generally, not just this one purchase.

## 10. Summary of doc sections superseded

| `docs/HARDWARE.md` section | Status per this doc |
|---|---|
| §1 Bus Controller board | Superseded — CM5 pick replaced by MeLE Quieter4C (x86, fanless), pending one-unit hardware bench verification (§9) |
| §2 GPS | Model 1 row (Pi's own GPS module) is dead, not a fallback — Model 2 (Driver tablet GNSS only) is the confirmed target (§6) |
| §7 Networking | Superseded in full — single onboard radio, AP-only, no WAN path (§5) |
| §9 PA/audio interim test | Superseded — audio path moves off the Driver tablet entirely (§8) rather than AUX-cabling from it |
| §10 Near-term Controller roles | PA/audio role (first bullet) is being pulled forward by §8, not just reserved headroom anymore |
| "Two competing architectures, unresolved" header | Resolved — Model 2 confirmed (§6) |

`docs/HARDWARE.md` itself has **not** been edited — this doc stands alongside
it. All decisions in this doc are now settled; the one remaining action item
is §9's one-unit `hostapd` AP-mode bench test before a fleet order. Once
that's confirmed, someone should fold the two documents together.
