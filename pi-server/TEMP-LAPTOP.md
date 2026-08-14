# Temporary onboard controller — laptop instead of Raspberry Pi

Interim setup for while the Pi hardware order is delayed. Uses your laptop as
the "Pi controller" and an external Monitor plugged into it as BusOps
Announce's screen. **No app code is different** — this runs the exact same
`pi-server/server.mjs`, `sync-schedule.mjs`, `announceRelay.mjs` that
[`DEPLOY.md`](DEPLOY.md) documents for the real Pi. Only the hardware and a
couple of URLs change. When the Pi arrives, decommissioning this is just
switching those URLs back — see "Removing this" at the bottom.

## What's different from the real Pi

- **No GPS/gpsd on the laptop.** The Driver phone already computes its own
  tracking state from its own GPS and pushes it over the local WebSocket
  (`src/announceLink.js` → `pi-server/announceRelay.mjs` → `onboard.js`'s
  `connectSignFeed`) — this was already built as the primary path, with
  local-GPS/gpsd polling as a *fallback* (see `onboard.js`'s `runSignLocal`).
  The laptop simply never has a fallback to fall back to. `server.mjs` still
  tries to start a gpsd client on launch and will print repeated
  `[gpsd] connection error` warnings forever — that's expected and harmless,
  just noise, since nothing here uses `/api/position`.
- **One box does two jobs.** The real Pi has two WiFi radios (`wlan0` client
  for depot sync, `wlan1` hotspot for the display/driver device). Windows
  **Mobile Hotspot** does both on one adapter — it shares whatever internet
  connection the laptop already has while simultaneously hosting its own
  WiFi network, which is the same shape.
- **Known degraded mode**: if the driver phone's WiFi link to the laptop
  drops mid-route, `onboard.js` falls back to local GPS on whatever device is
  running the browser — a laptop has no real GPS chip, so that fallback will
  be poor-to-useless here (unlike on a real Pi with gpsd). Not a blocker, just
  don't expect the sign to self-heal a dropped WiFi link the way the real Pi
  setup does.

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

1. Run `pi-server/start-temp-pi.local.ps1`. It syncs the schedule from
   Supabase, then prints two URLs and starts the server.
2. **Driver phone commissioning — once per phone, not every day.** The first
   script output line is a URL like:
   ```
   http://<driver-pwa-url>/?announce-setup=ws://192.168.137.1:8080/driver-push&announce-token=<token>
   ```
   Connect the driver's phone to the laptop's Mobile Hotspot WiFi, open that
   URL once in its browser (any page load — it just writes two values to
   `localStorage` per `captureAnnounceSetup` in `src/announceLink.js`), then
   never needs it again. It'll auto-push state for every journey started
   from that phone from then on, and is a complete no-op if you ever open
   the plain Driver PWA URL without those params.
3. **Today's kiosk URL** — the second line, e.g.:
   ```
   http://localhost:8080/onboard.html?journey=<journey-id>&announce-token=<token>
   ```
   Fill in `<journey-id>` (find it on the dashboard's Daily Journeys page —
   open the journey's detail view) and open that URL full-screen (F11, or
   Chrome `--kiosk`) in the browser on the Monitor plugged into the laptop.
4. Leave the PowerShell window running for the day. Ctrl+C to stop.

## Verifying it's working

Same checks as `DEPLOY.md`'s "Verifying it's working" section, just against
`localhost` instead of the Pi's `192.168.4.1`:
```powershell
curl http://localhost:8080/api/schedule
npx wscat -c "ws://localhost:8080/sign-feed?token=<token>"   # should connect and stay open
```
The sign should go from blank to showing the route the moment the driver
taps Start on their phone — that's `get_duty_card` flipping to `in_progress`,
picked up by whichever path (push or poll) is live.

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
