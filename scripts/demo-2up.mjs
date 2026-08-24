// Two-window client-pitch demo: the real driver PWA next to the real
// BusOps Announce passenger display, borderless and positioned for a 15" laptop
// (1280x720 logical / window.screen coordinate space — see openWindow()'s
// comment on why that's not the same as the panel's physical pixels).
//
// Unlike demo.html (a scripted, entirely fake simulation), this drives the
// actual app code with mocked Geolocation — same technique as
// scripts/demo-announce-push.mjs, but two windows instead of four, and two
// selectable starting scenarios instead of manual-only:
//
// Every run also bypasses one random intermediate stop — a request stop
// nobody needed on the day, as distinct from a GPS dropout or a driver-
// triggered diversion alert. The GPS path still crosses that stop's 250m approach radius (EVENT 2
// still fires) but stays just outside its 50m arrival radius, so EVENT 3
// never fires there — gps.js's findForwardMatch rejoin confirms the skip
// once the vehicle reaches the following stop instead (which then arrives
// normally, but with no EVENT 2 of its own — the app jumps straight from
// "still searching" to arrived once matched). Set DEMO_SKIP_STOP=0 to
// disable and drive straight through every stop instead.
//
//   duty    Driver already has an assigned duty card (the PSVAIR demo
//           journey). PWA opens straight to the duty card.
//   manual  No duty card assigned. PWA opens to the "No duty assigned"
//           screen; you click "Select a service manually" and pick it
//           yourself. The BusOps Announce window is already pointed at the
//           journey this will resolve to (get_or_create_manual_journey is
//           keyed on departure + date, so the id is known up front even
//           though the row's status flips to in_progress only once you
//           actually hit Start) — see the printed instructions once the
//           windows open for exactly what to pick.
//
// Both scenarios drive the same physical route (S125S, Weston → Boston
// College) so one set of mocked stop coordinates covers either.
//
// Audio: the BusOps Announce window is the one that talks (real onboard hardware
// only has one speaker — the vehicle's, not the driver's phone); the PWA
// window's own PSVAIR announcements are muted via localStorage so the two
// don't talk over each other.
//
// The Announce window is a pure pushed-state renderer (see
// docs/CONTROLLER-REDESIGN.md) — it shows nothing until the driver window's
// push feed delivers a schedule, so this script spawns mele-server/server.mjs
// (not the plain server.js) and commissions the driver window's push-feed
// localStorage before it loads, same technique as
// scripts/demo-announce-push.mjs.
//
// Usage:
//   node scripts/demo-2up.mjs duty   [secondsPerStop]
//   node scripts/demo-2up.mjs manual [secondsPerStop]
//
// Starts mele-server/server.mjs itself if nothing is already answering on its
// port — see ensureServerRunning() — and stops it again on exit, but only
// if this script was the one that started it (a server you already had
// running is left alone).

import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { haversine } from '../pcv-dashboard/busops/driver/src/geo.js';

const MODE = process.argv[2];
// Deliberately slow (14s/stop) — this script exists to
// demonstrate the 4 PSVAIR announcement events distinctly (see APPROACHING_
// RADIUS_M below), and back-to-back events need enough room each to finish
// playing before the next one starts, or stopCurrentPlayback() in
// announcements.js will cut one off early.
const SECONDS_PER_STOP = Number(process.argv[3] ?? 14);
const SUB_STEPS = 6; // interpolation points per stop-to-stop leg
// Mirrors gps.js's APPROACHING_RADIUS_M — used here only to narrate in the
// terminal which of the 4 PSVAIR events should be audible right now, synced
// with the real app logic firing off the same simulated GPS feed.
const APPROACHING_RADIUS_M = 250;

if (MODE !== 'duty' && MODE !== 'manual') {
  console.error('Usage: node scripts/demo-2up.mjs <duty|manual> [secondsPerStop]');
  process.exit(1);
}

