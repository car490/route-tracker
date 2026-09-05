// BusOps Announce Solo — real-tablet AV review walkthrough.
//
// Sibling to demo-announce-solo.mjs, but instead of opening a local
// Playwright browser window, it attaches to the WebView Fully Kiosk
// *already has open* on the real physical Solo tablet, over a temporary,
// non-persistent Chrome DevTools Protocol (CDP) session tunnelled through
// `adb forward`. It never navigates that page anywhere, never changes any
// Fully Kiosk or Android setting, and never writes anything to the device —
// it only feeds mocked geolocation into the page that's already running and
// reads its state back, exactly the way demo-announce-solo.mjs's Playwright
// script does via context.setGeolocation()/waitForSelector(). Closing this
// script (Q/Ctrl+C) tears down the adb port-forward and drops the CDP
// session; the tablet is left exactly as it was.
//
// Deliberately does NOT sign a device token or touch the announce_devices
// row for the real device — it drives whatever the tablet is already
// showing, under its own already-configured candidates/active window.
//
// Usage:
//   node scripts/review-announce-solo.mjs [S125S|S116S] [outbound|inbound] [secondsPerStop]
//
// Requires: `adb` on PATH, the tablet connected over USB with USB debugging
// already authorized (unchanged from however it's set up today), and Fully
// Kiosk's WebView already showing onboard.html for a journey this device is
// actually candidate-configured for.
//
// Interactive controls while it's running:
//   SPACE        pause/resume — the bus holds its exact simulated position
//   N            skip straight to the next stop
//   0-9 + Enter  jump straight to that stop index (see the printed stop list)
//   Q            quit — closes the CDP session and the adb port-forward

import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { haversine } from '../pcv-dashboard/busops/shared/geo.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── CLI args ─────────────────────────────────────────────────────────────
const SERVICE = (process.argv[2] ?? 'S125S').toUpperCase();
const DIRECTION = (process.argv[3] ?? 'outbound').toLowerCase();
const SECONDS_PER_STOP = Number(process.argv[4] ?? 14);
const SUB_STEPS = 6;
const APPROACHING_RADIUS_M = 250; // mirrors gps.js's own threshold — narration only
const FORWARD_PORT = 9223; // arbitrary local port for the adb tunnel; freed on exit

if (!['S125S', 'S116S'].includes(SERVICE)) {
  console.error('Usage: node scripts/review-announce-solo.mjs [S125S|S116S] [outbound|inbound] [secondsPerStop]');
  process.exit(1);
}

// ── Route stops — read straight from schedule.json, same file the app
// ships and demo-announce-solo.mjs reads — this script can't drift from
// real stop data ─────────────────────────────────────────────────────────
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
console.log(`Route: ${SERVICE} — ${departure.label} (${STOPS.length} stops)`);
console.log('Stops:');
STOPS.forEach((s, i) => console.log(`  ${i}. ${stripIndicator(s.name)}`));

// ── adb helpers — read/tunnel only, never touch a setting ─────────────────
function adb(args) {
  try {
    return execFileSync('adb', args, { encoding: 'utf8' });
  } catch (err) {
    throw new Error(`adb ${args.join(' ')} failed: ${err.stderr || err.message}`);
  }
}

function checkAdbAvailable() {
  try {
    execFileSync('adb', ['version'], { stdio: 'pipe' });
  } catch {
    throw new Error(
      'adb not found on PATH. Install Android platform-tools (adb is the only tool this script\n' +
      'needs) and make sure it is on PATH, then re-run. Nothing on the tablet needs changing for this.',
    );
  }
}

function checkDeviceConnected() {
  const out = adb(['devices']);
  const lines = out.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  const authorized = lines.filter((l) => l.endsWith('device'));
  if (authorized.length === 0) {
    throw new Error(
      `No authorized adb device found. \`adb devices\` reported:\n${out}\n` +
      'Plug the tablet in over USB and accept the "Allow USB debugging?" prompt on it if shown\n' +
      '(that prompt is the device\'s own OS asking, not a setting this script changes).',
    );
  }
  if (authorized.length > 1) {
    console.log('Multiple adb devices connected — using the first one:', authorized[0]);
  }
}

