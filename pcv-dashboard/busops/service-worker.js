// Registered with { type: 'module' } (see driver/index.html/announce/onboard.html)
// so this can import config.js directly instead of duplicating its
// dev/prod Supabase URL — CLAUDE.md's rule that those values live only in
// driver/src/config.js applies here too. Module service workers have been
// supported in every Chromium-based engine (this fleet's actual runtime —
// Android WebView kiosk tablets, Chrome/Edge desktop) since 2021; if a
// browser without support ever loads this app, registration simply fails
// (existing `.catch(console.error)` in both HTML files) and the app runs
// without offline/precache, same graceful-degradation posture as any other
// registration failure today.
import { SUPABASE_URL, SUPABASE_KEY } from './driver/src/config.js';

const CACHE_NAME = 'busops-driver-v2.2.8-sizing-f';

const STATIC_ASSETS = [
  './',
  './driver/index.html',
  './announce/onboard.html',
  './driver/style.css',
  './announce/onboard.css',
  './driver/manifest.json',
  // CoachMate brand assets — always cached so the brand renders offline
  './shared/icons/icon-192.png',
  './shared/icons/icon-512.png',
  './driver/lib/leaflet.min.js',
  './driver/lib/leaflet.min.css',
  './announce/lib/supabase.min.js',
  './driver/src/main.js',
  './announce/src/onboard.js',
  './announce/src/panelSizing.js',
  './announce/src/headlineLines.js',
  './announce/src/announceDeviceFeed.js',
  './announce/src/announceDeviceSetup.js',
  './announce/src/announceGps.js',
  './announce/src/announceSoloAutopilot.js',
  './announce/src/scheduleAutopilot.js',
  './driver/src/announcements.js',
  './driver/src/directions.js',
  './shared/engine.js',
  './shared/geo.js',
  './shared/geofence.js',
  './shared/gps.js',
  './driver/src/map.js',
  './driver/src/ui.js',
  './shared/logger.js',
  './driver/src/config.js',
  './driver/src/schedule.json',
  './driver/src/supabaseApi.js',
  './driver/src/manualSelection.js',
  './driver/src/vehicleSetup.js',
  './driver/src/announceDeviceLink.js',
  './driver/src/announceDeviceLinkApi.js',
];

