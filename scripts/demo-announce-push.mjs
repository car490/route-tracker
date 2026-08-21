// Local end-to-end proof for the Driver -> Pi push path (src/announceLink.js
// -> pi-server/announceRelay.mjs -> src/onboard.js's runSignPush), without
// any real Pi/Android hardware. Same technique as scripts/demo-drive.mjs /
// demo-2up.mjs — drives the real app code with mocked Geolocation — but
// instead of the plain root server.js, this spawns pi-server/server.mjs
// itself (it already serves the whole repo statically, same as server.js,
// plus the new /driver-push and /sign-feed WebSocket endpoints), and
// commissions both windows for the push feed before they load.
//
// What to look for once all four windows have started:
//   - All three RIGHT-side (Announce) windows — Bar, Monitor, and
//     monitor-vertical, see PANEL_PROFILES in src/onboard.js — should
//     update in lockstep with the LEFT one WITHOUT ever requesting their
//     own GPS permission — they're pure pushed-state renderers now (see
//     docs/CONTROLLER-REDESIGN.md), with no GPS or Supabase access of their
//     own at all, not a fallback path. All three subscribe to the same
//     /sign-feed token, so one Driver push drives all three previews at
//     once.
//   - This terminal (piped from the spawned pi-server) should print
//     "[announceRelay] driver connected" once you hit Start, and
//     "[announceRelay] sign display connected" three times shortly after
//     (once per Announce window).
//
// Usage:
//   node scripts/demo-announce-push.mjs [secondsPerStop]
//
// Manual-selection mode only (no pre-existing duty link needed) — resolves
// today's journey row itself, same as `npm run demo:2up:manual`.

import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const SECONDS_PER_STOP = Number(process.argv[2] ?? 10);
const SUB_STEPS = 6;

const PORT = 8081; // deliberately not 8080 — leaves the plain dev server.js free to run alongside this
const BASE_URL = `http://localhost:${PORT}`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IS_WIN = process.platform === 'win32';
const DEMO_TOKEN = 'demo-announce-token';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lerp = (a, b, t) => a + (b - a) * t;

