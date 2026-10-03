# Announce Solo: commissioning runbook

The one start-to-finish procedure for putting a **BusOps Announce Solo** sign into service: a
14" tablet on the bus that shows and says the next stop by itself, with no Driver device and no
Bus Controller. Follow it in order. Each stage ends with a check; don't start the next stage
until it passes.

This runbook covers **what** to do and in which order. The detail behind some steps lives
elsewhere and is linked rather than copied, so it has one home:

| Detail | Where |
|---|---|
| Tablet set-up script, Fully Kiosk quirks, the LEVIRTU tablet's own findings | `SOLO-DEVICE-SETUP.md`, `CAB-DEVICE-SETUP.md` "Known quirks" |
| Power supply, why it is permanent and not ignition-switched | `docs/HARDWARE.md` "Power loss and first boot" |
| How Solo picks a departure (and why shared stops matter) | `docs/ANNOUNCE-PRODUCT-TIERS.md` "Solo's schedule-autopilot" |
| Test procedures (dev) | `docs/TESTING.md` §17 (Solo), §19 (power cut, screen switching) |
| What is decided and what is still open | `docs/DECISIONS.md` |

Added 2026-10-03. Before then the departures step needed SQL; it is now on the Dashboard.

---

## Stage 0: is Solo right for this bus?

Solo starts a trip when the bus is **near the first stop of one of its departures at about the
departure time**. That is only safe when:

- [ ] **No other service starts or ends at the same place** as the departures this sign will
      run, including **other operators'** services, which the Dashboard can't see. If one does,
      Solo is the wrong product; use Announce Lite (a Driver device tells the sign what is
      running) instead. The Dashboard warns about your own company's services at stage 2.
- [ ] **This bus runs the same departures every day it is in service.** If it swaps between
      routes from day to day, the sign has to be told each time (stage 2), or use Lite.
- [ ] **The route's stops all have announcement audio.** Check the Dashboard's announcement
      clip pages for gaps before the first trip; a stop with no clip is shown but not spoken.

## Stage 1: parts and accounts

- [ ] The **LEVIRTU 14" tablet** (PIXGOOD M328). A 14" display is required (owner, 2026-09-30).
- [ ] A **SIM with data**, or a WiFi network the bus can always reach. A phone hotspot is fine
      for a bench test only.
- [ ] **Fully Kiosk Browser PLUS licence** for this tablet. The sign switches its own screen on
      and off through PLUS; without it the screen never turns off.
- [ ] **Power parts:** a fused feed from a **permanent** (not ignition-switched) supply, through
      a **low-voltage cut-off** so the tablet can't flatten the bus battery, and a charger that
      keeps the tablet charged with the screen on.
- [ ] **Mount.** Still open: the chosen stanchion clamps fit 9–11" tablets, not 14"
      (`docs/DECISIONS.md` "Announce Lite/Solo tablet — mount"). Record what was actually used
      in the handover record.
- [ ] A laptop with `adb` (Android platform-tools) and a USB cable, and a Dashboard login for
      the company.

## Stage 2: office (Dashboard)

1. **Register the sign.** Dashboard → **Announce Devices** → **+ Add Device**. Pick the bus
   and give it a label you will recognise (e.g. "SN06JVZ front"). Save. The install link opens;
   you can close it and get it again later.
2. **Choose its departures.** On the device's row → **Solo set-up**:
   - Tick each departure this bus runs. Only tick what this bus actually runs.
   - Leave **15 minutes before**, **30 minutes after** and **150 metres** unless you have a
     reason. Narrow them if the Dashboard says two departures can't be told apart; widen the
     distance if the bus waits somewhere bigger than 150 m across (a large depot yard).
   - Read every warning. A warning about **another service** means stage 0 failed for that
     departure: untick it or don't use Solo. Tick "I have checked these" only when you know why
     the warning doesn't apply.
   - Save. The status column shows "Solo · N departures".
3. **Check the timetable behind it.** The sign's screen times and starts come straight from the
   departures, so:
   - [ ] School runs have **school term time** ticked, and this year's term dates are in.
   - [ ] **Bank holidays** that fall on a running day (e.g. Early May in term time) have a
         **removed date** on each run.
   - [ ] No **test departures** are ticked on a live sign (each keeps the screen awake).
4. **Get the install link.** Device row → **Get Install Link** → **Copy Link**. Treat it like a
   key: it is this sign's permanent credential. Paste it only into the setup command in stage 3;
   never into chat, email, a ticket or a document.

**Check:** the device row shows the right bus, "Solo · N departures", and Testing mode is
**off**.

## Stage 3: bench (tablet set-up)

Do this at a desk, with the tablet on its charger and on a network that will still be there
after a restart (SIM or real WiFi; **never** only a USB tunnel, see the warning at the top of
`SOLO-DEVICE-SETUP.md`).

1. On the tablet: Developer options → **USB debugging** on. Connect USB, accept the prompt.
2. Run the setup script with the install link (add the WiFi name and password only for a
   tablet with no SIM):
   ```sh
   cd pcv-dashboard/busops/announce/cab-device
   ./setup-solo-device.sh '<install link>'
   ```
   On Android 16, if the script reports it could not set the Home app, tap **Yes** on Fully's
   "Switch Kiosk Mode on?" and choose **Fully Kiosk Browser** as the Home app.
3. When the script asks whether the tablet shows the idle screen, answer **yes** only if it
   does. That deletes the settings copy (which holds the link) from the tablet.
