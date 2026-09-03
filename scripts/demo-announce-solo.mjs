// BusOps Announce Solo — single-window live walkthrough, driving the real
// Solo autopilot end-to-end (idle-loop geofence+time matching, GPS
// tracking, on-screen state, local speechSynthesis) with no Driver device
// and no mele-server/Controller involved (gps_source: 'internal').
//
// Unlike scripts/demo-2up.mjs (base/Lite tier — driven by a Driver device's
// *pushed* state relayed through mele-server), Solo reads/writes Supabase
// directly off its own simulated GPS, so this script only needs one browser
// window, one signed device JWT, and the plain static server (server.js) —
// not mele-server.
//
// Usage:
//   node scripts/demo-announce-solo.mjs [S125S|S116S] [outbound|inbound] [secondsPerStop]
//
// Interactive controls while it's running:
//   SPACE  pause/resume — the bus holds its exact simulated position, so you
//          can take notes on the display/audio without the route moving on
//   N      skip straight to the next stop (cuts the current interpolation)
//   Q      quit — closes the browser and stops any server this script started
//
// Requires SUPABASE_JWT_SECRET in pcv-dashboard/.env.local (the same secret
// vite.config.js's localSignAnnounceTokenApi signs with for the dashboard's
// own "Get Install Link" button) — this script signs the identical token
// shape directly in Node, since no dashboard dev server needs to be running
// for this.
//
// Targets the dev Solo test device only (id hardcoded below) — nothing has
// shipped to production yet, all testing targets develop/dev Supabase (see
// memory: project_develop_is_active_env). That device's
// candidate_departure_ids/active windows were set up 2026-09-02 to cover
// both S125S and S116S, both directions, every day, all day.

import { chromium } from 'playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import { haversine } from '../pcv-dashboard/busops/shared/geo.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IS_WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── CLI args ─────────────────────────────────────────────────────────────
const SERVICE = (process.argv[2] ?? 'S125S').toUpperCase();
const DIRECTION = (process.argv[3] ?? 'outbound').toLowerCase();
const SECONDS_PER_STOP = Number(process.argv[4] ?? 14);
const SUB_STEPS = 6;
const APPROACHING_RADIUS_M = 250; // mirrors gps.js's own threshold — narration only

if (!['S125S', 'S116S'].includes(SERVICE)) {
  console.error('Usage: node scripts/demo-announce-solo.mjs [S125S|S116S] [outbound|inbound] [secondsPerStop]');
  process.exit(1);
}

// ── Dev Solo test device ────────────────────────────────────────────────
const DEVICE_ID  = '11fffc73-b50d-4678-9234-4e149c1385f7';
const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const VEHICLE_ID = '60158411-de5d-4f24-bf18-35264ca1dbc8';

// ── Route stops — read straight from schedule.json (the same file the app
// itself ships), so this script can never drift from the real stop data ───
const schedulePath = join(ROOT, 'pcv-dashboard/busops/driver/src/schedule.json');
const schedule = JSON.parse(readFileSync(schedulePath, 'utf8'));
const serviceDepartures = schedule[SERVICE];
if (!serviceDepartures) {
  console.error(`No "${SERVICE}" entry in schedule.json — run scripts/generate-schedule.mjs first?`);
  process.exit(1);
}
const found = Object.entries(serviceDepartures).find(([, dep]) => dep.label.toLowerCase().includes(DIRECTION));
if (!found) {
  console.error(`No ${SERVICE} departure matching direction "${DIRECTION}" — known labels:`,
    Object.values(serviceDepartures).map((d) => d.label));
  process.exit(1);
}
const departure = found[1];
const STOPS = departure.stops;
const stripIndicator = (name) => name.replace(/\s*\([^)]*\)\s*$/, '');
console.log(`Route: ${SERVICE} — ${departure.label} (${STOPS.length} stops, "${stripIndicator(STOPS[0].name)}" -> "${stripIndicator(STOPS[STOPS.length - 1].name)}")`);