async function isServerUp() {
  try {
    const res = await fetch(`${BASE_URL}/api/schedule`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServerRunning() {
  if (await isServerUp()) {
    console.log(`pi-server already running on :${PORT} — reusing it (its DRIVER_PUSH_TOKEN must already be "${DEMO_TOKEN}").`);
    return null;
  }
  console.log(`Starting pi-server (node pcv-dashboard/busops/announce/pi-server/server.mjs) on :${PORT}…`);
  const child = spawn('node', ['pcv-dashboard/busops/announce/pi-server/server.mjs'], {
    cwd: ROOT,
    shell: IS_WIN,
    env: { ...process.env, PORT: String(PORT), DRIVER_PUSH_TOKEN: DEMO_TOKEN },
  });
  child.stdout.on('data', (d) => process.stdout.write(`[pi-server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[pi-server] ${d}`));
  for (let i = 0; i < 30; i++) {
    if (await isServerUp()) return child;
    await sleep(200);
  }
  throw new Error(`pcv-dashboard/busops/announce/pi-server/server.mjs did not come up on :${PORT} within 6s`);
}

function stopServer(child) {
  if (!child) return;
  console.log('Stopping the pi-server this script started…');
  if (IS_WIN) {
    try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  } else {
    child.kill('SIGTERM');
  }
}

// Same S125S Weston -> Boston College departure demo-2up.mjs's manual mode
// drives — see that file for where these ids/coordinates came from.
const MANUAL_DEPARTURE_ID = '338aebc6-8b5e-4a86-acad-a56bcf7a123b';
const MANUAL_SERVICE = 'S125S';
const MANUAL_PERIOD = 'Morning Outbound';

const SUPABASE_URL = 'https://cgcbfgceputvdvhzrgio.supabase.co';
const SUPABASE_KEY = 'sb_publishable_LZVX8fASyDG8UtMp3eeRJQ_SBxpCa54';

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

// setup(page) runs after load but before the reload that makes it "real" —
// same two-step dance demo-drive.mjs/demo-2up.mjs use for the mute flag,
// extended here to also seed the Driver window's one-time push commissioning.
async function openWindow({ url, windowPosition, windowSize, setup }) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'demo-announce-push-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    args: [`--window-size=${windowSize}`, `--window-position=${windowPosition}`, `--app=${url}`],
    geolocation: { latitude: STOPS[0].lat, longitude: STOPS[0].lon },
    permissions: ['geolocation', 'screen-wake-lock'],
  });
  const page = await waitForRealPage(context, url);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  if (setup) await setup(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  return { context, page };
}

// Three Announce previews to the right of the driver PWA — Bar (28"
// ultra-wide destination-board panel, not yet built, kept for later — see
// docs/CONTROLLER-REDESIGN.md) full-width on top, Monitor (Dell Pro P2426H,
// the confirmed demo/validation display) and monitor-vertical (same panel,
// vertical tube-track) side by side below it. All three windows use their
// real target aspect ratio (2560:480 / 1920:1080 for both Monitor variants)
// at a scaled-down size — only the aspect ratio needs to match for correct
// rendering: onboard.js's computeMinTextVh() derives --min-text purely from
// diagonal + aspect ratio, not absolute pixel count, so a proportionally-
// shrunk window is exactly as accurate as a literal native-resolution one.
// Each window also carries its own ?panel-profile= so the layout choice is
// explicit (see PANEL_PROFILES in src/onboard.js) rather than depending on
// the window happening to cross the 4:1 matchMedia breakpoint.
const SCREEN_W = 1280, SCREEN_H = 720;
const MARGIN = 20;
const PWA_W = 340, PWA_H = 650;
const PWA_X = MARGIN;
const PWA_Y = Math.round((SCREEN_H - PWA_H) / 2);
const NS_X = PWA_X + PWA_W + MARGIN;
const BAR_W = 780, BAR_H = Math.round(BAR_W * 480 / 2560);
const BAR_X = NS_X, BAR_Y = MARGIN;
const MON_W = 380, MON_H = Math.round(MON_W * 1080 / 1920);
const MON_ROW_Y = BAR_Y + BAR_H + MARGIN;
const MONITOR_X = NS_X, MONITOR_Y = MON_ROW_Y;
const MONITOR_VERTICAL_X = NS_X + MON_W + MARGIN, MONITOR_VERTICAL_Y = MON_ROW_Y;

let serverChild = null;
function shutdown() { stopServer(serverChild); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
  serverChild = await ensureServerRunning();

  console.log("Resolving today's manual-mode journey row…");
  // Creates/finds the row so it exists once Start is clicked — the id
  // itself isn't needed here; the Announce window is a pure pushed-state
  // renderer now and learns everything from the driver's schedule push,
  // not from watching a specific journey id in its own URL.
  await resolveManualJourneyId();

  const driverUrl = `${BASE_URL}/driver/index.html`; // not "/" — pi-server aliases "/" to /announce/onboard.html
  const onboardUrl = (panelProfile) => {
    const u = new URL('/announce/onboard.html', BASE_URL);
    u.searchParams.set('announce-token', DEMO_TOKEN);
    u.searchParams.set('panel-profile', panelProfile);
    return u.toString();
  };

  const [driver, announceBar, announceMonitor, announceMonitorVertical] = await Promise.all([
    openWindow({
      url: driverUrl,
      windowPosition: `${PWA_X},${PWA_Y}`, windowSize: `${PWA_W},${PWA_H}`,
      setup: (page) => page.evaluate(({ url, token }) => {
        localStorage.setItem('psvair-muted', '1'); // audio stays on this window either way — muted so the demo doesn't talk over itself
        localStorage.setItem('announceLinkUrl', url);
        localStorage.setItem('announceLinkToken', token);
      }, { url: `ws://localhost:${PORT}/driver-push`, token: DEMO_TOKEN }),
    }),
    openWindow({
      url: onboardUrl('bar'),
      windowPosition: `${BAR_X},${BAR_Y}`, windowSize: `${BAR_W},${BAR_H}`,
    }),
    openWindow({
      url: onboardUrl('monitor'),
      windowPosition: `${MONITOR_X},${MONITOR_Y}`, windowSize: `${MON_W},${MON_H}`,
    }),
    openWindow({
      url: onboardUrl('monitor-vertical'),
      windowPosition: `${MONITOR_VERTICAL_X},${MONITOR_VERTICAL_Y}`, windowSize: `${MON_W},${MON_H}`,
    }),
  ]);

  console.log('\nFour windows are open.');
  console.log('LEFT        (driver PWA):              click "Select a service manually", choose');
  console.log(`                                       Service: ${MANUAL_SERVICE}, Period: ${MANUAL_PERIOD}, then hit Start.`);
  console.log('TOP RIGHT   (Announce, Bar):            nothing to click — all three connect to the');
  console.log('BOTTOM LEFT (Announce, Monitor):        pushed feed on their own and wake once the');
  console.log('BOTTOM RIGHT(Announce, Monitor-vert.):  driver hits Start. No fallback exists — pure');
  console.log('                                        pushed-state renderers, all subscribed to the');
  console.log('                                        same feed (see docs/CONTROLLER-REDESIGN.md).');
  console.log('\nWaiting for all four to start…');

  await Promise.all([
    driver.page.waitForSelector('#tracker:not([hidden])', { timeout: 10 * 60 * 1000 }),
    announceBar.page.waitForSelector('#onboard-sign:not([hidden])', { timeout: 10 * 60 * 1000 }),
    announceMonitor.page.waitForSelector('#onboard-sign:not([hidden])', { timeout: 10 * 60 * 1000 }),
    announceMonitorVertical.page.waitForSelector('#onboard-sign:not([hidden])', { timeout: 10 * 60 * 1000 }),
  ]);
  console.log('All four started — driving the route now.\n');

  for (let i = 1; i < STOPS.length; i++) {
    const from = STOPS[i - 1];
    const to = STOPS[i];
    for (let s = 1; s <= SUB_STEPS; s++) {
      const t = s / SUB_STEPS;
      const pos = { latitude: lerp(from.lat, to.lat, t), longitude: lerp(from.lon, to.lon, t) };
      await Promise.all([
        driver.context.setGeolocation(pos),
        announceBar.context.setGeolocation(pos),
        announceMonitor.context.setGeolocation(pos),
        announceMonitorVertical.context.setGeolocation(pos),
      ]);
      await sleep((SECONDS_PER_STOP * 1000) / SUB_STEPS);
    }
    console.log(`-> ${to.name}`);
  }

  console.log('\nRoute complete. Windows stay open; close them manually (or Ctrl+C this script).');
})().catch((err) => {
  console.error('\n=== demo-announce-push.mjs failed ===');
  console.error(err);
  stopServer(serverChild);
  process.exitCode = 1;
});
