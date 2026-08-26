// Variant of ../../scripts/demo-2up.mjs that drives the real physical MeLE
// Controller + Monitor (192.168.1.141, reachable directly over Ethernet/LAN)
// instead of the throwaway local mele-server the original script spins up —
// for bench-verifying onboard-sign changes actually land on real hardware,
// not just in a local browser window.
//
// Only opens the driver PWA window; the real onboard kiosk display (already
// running on the Controller) takes the place of the original script's
// second "Announce" window.
//
// Usage (run from pcv-dashboard/busops/):
//   CONTROLLER_TOKEN=<the box's DRIVER_PUSH_TOKEN> node _demo-real-controller.mjs <duty|manual> [secondsPerStop]
// PowerShell: $env:CONTROLLER_TOKEN = '<token>'; node _demo-real-controller.mjs <duty|manual>
// The token is the same one mele-server/DEPLOY.md's bootstrap step prints for this box —
// deliberately not hardcoded here, since this file is committed to the repo.

import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { haversine } from './driver/src/geo.js';

const MODE = process.argv[2];
const SECONDS_PER_STOP = Number(process.argv[3] ?? 14);
const SUB_STEPS = 6;
const APPROACHING_RADIUS_M = 250;

if (MODE !== 'duty' && MODE !== 'manual') {
  console.error('Usage: CONTROLLER_TOKEN=<token> node _demo-real-controller.mjs <duty|manual> [secondsPerStop]');
  process.exit(1);
}

if (!process.env.CONTROLLER_TOKEN) {
  console.error('Set CONTROLLER_TOKEN to the Controller\'s DRIVER_PUSH_TOKEN before running this (see mele-server/DEPLOY.md).');
  console.error('bash:       CONTROLLER_TOKEN=<token> node _demo-real-controller.mjs duty');
  console.error('PowerShell: $env:CONTROLLER_TOKEN = \'<token>\'; node _demo-real-controller.mjs duty');
  process.exit(1);
}

const ROOT = fileURLToPath(new URL('.', import.meta.url)); // pcv-dashboard/busops/
const IS_WIN = process.platform === 'win32';

const LOCAL_PORT = 8082;
const LOCAL_TOKEN = 'unused-local-token';
const BASE_URL = `http://localhost:${LOCAL_PORT}`;

const CONTROLLER_HOST = '192.168.1.141:8080';
const CONTROLLER_PUSH_URL = `wss://${CONTROLLER_HOST}/driver-push`;
const CONTROLLER_TOKEN = process.env.CONTROLLER_TOKEN;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    console.log(`Local static server already running on :${LOCAL_PORT} — reusing it.`);
    return null;
  }
  console.log(`Starting local static server on :${LOCAL_PORT} (assets only, push feed unused)…`);
  const child = spawn('node', ['announce/mele-server/server.mjs'], {
    cwd: ROOT,
    shell: IS_WIN,
    env: { ...process.env, PORT: String(LOCAL_PORT), DRIVER_PUSH_TOKEN: LOCAL_TOKEN },
  });
  child.stdout.on('data', (d) => process.stdout.write(`[local-server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[local-server] ${d}`));
  for (let i = 0; i < 30; i++) {
    if (await isServerUp()) return child;
    await sleep(200);
  }
  throw new Error(`local static server did not come up on :${LOCAL_PORT} within 6s`);
}

function stopServer(child) {
  if (!child) return;
  console.log('Stopping the local static server this script started…');
  if (IS_WIN) {
    try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  } else {
    child.kill('SIGTERM');
  }
}

const DUTY_JOURNEY_ID = '2d2f26b1-31b9-434b-a858-e614a53599b5';
const MANUAL_DEPARTURE_ID = '338aebc6-8b5e-4a86-acad-a56bcf7a123b';
const MANUAL_SERVICE = 'S125S';
const MANUAL_PERIOD  = 'Morning Outbound';

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

const lerp = (a, b, t) => a + (b - a) * t;

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