// ── Sign the device JWT ourselves (same shape as api/sign-announce-token.js
// / vite.config.js's localSignAnnounceTokenApi) — no dashboard/API server
// needed for this script ───────────────────────────────────────────────────
function base64url(str) {
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
const ANNOUNCE_TOKEN_LIFETIME_SECONDS = 100 * 365 * 24 * 60 * 60;
function signAnnounceDeviceToken(secret) {
  // No kid — matches generate_duty_token()'s own fixed header constant
  // exactly (schema.sql: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' decodes to
  // this same {alg,typ} pair, no kid). Real duty-card tokens built that way
  // verify fine against dev Supabase, confirming the legacy secret alone is
  // sufficient here — the 401s this script hit earlier were a self-inflicted
  // bug in readEnvLocal() (not stripping the secret's surrounding quotes in
  // .env.local), not a JWT-signing-keys/kid issue. See its comment.
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    iss: 'supabase', role: 'anon',
    device_id: DEVICE_ID, company_id: COMPANY_ID, vehicle_id: VEHICLE_ID,
    iat: now, exp: now + ANNOUNCE_TOKEN_LIFETIME_SECONDS,
  }));
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${payload}.${sig}`;
}
function readEnvLocal(key) {
  const text = readFileSync(join(ROOT, 'pcv-dashboard/.env.local'), 'utf8');
  const line = text.split('\n').find((l) => l.trim().startsWith(`${key}=`));
  if (!line) return null;
  const raw = line.slice(line.indexOf('=') + 1).trim();
  // Strip a single matching pair of surrounding quotes — Vite's own env
  // loader does this automatically (which is why the dashboard's real
  // "Get Install Link" button, built on the same secret, works fine); this
  // hand-rolled parser didn't, so it was signing with the literal quote
  // characters included as part of the secret. Confirmed live, 2026-09-02:
  // that's what produced PGRST301 "No suitable key or wrong key type" —
  // not a Supabase JWT-signing-keys issue at all, a wrong byte string.
  const quoted = /^(["'])(.*)\1$/.exec(raw);
  return quoted ? quoted[2] : raw;
}
const jwtSecret = readEnvLocal('SUPABASE_JWT_SECRET');
if (!jwtSecret) {
  console.error('SUPABASE_JWT_SECRET not found in pcv-dashboard/.env.local — needed to sign the device token.');
  process.exit(1);
}
const deviceToken = signAnnounceDeviceToken(jwtSecret);

// ── Plain static server (server.js, :8080) — NOT mele-server. Solo reads/
// writes Supabase directly; there is no push relay involved on this tier. ──
const PORT = 8080;
const BASE_URL = `http://localhost:${PORT}`;

