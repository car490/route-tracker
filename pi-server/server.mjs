// Runs on the Pi, reachable only over its own WiFi hotspot by the mounted
// Fire HD. Three jobs: serve the onboard app's static files (the Fire HD
// can't reach GitHub Pages from an isolated hotspot), serve the schedule
// cache written by sync-schedule.mjs, and bridge gpsd's GPS fix out as a
// tiny polled endpoint. Zero external dependencies, same style as the
// repo-root server.js.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGpsdClient } from './gpsd-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..'); // pi-server/ sits alongside index.html, src/, style.css
const CACHE_PATH = path.join(__dirname, 'schedule-cache.json');
const PORT = Number(process.env.PORT) || 8080;
const GPSD_HOST = process.env.GPSD_HOST || '127.0.0.1';
const GPSD_PORT = Number(process.env.GPSD_PORT) || 2947;
// A fix older than this is treated as stale (GPS lost) rather than served as current.
const FIX_MAX_AGE_MS = 15_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const gpsd = startGpsdClient({ host: GPSD_HOST, port: GPSD_PORT });

async function serveApiSchedule(res) {
  try {
    const raw = await fsp.readFile(CACHE_PATH, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(raw);
  } catch (_) {
    // No cache yet (never synced) — respond with an empty list rather than
    // a hard error so the picker just shows "no routes" instead of crashing.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  }
}

function serveApiPosition(res) {
  const fix = gpsd.getLatestFix();
  if (!fix || Date.now() - fix.ts > FIX_MAX_AGE_MS) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no_fix' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ lat: fix.lat, lon: fix.lon, speed: fix.speed }));
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

http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath === '/api/schedule') return void serveApiSchedule(res);
  if (urlPath === '/api/position') return void serveApiPosition(res);
  serveStaticFile(urlPath, res);
}).listen(PORT, () =>
  console.log(`pi-server running -> http://0.0.0.0:${PORT}/  (gpsd @ ${GPSD_HOST}:${GPSD_PORT})`)
);