async function openWindow({ url, windowPosition, windowSize }) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'demo-real-controller-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    // Required: the Controller's push endpoint uses a self-signed cert
    // (see mele-server/DEPLOY.md §6) — this is the documented
    // "acceptable for a fully local, isolated kiosk display" escape hatch,
    // applied here to this demo's own driver window.
    ignoreHTTPSErrors: true,
    args: [`--window-size=${windowSize}`, `--window-position=${windowPosition}`, `--app=${url}`],
    geolocation: { latitude: STOPS[0].lat, longitude: STOPS[0].lon },
    permissions: ['geolocation', 'screen-wake-lock'],
  });
  const page = await waitForRealPage(context, url);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.evaluate(() => localStorage.setItem('psvair-muted', '1')).catch(() => {});
  await page.evaluate(({ url: wsUrl, token }) => {
    localStorage.setItem('announceLinkUrl', wsUrl);
    localStorage.setItem('announceLinkToken', token);
  }, { url: CONTROLLER_PUSH_URL, token: CONTROLLER_TOKEN }).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' });
  return { context, page };
}

const SCREEN_W = 1280, SCREEN_H = 720;
const PWA_W = 380, PWA_H = 700;
const PWA_X = Math.round((SCREEN_W - PWA_W) / 2);
const PWA_Y = Math.round((SCREEN_H - PWA_H) / 2);

let serverChild = null;
function shutdown() {
  stopServer(serverChild);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
  serverChild = await ensureServerRunning();

  let pwaUrl;
  if (MODE === 'duty') {
    pwaUrl = `${BASE_URL}/driver/index.html?duties=${DUTY_JOURNEY_ID}`;
  } else {
    pwaUrl = `${BASE_URL}/driver/index.html`;
    console.log("Resolving today's manual-mode journey row…");
    await resolveManualJourneyId();
  }

  console.log(`\nPushing to the REAL Controller at ${CONTROLLER_PUSH_URL}`);
  console.log('Watch the physical Monitor for this — not a laptop window.\n');

  const driver = await openWindow({
    url: pwaUrl,
    windowPosition: `${PWA_X},${PWA_Y}`,
    windowSize: `${PWA_W},${PWA_H}`,
  });

  if (MODE === 'duty') {
    console.log('Click through the duty card, pick the first stop');
    console.log('("Weston, adj The Chequers PH") as the starting point, and hit Start.');
  } else {
    console.log('Click "Select a service manually", choose');
    console.log(`Service: ${MANUAL_SERVICE}, Period: the one starting "${MANUAL_PERIOD}", then hit Start.`);
  }
  console.log('\nWaiting for the journey to start…');

  await driver.page.waitForSelector('#tracker:not([hidden])', { timeout: 10 * 60 * 1000 });
  console.log('Started — driving the route now. Watch the real Monitor.\n');

  for (let i = 1; i < STOPS.length; i++) {
    const from = STOPS[i - 1];
    const to = STOPS[i];
    const isFinalStop = i === STOPS.length - 1;
    let approachAnnounced = false;

    for (let s = 1; s <= SUB_STEPS; s++) {
      const t = s / SUB_STEPS;
      const pos = { latitude: lerp(from.lat, to.lat, t), longitude: lerp(from.lon, to.lon, t) };
      await driver.context.setGeolocation(pos);

      if (!isFinalStop && !approachAnnounced) {
        const distM = haversine(pos.latitude, pos.longitude, to.lat, to.lon);
        if (distM <= APPROACHING_RADIUS_M) {
          approachAnnounced = true;
          console.log(`  [EVENT 2] Approaching "${to.name}" — should be audible on the Monitor now.`);
        }
      }
      await sleep((SECONDS_PER_STOP * 1000) / SUB_STEPS);
    }

    if (isFinalStop) {
      console.log(`→ ${to.name}`);
      console.log('[EVENT 4] Final stop — "This is the final stop..."');
    } else {
      console.log(`→ ${to.name}`);
      console.log(`  [EVENT 3] Stopped at "${to.name}"`);
    }
  }

  console.log('\nRoute complete — arrived at Boston College. Window stays open;');
  console.log('close it manually (or Ctrl+C this script) when done.');
})().catch((err) => {
  console.error('\n=== _demo-real-controller.mjs failed ===');
  console.error(err);
  stopServer(serverChild);
  process.exitCode = 1;
});