async function isServerUp() {
  try {
    const res = await fetch(`${BASE_URL}/announce/onboard.html`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}
async function ensureServerRunning() {
  if (await isServerUp()) {
    console.log(`server.js already running on :${PORT} — reusing it.`);
    return null;
  }
  console.log('Starting pcv-dashboard/busops/server.js…');
  const child = spawn('node', ['server.js'], { cwd: join(ROOT, 'pcv-dashboard/busops'), shell: IS_WIN });
  child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  for (let i = 0; i < 30; i++) {
    if (await isServerUp()) return child;
    await sleep(200);
  }
  throw new Error(`server.js did not come up on :${PORT} within 6s`);
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

// context.pages()[0] can race the --app= window's real navigation and grab
// a transient about:blank page instead — poll for a page whose origin
// actually matches (same technique as demo-2up.mjs).
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

// ── Pause/skip/quit controls ────────────────────────────────────────────
let paused = false;
let skipRequested = false;
let quitRequested = false;
const TICK_MS = 100;

function attachKeyListener() {
  if (!process.stdin.isTTY) {
    console.log('(stdin is not a TTY — pause/skip/quit keys unavailable; Ctrl+C to stop.)');
    return;
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key) => {
    if (key.charCodeAt(0) === 3 || key.toLowerCase() === 'q') { quitRequested = true; return; } // Ctrl+C or Q
    if (key === ' ') {
      paused = !paused;
      console.log(paused
        ? '\n⏸  PAUSED - bus holds its exact position. Press SPACE to resume, Q to quit.'
        : '\n▶  RESUMED.');
      return;
    }
    if (key.toLowerCase() === 'n') {
      skipRequested = true;
      console.log('\n⏭  Skipping to next stop...');
    }
  });
  console.log('\nControls: [SPACE] pause/resume   [N] skip to next stop   [Q] quit\n');
}

// Sleeps `ms` of *unpaused* time, returning early on a skip/quit request.
async function pausableSleep(ms) {
  let elapsed = 0;
  while (elapsed < ms) {
    if (quitRequested || skipRequested) return;
    await sleep(TICK_MS);
    if (!paused) elapsed += TICK_MS;
  }
}
async function waitWhilePaused() {
  while (paused && !quitRequested) await sleep(TICK_MS);
}

// ── Main ─────────────────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;

let serverChild = null;
let context = null;
async function shutdown() {
  if (context) await context.close().catch(() => {});
  stopServer(serverChild);
  process.exit(0);
}
process.on('SIGINT', shutdown);

(async () => {
  serverChild = await ensureServerRunning();

  const onboardUrl = new URL('/announce/onboard.html', BASE_URL);
  onboardUrl.searchParams.set('announce-device-token', deviceToken);
  onboardUrl.searchParams.set('panel-profile', 'lite'); // DOOGEE Tab E3 Max — the real Solo hardware target

  const userDataDir = mkdtempSync(join(tmpdir(), 'demo-announce-solo-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    args: ['--window-size=900,600', '--window-position=200,80', `--app=${onboardUrl.toString()}`],
    geolocation: { latitude: STOPS[0].lat, longitude: STOPS[0].lon },
    permissions: ['geolocation', 'screen-wake-lock'],
  });
  const page = await waitForRealPage(context, onboardUrl.toString());
  page.on('console', (msg) => console.log(`[browser:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => console.log('[browser:pageerror]', err));
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  attachKeyListener();

  console.log(`Positioned at "${stripIndicator(STOPS[0].name)}" (this route's first stop). Waiting for Solo's idle loop`);
  console.log('to match it against its candidates (polls every 5s)...');
  const matched = await page.waitForSelector('#onboard-sign:not([hidden])', { timeout: 60_000 }).catch(() => null);
  if (!matched) {
    console.error('\nTimed out waiting for the journey to start. Check: is this device\'s active window open right');
    console.error('now, is testing_mode set (for a geofence-only fallback match), and does candidate_departure_ids');
    console.error(`actually include this ${SERVICE} ${DIRECTION} departure (${found[0]})?`);
    await shutdown();
    return;
  }
  console.log('Journey started.\n');
  console.log(`[ROUTE START] "This is a(n) ${SERVICE} to ${stripIndicator(STOPS[STOPS.length - 1].name)}." should be audible now.`);
  await sleep(1500); // let the AT_STOP/STOP_DEPARTURE pair for the origin stop land before narrating movement
  console.log(`[AT STOP] "${stripIndicator(STOPS[0].name)}" - arrival + departure-naming-next should be audible now.\n`);

  for (let i = 1; i < STOPS.length && !quitRequested; i++) {
    const from = STOPS[i - 1];
    const to = STOPS[i];
    const isFinalStop = i === STOPS.length - 1;
    let approachAnnounced = false;

    for (let s = 1; s <= SUB_STEPS && !quitRequested; s++) {
      if (skipRequested) { skipRequested = false; break; }
      await waitWhilePaused();
      if (quitRequested) break;

      const t = s / SUB_STEPS;
      const pos = { latitude: lerp(from.lat, to.lat, t), longitude: lerp(from.lon, to.lon, t) };
      await context.setGeolocation(pos);

      if (!isFinalStop && !approachAnnounced) {
        const distM = haversine(pos.latitude, pos.longitude, to.lat, to.lon);
        if (distM <= APPROACHING_RADIUS_M) {
          approachAnnounced = true;
          console.log(`  [APPROACHING] "${stripIndicator(to.name)}" - should be audible/on-screen now.`);
        }
      }
      await pausableSleep((SECONDS_PER_STOP * 1000) / SUB_STEPS);
    }
    if (quitRequested) break;

    await context.setGeolocation({ latitude: to.lat, longitude: to.lon }); // land exactly on the stop regardless of skip
    if (isFinalStop) {
      console.log(`-> ${stripIndicator(to.name)}\n  [FINAL STOP] "This bus terminates here, all change please." should be audible now.`);
    } else {
      console.log(`-> ${stripIndicator(to.name)}\n  [AT STOP / DEPARTURE] arrival + next-stop announcement should be audible now.`);
    }
    await waitWhilePaused();
  }

  if (!quitRequested) {
    console.log('\nRoute complete - the device should auto-complete the journey and return to its idle/next-departure screen.');
  }
  console.log('Window stays open - press Q or Ctrl+C to close it and exit.');
  while (!quitRequested) await sleep(TICK_MS);
  await shutdown();
})().catch(async (err) => {
  console.error('\n=== demo-announce-solo.mjs failed ===');
  console.error(err);
  if (context) await context.close().catch(() => {});
  stopServer(serverChild);
  process.exitCode = 1;
});
