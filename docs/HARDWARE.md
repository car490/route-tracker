# Onboard vehicle hardware — consolidated spec

Single source of truth for every piece of physical hardware in the
onboard/vehicle system (Bus Controller, GPS, passenger display, driver
tablet/cab device, power, networking, mounting). Supersedes the
`## Hardware`, `## Storage`, `## Why two WiFi radios`, and `### Option B
panel` sections that used to live in `pi-server/DEPLOY.md` — that file now
just points here and keeps its step-by-step install instructions.

Two other source documents feed into this one and are **not edited by
it**:
- `docs/BusOpsDriver_Proposal.source.html`/`.pdf` — the formal, versioned
  procurement proposal, referenced by section number throughout. Where
  this doc says something has moved on from what the proposal says, that
  means the proposal is stale on that point, not that this doc overrides
  it as a formal deliverable.
- `CAB-DEVICE-SETUP.md` (repo root) — the actual, currently-deployed
  driver-facing device (§4), summarized here but kept as the detailed
  reference.

---

## Read this first: two competing architectures, unresolved

The proposal doc and what's actually built in this repo describe **two
different systems**, and nothing in the repo has reconciled them. This
affects real procurement decisions (does the Pi need its own GPS module?
does it need a second WiFi radio?), so don't silently pick one while
reading the rest of this doc — the sections below flag which model each
item belongs to.

**Model 1 — what's actually built** (`pi-server/*`, `onboard.js`, current
`DEPLOY.md`):
- The Pi has its **own physical GPS module** (USB/UART, e.g. u-blox),
  read by `gpsd` and bridged out at `/api/position` (`pi-server/gpsd-client.mjs`).
- The passenger display (`onboard.js`) **independently polls Supabase**
  (`get_duty_card` RPC) for journey state — it doesn't receive anything
  pushed to it from the driver's device.
- The driver's own PWA (phone or tablet, `src/main.js`) talks to Supabase
  directly; it has no local link to the Pi at all.
- WiFi hotspot model: Pi's onboard radio (`wlan0`) stays a normal client
  for the depot sync; a **second USB WiFi dongle** (`wlan1`) runs the
  permanent hotspot other devices join.

**Model 2 — the proposal's design** (`docs/BusOpsDriver_Proposal.source.html`
§2, §3.1, §5 Signal Path, §7.2):
- The Pi ("**Bus Controller**") has **no GPS hardware of its own** — GPS
  polling happens entirely on the driver's tablet ("**Driver PWA**",
  Blackview Active 5 as of 2026-08-13 — see §5), which sends structured JSON progress events
  (`next_stop`, `eta_next_stop`, etc.) to the Bus Controller over a local
  WiFi link. The Bus Controller renders the passenger UI from those events
  and drives the display over HDMI — it's a receiver/renderer, not an
  independent Supabase poller.
- WiFi hotspot model: the Bus Controller hosts the AP on its **single
  onboard radio** — no second dongle. (§3.1: "Corrected: the Bus
  Controller hosts the local network... The device does not host its own
  hotspot.")

These aren't a documentation typo — they're two different system designs.
Model 1 is what's actually running; Model 2 is what the formal proposal
specifies. Which one is the real target determines whether a GPS module
and a second WiFi radio belong on the Bus Controller's BOM at all. **This
needs a decision from the team, not an assumption from this doc.**

**Networking (§7) resolved 2026-08-13: the Pi hosts the AP, the Driver
device joins it as a client** — both models already agreed on this point
(see §7); the only thing in question was whether a competing "Driver
hosts, Pi joins" plan (briefly considered again this session, callback to
the since-superseded 2026-07-22 WiFi Direct design — see
`project_nextstop_architecture` memory) should displace it. It doesn't —
confirmed given the CM5 hardware already procured (§1) and to avoid the
MDM/Device-Owner or WiFi-Direct-fragility exposure either alternative
carries. `pi-server/announceRelay.mjs` (Pi-hosted WebSocket relay) and
`src/announceLink.js` (Driver-side client that dials out to it) already
match this — no code rework needed. The GPS-ownership/independent-polling
question (Model 1 vs Model 2 otherwise) is unaffected by this and remains
open.

**A third layer, on top of both:** neither model above is what's actually
in drivers' cabs right now. The real driver-facing device today is a
temporary bridge — see §4 — that isn't the Tab A9 LTE tablet either
model assumes.

---

## 1. Bus Controller (Raspberry Pi)

