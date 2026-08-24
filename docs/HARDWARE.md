# Onboard vehicle hardware — consolidated spec

Single source of truth for every piece of physical hardware **and the Bus
Controller's software architecture** in the onboard/vehicle system (Bus
Controller, GPS, passenger display, driver tablet/cab device, power,
networking, mounting). Supersedes the `## Hardware`, `## Storage`, `## Why
two WiFi radios`, and `### Option B panel` sections that used to live in
`mele-server/DEPLOY.md` — that file now just points here and keeps its
step-by-step install instructions.

**This file used to be split across two documents** — this one (hardware
spec) and `docs/CONTROLLER-REDESIGN.md` (a later design session that moved
the Bus Controller from a Raspberry Pi to an x86 mini PC and resolved the
architecture question below). `CONTROLLER-REDESIGN.md` said explicitly:
"once [the WiFi bench test] is confirmed, someone should fold the two
documents together." **This is that fold, done 2026-08-24.** The standalone
file has been removed; everything in it now lives in §1–§5 below. Any code
comment or doc that still cites `docs/CONTROLLER-REDESIGN.md §N` is stale —
see the mapping in §12's last entry if you need to trace an old reference.

Two other source documents feed into this one and are **not edited by
it**:
- `docs/BusOpsDriver_Proposal.source.html`/`.pdf` — the formal, versioned
  procurement proposal, referenced by section number throughout. Where
  this doc says something has moved on from what the proposal says, that
  means the proposal is stale on that point, not that this doc overrides
  it as a formal deliverable.
- `CAB-DEVICE-SETUP.md` (repo root) — the actual, currently-deployed
  driver-facing device (§7), summarized here but kept as the detailed
  reference.

---

## Read this first: architecture — resolved 2026-08-14

For a long time the proposal doc and what was actually built described two
different systems, and nothing reconciled them — this section used to be
headed "two competing architectures, unresolved." **It's resolved now.**

**Model 2 — the proposal's design — is the confirmed target:**
- The Bus Controller has **no GPS hardware of its own**. GPS lives entirely
  on the driver tablet ("Driver PWA", Blackview Active 5 — see §8), which
  sends structured state to the Controller over a local WiFi link. The
  Controller renders the passenger UI from those events and drives the
  display over HDMI — it's a receiver/renderer, not an independent
  Supabase poller.
- The Controller hosts the AP on a **single onboard radio** — no second
  dongle, no depot-WiFi client role at all (§3).

**Model 1 (what was actually built first — the Controller had its own GPS
module and the passenger display independently polled Supabase) is dead,
not a fallback.** `gpsd`, the Controller's GPS module, and the depot-sync
job are all being retired as part of this (§1, §2, §3).

**How this got resolved:** the Bus Controller's original board pick
(Raspberry Pi CM5) ran into a real procurement problem one day after being
confirmed — CM5 modules are expensive and effectively unavailable through
UK supply channels. That started a conversation about an x86 mini PC
instead, which led to reworking what the box's job even is, not just what
it runs on: once you stop requiring a depot-WiFi client role, you no longer
need the box to be a WiFi client *and* AP at the same time, which removes
the "second radio" question entirely — and once the box stops syncing
anything itself, `gpsd`/depot sync/independent Supabase polling all stop
mattering. See §1 for the board decision and §3 for the resulting
networking/software architecture.

**Two things this resolution does *not* touch:**
- **Networking's AP-hosting question was already resolved earlier,
  2026-08-13**, independent of the board/architecture pivot above: the
  Controller hosts the AP, the driver device joins it as a client. A
  competing "driver hosts, Controller joins" plan (a callback to the
  since-superseded 2026-07-22 WiFi Direct design) was considered again and
  rejected — see §3.
- **A third layer sits on top of both models and isn't affected by
  either:** neither model above is what's actually in drivers' cabs right
  now. The real driver-facing device today is a temporary bridge (§7) that
  isn't the Blackview tablet either model assumes.

---

## 1. Bus Controller (board, storage, power-in, enclosure)

### Board: MeLE Quieter4C (x86 mini PC) — replaces Raspberry Pi CM5

**Decided 2026-08-14, replacing the Raspberry Pi CM5 pick outright — not a
fallback.** Reason: CM5 board/module cost and UK availability. Derived
fresh from the requirements below, not carried over from the old CM5 spec:

| Requirement | Why |
|---|---|
| x86, not ARM/Pi | Board-cost/availability problem that started this redesign |
| No WAN of any kind — no depot WiFi client, no cellular | §3 removes the Controller's need to ever be a WiFi client |
| One onboard WiFi radio, AP only (`hostapd`) | §3 |
| No load-bearing USB — anything the box depends on must be onboard | Vibration risk in a moving vehicle — the original reason the Pi was chosen over x86 in the first place, and it doesn't stop mattering just because the board changed |
| Light compute — JSON-over-WebSocket renderer, no GPS, no independent DB polling | §2, §3 |
| A real 3.5mm audio-out jack (interim AUX cable) | §4 |
| Fanless | Same vibration/no-moving-parts logic that rules out USB dongles applies to a spinning fan |
| Reuses the existing 12V-in USB-C PD point-of-load module (§9) | Already a standard, already-sourced component — no new power-module type needed |

**Pick: MeLE Quieter4C** (Intel N100/N150, fanless), spec-sheet-verified,
not carried over from memory:
- Fanless, 18.3mm thick — no moving parts, small footprint for the
  ceiling-void enclosure.
- USB-C PD input (12–20V) — plugs straight into the existing PD
  point-of-load module.
