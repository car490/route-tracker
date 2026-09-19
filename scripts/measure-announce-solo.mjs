// BusOps Announce Solo: measure the REAL sign on the REAL tablet, read-only.
//
// Sibling to review-announce-solo.mjs. That script walks the sign through a route; this one
// takes ONE measurement of whatever the sign is showing right now and judges it against the
// approved sizes (22 mm lowercase x-height on Lines 2/3, 13.5 mm top bar and Line 1, 23 mm bar,
// 21.6 mm Line 1 slot, 24 mm sentence states, 5.5 mm brand mark). It attaches over a temporary
// Chrome DevTools Protocol session tunnelled through `adb forward`, evaluates one read-only
// function in the page (tabletProbe.mjs), takes a screenshot, and detaches. It never navigates,
// never touches a Fully Kiosk or Android setting, never writes to the device, and never records
// the page's URL query (which carries the device token).
//
// Usage:
//   node scripts/measure-announce-solo.mjs [--serial <adb serial>] [--lit-height-mm 180] [--out <dir>]
//   node scripts/measure-announce-solo.mjs --cdp-port <port>    # attach to an existing DevTools port (no adb)
//
// Requires (adb mode): `adb` on PATH, the tablet on USB with debugging authorised, and Fully
// Kiosk's web-contents debugging already ON. If it is off this tool says so and stops; it does
// not switch it on. Run it while the sign is showing a stop (three lines) to check Lines 2/3;
// on the idle screen it still checks the top bar and the brand mark.
//
// Exit code: 0 all checks pass, 1 a check failed, 2 could not measure (nothing attached, etc).

import WebSocket from 'ws';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

import { parseAdbDevices, chooseDevice, findWebviewSocketNames, pickSignTarget } from './announce-replica/src/tabletAdb.mjs';
import { evaluateTabletReport, SOLO_LIT_WIDTH_MM, SOLO_LIT_HEIGHT_MM } from './announce-replica/src/tabletReport.mjs';
import { probeSign } from './announce-replica/src/tabletProbe.mjs';
import { withTimeout, DevToolsTimeout } from './announce-replica/src/tabletCdp.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── arguments ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? undefined : argv[i + 1]; };
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(readUsage());
  process.exit(0);
}
const serialArg = flag('serial');
const cdpPortArg = flag('cdp-port');
const outRoot = resolve(flag('out') ?? join(ROOT, 'scripts', 'tablet-captures'));
const litHeightMm = Number(flag('lit-height-mm') ?? SOLO_LIT_HEIGHT_MM);
const litWidthMm = Number(flag('lit-width-mm') ?? SOLO_LIT_WIDTH_MM);
const FORWARD_PORT = Number(flag('port') ?? 9224); // differs from review-announce-solo.mjs's 9223 so both can be used

function readUsage() {
  return [
    'Usage: node scripts/measure-announce-solo.mjs [--serial <adb serial>] [--lit-height-mm 180] [--lit-width-mm 289] [--out <dir>]',
    '       node scripts/measure-announce-solo.mjs --cdp-port <port>   (attach to an existing DevTools port instead of using adb)',
    'Read-only. Exit 0 = all checks pass, 1 = a check failed, 2 = could not measure.',
  ].join('\n');
}

class CouldNotMeasure extends Error {}