| Item | Spec | Status |
|---|---|---|
| Board | **Waveshare CM5 carrier baseplate + official Raspberry Pi CM5108032 module** (8GB RAM, 32GB eMMC, **wireless**), bundled with an antenna kit and heatsink — ordered and confirmed 2026-08-13, ahead of the "future hardening step" framing this doc previously used. Both earlier open items are now closed: (1) **wireless confirmed** — the `CM5108032` part number is the WL SKU, not No-Wireless; (2) **antenna covered** — the bundle includes an antenna kit, and Waveshare's CM5 baseplates route the module's antenna out to an SMA bulkhead connector for exactly this (confirm the antenna is actually mounted somewhere useful inside the polycarbonate enclosure at build time, not left coiled up next to the metal Faraday-cage risk it's meant to avoid). AP+STA concurrent mode (hosting the Driver's AP while also doing the depot WiFi sync) is achievable on CM5's radio via a virtual-interface trick (`uap0` alongside `wlan0`, same technique as a stock Pi 5) — real and documented, not hopeful — with the caveat that AP and STA share one radio so both are forced onto the same channel; if that proves flaky in testing, the fallback is the same second-USB-WiFi-dongle hedge Model 1 already uses today. Still unconfirmed: which specific Waveshare baseplate variant (Nano/Mini/IO-Base/Dual-Eth, etc. — they differ in USB/GPIO/M.2 headroom for that dongle-hedge fallback and future roles per §10). | Board choice settled 2026-08-13 (see networking note above). Original Pi 5, 4GB pick (below) is now the fallback only if this hardware doesn't pan out in testing. Module confirmed as **CM5108032** ("Package A" bundle): quad-core Cortex-A76 (BCM2712), onboard PCIe Gen 2 x1, onboard Gigabit Ethernet PHY (IEEE1588-capable), B2B connector compatible with CM4-generation carrier boards. **Baseboard confirmed 2026-08-13: Waveshare CM5-PoE-BASE-A** — 2× full-size HDMI (dual 4K out), 2× USB3.2 Gen1 + 2× USB2.0 (four spare ports total — covers the AP/STA-dongle fallback in §7 and the §10 near-term PA/ticketing/APC headroom with room left over), onboard M.2 M-Key slot (NVMe SSD needs no separate HAT, though the module's onboard 32GB eMMC already covers the demo build), Gigabit Ethernet with 802.3af/at PoE compliance, 40-pin GPIO header (candidate interface for the §10 PA amp relay control), onboard RTC + battery holder, fan connector. Power input: **either** 802.3af/at PoE **or** USB-C 5V/5A DC — both present on the board; the production power design (§6) uses the USB-C leg off the 12V distribution block, PoE is available but not currently part of the planned chain. |
| ~~Board (superseded, kept as fallback)~~ | Raspberry Pi 5, 4GB | No longer the primary pick — see CM5 row above. Pi 4 remains a supported fallback either way (existing stock) — boots from USB3 SSD instead of NVMe. |
| RAM sizing | 4GB — "sufficient for kiosk browser + hostapd + one WebSocket link" | Stated justification, treated as settled. |
| Storage | **No microSD, ever** — vibration, write-endurance (gpsd/Node/journald logs), and unclean-shutdown corruption risk all rule it out. NVMe HAT (e.g. Pimoroni NVMe Base, Waveshare PCIe HAT) + M.2 2230/2242 SSD, 32GB+. Pi 4 fallback: USB 3.0 SSD (e.g. Samsung T7). | Firm requirement (no microSD); specific HAT/SSD brand is "e.g.", not mandated. |
| Power | 5V/5A via USB-C, fed from a 12V-in USB-C PD point-of-load module (25–60W rated) | Firm, part of the power chain — see §6. |
| Enclosure | **Polycarbonate**, combined with the power electronics in one enclosure, recessed into the ceiling void — **metal is explicitly disallowed**: it would Faraday-cage the Pi's onboard WiFi, which the AP (whichever model above is real) depends on. | Firm, specific reason given, not just a preference. |

## 2. GPS

Two independent hardware chains — don't conflate them:

| Chain | Spec | Status |
|---|---|---|
| **Pi's own GPS module** (Model 1 only) | USB or UART module, e.g. u-blox NEO-6M/7M/8M, device path `/dev/ttyUSB0` or `/dev/ttyAMA0`, read via `gpsd` | Only needed if Model 1 (Pi has its own GPS) is the real target — the proposal's Bus Controller procurement table (§7.2) has no GPS line item at all. |
| **Driver tablet's GNSS** (both models — this one is unconditional) | The device needs its own GPS+cellular capability regardless of which specific SKU is chosen. Production target as of 2026-08-13: **Blackview Active 5** (built-in GPS + Dual SIM 4G LTE — see §5). Superseded pick: Samsung Galaxy Tab A9 LTE (SM-X115); its WiFi-only sibling SM-X110 was rejected earlier for lacking a GNSS chip at all — same reasoning, different device now. | Firm regardless of which architecture model is real — the driver device needs its own GPS either way. (This is the proposal's target tablet — see §5. Today's actual cab device, §4, uses browser geolocation instead.) |

## 3. Passenger / interior display

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
- **Text ≥22mm in height on a contrasting background** (§1.4). **Resolved
  2026-08-13**: `onboard.js` now computes the correct `--min-text` vh value
  at runtime from a per-panel physical diagonal supplied once via
  `?panel-diagonal=<inches>` (`computeMinTextVh()`, see `pi-server/DEPLOY.md`
  "Panel physical size"), rather than relying on the old fixed 17vh
  constant that only happened to be correct for two specific panels. Any
  future panel just needs its diagonal size added to the kiosk URL — no
  code change required. The Dell P2426H used in the demo build needed this:
  reusing the old fixed constant would have rendered text at ~2.3× the
  required size (7.4vh actually needed vs. 17vh assumed).
- **Small/light enough for the ceiling-void install** without structural
  changes to the vehicle.

### Nice-to-have (comfort, cost, or aesthetics — not compliance-driven)
- **Touch capability** — confirmed unused. The display has zero passenger
  interaction; `onboard.html` says so explicitly. A touch panel doesn't
  hurt, but it's not required.
- **Bezel-less/open-frame chassis look** — reads more "installed panel,"
  less "PC monitor bolted in," but a standard-bezel consumer monitor
  works functionally, VESA-mounted instead of on its desk stand.
- **VESA-mount convenience, professional/brand-matched look** — relevant
  for the beta specifically (avoids a bespoke enclosure); not a
  production compliance requirement.

### Undetermined — flagged as open, not invented
- Daylight brightness/nits for readability through vehicle glazing —
  the proposal's commissioning steps (§6.3) say to "test," but no minimum
  nit figure is specified anywhere.
- IP/dust rating, operating temperature range — not addressed anywhere.
- The actual wattage ceiling the existing sign wiring can supply — referenced
  repeatedly ("fits the existing wiring") but never given a number.

**Two hardware paths, confirmed 2026-08-13, revised same day:** no rugged,
vehicle-mountable panel meeting the MUST-haves above is available
off-the-shelf — this isn't a pending-order gap, it's a genuine sourcing
dead end research has hit twice now (Allsee/VSDISPLAY below, and again
since the 2026-08-02 small-panel pivot). Two paths follow from that — but
**correction to this note's first version**: they are not "demo on a
bench vs. production in a vehicle." The demo build uses the **same
mounts, Bus Controller, power chain (Victron converter, distribution
block, PD modules, grounding — all of §6), and install locations** as
production — it's a real physical validation, not a bench mockup. The
only two differences are the panel itself and one added component:
- **Demo/validation path (real, in use today):** the Dell Pro P2426H
  (below) stands in for the not-yet-sourced production panel, and because
  it needs mains **240V AC** while the rest of the system is the real 24V
  vehicle supply, a **24V-input pure sine wave inverter (~150W, confirmed
  2026-08-13)** feeds it — tapped pre-converter, straight off the raw 24V
  supply on its own fuse, deliberately **not** off the isolated 12V
  distribution block (see §12 for why: the Victron converter's isolation
  exists to keep switching noise away from the electronics sharing that
  rail, and an inverter is exactly the kind of noisy load it's isolating
  against). This is the one branch that doesn't match how the eventual
  production panel will be wired — see §12 for the full cable-level
  detail.
- **Production path (still unresolved):** once a 12V-native panel is
  sourced, the inverter is removed entirely and that panel wires straight
  into a 12V branch off the distribution block, same as every other
  device in §6. No candidate meeting 12V-native + fits-the-existing-wiring
  + vehicle-rugged has been found yet — treat this as an open sourcing
  problem to actively solve, not a detail to fill in later.

### Status trail (why this looks unsettled — it genuinely is)
| Panel | Status | Source |
|---|---|---|
| Fire HD 10 tablet | Still a live, supported option (`DEPLOY.md` "Option A") | `pi-server/DEPLOY.md` §5 |
| Allsee WS28HD8-B / "VSDISPLAY 28" 1920×360" stretch-bar | **Dropped** — hard to source in time, and the target fleet's wiring can't take a large-format retrofit without a major rewire | Proposal §7.3; `DEPLOY.md`'s own "Option B panel" section calls its own stretch-bar example stale |
| **Dell Pro P2426H, without stand** (210-BVTG, service tag FZG4ZD4) | **Demo/validation only**, mains 240V — see two-path note above. 24" FHD IPS, 100×100mm VESA, full-size HDMI + DisplayPort in, ships with a plain IEC mains lead (100–240V AC, 74W max — no external power brick). In active use for the physical fit-out today; explicitly not a production candidate. | This session, 2026-08-13 |
| Production panel | **TBD, unresolved sourcing gap** — "compact, low-power, standard aspect ratio, fits the existing wiring," and no off-the-shelf candidate found meeting all three as of 2026-08-13 | Proposal §7.3 |
| ~~Beta pick — iiyama ProLite XUB2492HSN-B1~~ | **Removed 2026-08-13** — explicitly dropped in favor of the Dell Pro P2426H above, which is the confirmed unit in use for demo/beta. Its open question (existing wiring vs. temporary supply) is now moot. Do not reintroduce without checking with the user first. | Superseded, kept for audit trail only |

## 4. Cab device — the temporary bridge actually deployed today

Full detail: `CAB-DEVICE-SETUP.md` (repo root). This is **not** the
proposal's Tab A9 LTE tablet — it's a deliberately different, much
simpler stopgap, explicitly framed as lasting "the next ~6 months, until
vehicles carry NextStop-native hardware" (i.e. until whichever of Model 1
or Model 2 above actually gets built).