- 3.5mm audio jack — **confirmed as genuine audio-out** (not an input-only
  trap — see the ruled-out Quieter3Q below), user-verified directly, not
  taken from spec-sheet text alone.
- Dual HDMI, onboard WiFi 5 + Gigabit Ethernet, N100/N150 CPU —
  comfortably more than this workload needs now that
  GPS/Supabase-polling/dual-radio are gone.
- No microSD dependency for the OS — boots from internal storage.

**Confirmed order spec for the BETA unit**: MeLE Quieter4C, **N150** (same
Alder-Lake-N class as N100, slightly higher clock, no practical difference
for this workload), **8GB RAM / 128GB storage, No OS** (Linux/Ubuntu
installed directly), **USB-C PD3.0**, **VESA mount** included — the exact
listing to order, not a generic "Quieter4C-class" placeholder. Sources:
[MeLE Quieter4C product page](https://www.mele.cn/product/Quieter4C-en.html),
[CNX Software launch coverage](https://www.cnx-software.com/2023/12/05/mele-quieter4c-ultrathin-fanless-intel-n100-mini-pc-supports-up-to-three-displays/).

**Purchasing note — minimum-viable spec, cost closely managed**: don't
overspec any component for the BETA build. A £489-listed Quieter4C
configuration turned out to be 16GB RAM/512GB storage with Windows 11 Pro
bundled — none of which this workload needs. Buy "No OS" and flash
Debian/Ubuntu directly; 8GB RAM is comfortable headroom against today's
much lighter workload (no own GPS daemon, no independent Supabase
polling); 128GB comfortably fits OS + Node app + the modest
`audio/announcements/` clip set. Treat "buy the minimum spec that
comfortably covers the actual workload" as a standing principle for
BETA-stage hardware decisions generally, not just this purchase.

**One remaining real risk, not papered over**: the exact WiFi chipset in
the Quieter4C couldn't be confirmed from public specs (older MeLE models
used Realtek; a newer sibling uses Intel AX201 — unclear which this one
ships). This matters because §3 depends on that chip running reliably in
AP mode under Linux `hostapd` — cheap WiFi chips are exactly where
AP-mode Linux driver support gets patchy. **Do not order a fleet's worth
on the spec sheet alone** — buy one unit, bench-test `hostapd` AP mode on
it directly, and only then commit to the rest. This is the one action
item left before this redesign can be considered fully validated, not
just agreed direction.

Also flagged, not a blocker: this is a consumer-grade board with no
stated operating-temp/vibration certification. Only escalate to a Logic
Supply/Advantech-class unit if the Quieter4C actually fails in the
ceiling-void environment during testing — not pre-emptively, since the
workload is now light enough that raw compute headroom isn't a reason to
reach for an industrial board.

| Item | Status |
|---|---|
| ~~Waveshare CM5 carrier + Raspberry Pi CM5108032 module~~ | **Superseded 2026-08-14** — cost/UK-availability problem. Was itself confirmed 2026-08-13, one day before being dropped. Kept for audit trail only, do not reintroduce. |
| ~~Raspberry Pi 5, 4GB~~ | Was the CM5 pick's own fallback; moot now the board family changed entirely |
| ~~MeLE Quieter3Q~~ (N5105, 8GB/128GB) | **Ruled out** — otherwise an exact match on RAM/storage/fanless/USB-C-power, but its 3.5mm jack is a combo mic-in/line-in jack, confirmed with the seller: **it does not support audio output at all.** Physical presence of a 3.5mm jack in a spec sheet is not evidence of audio-out on this device class. |

### No load-bearing USB peripherals, ever

**Firm requirement.** No USB WiFi dongles, no USB relay boards, nothing
hanging off a USB port for anything the box depends on. Vibration in a
moving vehicle makes USB connections a reliability risk. Any interface the
Controller needs has to be onboard/internal (an M.2 WiFi card, the 3.5mm
jack, HDMI, onboard Ethernet) or wireless. This rules out the "second USB
WiFi dongle for the AP" idea floated during the board discussion — moot
anyway once §3 removes the need for a second radio at all.

**Tension this creates, not yet resolved**: §11's ticketing/APC headroom
ideas assumed a USB or serial card reader — that assumption now conflicts
with this rule. Flagged there, not resolved here.

### Storage

**No microSD, ever** — vibration, write-endurance, and unclean-shutdown
corruption risk all rule it out. The MeLE Quieter4C's internal storage
(128GB, confirmed order spec above) satisfies this without extra
hardware, unlike the old Pi pick which needed a separate NVMe HAT + SSD.

### Power-in

USB-C PD, 12–20V input, fed from the same 12V-in USB-C PD point-of-load
module (25–60W rated) already used elsewhere in the power chain — see §9.
Firm on the module type; the Controller's actual current draw hasn't been
confirmed against the old Pi-specific fuse sizing — see §13.

### Enclosure

**Polycarbonate**, combined with the power electronics in one enclosure,
recessed into the ceiling void — **metal is explicitly disallowed**: it
would Faraday-cage the Controller's onboard WiFi, which the AP (§3)
depends on. Firm, specific reason given, not just a preference.
(Originally stated for the Pi; the reasoning is unchanged for the MeLE
box, since it depends on the same onboard-WiFi AP.)

### Sudden power loss / ignition-off

The whole power chain (§9) sits downstream of the master isolator switch
— there is no soft-shutdown warning when it's switched off, the 24V rail
simply disappears. Worth being precise about which component this
actually threatens:

- **Driver tablet, interior display, any future PA amp** — not really at
  risk. The tablet has its own battery; the display and amp have no
  persistent writable storage, they just go dark/silent.
- **Bus Controller** — the real risk. It's a full computer with a live
  root filesystem. "No microSD, ever" above already flags unclean-shutdown
  corruption as a reason to avoid SD cards, but that alone only reduces
  *wear-related* failure — it doesn't by itself prevent filesystem
  corruption from a write that's mid-flight when the rail cuts instantly.

Recommended layered approach, cheapest/most-important first:

1. **Read-only root filesystem** — anything that thinks it's writing goes
   to a RAM-backed overlay instead. Makes the OS image itself immune to
   corruption regardless of when power cuts. Software-only, no extra
   hardware/cabling. First line of defense and probably sufficient on its
   own for most of this box's workload.
2. **Keep genuinely-persistent state** (logs, any local cache) **off the
   read-only root**, on a small writable partition, written via
   write-temp-then-atomic-rename so a torn write never leaves a
   half-written file.
3. **Optional: a small supercap/UPS hold-up module** between the 12V
   Controller branch and its USB-C PD module — holds the rail up for a few
   seconds after power cuts, enough to run a clean `shutdown -h now`. With
   (1) already in place, this is a nice-to-have, not load-bearing. Not
   currently speced to a specific part.
4. **Enable the board's watchdog timer** (if the MeLE's chipset supports
   one — not yet confirmed) — cheap, orthogonal to corruption, means a
   hang triggers an auto-reboot rather than needing a physical
   power-cycle.