4. Then by hand:
   - [ ] **Screen lock off** (Settings → Security → Screen lock → None), so a restart never
         stops at a PIN.
   - [ ] **Kiosk exit PIN set on the tablet:** Fully's menu → Settings → Kiosk Mode → Kiosk PIN.
         Keep it in the company's password store, never in the repo, chat or email.
   - [ ] **PLUS still licensed:** Fully's menu → About.
   - [ ] **Location allowed:** no location prompt left on screen.
5. **Restart test:** hold the power button about 10 seconds to restart it. It must come back to
   the idle screen with nobody touching it (one swipe past Android's first-unlock screen is
   acceptable). Then try to leave the kiosk: it must ask for the PIN.
6. **Screen times:** attach DevTools (see `npm run measure:announce-solo` for how) and find the
   line `[screen] YYYY-MM-DD screen on HH:MM–HH:MM, …`. Check it against the timetable: on from
   30 minutes before each departure's first stop to 15 minutes after its last.
7. **USB debugging off** before it leaves the bench, unless you will measure it on the bus
   (then switch it off after stage 5).

**Check:** restarts by itself into the idle screen, the kiosk needs the PIN, and the screen
times match the timetable.

## Stage 4: vehicle (fitting)

1. **Power:** wire the tablet's charger to a fused **permanent** supply through the
   **low-voltage cut-off**. Not ignition-switched: this tablet stops at its charging screen
   after a flat battery or a switch-off and needs a person to press the power button
   (owner's test, 2026-09-30). Label the fuse.
2. **Mount** where passengers can read it. Record the position and mount in the handover
   record.
3. **Sightlines (still open, `docs/DECISIONS.md` "seat-visibility compliance"):** sit in the
   seats furthest from the sign and note which can read Lines 2 and 3. Record it; a full
   compliance check method doesn't exist yet.
4. **Sound:** volume high enough to hear at the back with the engine running.
5. **Text size (optional, needs USB debugging on):** `npm run measure:announce-solo` while it
   shows a stop. Exit 0 means the sizes pass.

**Check:** the sign is on, powered from the permanent feed, and readable and audible from the
back seats.

## Stage 5: first trip (acceptance)

Ride (or have someone ride) the first departure the sign runs, ideally before it carries
passengers in service.

- [ ] Within its wake window the screen is on, showing the idle screen with the company name.
- [ ] At the first stop near departure time the sign **starts by itself** (no one touches it).
- [ ] Each stop is **shown and spoken**, in order, at the right moment.
- [ ] At the last stop "This service terminates here" shows and repeats, then the idle screen.
- [ ] Dashboard → **Journeys**: the trip is there, with **this bus** on it and stop times
      (they upload at the end of the trip).
- [ ] Later that day, after the last departure plus 15 minutes, the screen goes off by itself.

If the sign doesn't start: check the bus was within the distance of the first stop and within
the minutes of the departure time, and that the departure runs today (days, term dates,
removed dates). **Don't** leave Testing mode on to make it start; it is for bench tests only.

## Stage 6: handover record

Fill this in and keep it with the vehicle's records. **No install link, token, PIN or
password goes in it.**

| Item | Value |
|---|---|
| Company / bus registration | |
| Dashboard device label | |
| Departures ticked (service and time) | |
| Settings (before / after / distance) | |
| Tablet model and serial number | |
| SIM provider and number, or WiFi network name | |
| Fully PLUS licence confirmed (date) | |
| Kiosk PIN set and stored in (name of the password store, not the PIN) | |
| Power: fuse position and rating; cut-off model and setting | |
| Mount used and position | |
| Seats that can't read the sign (stage 4.3) | |
| First trip: date, departure, result | |
| Fitted by / signed off by / date | |

## Changing a sign later

- **Different departures, or the bus moves to other work:** Dashboard → Solo set-up. The sign
  picks it up within the hour (or at a restart). No visit to the bus.
- **Timetable change, term dates, bank holidays:** in the Dashboard as usual; the sign follows.
- **Sign moves to another bus:** Revoke it and add it again for the new bus (stage 2 onwards),
  so the trips are recorded against the right vehicle.

## Retiring a sign, or a lost or stolen tablet

1. Dashboard → Announce Devices → **Revoke** on its row. Its install link stops working for
   good straight away. A sign that is running keeps its screen until it next starts up, then
   goes dark: restart it (hold the power button about 10 seconds) or switch off its fuse if you
   can reach the bus. Revoking can't be undone; a tablet coming back into use is added as a new
   device with a new link.
2. If you have the tablet: Fully's menu (needs the kiosk PIN) → exit, then factory reset it
   before reuse. That also clears its saved trips and its copy of the departures.
3. **Delete** the row only once nobody needs its history on that page; the trips it recorded
   stay in Journeys either way.

## Still open (don't treat these as done)

- Mount for a 14" tablet, and a real seat-visibility check method (stages 1 and 4).
- Screen switching and carrying on after a real power cut have been proven with simulated GPS,
  not yet on the real tablet (`docs/TESTING.md` §19 A2 and B).
- Kiosk Lock not surviving a restart (Fully Kiosk Accessibility Service bug,
  `CAB-DEVICE-SETUP.md`): stage 3 step 5 is the check; repeat it after the first week.
- A **revoked** sign that is running only goes dark at its next start-up; making it notice
  within the hour (at its hourly re-read) is a possible follow-up.
- Solo for routes that **do** share stops with other services has no design yet.
- First in-service run: Monday 2026-10-05 (record the result in stage 6 and here).