| Item | Spec | Status |
|---|---|---|
| Device | **Any** Android phone/tablet — no specific SKU, no LTE requirement | Deliberately unconstrained — "any unit can be swapped between the 4 vehicles with zero reconfiguration" since nothing on it is bound to a specific vehicle |
| GPS | Browser's `navigator.geolocation` — same source the existing driver-phone flow already uses | **No dedicated GPS module** — unlike the proposal's tablet, this doesn't require an LTE/GNSS-capable SKU |
| Power | Ignition-switched USB supply, "like a dashcam" | Firm for this bridge; distinct from the vehicle's 24V→12V DC chain in §6 — a simple USB power source, not wired into the Victron converter |
| Mount | Not specified in the source doc | **Undetermined** — worth flagging as a gap, not assumed solved |
| Software | The existing driver PWA (`index.html`/`src/main.js`) itself, installed via "Add to Home Screen" + Android Screen Pinning — no new app, no dedicated firmware | Reuses `src/manualSelection.js`'s existing manual service/run picker; driver taps "Select a service manually" once on boot |
| Vehicle/driver binding | None — journeys created this way have `driver_id`/`vehicle_id` both `null` (`get_or_create_manual_journey`) | Known limitation: any dashboard report assuming every journey has a driver/vehicle will show gaps for cab-device journeys |
| Optional resilience | **Fully Kiosk Browser** (free Android app) if unattended reboots turn out to need auto-relaunch — screen pinning alone doesn't survive a reboot | Not required to ship the bridge, only if reboot behaviour turns out to be a real problem in practice |