// Finds the abstract socket name for the WebView's already-running remote
// debug endpoint. Purely a read (`cat /proc/net/unix`) — nothing written.
function findWebviewSocketName() {
  const out = adb(['shell', 'cat', '/proc/net/unix']);
  const line = out.split('\n').find((l) => l.includes('webview_devtools_remote'));
  if (!line) {
    throw new Error(
      'No webview_devtools_remote_* socket found on the device. This means the app currently on\n' +
      'screen isn\'t exposing WebView remote debugging right now — check WebView Contents\n' +
      'Debugging is already on in Fully Kiosk\'s settings (don\'t toggle it if it\'s off; ask first).',
    );
  }
  const fields = line.trim().split(/\s+/);
  return fields[fields.length - 1].replace(/^@/, ''); // last field is the (possibly @-prefixed) path
}

// `adb forward` is a live TCP tunnel, not a stored setting — torn down on exit.
function forwardPort(socketName) {
  adb(['forward', `tcp:${FORWARD_PORT}`, `localabstract:${socketName}`]);
}
function removePortForward() {
  try { adb(['forward', '--remove', `tcp:${FORWARD_PORT}`]); } catch {}
}

async function findOnboardPageTarget() {
  const res = await fetch(`http://localhost:${FORWARD_PORT}/json`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && /onboard\.html/.test(t.url))
    ?? targets.find((t) => t.type === 'page');
  if (!page) {
    throw new Error(`No page target found at http://localhost:${FORWARD_PORT}/json — got: ${JSON.stringify(targets)}`);
  }
  return page;
}

// ── Minimal raw CDP client over `ws` — the proven fallback technique from
// the wss:// cert-fix session (Storage.clearDataForOrigin,
// navigator.permissions.query via Runtime.evaluate), reused here for
// Emulation.setGeolocationOverride instead. Only ever reads/evaluates/
// overrides at the protocol level — never Page.navigate, never a settings
// call. ─────────────────────────────────────────────────────────────────
class CDPClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        for (const cb of this.listeners.get(msg.method) ?? []) cb(msg.params);
      }
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, cb) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(cb);
  }
}

async function connectCDP(webSocketDebuggerUrl) {
  // Some Android WebView builds echo back a hostname/port that doesn't match
  // our actual forwarded port — force it to the one we control.
  const wsUrl = new URL(webSocketDebuggerUrl);
  wsUrl.hostname = 'localhost';
  wsUrl.port = String(FORWARD_PORT);
  const ws = new WebSocket(wsUrl.toString());
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const client = new CDPClient(ws);
  await client.send('Runtime.enable');
  client.on('Runtime.consoleAPICalled', (p) => {
    const text = (p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
    console.log(`[tablet:${p.type}] ${text}`);
  });
  client.on('Runtime.exceptionThrown', (p) => {
    console.log('[tablet:pageerror]', p.exceptionDetails?.text ?? p.exceptionDetails);
  });
  return { ws, client };
}

async function evalBool(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, returnByValue: true });
  return Boolean(result.result?.value);
}

async function setGeolocation(client, latitude, longitude) {
  await client.send('Emulation.setGeolocationOverride', { latitude, longitude, accuracy: 10 });
}

// ── Pause/skip/jump/quit controls ───────────────────────────────────────
let paused = false;
let skipRequested = false;
let quitRequested = false;
let jumpToIndex = null;
let digitBuffer = '';
const TICK_MS = 100;

