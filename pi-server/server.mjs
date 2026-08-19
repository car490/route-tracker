// Runs on the Controller, reachable either over its own WiFi hotspot
// (Option A — a Fire HD or other WiFi-client display) or from a kiosk
// browser running locally on the box itself (Option B — HDMI display, see
// DEPLOY.md). Two jobs: serve the onboard app's static files (the display
// can't reach GitHub Pages from an isolated hotspot, and has no browser of
// its own in Option B), and serve the schedule cache written by the announce
// relay's onSchedule callback (see writeScheduleCache below) whenever the
// Driver device pushes a fresh one. No GPS of its own (see
// docs/CONTROLLER-REDESIGN.md §6 — the Controller has no GPS hardware; that
// lives entirely on the Driver device and flows through as pushed state).
// Zero external dependencies, same style as the repo-root server.js.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachAnnounceRelay } from './announceRelay.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..'); // pi-server/ sits alongside index.html, src/, style.css
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
  if (urlPath === '/') urlPath = '/onboard.html';
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

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath === '/api/schedule') return void serveApiSchedule(res, relay);
  serveStaticFile(urlPath, res);
});

const relay = attachAnnounceRelay(server, { token: DRIVER_PUSH_TOKEN, onSchedule: writeScheduleCache });

server.listen(PORT, () =>
  console.log(`pi-server running -> http://0.0.0.0:${PORT}/`)
);