---

## 2. GPS

Two independent hardware chains — don't conflate them:

| Chain | Spec | Status |
|---|---|---|
| ~~Bus Controller's own GPS module~~ (Model 1) | USB or UART module, e.g. u-blox NEO-6M/7M/8M, read via `gpsd` | **Dead, not a fallback** — Model 2 (driver tablet owns GPS) is the confirmed target (see "Read this first" above). `mele-server/gpsd-client.mjs` and this row are historical. |
| **Driver tablet's GNSS** (unconditional either way) | The device needs its own GPS+cellular capability regardless of which specific SKU is chosen. Production target: **Blackview Active 5** (built-in GPS + Dual SIM 4G LTE — see §8). Superseded pick: Samsung Galaxy Tab A9 LTE. | Firm — the driver device needs its own GPS. (Today's actual cab device, §7, uses browser geolocation instead — see that section.) |

---

## 3. Bus Controller networking & software architecture

### Networking: single onboard radio, AP-only, no WAN

**Decided.** Once the Controller never needs to be a WiFi client (no depot
sync to join a network for — see below), its only remaining networking
job is **hosting** an access point for the driver device to join.

- **One onboard WiFi chip, run permanently in AP mode.** No dual-radio
  requirement, no AP+STA concurrent-mode driver risk, no mode-switching
  logic, and (§1) no USB dongle. Any mini PC's stock onboard WiFi handles
  this — see §1's one remaining risk (chipset AP-mode support
  unconfirmed, bench-test before a fleet order).
- **The Controller needs no WAN/internet connectivity of any kind** — no
  depot WiFi client role, no cellular modem. Everything it knows comes
  from the driver device over the local AP link.
- Static AP IP, `hostapd`/`dnsmasq`, WiFi interface marked `unmanaged` in
  NetworkManager so it doesn't fight the manually-run `hostapd`.
- **Who joins the hotspot**: the driver PWA tablet, as a standard
  low-privilege client, one-time pairing at commissioning.

| Item | Historical (two-radio model, retired) | Current (decided) |
|---|---|---|
| Depot sync | `wlan0`, normal WiFi client, joins depot WiFi each morning | **Removed entirely — see below** |
| Hotspot for other devices | Second radio: USB WiFi dongle running a permanent AP | **Single onboard radio**, AP-only, no dongle |
| Recent stability | This flip-flopped once already: commit `7f1a342` removed the hotspot entirely (assumed no longer needed), commit `a60d075` restored it days later after a `develop` merge showed it was still required | Resolved 2026-08-13 that *some* AP is required (§ above); the two-radio *implementation* of it was then retired 2026-08-14 by the redesign below |

### Depot WiFi sync: dropped as a concept entirely

**Old model**: the Controller joined the depot's WiFi once each morning to
run `mele-server/sync-schedule.mjs`, pulling the day's schedule into a
local `schedule-cache.json`. This was gated on the vehicle being in range
of a depot WiFi network that actually works — and the depot's WiFi turned
out not to be decent, so the old model's one and only network dependency
didn't reliably exist.

**New model**: the Controller never talks to Supabase/PCV Dashboard Core
directly, at all. The driver PWA already does two things that make this
unnecessary: it fetches schedule/duty data straight from Supabase over its
own cellular connection, independent of any local network; and it already
opens a WebSocket to the Controller every journey (`/driver-push`) to push
live tracking state. The fix: make the driver PWA the **sole** sync path
to Core, for schedule/duty data as well as live state, relayed down to the
Controller over the local link it already opens.

- `mele-server/sync-schedule.mjs` and its once-a-day boot job are no
  longer needed — candidates for removal.
- The `/driver-push` protocol carries multiple message types over **one
  socket, multiplexed by `type`** (no separate endpoint per type — a
  second socket would mean a second token-auth check, a second
  reconnect/backoff cycle, and a new class of partial-failure mode nothing
  today has to reason about):
  - `type: 'state'` — live tracking state (the original, pre-existing
    message type), relayed to sign clients.
  - `type: 'schedule'` — duty/timetable data, sent once when the driver
    connects (or on schedule change). Received and held by the Controller
    (in memory or on its writable partition, so it survives a Controller
    restart mid-shift) in place of the old `schedule-cache.json` sync job.
  - `type: 'announce'` — see §4.