function attachKeyListener() {
  if (!process.stdin.isTTY) {
    console.log('(stdin is not a TTY — pause/skip/jump/quit keys unavailable; Ctrl+C to stop.)');
    return;
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key) => {
    if (key.charCodeAt(0) === 3) { quitRequested = true; return; } // Ctrl+C
    if (/^[0-9]$/.test(key)) { digitBuffer += key; process.stdout.write(key); return; }
    if (key === '\r' || key === '\n') {
      if (digitBuffer) {
        const n = Number(digitBuffer);
        digitBuffer = '';
        if (n >= 0 && n < STOPS.length) {
          jumpToIndex = n;
          console.log(`\n⏩ Jumping to stop ${n} ("${stripIndicator(STOPS[n].name)}")...`);
        } else {
          console.log(`\n(no stop ${n} — route has ${STOPS.length} stops, 0-${STOPS.length - 1})`);
        }
      }
      return;
    }
    if (key.toLowerCase() === 'q') { quitRequested = true; return; }
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
  console.log('\nControls: [SPACE] pause/resume   [N] skip to next stop   [0-9]+Enter jump to stop   [Q] quit\n');
}

async function pausableSleep(ms) {
  let elapsed = 0;
  while (elapsed < ms) {
    if (quitRequested || skipRequested || jumpToIndex !== null) return;
    await sleep(TICK_MS);
    if (!paused) elapsed += TICK_MS;
  }
}
async function waitWhilePaused() {
  while (paused && !quitRequested) await sleep(TICK_MS);
}

// ── Main ─────────────────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;

let ws = null;
async function shutdown() {
  if (ws) ws.close();
  removePortForward();
  process.exit(0);
}
process.on('SIGINT', shutdown);

(async () => {
  checkAdbAvailable();
  checkDeviceConnected();

  console.log('Locating the WebView Fully Kiosk already has open (no navigation, no settings touched)...');
  const socketName = findWebviewSocketName();
  forwardPort(socketName);
  await sleep(300); // let the forward settle before the first HTTP fetch

  const target = await findOnboardPageTarget();
  console.log(`Attached to: ${target.url}`);
  const conn = await connectCDP(target.webSocketDebuggerUrl);
  ws = conn.ws;
  const { client } = conn;

  attachKeyListener();

  console.log(`Overriding geolocation to "${stripIndicator(STOPS[0].name)}" (this route's first stop).`);
  console.log('Waiting for Solo\'s idle loop to match it against its candidates (polls every 5s)...');
  console.log('(If nothing happens within a minute or two, this device\'s active window may not cover');
  console.log(' right now, or it may not be candidate-configured for this exact departure — ask before');
  console.log(' changing either on its Supabase row, per the review session\'s ground rules.)');
  await setGeolocation(client, STOPS[0].lat, STOPS[0].lon);

  let matched = false;
  for (let i = 0; i < 600 && !quitRequested; i++) { // up to ~2 minutes
    if (await evalBool(client, "!!document.querySelector('#onboard-sign') && !document.querySelector('#onboard-sign').hidden")) {
      matched = true;
      break;
    }
    await sleep(200);
  }
  if (!matched) {
    console.error('\nTimed out waiting for the journey to start on the tablet.');
    await shutdown();
    return;
  }
  console.log('Journey started on the tablet.\n');
  console.log(`[ROUTE START] "This is ${departure.label.startsWith('A') ? 'an' : 'a'} ${SERVICE} to ${stripIndicator(STOPS[STOPS.length - 1].name)}." should be audible now.`);
  await sleep(1500);
  console.log(`[DEPARTURE] leaving "${stripIndicator(STOPS[0].name)}" - next-stop announcement should be audible now.\n`);

  let i = 1;
  while (i < STOPS.length && !quitRequested) {
    if (jumpToIndex !== null) {
      i = Math.max(1, Math.min(jumpToIndex, STOPS.length - 1));
      jumpToIndex = null;
    }
    const from = STOPS[i - 1];
    const to = STOPS[i];
    const isFinalStop = i === STOPS.length - 1;
    let approachAnnounced = false;

    for (let s = 1; s <= SUB_STEPS && !quitRequested && jumpToIndex === null; s++) {
      if (skipRequested) { skipRequested = false; break; }
      await waitWhilePaused();
      if (quitRequested || jumpToIndex !== null) break;

      const t = s / SUB_STEPS;
      const lat = lerp(from.lat, to.lat, t);
      const lon = lerp(from.lon, to.lon, t);
      await setGeolocation(client, lat, lon);

      if (!isFinalStop && !approachAnnounced) {
        const distM = haversine(lat, lon, to.lat, to.lon);
        if (distM <= APPROACHING_RADIUS_M) {
          approachAnnounced = true;
          console.log(`  [APPROACHING] "${stripIndicator(to.name)}" - should be audible/on-screen now.`);
        }
      }
      await pausableSleep((SECONDS_PER_STOP * 1000) / SUB_STEPS);
    }
    if (quitRequested) break;
    if (jumpToIndex !== null) continue; // re-enter loop head, which applies the jump

    await setGeolocation(client, to.lat, to.lon); // land exactly on the stop regardless of skip
    if (isFinalStop) {
      console.log(`-> ${stripIndicator(to.name)}\n  [TERMINUS] "This service terminates here, all change please." should be audible now, page red.`);
    } else {
      console.log(`-> ${stripIndicator(to.name)}\n  [DEPARTURE] next-stop announcement should be audible now.`);
    }
    await waitWhilePaused();
    i++;
  }

  if (!quitRequested) {
    console.log('\nRoute complete - the tablet should auto-complete the journey and return to idle.');
  }
  console.log('Session stays open - press Q or Ctrl+C to detach (tablet is untouched either way).');
  while (!quitRequested) await sleep(TICK_MS);
  await shutdown();
})().catch(async (err) => {
  console.error('\n=== review-announce-solo.mjs failed ===');
  console.error(err.message ?? err);
  removePortForward();
  if (ws) ws.close();
  process.exitCode = 1;
});