// ── adb (read/tunnel only) ───────────────────────────────────────────────
const KNOWN_ADB_PATHS = [
  'C:\\Program Files (x86)\\Android\\android-sdk\\platform-tools\\adb.exe',
  'C:\\Program Files\\Android\\android-sdk\\platform-tools\\adb.exe',
  `${process.env.LOCALAPPDATA}\\Android\\Sdk\\platform-tools\\adb.exe`,
];
let adbBin = null;
function resolveAdb() {
  if (adbBin) return adbBin;
  for (const candidate of [process.env.ADB, 'adb', ...KNOWN_ADB_PATHS].filter(Boolean)) {
    try { execFileSync(candidate, ['version'], { stdio: 'pipe' }); adbBin = candidate; return candidate; } catch { /* next */ }
  }
  throw new CouldNotMeasure('adb not found on PATH or in a known install location. Install Android platform-tools or set ADB=/path/to/adb.exe. Nothing on the tablet needs changing.');
}
function adb(args, serial) {
  const full = serial ? ['-s', serial, ...args] : args;
  try {
    return execFileSync(resolveAdb(), full, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    throw new CouldNotMeasure(`adb ${full.join(' ')} failed: ${(err.stderr || err.message || '').toString().trim()}`);
  }
}

// ── raw CDP client (same technique as review-announce-solo.mjs) ──────────
class CDPClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve: ok, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else ok(msg.result);
      }
    });
  }
  // Every call has a time limit: the Android WebView never answers Page.captureScreenshot, and an
  // unbounded wait turned that into a hang (found live 2026-09-19).
  send(method, params = {}, limitMs = 20000) {
    const id = this.nextId++;
    const call = new Promise((ok, reject) => {
      this.pending.set(id, { resolve: ok, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
    return withTimeout(call, limitMs, method).catch((err) => {
      this.pending.delete(id);
      throw err;
    });
  }
}

async function listTargets(port) {
  let res;
  try {
    res = await withTimeout(fetch(`http://127.0.0.1:${port}/json`), 10000, 'GET /json');
  } catch (err) {
    throw new CouldNotMeasure(`Nothing is listening for DevTools on 127.0.0.1:${port} (${err.cause?.code ?? err.message}).`);
  }
  return res.json();
}

async function connect(port) {
  const targets = await listTargets(port);
  const page = pickSignTarget(targets);
  if (!page) {
    // never print the query string: it can carry the device token
    const seen = targets.filter((t) => t.type === 'page' && typeof t.url === 'string').map((t) => t.url.split(/[?#]/)[0]).join(', ') || 'no pages';
    throw new CouldNotMeasure(`The sign (/announce/onboard) is not open in that WebView (pages: ${seen}). Open the sign first.`);
  }
  // some WebView builds echo a hostname/port that is not our tunnel: force the one we control
  const wsUrl = new URL(page.webSocketDebuggerUrl);
  wsUrl.hostname = '127.0.0.1';
  wsUrl.port = String(port);
  const ws = new WebSocket(wsUrl.toString());
  await withTimeout(new Promise((ok, reject) => { ws.once('open', ok); ws.once('error', reject); }), 10000, 'WebSocket open');
  return { ws, client: new CDPClient(ws) };
}

// ── main ─────────────────────────────────────────────────────────────────
async function measure() {
  if (!Number.isFinite(litHeightMm) || litHeightMm <= 0) throw new CouldNotMeasure(`--lit-height-mm must be a positive number, got "${flag('lit-height-mm')}".`);

  let port;
  let device = null;
  let forwarded = null;
  if (cdpPortArg) {
    port = Number(cdpPortArg);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new CouldNotMeasure(`--cdp-port must be a port number, got "${cdpPortArg}".`);
  } else {
    device = chooseDevice(parseAdbDevices(adb(['devices', '-l'])), serialArg);
    const sockets = findWebviewSocketNames(adb(['shell', 'cat', '/proc/net/unix'], device.serial));
    if (sockets.length === 0) {
      throw new CouldNotMeasure(
        'The tablet is not exposing WebView DevTools right now, so there is nothing to attach to.\n' +
        'Fully Kiosk\'s web-contents debugging is off (setting key webviewDebugging). This tool will not switch it on:\n' +
        'turn it on in Fully Kiosk yourself, then run again. (Importing Fully Kiosk settings resets it to off.)',
      );
    }
    if (sockets.length > 1) console.log(`More than one WebView debugging socket found; using the first: ${sockets[0]}`);
    port = FORWARD_PORT;
    adb(['forward', `tcp:${port}`, `localabstract:${sockets[0]}`], device.serial);
    forwarded = device.serial;
    await sleep(300); // let the forward settle before the first HTTP fetch
  }

  let conn = null;
  try {
    conn = await connect(port);
    const evaluated = await conn.client.send('Runtime.evaluate', {
      expression: `(${probeSign.toString()})()`,
      awaitPromise: true,
      returnByValue: true,
    }, 30000);
    if (evaluated.exceptionDetails) throw new CouldNotMeasure(`The probe failed inside the page: ${evaluated.exceptionDetails.text ?? 'exception'}`);
    const report = evaluated.result.value;

    // The screenshot is a nice-to-have and must never block the measurement. On the tablet the
    // WebView does not answer Page.captureScreenshot, so take it with `adb screencap` (native panel
    // pixels); with a plain DevTools port (the tests) use DevTools and carry on without it.
    let screenshot = null;
    let screenshotNote = null;
    try {
      if (device) {
        screenshot = execFileSync(resolveAdb(), ['-s', device.serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
      } else {
        screenshot = Buffer.from((await conn.client.send('Page.captureScreenshot', { format: 'png' }, 15000)).data, 'base64');
      }
    } catch (err) {
      screenshotNote = `Screenshot not saved (${String(err.message).split('\n')[0]}); the measurements do not need it.`;
    }
    return { report, screenshot, screenshotNote, device };
  } finally {
    try { conn?.ws.close(); } catch { /* already closed */ }
    if (forwarded) { try { adb(['forward', '--remove', `tcp:${port}`], forwarded); } catch { /* best effort */ } }
  }
}

function save({ report, result, screenshot, device }) {
  const t = new Date();
  const stamp = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}`;
  let dir = join(outRoot, `${stamp}-${result.state}`);
  for (let n = 2; existsSync(dir); n++) dir = join(outRoot, `${stamp}-${result.state}-${n}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ device: device ? { model: device.model ?? null } : null, litHeightMm, litWidthMm, report, result }, null, 2));
  if (screenshot) writeFileSync(join(dir, 'screenshot.png'), screenshot);
  return dir;
}

try {
  const measured = await measure();
  const result = evaluateTabletReport(measured.report, { litHeightMm, litWidthMm });
  const dir = save({ ...measured, result });

  const r = measured.report;
  console.log(`Page: ${r.url} | viewport ${r.viewport.w} x ${r.viewport.h} CSS px, DPR ${Number(r.dpr).toFixed(2)} | ${result.pxPerMm.toFixed(4)} px/mm at ${litHeightMm} mm lit height`);
  console.log(`State on screen: ${result.state}${r.sign.threeLine ? ' (three-line)' : ''}\n`);
  for (const c of result.checks) console.log(`  ${c.status === 'pass' ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  for (const note of [...result.notes, measured.screenshotNote].filter(Boolean)) console.log(`\nNote: ${note}`);
  const failed = result.checks.filter((c) => c.status === 'fail').length;
  console.log(`\nRESULT: ${result.ok ? 'PASS' : 'FAIL'} (${result.checks.length - failed} of ${result.checks.length} checks pass)`);
  console.log(`Saved: ${dir}`);
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  console.error(err instanceof DevToolsTimeout
    ? `Could not measure: ${err.message}. Is the sign on screen (not Fully Kiosk's settings)? Is the tablet awake?`
    : err?.message
      ? `Could not measure: ${err.message}`
      : 'Could not measure.');
  process.exit(2);
}