// Deliberately not 8080/8081 — leaves the plain dev server.js (8080, e.g.
// from dev-all.mjs) and scripts/demo-announce-push.mjs (8081) free to run
// alongside this.
const PORT = 8082;
const BASE_URL = `http://localhost:${PORT}`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IS_WIN = process.platform === 'win32';
const DEMO_TOKEN = 'demo-2up-token';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isServerUp() {
  try {
    const res = await fetch(`${BASE_URL}/api/schedule`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Starts mele-server/server.mjs only if nothing is already answering on PORT
// — reusing an already-running server (e.g. a previous demo run you left
// open) rather than fighting over the port. Returns the child process if
// this call is the one that started it, so the caller knows whether it's
// responsible for stopping it again — null means "leave it alone, it
// wasn't ours."
async function ensureServerRunning() {
  if (await isServerUp()) {
    console.log(`mele-server already running on :${PORT} — reusing it (its DRIVER_PUSH_TOKEN must already be "${DEMO_TOKEN}").`);
    return null;
  }
  console.log(`Starting mele-server (node pcv-dashboard/busops/announce/mele-server/server.mjs) on :${PORT}…`);
  const child = spawn('node', ['pcv-dashboard/busops/announce/mele-server/server.mjs'], {
    cwd: ROOT,
    shell: IS_WIN,
    env: { ...process.env, PORT: String(PORT), DRIVER_PUSH_TOKEN: DEMO_TOKEN },
  });
  child.stdout.on('data', (d) => process.stdout.write(`[mele-server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[mele-server] ${d}`));
  for (let i = 0; i < 30; i++) {
    if (await isServerUp()) return child;
    await sleep(200);
  }
  throw new Error(`pcv-dashboard/busops/announce/mele-server/server.mjs did not come up on :${PORT} within 6s`);
}

function stopServer(child) {
  if (!child) return; // wasn't ours to stop
  console.log('Stopping the dev server this script started…');
  if (IS_WIN) {
    try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  } else {
    child.kill('SIGTERM');
  }
}

// PSVAIR demo journey (see memory: must be reset — journey_events deleted,
// status back to 'scheduled' — before re-running duty mode the same day).
const DUTY_JOURNEY_ID = '2d2f26b1-31b9-434b-a858-e614a53599b5';

// S125S Morning Outbound (Weston → Boston College) — same route as the duty
// journey above. Manual mode drives this departure (the picker now fetches
// its list live from Supabase, see supabaseApi.js's fetchAvailableServices).
const MANUAL_DEPARTURE_ID = '338aebc6-8b5e-4a86-acad-a56bcf7a123b';
const MANUAL_SERVICE = 'S125S';
const MANUAL_PERIOD  = 'Morning Outbound';

// Dev Supabase anon/publishable key — safe, RLS-gated (see src/config.js's
// comment). Hardcoded here rather than imported: config.js picks dev vs
// prod off window.location.hostname, which doesn't exist in Node.
const SUPABASE_URL = 'https://cgcbfgceputvdvhzrgio.supabase.co';
const SUPABASE_KEY = 'sb_publishable_LZVX8fASyDG8UtMp3eeRJQ_SBxpCa54';

// Real stops, Weston to Boston College (S125S Outbound) — pulled from dev
// Supabase timetable_stops/stops for timetable_departure_id above.
const STOPS = [
  { name: "Weston, adj The Chequers PH",        lat: 52.808106507, lon: -0.084034973 },
  { name: "Weston, opp Delgate Bank",             lat: 52.807162,    lon: -0.074017 },
  { name: "Moulton, opp Bell Lane",               lat: 52.805379,    lon: -0.065016 },
  { name: "Moulton, adj River Lane",              lat: 52.804524,    lon: -0.057221 },
  { name: "Whaplode, opp St Mary's Gardens",      lat: 52.800272,    lon: -0.041953 },
  { name: "Whaplode, adj Darjeeling Restaurant",  lat: 52.800214,    lon: -0.036289 },
  { name: "Whaplode, opp Middle Road",            lat: 52.800127,    lon: -0.032125 },
  { name: "Whaplode, adj Stockwell Gate",         lat: 52.80104,     lon: -0.026476 },
  { name: "Holbeach, opp Wignals Gate",           lat: 52.803429,    lon: -0.01177 },
  { name: "Holbeach, opp Netherfield",            lat: 52.804283,    lon: -0.001034 },
  { name: "Holbeach, adj Fairfields",             lat: 52.804876,    lon: 0.005373 },
  { name: "Holbeach, opp Stukeley Hall Drive",    lat: 52.80472,     lon: 0.009816 },
  { name: "Holbeach, opp Interchange Shelter",    lat: 52.803419,    lon: 0.018658 },
  { name: "Holbeach, opp Damgate",                lat: 52.803826,    lon: 0.023765 },
  { name: "Holbeach, adj Rowan Close",            lat: 52.803854,    lon: 0.031629 },
  { name: "Fleet Road (opp)",                     lat: 52.805217,    lon: 0.052731 },
  { name: "Fleet Hargate, adj Winslow Gate",      lat: 52.804581,    lon: 0.058324 },
  { name: "Fleet Hargate, opp Proctors Close",    lat: 52.804406,    lon: 0.062188 },
  { name: "Holbeach Cackle Hill, opp 188 Boston Road", lat: 52.81834, lon: 0.002431 },
  { name: "New Saracen's Head PH (adj)",          lat: 52.824392,    lon: -0.012074 },
  { name: "Fosdyke, adj Village Hall",            lat: 52.880265,    lon: -0.045871 },
  { name: "Fosdyke, opp All Saint's Church",      lat: 52.880896,    lon: -0.047091 },
  { name: "Boston College (adj)",                 lat: 52.972156,    lon: -0.018524 },
];

const lerp = (a, b, t) => a + (b - a) * t;

// Must clear geofence.js's GEOFENCE_RADIUS_M (50m) with margin, while
// staying well inside APPROACHING_RADIUS_M (250m) — the vehicle still
// triggers the approach announcement as it passes the stop, it just never
// registers as arrived there, same as a real drive-by.
const SKIP_BYPASS_OFFSET_M = 100;
const SKIP_ENABLED = process.env.DEMO_SKIP_STOP !== '0';

// Offsets `target` sideways off the prev->next road direction by offsetM,
// so the simulated path drives past it at a safe distance instead of
// through it — regardless of how the real stops happen to line up.
function offsetPerpendicular(prev, target, next, offsetM) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((target.lat * Math.PI) / 180);

  const dxm = (next.lon - prev.lon) * mPerDegLon;
  const dym = (next.lat - prev.lat) * mPerDegLat;
  const len = Math.hypot(dxm, dym) || 1;
  const perpXm = -dym / len;
  const perpYm = dxm / len;

  return {
    lat: target.lat + (perpYm * offsetM) / mPerDegLat,
    lon: target.lon + (perpXm * offsetM) / mPerDegLon,
  };
}

// Resolves (creating if needed) today's journey row for the manual-mode
// departure, so the BusOps Announce window can be pointed at its journey_id before
// the driver has actually clicked Start. Idempotent — keyed on
// (timetable_departure_id, journey_date) — see schema.sql. This does NOT
// flip status to in_progress; that only happens once you click Start in the
// browser (src/manualSelection.js calls start_journey itself).
async function resolveManualJourneyId() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_or_create_manual_journey`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_timetable_departure_id: MANUAL_DEPARTURE_ID }),
  });
  if (!res.ok) throw new Error(`get_or_create_manual_journey failed: ${res.status} ${await res.text()}`);
  const [{ journey_id }] = await res.json();
  return journey_id;
}

// context.pages()[0] can race the --app= window's real navigation and grab
// a transient about:blank page instead — poll for a page whose origin
// actually matches instead of trusting whichever page shows up first.
async function waitForRealPage(context, expectedUrl) {
  const targetOrigin = new URL(expectedUrl).origin;
  for (let i = 0; i < 30; i++) {
    const found = context.pages().find((p) => {
      try { return new URL(p.url()).origin === targetOrigin; } catch { return false; }
    });
    if (found) return found;
    await sleep(100);
  }
  return context.pages()[0] ?? await context.waitForEvent('page');
}

async function openWindow({ url, windowPosition, windowSize, mute, commissionAnnounce }) {
  // launchPersistentContext + --app=<url> gives a bare window: no tabs, no
  // address bar, just the page content and a thin native title bar.
  // viewport: null means "no emulation, use the real window" — plain
  // chromium.launch()+newContext() emulates a *virtual* viewport on top of
  // the real window, and under Windows display scaling those two sizes can
  // diverge.
  // --window-size/-position are in the same logical coordinate space as
  // window.screen (NOT physical pixels — a 1920x1080 panel at 150% Windows
  // scaling reports as 1280x720 here, which is this laptop's actual
  // logical resolution). Re-tune the LAYOUT constants below if you run
  // this on a different display.
  const userDataDir = mkdtempSync(join(tmpdir(), 'demo-2up-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    args: [`--window-size=${windowSize}`, `--window-position=${windowPosition}`, `--app=${url}`],
    geolocation: { latitude: STOPS[0].lat, longitude: STOPS[0].lon },
    // Granting only 'geolocation' makes Chromium auto-deny every other
    // permission it hasn't been told about explicitly — including Screen
    // Wake Lock — so the driver PWA's wakelock-warning banner falsely
    // fires on every demo run even though a real device never denies it.
    // Listing 'screen-wake-lock' too avoids that false positive.
    permissions: ['geolocation', 'screen-wake-lock'],
  });
  const page = await waitForRealPage(context, url);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  if (mute) {
    // Set before the app's own init reads it, so no announcement gets
    // spoken even for the very first stop.
    await page.evaluate(() => localStorage.setItem('psvair-muted', '1')).catch(() => {});
  }
  if (commissionAnnounce) {
    // One-time push-feed commissioning (src/announceLink.js's
    // captureAnnounceSetup) — without this the driver window never pushes
    // schedule/state, and the Announce window (a pure pushed-state renderer
    // now) stays permanently blank.
    await page.evaluate(({ url: wsUrl, token }) => {
      localStorage.setItem('announceLinkUrl', wsUrl);
      localStorage.setItem('announceLinkToken', token);
    }, { url: `ws://localhost:${PORT}/driver-push`, token: DEMO_TOKEN }).catch(() => {});
  }
  // --app=<url> starts navigating the instant Chromium's process starts,
  // racing ahead of the geolocation permission grant and (if set) the mute
  // flag above. Reload so this window's real first paint happens after
  // both are already in place.
  await page.reload({ waitUntil: 'domcontentloaded' });
  return { context, page };
}