const TILE_CACHE = [
  'https://tile.openstreetmap.org/13/4090/2670.png',
  'https://tile.openstreetmap.org/13/4090/2671.png',
  'https://tile.openstreetmap.org/13/4090/2672.png',
  'https://tile.openstreetmap.org/13/4090/2673.png',
  'https://tile.openstreetmap.org/13/4091/2669.png',
  'https://tile.openstreetmap.org/13/4091/2670.png',
  'https://tile.openstreetmap.org/13/4091/2671.png',
  'https://tile.openstreetmap.org/13/4091/2672.png',
  'https://tile.openstreetmap.org/13/4091/2673.png',
  'https://tile.openstreetmap.org/13/4092/2669.png',
  'https://tile.openstreetmap.org/13/4092/2670.png',
  'https://tile.openstreetmap.org/13/4092/2671.png',
  'https://tile.openstreetmap.org/13/4092/2672.png',
  'https://tile.openstreetmap.org/13/4092/2673.png',
  'https://tile.openstreetmap.org/13/4093/2668.png',
  'https://tile.openstreetmap.org/13/4093/2669.png',
  'https://tile.openstreetmap.org/13/4093/2670.png',
  'https://tile.openstreetmap.org/13/4093/2671.png',
  'https://tile.openstreetmap.org/13/4093/2672.png',
  'https://tile.openstreetmap.org/13/4093/2673.png',
  'https://tile.openstreetmap.org/13/4093/2674.png',
  'https://tile.openstreetmap.org/13/4093/2675.png',
  'https://tile.openstreetmap.org/13/4093/2676.png',
  'https://tile.openstreetmap.org/13/4094/2668.png',
  'https://tile.openstreetmap.org/13/4094/2669.png',
  'https://tile.openstreetmap.org/13/4094/2670.png',
  'https://tile.openstreetmap.org/13/4094/2671.png',
  'https://tile.openstreetmap.org/13/4094/2672.png',
  'https://tile.openstreetmap.org/13/4094/2673.png',
  'https://tile.openstreetmap.org/13/4094/2674.png',
  'https://tile.openstreetmap.org/13/4094/2675.png',
  'https://tile.openstreetmap.org/13/4094/2676.png',
  'https://tile.openstreetmap.org/13/4094/2677.png',
  'https://tile.openstreetmap.org/13/4095/2668.png',
  'https://tile.openstreetmap.org/13/4095/2669.png',
  'https://tile.openstreetmap.org/13/4095/2670.png',
  'https://tile.openstreetmap.org/13/4095/2671.png',
  'https://tile.openstreetmap.org/13/4095/2672.png',
  'https://tile.openstreetmap.org/13/4095/2673.png',
  'https://tile.openstreetmap.org/13/4095/2674.png',
  'https://tile.openstreetmap.org/13/4095/2675.png',
  'https://tile.openstreetmap.org/13/4095/2676.png',
  'https://tile.openstreetmap.org/13/4095/2677.png',
  'https://tile.openstreetmap.org/13/4096/2668.png',
  'https://tile.openstreetmap.org/13/4096/2669.png',
  'https://tile.openstreetmap.org/13/4096/2670.png',
  'https://tile.openstreetmap.org/13/4096/2671.png',
  'https://tile.openstreetmap.org/13/4096/2674.png',
  'https://tile.openstreetmap.org/13/4096/2675.png',
  'https://tile.openstreetmap.org/13/4096/2676.png',
  'https://tile.openstreetmap.org/13/4096/2677.png',
  'https://tile.openstreetmap.org/13/4097/2674.png',
  'https://tile.openstreetmap.org/13/4097/2675.png',
  'https://tile.openstreetmap.org/13/4097/2676.png',
  'https://tile.openstreetmap.org/13/4098/2674.png',
  'https://tile.openstreetmap.org/13/4098/2675.png',
  'https://tile.openstreetmap.org/13/4098/2676.png',
];

// Pre-rendered PSVAIR announcement clips. Phase 2 of
// docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md: the file list isn't static like
// STATIC_ASSETS since it grows/shrinks with stops/routes, so it's read live
// from the server-side announcement_clips table (kept current automatically
// by Phase 1's trigger+cron pipeline) rather than a manifest.json baked into
// the deploy. shared/announcementAudio.js's playClip() tries a Storage URL
// built the same way (see PAGE_SIZE below for why this paginates).
const CLIP_PAGE_SIZE = 1000; // PostgREST caps an unpaginated request at 1000 rows

export async function fetchAnnouncementClipStorageUrls() {
  const urls = [];
  for (let offset = 0; ; offset += CLIP_PAGE_SIZE) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/announcement_clips?select=storage_path&limit=${CLIP_PAGE_SIZE}&offset=${offset}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) throw new Error(`announcement_clips fetch failed: ${res.status}`);
    const rows = await res.json();
    urls.push(...rows.map((r) => `${SUPABASE_URL}/storage/v1/object/public/announcement-audio/${r.storage_path}`));
    if (rows.length < CLIP_PAGE_SIZE) break;
  }
  return urls;
}

// Storage-backed clips are the only source the browser precaches — see this
// file's header comment. Removed 2026-09-16 (once parity was proven on dev
// then production): a parallel precache of the bundled
// driver/audio/announcements/ files, which used to serve as a transition
// fallback for Driver/Solo. Those files themselves aren't gone — they
// remain the Bus Controller's own audio source (mele-server/audioPlayer.mjs
// reads them from local disk, no live fetch) — this service worker just has
// no reason to fetch/cache them any more, since no browser code ever reads
// them now.
function cacheAnnouncementAudio(cache) {
  return fetchAnnouncementClipStorageUrls()
    .then((urls) => (urls.length ? cache.addAll(urls.map((url) => new Request(url, { mode: 'cors' }))) : undefined))
    .catch(() => {}); // offline at install time, or pipeline not reachable — journey-start preflight covers a real gap
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_ASSETS).then(() =>
        Promise.all([
          cache.addAll(TILE_CACHE.map(url => new Request(url, { mode: 'cors' }))),
          cacheAnnouncementAudio(cache),
        ])
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