- **Freshness/fallback**: if the Controller boots before any driver device
  has connected yet, it has no schedule (or whatever it cached from the
  last connection, if persisted across reboots). This is a superset of the
  old model's existing failure mode (stale schedule when depot WiFi
  doesn't cooperate), not a new risk class.

---

## 4. Bus Controller audio (PA) and remaining compliance gaps

### Where announcement audio plays: decided, moves to the Controller

**Current state before this decision**: announcement audio was issued
entirely from the driver PWA — pre-rendered Azure TTS clips playing on the
driver's own tablet, reaching the vehicle PA via the tablet's headphone
jack into the head unit's AUX-IN (logged as "a listening test, not a
committed design," see below).

**Decided: move it to the Controller.** Reasons: matches the PWA/Controller
split this whole architecture establishes (driver duty + sync vs.
passenger-facing output, visual *and* audio now); a stationary, hardwired,
always-on box is a better home for unattended continuous PA audio than a
mobile browser tab (background-tab throttling, phone hardware/battery
variance); today's AUX-cable-from-the-driver-tablet path was already an
interim hack, not a committed design; and it's not new scope — §11 already
anticipated the Controller growing a PA/amp role, this pulls it forward.

**Protocol design: the driver stays the decision-maker, the Controller
just plays.** Every announcement funnels through one function
(`announce(text, audioKeys)` in `src/announcements.js`) *after* all the
PSVAIR-event logic and clip-key resolution has already happened — so
`audioKeys` arriving there is already a plain, ready list of clip
filenames. That means the Controller does **not** re-derive triggers from
pushed state — that would duplicate the PSVAIR-event decision logic in a
second runtime. Instead:

- `announce()` broadcasts `{ type: 'announce', text, audioKeys }` to the
  Controller over the same `/driver-push` link as `type: 'state'`/`type:
  'schedule'`.
- The Controller is a genuinely dumb player: receive `audioKeys`, play the
  matching mp3s in sequence from local disk, done. No PSVAIR logic, no
  clip filename derivation, no TTS fallback, no knowledge of stop IDs or
  service codes on the Controller side.
- The busy/queue state machine that stops a new announcement cutting off
  one still playing lives on the Controller now, not duplicated on the
  driver side — once real playback happens there, the Controller owns
  real-world timing.
- **Mute** stays a driver-side control, gating whether the `announce`
  message is sent at all, rather than gating local playback.
- **Missing clip on the Controller**: since live `speechSynthesis` doesn't
  port to Node, a missing clip means that one announcement is silently
  skipped and logged, not crashed and not synthesized. Pre-rendered clips
  ship as part of the Controller's own deployed software/image, not
  streamed live at announce-time.
- The on-screen caption bar in the driver PWA is unaffected — it shows
  **intent** (what the app instructed to be announced), not confirmation
  the Controller actually played it. No return channel from Controller →
  driver is built for this deliberately: today's `/driver-push` connection
  is one-way, and adding inbound traffic would mean the driver device has
  to accept and parse network messages from the Controller — new attack
  surface on a device that also carries driver credentials, for a feature
  that doesn't need it. A Controller-side playback fault belongs in a
  Controller-side log.

**Implementation deviation, decided 2026-08-19 — the driver PWA does
*not* stop playing locally yet.** Only one physical Controller exists so
far (commissioning imminent, not fleet-wide) — a hard cutover to
Controller-only audio would silence PSVAIR audio entirely on every other
vehicle, a compliance regression, not just a UX one. `announce()` now
broadcasts to a commissioned Controller *alongside* local playback rather
than in place of it; it's a no-op on any device never commissioned with
one. **Drop local playback only once Controller hardware is deployed
fleet-wide** — tracked in `docs/TODO.md` "Controller audio."

### Audio-out hardware: interim AUX, amp deferred

The demo bus has no amp, and buying one now would be speculative. This
isn't a new call — the interim test plan below already existed before the
audio-ownership decision, it just relocates: the AUX source becomes the
Controller's own 3.5mm jack (confirmed genuine audio-out, §1) instead of
the driver tablet's headphone jack, same cable, same test methodology, no
new hardware commitment now.

- **No PA amplifier/speaker system specified anywhere** (PSV(AI)R Appendix
  A §2.2/§2.3) — the 3dB-above-ambient and 84dB-ceiling audio requirements
  depend on PA hardware that doesn't exist in any procurement table yet.
  **Interim test plan**: before committing to any new PA hardware, try the
  host vehicle's existing speakers via its existing radio head unit's
  AUX-IN — cable is the Controller's 3.5mm jack to whatever the radio's
  AUX-IN takes (commonly 3.5mm, occasionally stereo RCA — check the
  specific head unit before buying the cable). This is explicitly a
  **listening test, not a committed design** — the existing speaker
  configuration is unknown, and the SPL requirements still need a real
  measurement against it either way, using the same calibration workflow
  already built for a dedicated PA (`vehicle_audio_config`,
  `getAudioLevelForVehicle()` in `src/audioConfigPipeline.js`): play a
  test announcement through whichever path is chosen, measure SPL, record
  it. If the existing setup clears the bar, it may remove the need for
  new PA hardware entirely; if not, this test at least establishes a
  baseline before spending on an amp/speaker.
- A PA amp stays a reserved-but-unpurchased line in §11's headroom list,
  revisited only if the AUX/existing-speakers test comes back short.

### Other known compliance gaps (no assigned hardware owner)

Carried from PSV(AI)R Appendix A, not re-solved here — not committed
roadmap items:

- **Induction hearing loop** (§2.5) — not addressed anywhere in the
  current build, independent of the audio-ownership decision above.