// ── Layout — tuned for this laptop's 1280x720 logical screen ───────────────
const SCREEN_W = 1280, SCREEN_H = 720;
const MARGIN = 20;

const PWA_W = 340, PWA_H = 650; // real phone proportions
const PWA_X = MARGIN;
const PWA_Y = Math.round((SCREEN_H - PWA_H) / 2); // vertically centred, left edge

const NS_X = PWA_X + PWA_W + MARGIN;
const NS_W = SCREEN_W - NS_X - MARGIN; // fills remaining width
const NS_H = 200; // 880x200 = 4.4:1, safely past onboard.js's 4:1 wide-layout breakpoint
const NS_Y = Math.round((SCREEN_H - NS_H) / 2); // vertically centred, right of the PWA

let serverChild = null;
function shutdown() {
  stopServer(serverChild);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
  serverChild = await ensureServerRunning();

  // /driver/index.html, not "/" — mele-server/server.mjs aliases bare "/" to
  // /announce/onboard.html (see its serveStaticFile()).
  let pwaUrl;

  if (MODE === 'duty') {
    pwaUrl = `${BASE_URL}/driver/index.html?duties=${DUTY_JOURNEY_ID}`;
  } else {
    pwaUrl = `${BASE_URL}/driver/index.html`;
    console.log('Resolving today\'s manual-mode journey row…');
    await resolveManualJourneyId(); // creates/finds the row so it exists once Start is clicked; the id itself isn't needed here anymore — the Announce window learns it from the driver's schedule push instead of watching a specific journey id
  }

  const onboardUrl = new URL('/announce/onboard.html', BASE_URL);
  onboardUrl.searchParams.set('announce-token', DEMO_TOKEN);

  const [driver, announce] = await Promise.all([
    openWindow({
      url: pwaUrl, mute: true, commissionAnnounce: true,
      windowPosition: `${PWA_X},${PWA_Y}`, windowSize: `${PWA_W},${PWA_H}`,
    }),
    openWindow({
      url: onboardUrl.toString(), mute: false,
      windowPosition: `${NS_X},${NS_Y}`, windowSize: `${NS_W},${NS_H}`,
    }),
  ]);

  console.log('\nTwo windows are open.');
  if (MODE === 'duty') {
    console.log('LEFT  (driver PWA):  click through the duty card, pick the first stop');
    console.log('                     ("Weston, adj The Chequers PH") as the starting point,');
    console.log('                     and hit Start.');
  } else {
    console.log('LEFT  (driver PWA):  click "Select a service manually", choose');
    console.log(`                     Service: ${MANUAL_SERVICE}, Period: the one starting "${MANUAL_PERIOD}"`);
    console.log('                     (label now includes the departure time, e.g. "Morning Outbound (08:15)"),');
    console.log('                     then hit Start. Must resolve to the same departure as');
    console.log(`                     MANUAL_DEPARTURE_ID (${MANUAL_DEPARTURE_ID}) above — the BusOps`);
    console.log('                     Announce window is already watching the journey it resolves to.');
  }
  console.log('RIGHT (Announce):    nothing to click — connects to the driver window\'s pushed');
  console.log('                     feed and wakes the instant you hit Start (it\'s a pure');
  console.log('                     pushed-state renderer now, no GPS/Supabase of its own).');
  console.log('                     It has voice; the driver PWA is muted so they don\'t overlap.');
  console.log('\nWaiting for both to start…');

  await Promise.all([
    driver.page.waitForSelector('#tracker:not([hidden])', { timeout: 10 * 60 * 1000 }),
    announce.page.waitForSelector('#onboard-sign:not([hidden])', { timeout: 10 * 60 * 1000 }),
  ]);
  console.log('Both started — driving the route now.');
  console.log('[EVENT 1] Journey start — should be audible now: route/destination + first two stops.\n');

  // Candidates exclude the first stop (covered by EVENT 1) and the last
  // stop (terminus, its own scenario).
  const skipIdx = SKIP_ENABLED
    ? 1 + Math.floor(Math.random() * (STOPS.length - 2))
    : null;

  const drivePoints = STOPS.map((s) => ({ lat: s.lat, lon: s.lon }));
  if (skipIdx !== null) {
    drivePoints[skipIdx] = offsetPerpendicular(
      STOPS[skipIdx - 1], STOPS[skipIdx], STOPS[skipIdx + 1], SKIP_BYPASS_OFFSET_M
    );
    console.log(`This run bypasses "${STOPS[skipIdx].name}" — EVENT 2 still fires as the vehicle`);
    console.log('passes it, but it drives on without stopping (no EVENT 3 there); the skip is');
    console.log('confirmed once it reaches the next stop instead.\n');
  }

  for (let i = 1; i < STOPS.length; i++) {
    const from = drivePoints[i - 1];
    const to = drivePoints[i];
    const trueTo = STOPS[i]; // real stop position/name — what the app itself measures against
    const isFinalStop = i === STOPS.length - 1;
    const isSkip = i === skipIdx;
    // The app never fires a separate approach pre-announcement for the stop
    // right after a skip — nextStopIndex is still parked on the skipped
    // index until the moment it's confirmed arrived (see gps.js's
    // findForwardMatch branch), so it jumps straight from "still
    // searching" to arrived with no EVENT 2 in between.
    const suppressApproach = skipIdx !== null && i === skipIdx + 1;
    let approachAnnounced = false;

    for (let s = 1; s <= SUB_STEPS; s++) {
      const t = s / SUB_STEPS;
      const pos = { latitude: lerp(from.lat, to.lat, t), longitude: lerp(from.lon, to.lon, t) };
      await Promise.all([
        driver.context.setGeolocation(pos),
        announce.context.setGeolocation(pos),
      ]);

      // Narrates in the terminal, synced with the same simulated GPS feed
      // the app itself is reacting to — not a separate source of truth,
      // just gps.js's own 250m/50m thresholds computed here too so you know
      // which of the 4 events to expect right now. Distance is measured
      // against trueTo (the real stop position), same as the app's own
      // schedule data — not the bypass waypoint the GPS feed is following.
      if (!isFinalStop && !approachAnnounced && !suppressApproach) {
        const distM = haversine(pos.latitude, pos.longitude, trueTo.lat, trueTo.lon);
        if (distM <= APPROACHING_RADIUS_M) {
          approachAnnounced = true;
          console.log(`  [EVENT 2] Approaching "${trueTo.name}" — should be audible now.`);
        }
      }

      await sleep((SECONDS_PER_STOP * 1000) / SUB_STEPS);
    }

    if (isFinalStop) {
      console.log(`→ ${trueTo.name}`);
      console.log('[EVENT 4] Final stop — should be audible now: "This is the final stop..."');
    } else if (isSkip) {
      console.log(`⤳ ${trueTo.name}  (bypassed — no stop)`);
      console.log(`  [SKIP] Passed "${trueTo.name}" without stopping — no EVENT 3 here.`);
    } else {
      console.log(`→ ${trueTo.name}`);
      console.log(`  [EVENT 3] Stopped at "${trueTo.name}" — should be audible now: route/destination + next stop.`);
    }
  }

  console.log('\nRoute complete — arrived at Boston College. Windows stay open;');
  console.log('close them manually (or Ctrl+C this script) when the demo is done.');
})().catch((err) => {
  console.error('\n=== demo-2up.mjs failed ===');
  console.error(err);
  stopServer(serverChild);
  process.exitCode = 1;
});
