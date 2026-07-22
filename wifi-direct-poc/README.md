# WiFi Direct bench-test harness

Throwaway hardware validation tool for the `.Driver` / `.NextStop` redesign — **not**
part of the RouteTracker product build, not deployed anywhere. Its only job is to
answer, on real candidate hardware, the question research alone couldn't answer:
does this specific device actually support WiFi Direct client pairing, does it
survive a reboot without a manual re-pair, and does one Group Owner hold multiple
clients at once.

See the memory file `project_nextstop_architecture.md` for the full design context —
short version: `.Driver` will be the WiFi Direct Group Owner, `.NextStop` display(s)
join as clients and receive pushed visual state. This app is one APK that can play
either role, so you install the same build on every test device.

## What it tests

1. **Pairing** — Driver creates a fixed-identity P2P group; NextStop discovers and
   joins it.
2. **Reboot survival** — kill/relaunch the app (or reboot the device) on both ends
   and confirm they re-form the same group without any manual WiFi Direct pairing
   UI step in Android Settings. This is the "no need to manage it" requirement —
   if this fails, the device is a no-go regardless of anything else.
3. **Data path** — once connected, Driver sends a timestamped "PING" over a plain
   TCP socket every 3s; NextStop logs each one and sends an ACK back. This proves
   the link actually carries data, not just that P2P association succeeded (radio
   pairing and application connectivity are different failure modes — test both).
4. **Multi-client fan-out** — run the app as NextStop on two devices at once,
   both pointed at the same Driver. Confirm the Driver's log shows two concurrent
   client connections both receiving pings. This is the one thing official Android
   docs don't specify a limit for — only a real test answers it.

## Building it

This is source files only, not a full Gradle project (no wrapper/build-tool version
to guess at from outside a real Android Studio install). To build:

1. Android Studio → **New Project → Empty Views Activity (Kotlin)**.
   - minSdk **29** (Android 10) — required for `WifiP2pConfig.Builder`, which is
     what lets Driver create a group with a fixed, reproducible name/passphrase
     instead of a new random one every launch.
   - targetSdk **34**.
2. Open the generated `app/src/main/AndroidManifest.xml` and add the permission
   block from [`AndroidManifest-additions.xml`](AndroidManifest-additions.xml)
   inside `<manifest>`, above `<application>`. Leave the rest of the generated
   manifest (the `<application>`/`<activity>` block, theme, icon refs) as-is.
3. Replace the generated `MainActivity.kt` entirely with
   [`MainActivity.kt`](MainActivity.kt) — update the `package` line at the top to
   match whatever package name the wizard gave your project.
4. Replace the generated `res/layout/activity_main.xml` entirely with
   [`activity_main.xml`](activity_main.xml).
5. Build & install on each test device (same APK, both roles).

No extra Gradle dependencies needed — `WifiP2pManager` and plain `java.net` sockets
are both core Android SDK.

## Running the test

1. Install on two (ideally three, to test multi-client) devices.
2. On one device — the stand-in for `.Driver` — select **Driver (Group Owner)**
   and tap **Start**. Watch the log for "Group formed... this device is Group
   Owner" then "Client connected: ...".
3. On the other device(s) — the actual candidate `.NextStop` hardware — select
   **NextStop (Client)** and tap **Start**. Watch for "Connected to Driver server"
   and a stream of "Received: PING ..." lines.
4. Force-stop or reboot both devices, relaunch the app, hit Start again on both
   (same role each). If they reconnect without you touching Android's WiFi
   Direct settings screen, that's a pass on requirement #2 above.
5. Add a second NextStop device while the first is still connected. Check the
   Driver's log shows both clients concurrently.

If any candidate device fails step 2 (never becomes Group Owner or never shows a
connected client) or step 3 (peer discovery never finds the Driver), treat that as
a hard no for that model — don't try to work around it, the whole point of this
test is to filter before money is spent.

## Interpreting a failure

- Driver never logs "Client connected": either discovery failed on the NextStop
  side (check its log for "Found peer...") or the P2P group never formed on the
  Driver side (check for "createGroup: FAILED (reason=...)").
- Connected but no pings ever arrive: P2P association works but something (a
  firewall, a vendor-specific network restriction, a background-network policy
  restriction on that OS build) is blocking the plain TCP socket — this is a
  real finding, not a bug in the harness, and points at that device's OS being
  unsuitable regardless of what the radio itself can do.
- Reconnects only after re-pairing manually in Settings each time: fails
  requirement #2 — the persistent/fixed-identity approach this harness uses
  isn't being honoured by that device's WiFi Direct implementation.