- **No door-open sensor** (§3.1) — GPS-confirmed arrival is used as a
  proxy trigger for "doors open" announcements instead.
- **No alert-tone/chime** (§4A/5.1) — diversion and final-stop
  announcements go straight to spoken content with nothing preceding
  them; a short fixed chime clip is recommended but not built.

---

## 5. Idle-screen branding (before a journey starts)

**Requirement, decided 2026-08-14**: show the operator's own branding on
the passenger display as the default/idle state, before any journey has
started — not the blank/generic screen it showed before.

**Why this was harder than it sounds**: everything that resolves "which
company is this" today comes from `get_duty_card()`, which is
journey-scoped — it returns nothing until a journey exists. The idle
screen by definition has no journey yet, so there's no company context to
hang a logo on.

**Implementation**: company identity is commissioned directly onto the
device — a fixed, one-time, per-vehicle setting, same pattern as
`&panel-diagonal=`/`&panel-profile=` — rather than fetched live (the
Controller has no WAN path, §3). See `mele-server/DEPLOY.md` "Idle screen
branding" for the exact commissioning steps (`&operator-name=`, logo image
fetched once from a machine with internet access and pushed to the
Controller).

**Decided: logo + operator name as text, no accessibility statement.**
Checked against `docs/BusOpsDriver_Proposal.source.html`'s Appendix A —
the full PSV(AI)R compliance mapping — and there is no requirement
anywhere in it about what the display shows before a journey starts;
A1–A4 are entirely about in-service behaviour. An earlier framing of this
as "pair the branding fix with a PSVAIR statement" was speculation, not
grounded in the actual regulation text. So this is a pure branding/UX
call: logo plus operator name as text (in case the logo graphic alone
isn't legible/recognisable at typical viewing distance), nothing more.

---

## 6. Passenger / interior display

### MUST-have (regulatory or physical-constraint driven — not negotiable)
Sourced from PSV(AI)R Appendix A and the fleet-wiring finding:

- **HDMI input**, driven from the Bus Controller — no smart/Android
  panel, no separate content source.
- **Fits the existing vehicle wiring's power budget.** The target fleet
  is 10+ year old vehicles; a large-format panel (the earlier 28"
  candidate) was dropped specifically because the existing wiring can't
  support it without a major rewire. "Compact, low-power" per the
  proposal (§7.3) — exact wattage ceiling is not quantified anywhere in
  the repo (see "Undetermined" below).
- **Visible from ≥51% of passenger seats per deck** (Appendix A §1.1).
- **Visible from every forward-facing wheelchair space and priority
  seat** (§1.2), and from rearward-facing wheelchair spaces on buses
  first used from 1/10/24 (§1.3).
- **Text ≥22mm in height on a contrasting background** (§1.4).
  **Resolved**: `onboard.js` computes the correct `--min-text` vh value at
  runtime from a per-panel physical diagonal supplied once via
  `?panel-diagonal=<inches>` (`computeMinTextVh()`, see
  `mele-server/DEPLOY.md` "Panel physical size"), rather than a fixed
  constant that only happened to be correct for two specific panels. Any
  future panel just needs its diagonal added to the kiosk URL — no code
  change required.
- **Small/light enough for the ceiling-void install** without structural
  changes to the vehicle.

### Nice-to-have (comfort, cost, or aesthetics — not compliance-driven)
- **Touch capability** — confirmed unused. The display has zero
  passenger interaction; `onboard.html` says so explicitly.
- **Bezel-less/open-frame chassis look** — a standard-bezel consumer
  monitor works functionally, VESA-mounted instead of on its desk stand.
- **VESA-mount convenience, professional/brand-matched look** — relevant
  for the beta specifically; not a production compliance requirement.

### Undetermined — flagged as open, not invented
- Daylight brightness/nits for readability through vehicle glazing — no
  minimum nit figure specified anywhere.
- IP/dust rating, operating temperature range — not addressed anywhere.
- The actual wattage ceiling the existing sign wiring can supply —
  referenced repeatedly but never given a number.

**Two hardware paths**: no rugged, vehicle-mountable panel meeting the
MUST-haves above is available off-the-shelf — a genuine sourcing dead
end, not a pending-order gap. The demo build uses the **same mounts, Bus
Controller, power chain (§9), and install locations** as production — a
real physical validation, not a bench mockup. The only two differences
are the panel itself and one added component:
- **Demo/validation path (real, in use today)**: the Dell Pro P2426H
  (below) stands in for the not-yet-sourced production panel, and
  because it needs mains **240V AC** while the rest of the system is the
  real 24V vehicle supply, a **24V-input pure sine wave inverter (~150W)**
  feeds it — tapped pre-converter, off the raw 24V supply on its own
  fuse, deliberately **not** off the isolated 12V distribution block (see
  §13 for why). This is the one branch that doesn't match how the
  eventual production panel will be wired.
- **Production path (still unresolved)**: once a 12V-native panel is
  sourced, the inverter is removed entirely and that panel wires straight
  into a 12V branch off the distribution block, same as every other
  device in §9. No candidate meeting 12V-native + fits-the-existing-wiring
  + vehicle-rugged has been found yet — an open sourcing problem to
  actively solve.

### Status trail (why this looks unsettled — it genuinely is)
| Panel | Status | Source |
|---|---|---|
| Fire HD 10 tablet | **Dropped** — `DEPLOY.md` "Option A" no longer names a specific device; the Bar/Monitor display profiles are both HDMI-wired (Option B) | `mele-server/DEPLOY.md` §5 |
| Allsee WS28HD8-B / "VSDISPLAY 28" 1920×360" stretch-bar | **Dropped** — hard to source in time, and the target fleet's wiring can't take a large-format retrofit without a major rewire | Proposal §7.3 |
| **Dell Pro P2426H, without stand** (210-BVTG, service tag FZG4ZD4) | **Confirmed BETA unit, purchased 2026-08-14.** Mains 240V, see two-path note above. 24" FHD IPS, 100×100mm VESA fixing, full-size HDMI + DisplayPort in. Chosen over an industrial-spec panel because those run ~6 weeks average lead time. Consumer-grade, not the final production pick, but its physical footprint is expected to match the eventual production panel. Ships without an enclosure (§10). | This session, 2026-08-13/14 |
| Production panel | **TBD, unresolved sourcing gap** | Proposal §7.3 |
| ~~Beta pick — iiyama ProLite XUB2492HSN-B1~~ | **Removed 2026-08-13** — dropped in favor of the Dell Pro P2426H. Do not reintroduce without checking with the user first. | Superseded, kept for audit trail only |

---

## 7. Cab device — the temporary bridge actually deployed today

Full detail: `CAB-DEVICE-SETUP.md` (repo root). This is **not** the
Blackview tablet target — it's a deliberately different, much simpler
stopgap, explicitly framed as lasting "the next ~6 months, until vehicles
carry NextStop-native hardware" (i.e. until the architecture in §1–§5
actually gets built and deployed fleet-wide).

