// Runs on the Controller, reachable either over its own WiFi hotspot
// (Option A — a WiFi-client display, none currently deployed) or from a
// kiosk browser running locally on the box itself (Option B — HDMI display,
// see DEPLOY.md). Three jobs: serve the onboard app's static files (the
// display can't reach GitHub Pages from an isolated hotspot, and has no
// browser of its own in Option B), serve the schedule cache written by the
// announce relay's onSchedule callback (see writeScheduleCache below)
// whenever the Driver device pushes a fresh one, and play PSVAIR
// announcement audio locally (createAudioPlayer, docs/HARDWARE.md §4)
// whenever the Driver pushes a {type:'announce'} message —
// no GPS of its own (see docs/HARDWARE.md "Read this first"/§2 — the Controller
// has no GPS hardware; that lives entirely on the Driver device and flows
// through as pushed state), and no PSVAIR event-decision logic of its own
// either — audioPlayer.mjs just plays whatever clip keys the Driver already
// resolved. Requires `mpg123` installed (see DEPLOY.md); otherwise zero
// external dependencies, same style as the repo-root server.js.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachAnnounceRelay } from './announceRelay.mjs';
import { createAudioPlayer } from './audioPlayer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// mele-server/ sits at busops/announce/mele-server/; REPO_ROOT is busops/ itself
// (two levels up) because onboard.html's relative links to shared assets
// (../shared/brand-tokens.css, ../shared/icons/...) and its service worker
// registration (../service-worker.js) resolve, once the browser normalises
// them against the served URL, to /shared/... and /service-worker.js —
// paths that only exist under busops/, not busops/announce/.
const REPO_ROOT = path.join(__dirname, '../..');
const CACHE_PATH = path.join(__dirname, 'schedule-cache.json');
const PORT = Number(process.env.PORT) || 8080;
// Shared secret for the /driver-push and /sign-feed WebSocket endpoints
// (see announceRelay.mjs) — set via the systemd unit's Environment= line.
// These are the Controller's only source of schedule/state data; an unset
// token means it stays permanently blank, not degraded.
const DRIVER_PUSH_TOKEN = process.env.DRIVER_PUSH_TOKEN || null;
if (!DRIVER_PUSH_TOKEN) {
  console.warn('[announceRelay] DRIVER_PUSH_TOKEN not set — /driver-push and /sign-feed will reject all connections.');
}

// TLS is required, not optional: the Driver PWA is always served over
// HTTPS (GitHub Pages today, driver.pcvtechnologies.co.uk eventually), and mobile
// WebView (unlike desktop Chrome, which only warns) throws a synchronous
// SecurityError on `new WebSocket('ws://...')` from an HTTPS page — the
// connection is never even attempted, no exception in the codebase catches
// this as a distinguishable case. Plain ws:// therefore cannot work here at
// all, on any real deployed device — confirmed 2026-08-22 by testing the
// live WebView via chrome://inspect against this actual Controller.
// Self-signed since the Controller has no public DNS/WAN path for a real
// CA to validate against (see docs/HARDWARE.md §3); the cert must
// be installed as trusted on each Driver device once at commissioning
// (see mele-server/DEPLOY.md §6). onboard.js already derives ws:/wss:
// dynamically from location.protocol, so no change needed there.
const TLS_CERT_PATH = process.env.TLS_CERT_PATH || path.join(__dirname, 'certs/controller-cert.pem');
const TLS_KEY_PATH = process.env.TLS_KEY_PATH || path.join(__dirname, 'certs/controller-key.pem');
let tlsOptions = null;
try {
  tlsOptions = {
    cert: fs.readFileSync(TLS_CERT_PATH),
    key: fs.readFileSync(TLS_KEY_PATH),
  };
} catch (err) {
  console.warn(`[tls] Could not read cert/key (${TLS_CERT_PATH} / ${TLS_KEY_PATH}): ${err.message}`);
  console.warn('[tls] Falling back to plain HTTP — /driver-push will be unreachable from any HTTPS-served Driver PWA (mixed-content block). Generate a cert per DEPLOY.md before relying on this in a vehicle.');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// Written by the announce relay's onSchedule callback whenever the Driver
// pushes a fresh {type:'schedule', ...} message — see attachAnnounceRelay()
// below. Same atomic tmp+rename pattern the old sync-schedule.mjs used, so
// a Controller reboot mid-shift still has something to serve from disk
// until the Driver reconnects and re-pushes.
async function writeScheduleCache(msg) {
  const tmpPath = `${CACHE_PATH}.tmp`;
  try {
    await fsp.writeFile(tmpPath, JSON.stringify(msg));
    await fsp.rename(tmpPath, CACHE_PATH);
  } catch (err) {
    console.error('[schedule cache] failed to write:', err);
  }
}

async function serveApiSchedule(res, relay) {
  const latest = relay.getLatestSchedule();
  if (latest) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(latest));
    return;
  }
  try {
    const raw = await fsp.readFile(CACHE_PATH, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(raw);
  } catch (_) {
    // No cache yet (no Driver has ever pushed one) — respond with an empty
    // list rather than a hard error so the picker just shows "no routes"
    // instead of crashing.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  }
}

function serveStaticFile(urlPath, res) {
  if (urlPath === '/') urlPath = '/announce/onboard.html';
  const filePath = path.join(REPO_ROOT, urlPath);
  // Guard against path traversal escaping the repo root.
  if (!filePath.startsWith(REPO_ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const mime = MIME[path.extname(filePath)] ?? 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

const requestHandler = (req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath === '/api/schedule') return void serveApiSchedule(res, relay);
  serveStaticFile(urlPath, res);
};
const server = tlsOptions
  ? https.createServer(tlsOptions, requestHandler)
  : http.createServer(requestHandler);

const audioPlayer = createAudioPlayer();
const relay = attachAnnounceRelay(server, {
  token: DRIVER_PUSH_TOKEN,
  onSchedule: writeScheduleCache,
  onAnnounce: (msg) => audioPlayer.enqueueAnnounce(msg.text, msg.audioKeys),
});

server.listen(PORT, () =>
  console.log(`mele-server running -> ${tlsOptions ? 'https' : 'http'}://0.0.0.0:${PORT}/`)
);
