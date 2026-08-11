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
  Galaxy Tab A9 LTE), which sends structured JSON progress events
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

**A third layer, on top of both:** neither model above is what's actually
in drivers' cabs right now. The real driver-facing device today is a
temporary bridge — see §4 — that isn't the Tab A9 LTE tablet either
model assumes.

---

## 1. Bus Controller (Raspberry Pi)

| Item | Spec | Status |
|---|---|---|
| Board | Raspberry Pi 5, 4GB | Firm in both models. Pi 4 is a supported fallback (existing stock) — boots from USB3 SSD instead of NVMe. |
| RAM sizing | 4GB — "sufficient for kiosk browser + hostapd + one WebSocket link" | Stated justification, treated as settled. |
| Storage | **No microSD, ever** — vibration, write-endurance (gpsd/Node/journald logs), and unclean-shutdown corruption risk all rule it out. NVMe HAT (e.g. Pimoroni NVMe Base, Waveshare PCIe HAT) + M.2 2230/2242 SSD, 32GB+. Pi 4 fallback: USB 3.0 SSD (e.g. Samsung T7). | Firm requirement (no microSD); specific HAT/SSD brand is "e.g.", not mandated. |
| Power | 5V/5A via USB-C, fed from a 12V-in USB-C PD point-of-load module (25–60W rated) | Firm, part of the power chain — see §6. |
| Enclosure | **Polycarbonate**, combined with the power electronics in one enclosure, recessed into the ceiling void — **metal is explicitly disallowed**: it would Faraday-cage the Pi's onboard WiFi, which the AP (whichever model above is real) depends on. | Firm, specific reason given, not just a preference. |

## 2. GPS

Two independent hardware chains — don't conflate them:

| Chain | Spec | Status |
|---|---|---|
| **Pi's own GPS module** (Model 1 only) | USB or UART module, e.g. u-blox NEO-6M/7M/8M, device path `/dev/ttyUSB0` or `/dev/ttyAMA0`, read via `gpsd` | Only needed if Model 1 (Pi has its own GPS) is the real target — the proposal's Bus Controller procurement table (§7.2) has no GPS line item at all. |
| **Driver tablet's GNSS** (both models — this one is unconditional) | Requires the **LTE SKU** specifically — Samsung Galaxy Tab A9 **LTE (SM-X115)**. The WiFi-only SM-X110 was evaluated and explicitly rejected: no GNSS chip, fails the geofence requirement. | Firm regardless of which architecture model is real — the driver device needs its own GPS either way. (This is the proposal's target tablet — see §5. Today's actual cab device, §4, uses browser geolocation instead.) |

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
- **Text ≥22mm in height on a contrasting background** (§1.4). The UI
  (`onboard.css`) is already `vh`-based so it scales to whatever panel is
  chosen, but the 22mm figure itself must be re-verified against the real
  panel's physical size once one is picked — the earlier "compliant by
  design" reasoning specifically relied on the (now-dropped) 28" panel's
  fixed physical height and no longer applies.
- **Small/light enough for the ceiling-void install** without structural
  changes to the vehicle.

### Nice-to-have (comfort, cost, or aesthetics — not compliance-driven)
- **Touch capability** — confirmed unused. The display has zero passenger
  interaction; `onboard.html` says so explicitly. A touch panel doesn't
  hurt, but it's not required and Iiyama's open-frame touch chassis line
  appears to have no non-touch equivalent (unconfirmed — iiyama.com was
  unreachable to verify from this environment).
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

### Status trail (why this looks unsettled — it genuinely is)
| Panel | Status | Source |
|---|---|---|
| Fire HD 10 tablet | Still a live, supported option (`DEPLOY.md` "Option A") | `pi-server/DEPLOY.md` §5 |
| Allsee WS28HD8-B / "VSDISPLAY 28" 1920×360" stretch-bar | **Dropped** — hard to source in time, and the target fleet's wiring can't take a large-format retrofit without a major rewire | Proposal §7.3; `DEPLOY.md`'s own "Option B panel" section calls its own stretch-bar example stale |
| Production panel | **TBD** — "compact, low-power, standard aspect ratio, fits the existing wiring" | Proposal §7.3 |
| Beta pick — iiyama ProLite XUB2492HSN-B1 | Proposed for the 6-week/4-journeys-a-day beta **only**, contingent on an unresolved question: does the beta unit run off the vehicle's existing (constrained) sign wiring, or a temporary/external supply? If existing wiring, it's bound by the same low-power ceiling as production and this pick may not be viable. **Confirm before ordering.** | `pi-server/DEPLOY.md` §"Option B panel: which one to actually buy" |

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
| Tablet | Samsung Galaxy Tab A9, **LTE (SM-X115)**, 8GB/128GB | Firm — LTE SKU required for GNSS (see §2 above); also covers mid-route Supabase connectivity independent of any local AP. Supplier: Samsung UK / Currys. |
| Rejected | Wi-Fi-only SM-X110 | Explicitly rejected — no GNSS chip. |
| Cab mount | RAM Mounts C-size ball-and-socket, X-Grip or Tab-Tite cradle, **bolted base, not suction-cup**, rated for commercial-vehicle vibration | Firm. Supplier: RAM Mounts UK or MUD-UK. |
| Power | 12V-in USB-C PD module → tablet USB-C fast charge | Firm, part of the power chain below. |

## 6. Power / electrical

| Item | Spec | Status |
|---|---|---|
| Vehicle supply | 24V auxiliary circuit, tapped downstream of the master isolator switch | Firm |
| Central converter | **Victron Orion-Tr Isolated 24/12** — the *isolated* variant specifically, for galvanic noise/interference isolation ("sold explicitly for comms/entertainment/navigation systems") | Firm. Suppliers: 12 Volt Planet, Sunshine Solar, BMS Technologies, Midsummer Energy (UK). |
| Rejected earlier design | Two separate generic 24V→12V and 24V→5V converters | Explicitly superseded by the single isolated stage + point-of-load modules |
| Distribution | Fused 12V distribution block, individual fuse per branch (one downstream short doesn't take out the rest) | Firm. Supplier: Vehicle Wiring Products. |
| Point-of-load modules | 12V-input USB-C PD modules, 25–60W rated — one per device (Pi 5, driver tablet) | Firm. Suppliers: RS, Farnell. |
| Interior display power | Native 12V input, no conversion module needed | Firm (contingent on the display itself, still TBD) |
| Grounding | Interior Display GND + Bus Controller GND + DC-DC Converter GND → single chassis ground point | Firm |
| Ferrite chokes | On power lines | Firm installation step, no specific part |
| Wiring | 24V-rated automotive power loom | Firm. Supplier: Vehicle Wiring Products. |
| Beta display power (contingent) | iiyama monitor's universal 100–240V AC input — a *different* power source than the 24V/12V vehicle chain above | Only applies if the beta unit runs off a temporary/external supply rather than vehicle wiring — see §3 status trail, still open |

Note: this whole chain is the **proposal's** power design (Model 2 /
production target). The cab-device bridge (§4) is not wired into it at
all — it runs off a simple ignition-switched USB supply.

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