| Item | Spec | Status |
|---|---|---|
| Device | **Any** Android phone/tablet — no specific SKU | Deliberately unconstrained — any unit can be swapped between vehicles with zero reconfiguration |
| Connectivity | **SIM card required as of 2026-08-19**, one per unit — cellular data for a more reliable Supabase connection than depending on vehicle/depot WiFi. Must be inserted and confirmed working **before** Kiosk Mode is enabled — Settings isn't reachable once locked down. `cab-device/setup-cab-device.sh` enforces this with a pre-flight SIM check. | Firm, changed 2026-08-19 — supersedes an earlier "no LTE requirement" |
| GPS | Browser's `navigator.geolocation`, same source the existing driver-phone flow already uses | No dedicated GPS module needed (a SIM is required regardless, for data, not GPS) |
| Power | Ignition-switched USB supply, "like a dashcam" | Firm for this bridge; distinct from the vehicle's 24V→12V DC chain in §9 |
| Mount | Not specified in the source doc | **Undetermined** — flagged as a gap, not assumed solved |
| Software | The existing driver PWA itself, installed via "Add to Home Screen" + Android Screen Pinning — no new app, no dedicated firmware | Reuses the existing manual service/run picker |
| Vehicle/driver binding | None — journeys created this way have `driver_id`/`vehicle_id` both `null` | Known limitation — see `docs/TODO.md` |
| Optional resilience | **Fully Kiosk Browser** if unattended reboots need auto-relaunch — screen pinning alone doesn't survive a reboot | Not required to ship the bridge |

**Why this matters for the rest of this doc:** §5, §6, §8 are about a
*future* target state that hasn't been built. This section is what's
running now. Don't conflate the two when scoping new work.

---

## 8. Driver PWA tablet (cab-mounted, adjacent hardware — production target, not yet built)

Not covered by `DEPLOY.md` at all (that file is Controller-side only) but
wired into and mounted alongside the same system. This is the
**production target**, distinct from the cab-device bridge in §7 above.