**Why this matters for the rest of this doc:** §5 below (Driver PWA
tablet) and the WiFi/GPS architecture conflict at the top are both about
a *future* target state that hasn't been built. This section is what's
running now. Don't conflate the two when scoping new work — headroom
decisions (§10) should account for whichever of Model 1/Model 2 eventually
replaces this bridge, not extend the bridge itself.

## 5. Driver PWA tablet (cab-mounted, adjacent hardware — proposal's target, not yet built)

Not covered by `DEPLOY.md` at all (that file is Pi-side only) but wired
into and mounted alongside the same system per the proposal. This is the
**production target**, distinct from the cab-device bridge in §4 above,
which is what's actually deployed today.

| Item | Spec | Status |
|---|---|---|
| Tablet | **Blackview Active 5 Rugged AI Tablet Phone** — 8.68" HD+ 90Hz, IP68/IP69K, Android 15, 24GB RAM/128GB storage, Dual SIM 4G LTE, GPS, WiFi, fingerprint, 6600mAh, 218.5×131.7×12.3mm, 510g | **Confirmed production target 2026-08-13, supersedes the Tab A9 LTE pick below.** Already meets the same functional requirements the Tab A9 was chosen for (GNSS, independent cellular for mid-route Supabase connectivity) and adds IP68/IP69K ruggedness the Tab A9 never had documented. Also the physical unit in the current demo build. |
| ~~Tablet (superseded, 2026-08-13)~~ | Samsung Galaxy Tab A9, **LTE (SM-X115)**, 8GB/128GB | No longer the production pick — see Blackview row above. LTE SKU was required for GNSS (see §2); WiFi-only SM-X110 was rejected for lacking a GNSS chip — that reasoning carried over as *why a GPS+cellular-capable SKU matters*, not as an endorsement of this specific device. |
| Cab mount | **RAM® X-Grip® Universal Holder for 7"-8" Tablets** (RAM-HOL-UN8BU, B-size ball) — the Blackview's 131.7mm width sits inside this class's 57–146mm range, below the 9"-11" class's ~159mm minimum. **Bolted base, not suction-cup**, rated for commercial-vehicle vibration | Firm. Supplier: [MUD-UK](https://www.mudstuff.co.uk/products/x-grip-7-8-tablet-holder) or RAM Mounts UK. (Superseded the earlier "9"-11" or Tab-Tite" guidance, which was sized around the Tab A9, not the Blackview.) |
| Power | 12V-in USB-C PD module → tablet USB-C fast charge | Firm, part of the power chain below. Assumes the Blackview charges via USB-C (standard for current Android devices in this class) — not separately verified against its datasheet. |

