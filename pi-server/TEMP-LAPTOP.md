# Temporary onboard controller — laptop instead of dedicated hardware

Interim setup for while dedicated Controller hardware isn't set up. Uses your
laptop as the Controller and an external Monitor plugged into it as BusOps
Announce's screen. **No app code is different** — this runs the exact same
`pi-server/server.mjs` and `announceRelay.mjs` that [`DEPLOY.md`](DEPLOY.md)
documents for the real hardware. Only the hardware and a couple of URLs
change. When dedicated hardware is ready, decommissioning this is just
switching those URLs back — see "Removing this" at the bottom.

## What's different from real Controller hardware

- **No GPS needed on the laptop, same as the real Controller.** The Driver
  phone computes its own tracking state from its own GPS and pushes it over
  the local WebSocket (`src/announceLink.js` → `pi-server/announceRelay.mjs`
  → `onboard.js`'s `connectSignFeed`) — the Controller (laptop or real
  hardware) has no GPS of its own at all, by design, not as a fallback.
- **One box does two jobs.** A dedicated Controller box would have one WiFi
  radio hosting the hotspot the display/driver device joins. Windows
  **Mobile Hotspot** does the same job on this laptop's one adapter — it
  shares whatever internet connection the laptop already has while
  simultaneously hosting its own WiFi network.
- **No local fallback if the driver phone's WiFi link drops mid-route.**
  `onboard.js` is a pure pushed-state renderer now — if the connection drops
  it just shows the last state it received until the Driver device
  reconnects and resends, same behavior a real Controller box would have.
  Not a laptop-specific limitation.

## One-time setup

1. **Turn on Mobile Hotspot**: Settings → Network & internet → Mobile
   hotspot → On. Share *your normal internet connection* (WiFi or Ethernet —
   whatever this laptop already uses). Note the SSID/password shown there.
2. **Open the firewall for port 8080**: the first time `node server.mjs`
   accepts an inbound connection, Windows will prompt "Windows Defender
   Firewall has blocked some features of Node.js" — tick **both** Private
   *and* Public (the Mobile Hotspot adapter is usually classified Public) and
   allow. If you don't get the prompt, add the rule manually: Windows
   Defender Firewall → Advanced settings → Inbound Rules → New Rule → Port →
   TCP 8080 → Allow.
3. **Turn off sleep/lock on the laptop** while it's running this (Settings →
   System → Power) — same reasoning as the Pi's kiosk needing the screen to
   stay awake.
4. **Generate a token**: any long random string (e.g.
   `[System.Guid]::NewGuid().ToString("N") + [System.Guid]::NewGuid().ToString("N")`
   in a PowerShell prompt). This is the same kind of commissioning-time
   shared secret `DEPLOY.md` §6 describes for the real Pi — not a password
   you need to remember, just something long and hard to guess.
5. **Copy the script**: `pi-server/start-temp-pi.example.ps1` →
   `pi-server/start-temp-pi.local.ps1` (gitignored — it'll hold your real
   token). Paste your token into `$Token` at the top.

## Every day

1. Run `pi-server/start-temp-pi.local.ps1`. It prints two URLs and starts
   the server — no separate sync step, the schedule arrives pushed from the
   Driver device once it starts a journey.
2. **Driver phone commissioning — once per phone, not every day.** The first
   script output line is a URL like:
   ```
   http://<driver-pwa-url>/?announce-setup=ws://192.168.137.1:8080/driver-push&announce-token=<token>
   ```
   Connect the driver's phone to the laptop's Mobile Hotspot WiFi, open that
   URL once in its browser (any page load — it just writes two values to
   `localStorage` per `captureAnnounceSetup` in `src/announceLink.js`), then
   never needs it again. It'll auto-push schedule/state for every journey
   started from that phone from then on, and is a complete no-op if you ever
   open the plain Driver PWA URL without those params.
3. **Today's kiosk URL** — the second line, e.g.:
   ```
   http://localhost:8080/onboard.html?announce-token=<token>
   ```
   Same URL every day, nothing to fill in — open it full-screen (F11, or
   Chrome `--kiosk`) in the browser on the Monitor plugged into the laptop.
   It stays blank until the driver taps Start.
4. Leave the PowerShell window running for the day. Ctrl+C to stop.

## Verifying it's working

Same checks as `DEPLOY.md`'s "Verifying it's working" section, just against
`localhost` instead of the Pi's `192.168.4.1`:
```powershell
curl http://localhost:8080/api/schedule
npx wscat -c "ws://localhost:8080/sign-feed?token=<token>"   # should connect and stay open
```
The sign should go from blank to showing the route the moment the driver
taps Start on their phone — that's the schedule push arriving over
`/sign-feed`.

## Removing this

No rollback needed on the laptop side — just stop running
`start-temp-pi.local.ps1`. Two things need re-pointing at the real Pi once
it's commissioned per `DEPLOY.md`:

1. **Re-commission the driver phone** by opening the same kind of
   `?announce-setup=...&announce-token=...` URL again, this time with the
   Pi's `ws://192.168.4.1:8080/driver-push` and the Pi's own token — this
   simply overwrites the two `localStorage` values, no "undo" step needed.
2. **Point the Monitor's kiosk URL at the Pi** instead of `localhost` (or
   move the Monitor's HDMI cable to the Pi if it's driving the display
   directly per `DEPLOY.md` Option B).

Nothing in this file's setup touches `git`-tracked app code, so there's
nothing to revert there either — `start-temp-pi.local.ps1` can just stay
unused in the repo (it's gitignored) or be deleted.
