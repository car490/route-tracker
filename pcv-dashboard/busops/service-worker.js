const CACHE_NAME = 'busops-driver-v1.5.1';

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
  './announce/src/announceLiteFeed.js',
  './announce/src/announceLiteSetup.js',
  './announce/src/announceGps.js',
  './announce/src/announceStandaloneAutopilot.js',
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

// Pre-rendered PSVAIR announcement clips (scripts/generate-announcement-audio.mjs)
// — the file list isn't static like STATIC_ASSETS since it grows/shrinks with
// stops/routes, so it's read from the manifest the generator writes rather
// than hardcoded here. Missing manifest (audio feature not set up yet) is a
// silent no-op, not an install failure — announcements.js falls back to
// speechSynthesis for anything not cached.
function cacheAnnouncementAudio(cache) {
  return fetch('./driver/audio/announcements/manifest.json')
    .then((res) => (res.ok ? res.json() : null))
    .then((manifest) => {
      if (!manifest) return;
      const urls = Object.values(manifest).map((entry) => `./driver/audio/announcements/${entry.path}`);
      return cache.addAll(urls);
    })
    .catch(() => {});
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