| Item | Spec | Status |
|---|---|---|
| Tablet | **Blackview Active 5 Rugged AI Tablet Phone** — 8.68" HD+ 90Hz, IP68/IP69K, Android 15, 24GB RAM/128GB storage, Dual SIM 4G LTE, GPS, WiFi, fingerprint, 6600mAh, 218.5×131.7×12.3mm, 510g | **Confirmed production target**, supersedes the Tab A9 LTE pick. Meets the same GNSS/cellular requirements the Tab A9 was chosen for and adds documented IP68/IP69K ruggedness. Also the physical unit in the current demo build. |
| ~~Tablet (superseded)~~ | Samsung Galaxy Tab A9, LTE (SM-X115), 8GB/128GB | No longer the production pick |
| Cab mount | **RAM® X-Grip® Universal Holder for 7"-8" Tablets** (RAM-HOL-UN8BU, B-size ball) — the Blackview's 131.7mm width sits inside this class's range. Bolted base, not suction-cup, rated for commercial-vehicle vibration | Firm. Supplier: [MUD-UK](https://www.mudstuff.co.uk/products/x-grip-7-8-tablet-holder) or RAM Mounts UK. |
| Power | 12V-in USB-C PD module → tablet USB-C fast charge | Firm, part of §9. Assumes USB-C fast charge (standard for this device class) — not separately verified against its datasheet. |

---

## 9. Power / electrical

| Item | Spec | Status |
|---|---|---|
| Vehicle supply | 24V auxiliary circuit, tapped downstream of the master isolator switch | Firm |
| Central converter | **Victron Orion-Tr Isolated 24/12** — the *isolated* variant specifically, for galvanic noise/interference isolation. **Recommended tier: 24/12-20 (240W)** — today's actual 12V-side load (Bus Controller + driver tablet, ≈5A) leaves headroom for future branches without the 30A tier's overkill weight. | **Recommended, not yet confirmed as purchased.** Suppliers: 12 Volt Planet, Sunshine Solar, BMS Technologies, Midsummer Energy (UK). |
| **Main input fuse** (master switch → converter) | **20A**, sized against the 24/12-20's own datasheet numbers | Recommended, contingent on the 24/12-20 tier being the one actually used |
| Rejected earlier design | Two separate generic 24V→12V and 24V→5V converters | Explicitly superseded by the single isolated stage + point-of-load modules |
| Distribution | Fused 12V distribution block, individual fuse per branch | Firm. Supplier: Vehicle Wiring Products. |
| Point-of-load modules | 12V-input USB-C PD modules, 25–60W rated — one per device (Bus Controller, driver tablet) | Firm. Suppliers: RS, Farnell. |
| Interior display power | Native 12V input, no conversion module needed | Firm (contingent on the display itself, still TBD) |
| Grounding | Interior Display GND + Bus Controller GND + DC-DC Converter GND → single chassis ground point | Firm |
| Ferrite chokes | On power lines | Firm installation step |
| Wiring | 24V-rated automotive power loom | Firm. Supplier: Vehicle Wiring Products. |
| ~~Beta display power (contingent)~~ | ~~iiyama monitor's universal 100–240V AC input~~ | **Removed** — iiyama dropped in favor of the Dell P2426H |

Note: this chain is the **production target** power design. The
cab-device bridge (§7) is not wired into it at all — it runs off a simple
ignition-switched USB supply. (Ignition-off/sudden-power-loss handling is
covered in §1 — it's specifically about the Bus Controller.)

---

## 10. Mounting / enclosure

| Item | Spec | Status |
|---|---|---|
| Bus Controller + power electronics enclosure | Polycarbonate (see §1) | Firm |
| Interior display ceiling-drop mount (production) | **RAM Mounts E-size (3.38" ball) double-ball VESA system** — chosen for harsh-environment vibration resistance. **Corrected 2026-08-14 from an earlier D-size pick**: D-size is only rated to 6 lb/2.72kg dynamic, and the P2426H panel alone weighs 6.88 lb/3.12kg without its stand, already over D-size's rating. E-size (rated to 15 lb/6.8kg dynamic) has real headroom. Exact SKUs TBD — depend on the final production panel's weight/VESA pattern and the ceiling void's attachment point. | Mount family corrected, exact parts TBD |
| Interior display enclosure mount (BETA, Dell Pro P2426H) | Same RAM E-size VESA system, ordered against the bare panel's 100×100mm VESA holes: **RAM-E-246U** (or steel-reinforced **-IN1**) plate + **RAM-E-202U** (or **-IN1**) base + **RAM-E-201U-D** short double socket arm. All at [RAM Mounts UK](https://www.ram-mount.co.uk/). RAM's **Vibe-Safe** add-on puck available if vibration testing shows resonance. | Corrected + exact SKUs identified — order ASAP for BETA |
| Anti-vibration isolation mounts | On the ceiling-drop mount assembly | Firm, generic hardware. Supplier: Screwfix (M8 bolts). |
| HDMI cable | Shielded, short run | Firm — interference reduction. Supplier: The Pi Hut. |
| Driver tablet mount | See §8 | Firm (the cab-device bridge in §7 has no specified mount) |
| **Interior display enclosure — VESA passthrough requirement** | The enclosure's back panel **must** expose a 100×100mm VESA passthrough aligned to the panel's own native mounting holes | Firm requirement — lets the same RAM E-size mount hardware bolt to the bare panel now, then unbolt/rebolt to the enclosure later with no second purchase |

---

## 11. Near-term Bus Controller roles — reserve headroom, don't over-specify

Three additional roles are expected soon (confirmed directly by the team,
not yet in any proposal or procurement doc):

- **PA / audio announcement hardware** — **no longer just reserved
  headroom — pulled forward and decided, see §4.**
- **Contactless ticketing / fare validation** — likely a card/NFC reader.
  The Controller should probably **relay only**, not store or handle raw
  card data, to keep PCI-type compliance scope off it. **Conflicts with
  §1's "no load-bearing USB, ever" rule** if the reader is USB or serial —
  that assumption predates the no-USB decision and hasn't been
  reconciled. Needs either a wireless (Bluetooth) reader, or the no-USB
  rule needs an explicit carve-out for this role — flagged as an open
  tension, not resolved here.
- **Automatic passenger counting (APC)** — typically door-mounted
  IR/stereo sensors, historically assumed USB/RS-485/Ethernet. Same
  tension with the no-USB rule as ticketing above — Ethernet is fine
  (onboard, wired, not USB), USB/RS-485 sensor interfaces are not.

No hardware, model numbers, or interfaces are chosen for any of these —
none should be inferred from this section, beyond the USB conflict
flagged above. What it does establish: when sizing the Controller's power
budget, enclosure, and available ports going forward, leave margin rather
than speccing right up to the current display-only-plus-audio workload's
limit.

---

## 12. Decision history (why parts of this look unsettled)

For anyone reading this fresh and wondering if something was overlooked —
it wasn't, these are tracked reversals, not gaps:

- `1315787` — proposal doc corrected to the confirmed picks (Tab A9 LTE,
  Allsee 28" panel, Victron Orion-Tr Isolated, polycarbonate enclosure),
  PSV(AI)R Appendix A added.
- `7136e9b` — the 28" Allsee panel dropped from the proposal; production
  display marked TBD, wiring-constraint reasoning added.
- `7f1a342` — `wlan1` hotspot and its config examples removed, assuming
  the display no longer needed WiFi.
- `9a2946b` / `a60d075` — merge with `develop` showed the hotspot was
  still required (Fire HD Option A depended on it); config examples
  restored.
- `a151dea` — beta monitor pick logged, then found to still have an open
  question (existing wiring vs. temporary power) rather than being fully
  resolved.
- `5486ec4` — `CAB-DEVICE-SETUP.md` written on a separate branch,
  describing the actual bridge hardware deployed in cabs today. It sat
  unmerged and undocumented until this doc's own review process found it
  by checking branches other than `develop` — worth remembering that
  `develop` isn't guaranteed to be the whole picture.
- 2026-08-13 — §8's Samsung Galaxy Tab A9 LTE pick superseded by the
  Blackview Active 5.
- 2026-08-13 — the iiyama ProLite XUB2492HSN-B1 beta pick removed
  outright, not just reconciled, in favor of the Dell Pro P2426H.
- **2026-08-14 — the Bus Controller board pivots from Raspberry Pi CM5 to
  an x86 mini PC (MeLE Quieter4C)**, one day after the CM5 pick had been
  confirmed — reason: CM5 cost/UK-availability. This cascaded into: depot
  WiFi sync dropped entirely, networking simplified to single-radio
  AP-only, no-load-bearing-USB rule adopted, and the "two competing
  architectures" question resolved (Model 2 confirmed, Model 1 dead). This
  was originally written up as its own document,
  `docs/CONTROLLER-REDESIGN.md` — **folded into this document 2026-08-24**
  (§1–§5 above); the standalone file has been removed. Old
  `CONTROLLER-REDESIGN.md §N` references map here as: §2→§1, §3/§5→§3,
  §4→§1 ("no load-bearing USB"), §6→"Read this first"/§2/§3, §7→§5,
  §8→§4, §9→§1.
- 2026-08-19 — audio playback moves to the Bus Controller (§4), but the
  driver PWA keeps playing locally too until Controller hardware is
  deployed fleet-wide — a deliberate deviation from the original
  "Controller only" design, since only one physical Controller existed at
  the time.
- Fire HD 10 tablet dropped as a display option (§6) — superseded by the
  Bar/Monitor HDMI display profiles.

---

## 13. Cabling

Every physical cable implied by §1–§10, for the **production target**
only — the cab-device bridge (§7) is a separate, much simpler
ignition-switched-USB setup and isn't covered here.

### Power chain (§9) — one continuous run, in order

| Segment | Spec | Status |
|---|---|---|
| Vehicle 24V loom → master isolator switch → **input fuse (20A, see §9)** → Victron Orion-Tr Isolated 24/12-20 | 24V-rated automotive cable | Firm on wiring; fuse/converter tier recommended. Supplier: Vehicle Wiring Products. |
| Converter output → output fuse → fused 12V distribution block | 12V-rated cable, short run | Fuse: **10A** recommended |
| Distribution block → branch, fuse → 12V-in USB-C PD module → **Bus Controller** USB-C power-in | Fused branch + PD module + USB-C lead | **Fuse size needs reconfirming** — the earlier 5A figure was sized against the Raspberry Pi CM5's specific 5V/5A USB-C draw, which no longer applies now the board is a MeLE Quieter4C on 12–20V PD input (§1). Don't carry the old number forward without checking the new board's actual draw. |
| Distribution block → branch, **5A** fuse → 12V-in USB-C PD module → **Driver tablet** USB-C power-in | Fused branch + PD module + USB-C lead | Firm on wiring; fuse size recommended, revisit once the Blackview's actual charge wattage is confirmed |
| Distribution block → branch → **interior display** power-in | **Production (once panel is sourced):** straight 12V, no PD module | Production connector type still TBD pending the panel sourcing gap |
| **Demo only:** Vehicle 24V loom → **7.5A** fuse → **24V-input pure sine wave inverter** (~150W) → Dell P2426H's own IEC mains lead | Deliberately tapped pre-converter, off the raw 24V supply — not off the 12V distribution block (keeps the Victron's noise isolation intact) | Removed entirely once a 12V-native production panel replaces the Dell |
| Distribution block → spare fused branch (reserved) | For the PA amp, if the AUX/existing-speakers test (§4) comes back short | Not real yet — headroom to leave in the fuse-way count |
| Interior Display GND, Bus Controller GND, Converter GND → single chassis ground point | Three separate ground leads, not daisy-chained | Firm |
| Ferrite chokes | On each power lead where it exits/enters an enclosure | Firm installation step |

### Data/signal cables

| Cable | Spec | Status |
|---|---|---|
| HDMI, Bus Controller → interior display | Shielded, short run | Firm on spec; exact length depends on the still-open display pick (§6) |
| Antenna | The old CM5 pick had a documented antenna pigtail/SMA-bulkhead path; the MeLE Quieter4C's internal WiFi antenna routing isn't documented anywhere in this repo | **Open — not carried over from the old CM5 spec, not yet re-established for the new board** |
| **Interim audio test only:** Bus Controller 3.5mm jack → vehicle radio head unit AUX-IN | Plain 3.5mm-to-3.5mm cable, or 3.5mm-to-stereo-RCA depending on the head unit — check before buying | **Test path, not committed** — see §4 |

### Explicitly wireless — no cable, don't budget one

- **Driver tablet ↔ Bus Controller** (state/schedule/announce push) —
  WiFi, Controller-hosted AP (§3).
- **GPS** — lives entirely on the driver tablet's own GNSS chip (§2); no
  GPS module or cable to the Bus Controller at all.

### Open items blocking the full cable BOM

- **Display power connector + wattage** (§6) — panel itself still TBD.
- **PA amp** (§4) — no amplifier/speaker hardware specified anywhere yet;
  the wiring implications depend on whether the AUX test succeeds.
- **Bus Controller power draw** (§1) — needs reconfirming against the
  MeLE Quieter4C, not carried over from the old CM5-specific numbers.
- **WiFi antenna routing** — not documented for the new board, see above.