## 6. Power / electrical

| Item | Spec | Status |
|---|---|---|
| Vehicle supply | 24V auxiliary circuit, tapped downstream of the master isolator switch | Firm |
| Central converter | **Victron Orion-Tr Isolated 24/12** — the *isolated* variant specifically, for galvanic noise/interference isolation ("sold explicitly for comms/entertainment/navigation systems"). **Recommended current tier, 2026-08-13: the 24/12-20 (240W)** — per Victron's own datasheet, the 24/12 line comes in 9A/110W, 20A/240W, and 30A/360W continuous tiers. Today's actual 12V-side load (Bus Controller ~2.4A + driver tablet ~2–3A ≈ 5A) leaves almost no headroom on the 9A tier for the reserved-but-real future branches (§10's PA amp, production display), while the 30A tier (heavier, 1.6kg vs 1.3kg) is genuine overkill for what this system actually draws. The 20A tier gives ~4x headroom over today's real load, matching §10's "reserve headroom, don't over-specify" philosophy. | **Recommended, not yet confirmed as purchased** — flag if a different tier was actually bought. Suppliers: 12 Volt Planet, Sunshine Solar, BMS Technologies, Midsummer Energy (UK). |
| **Main input fuse** (master switch → converter) | **20A**, sized against the 24/12-20's own datasheet numbers: continuous input current at 24V is ~11.4A (40°C/240W continuous rating) to ~14.2A (25°C/300W continuous rating), accounting for 88% conversion efficiency. 20A clears the worst case with headroom and sits well inside the converter's own max cable rating for this tier (16mm²/AWG6). **Note:** the 24V-input Orion-Tr models have their own internal, non-replaceable input fuse per Victron's manual — this external fuse is not redundant with it, it protects the *cable run* from the master switch to the converter, which the internal fuse does not (Victron's own wiring diagrams still show an external fuse at the battery/switch end). | Recommended 2026-08-13, contingent on the 24/12-20 tier above being the one actually used — resize if a different tier is purchased. |
| Rejected earlier design | Two separate generic 24V→12V and 24V→5V converters | Explicitly superseded by the single isolated stage + point-of-load modules |
| Distribution | Fused 12V distribution block, individual fuse per branch (one downstream short doesn't take out the rest) | Firm. Supplier: Vehicle Wiring Products. |
| Point-of-load modules | 12V-input USB-C PD modules, 25–60W rated — one per device (Pi 5, driver tablet) | Firm. Suppliers: RS, Farnell. |
| Interior display power | Native 12V input, no conversion module needed | Firm (contingent on the display itself, still TBD) |
| Grounding | Interior Display GND + Bus Controller GND + DC-DC Converter GND → single chassis ground point | Firm |
| Ferrite chokes | On power lines | Firm installation step, no specific part |
| Wiring | 24V-rated automotive power loom | Firm. Supplier: Vehicle Wiring Products. |
| ~~Beta display power (contingent)~~ | ~~iiyama monitor's universal 100–240V AC input~~ | **Removed 2026-08-13** — iiyama dropped in favor of the Dell P2426H, whose mains power path is already covered above via the demo inverter branch (§12). |

Note: this whole chain is the **proposal's** power design (Model 2 /
production target). The cab-device bridge (§4) is not wired into it at
all — it runs off a simple ignition-switched USB supply.

### Sudden power loss / ignition-off (added 2026-08-13, previously undocumented)

The whole chain above sits downstream of the master isolator switch (§6
top row) — there is no soft-shutdown warning when it's switched off, the
24V rail simply disappears. Worth being precise about which component
this actually threatens:

- **Driver tablet, interior display, any future PA amp** — not really at
  risk. The tablet has its own battery (charging just stops); the display
  and amp have no persistent writable storage, they just go dark/silent.
- **Bus Controller (CM5)** — the real risk. It's a full embedded Linux
  computer with a live root filesystem. §1's "no microSD, ever" already
  flagged unclean-shutdown corruption as a reason to avoid SD cards, but
  switching to eMMC/NVMe only reduces *wear-related* failure — it does
  **not** by itself prevent filesystem corruption from a write that's
  mid-flight when the rail cuts instantly. This was never separately
  addressed until now.

Recommended layered approach, cheapest/most-important first:

1. **Read-only root filesystem** — Raspberry Pi OS supports this natively
   (`raspi-config`'s overlay filesystem option): root mounts read-only,
   anything that thinks it's writing goes to a RAM-backed overlay instead.
   Makes the OS image itself immune to corruption regardless of when power
   cuts. Software-only, no extra hardware/cabling. First line of defense
   and probably sufficient on its own for most of this box's workload.
2. **Keep genuinely-persistent state** (`pi-server`'s schedule cache,
   logs) **off the read-only root**, on a small writable partition,
   written via write-temp-then-atomic-rename so a torn write never leaves
   a half-written file. Software design detail for whoever builds that
   persistence layer, not a cabling matter — flagged here so it isn't
   missed.
3. **Optional: a small supercap/UPS hold-up module** between the 12V
   Bus-Controller branch and its USB-C PD module — holds the rail up for a
   few seconds after power cuts, enough to run a clean `shutdown -h now`.
   This overlaps with a *different*, earlier-flagged problem from this
   project's design history: the Pi needing to auto-boot fast enough to be
   ready inside the pre-duty walkaround window (a master-switch-off
   vehicle has no literal 24/7 power). The same physical component serves
   both — ride-through for momentary sags (e.g. engine cranking) and a
   graceful-shutdown window on sustained loss — but with (1) already in
   place, this becomes a nice-to-have rather than load-bearing. Not
   currently speced to a specific part; revisit if (1) alone proves
   insufficient in practice.
4. **Enable the CM5's onboard watchdog timer** — cheap, orthogonal to
   corruption, but means a hang triggers an auto-reboot rather than
   needing a physical power-cycle.

## 7. Networking

See the architecture-conflict note at the top — this table gives both models rather than picking one.

| Item | Model 1 (as built) | Model 2 (proposal, §3.1/§6.3) |
|---|---|---|
| Depot sync | `wlan0`, normal WiFi client, joins depot WiFi each morning | Same |
| Hotspot for other devices | **Second radio**: USB WiFi dongle (e.g. Edimax EW-7811Un) running `wlan1` as a permanent AP, static IP `192.168.4.1/24` | **Pi's own onboard radio** hosts the AP directly — no second dongle. WiFi interface marked `unmanaged` in NetworkManager so it doesn't fight the manually-run `hostapd`. |
| Who joins the hotspot | An external display device (Fire HD, if Option A) | The Driver PWA tablet, as a standard low-privilege client, one-time pairing at commissioning |
| Recent stability | This has already flip-flopped once in this repo's history: commit `7f1a342` removed the hotspot entirely (assumed no longer needed), commit `a60d075` restored it days later after a `develop` merge showed it was still required | — |

## 8. Mounting / enclosure

| Item | Spec | Status |
|---|---|---|
| Bus Controller + power electronics enclosure | Polycarbonate (see §1) | Firm |
| Interior display ceiling-drop mount | Sized to the final panel's weight and VESA/mounting pattern | **TBD** — depends on the undetermined display panel (§3) |
| Anti-vibration isolation mounts | On the ceiling-drop mount assembly | Firm requirement, generic hardware. Supplier: Screwfix (M8 bolts). |
| HDMI cable | Shielded, short run | Firm — interference reduction. Supplier: The Pi Hut. |
| Driver tablet mount | See §5 | Firm (proposal's target device — the cab-device bridge in §4 has no specified mount) |

## 9. Known compliance gaps (carried from Appendix A — not re-solved here)

These are documented gaps with **no assigned hardware owner** — not
committed roadmap items, and not something this doc resolves:

- **No PA amplifier/speaker system specified anywhere** (Appendix A
  §2.2/§2.3) — the 3dB-above-ambient and 84dB-ceiling audio requirements
  depend on PA hardware that doesn't exist in any procurement table yet.
  **Interim test plan, added 2026-08-13:** before committing to any new
  PA hardware, try the host vehicle's **existing speakers via its
  existing radio head unit's AUX-IN** — cable is simply the Blackview
  Active 5's 3.5mm headphone jack (confirmed present, §5) to whatever the
  radio's AUX-IN takes (commonly 3.5mm, occasionally stereo RCA — check
  the specific head unit before buying the cable). This is explicitly a
  **listening test, not a committed design** — the existing speaker
  configuration is unknown (routing, zones, whether the driver can even
  select the AUX source while the ignition/PA needs to announce
  automatically), and the SPL requirements above still need a real
  measurement against it either way, using the same calibration workflow
  already built for a dedicated PA (`vehicle_audio_config`,
  `getAudioLevelForVehicle()` in `src/audioConfigPipeline.js`): play a test announcement through whichever
  path is chosen, measure SPL, record it. If the existing setup clears
  the 3dB-above-ambient/84dB-ceiling bar, it may remove the need for new
  PA hardware entirely; if not, this test at least establishes a baseline
  before spending on an amp/speaker.
- **Induction hearing loop** (§2.5) — "not addressed anywhere in the
  current build," independent of this proposal.
- **No door-open sensor** (§3.1) — GPS-confirmed arrival is used as a
  proxy trigger for "doors open" announcements instead.
- **No alert-tone/chime** (§4A/5.1) — diversion and final-stop
  announcements go straight to spoken content with nothing preceding
  them; a short fixed chime clip is recommended but not built.

## 10. Near-term Bus Controller roles — reserve headroom, don't over-specify

The Bus Controller runs the passenger display only today. Three additional
roles are expected soon (confirmed directly by the team, not yet in any
proposal or procurement doc):

- **PA / audio announcement hardware** — the closest match to an existing
  documented gap (§9 above has no assigned owner for PA/amp/speaker
  hardware). Likely implication: amplifier control (relay/GPIO or I2S
  audio out) and a spare fused 12V branch for amplifier power, separate
  from the Pi's own draw.
- **Contactless ticketing / fare validation** — likely a USB or serial
  card/NFC reader. Worth flagging even before a device is chosen: the Pi
  should probably **relay only**, not store or handle raw card data, to
  keep PCI-type compliance scope off the Bus Controller itself. Headroom
  implication: a spare USB port and network path to whatever payment
  backend is chosen.
- **Automatic passenger counting (APC)** — typically door-mounted
  IR/stereo sensors feeding counts back to the Pi over USB, RS-485, or
  Ethernet. Headroom implication: spare USB/serial capacity, minor
  compute margin for tallying.

No hardware, model numbers, or interfaces are chosen for any of these —
none should be inferred from this section. What it does establish: when
sizing the Pi's power budget, enclosure, and available ports going
forward, leave margin rather than speccing right up to the current
display-only workload's limit.

## 11. Decision history (why parts of this look unsettled)

For anyone reading this fresh and wondering if something was overlooked —
it wasn't, these are tracked reversals, not gaps:

- `1315787` — proposal doc corrected to the confirmed picks (Tab A9 LTE,
  Allsee 28" panel, Victron Orion-Tr Isolated, polycarbonate enclosure),
  PSV(AI)R Appendix A added.
- `7136e9b` — the 28" Allsee panel dropped from the proposal; production
  display marked TBD, wiring-constraint reasoning added.
- `7f1a342` — (this repo, same-day session) `wlan1` hotspot and its config
  examples removed, assuming the display no longer needed WiFi.
- `9a2946b` / `a60d075` — merge with `develop` showed the hotspot was
  still required (Fire HD Option A depends on it); config examples
  restored.
- `a151dea` / this doc — beta monitor pick logged, then found to still
  have an open question (existing wiring vs. temporary power) rather than
  being fully resolved.
- `5486ec4` — `CAB-DEVICE-SETUP.md` written on a separate branch
  (`claude/pwa-cab-device-setup-708jeb`), describing the actual bridge
  hardware deployed in cabs today. It sat unmerged and undocumented here
  until this doc's own review process found it by checking branches other
  than `develop` — worth remembering that `develop` isn't guaranteed to
  be the whole picture.
- This doc, 2026-08-13 — §5's Samsung Galaxy Tab A9 LTE pick superseded by
  the **Blackview Active 5** (already the physical demo unit, and now the
  confirmed production target): meets the same GNSS/cellular requirement
  the Tab A9 was chosen for, adds IP68/IP69K ruggedness the Tab A9 never
  had, and changes the RAM Mounts cradle class from 9"-11" to 7"-8" (its
  131.7mm width doesn't reach the 9"-11" class's ~159mm minimum).
- This doc, 2026-08-13 — the iiyama ProLite XUB2492HSN-B1 beta pick (added
  `a151dea`, 2026-08-10) removed outright, not just reconciled: user
  confirmed the Dell Pro P2426H is the one unit in use going forward for
  demo/beta. Its unresolved wiring-vs-temporary-power question is moot as
  a result. Don't reintroduce the iiyama without checking first.

## 12. Cabling (added 2026-08-13)

Every physical cable implied by §1–§8, for the **production target (Model
2)** only — the cab-device bridge (§4) is a separate, much simpler
ignition-switched-USB setup and isn't covered here. Grouped by run, in the
same Firm/TBD convention as the rest of this doc.

### Power chain (§6) — one continuous run, in order

| Segment | Spec | Status |
|---|---|---|
| Vehicle 24V loom → master isolator switch → **input fuse (20A, see §6)** → Victron Orion-Tr Isolated 24/12-20 | 24V-rated automotive cable, tapped downstream of the master switch | Firm on wiring; fuse/converter tier recommended 2026-08-13, see §6. Supplier: Vehicle Wiring Products. |
| Converter output → output fuse → fused 12V distribution block | 12V-rated cable, short run — converter and distribution block sit close together in/near the same enclosure | Fuse: **10A** recommended (protects the short converter-to-block cable, sized above the ~5A combined Bus Controller + tablet load with headroom for the reserved future branches, well under the converter's own 20A continuous output rating) |
| Distribution block → branch, **5A** fuse → 12V-in USB-C PD module → **Bus Controller** USB-C power-in | Fused branch + PD module + USB-C lead. Fuse sized against the CM5-PoE-BASE-A's 5V/5A (25W) max USB-C draw — ~2.4A at 12V-in accounting for PD module conversion loss | Firm on wiring; fuse size recommended 2026-08-13 |
| Distribution block → branch, **5A** fuse → 12V-in USB-C PD module → **Driver tablet** USB-C power-in | Fused branch + PD module + USB-C lead — longer run than the Bus Controller's (distribution block is in the ceiling void, tablet is dash-mounted). Fuse sized against an estimated ~2–3A at 12V-in for the Blackview's USB-C fast charge (exact PD wattage unconfirmed) | Firm on wiring; fuse size recommended 2026-08-13, revisit once the Blackview's actual charge wattage is confirmed |
| Distribution block → branch → **interior display** power-in | **Production (once panel is sourced):** straight 12V, no PD module (native 12V input) — routes through the distribution block same as every other device. | Production connector type still **TBD** pending the panel sourcing gap. |
| **Demo only:** Vehicle 24V loom → **7.5A** fuse → **24V-input pure sine wave inverter** (~150W, e.g. Samlex PST-150-24 or ROADKING's 24V pure-sine range — sized against the Dell's 74W max draw) → Dell P2426H's own IEC mains lead | Fuse sized against ~3.5A continuous input draw at 24V (74W ÷ ~87% inverter efficiency ÷ 24V), with headroom for inverter startup inrush. Deliberately tapped **pre-converter, off the raw 24V supply — not off the 12V distribution block.** The Victron Orion-Tr Isolated converter (above) was chosen specifically for galvanic noise isolation for the sensitive electronics sharing that 12V rail; running an inverter off the same rail it feeds would reintroduce the switching noise the isolation exists to keep out. Removed entirely once a 12V-native production panel replaces the Dell — see the production row above. | Spec confirmed 2026-08-13; exact inverter model/supplier still to be finalized with the vehicle electrical build. |
| Distribution block → spare fused branch (reserved) | For a future PA amp (§10) | **Not real yet** — no PA hardware spec exists; this is headroom to leave in the distribution block's fuse-way count, not a cable to source now |
| Interior Display GND, Bus Controller GND, Converter GND → single chassis ground point | Three separate ground leads, not daisy-chained off each other | Firm |
| Ferrite chokes | On each power lead where it exits/enters an enclosure | Firm installation step, no specific part |

### Data/signal cables

| Cable | Spec | Status |
|---|---|---|
| HDMI, Bus Controller → interior display | Shielded, short run (§8) — the one video cable in the system | Firm on spec; exact length depends on the still-open display pick (§3) |
| Antenna pigtail, CM5 module → baseplate SMA bulkhead connector | Internal, short — included in the Waveshare antenna kit already procured (§1), not sourced separately | Firm. External antenna itself then needs a clear-of-metal mounting point inside the polycarbonate enclosure. |
| **Interim audio test only:** Blackview Active 5 3.5mm headphone jack → vehicle radio head unit AUX-IN | Plain 3.5mm-to-3.5mm cable, or 3.5mm-to-stereo-RCA if the specific head unit's AUX-IN is RCA — check before buying | **Test path, not committed** — see §9. Not part of the vehicle 24V/12V power chain at all (audio-only, no power leg); superseded entirely if a dedicated PA amp/speaker is chosen instead. |

### Explicitly wireless — no cable, don't budget one

- **Driver tablet ↔ Bus Controller** (state push) — WiFi, Pi-hosted AP (§7, resolved 2026-08-13).
- **Bus Controller ↔ depot WiFi** (schedule sync) — WiFi client, same radio.
- **GPS** — lives entirely on the driver tablet's own GNSS chip in Model 2; no GPS module cable to the Bus Controller at all. (Model 1's `gpsd`/u-blox USB-or-UART module, §2, is the *fallback-only* chain if Model 2 doesn't pan out.)

### Open items blocking the full cable BOM

- **Display power connector + wattage** (§3) — panel itself still TBD; can't spec the final 12V leg's connector until it's picked.
- **PA amp** (§9) — no amplifier/speaker hardware specified anywhere yet; analog vs I2S vs amplified-speaker-level wiring all imply different cable runs, and that decision hasn't been made.
- **Exact Waveshare baseplate variant** (§1, still open) — determines whether the NVMe SSD plugs into an onboard M.2 slot directly (no extra cable) or needs a separate HAT + ribbon cable, and whether there's a free USB port for the AP/STA-dongle fallback or future ticketing/APC hardware (§10).
