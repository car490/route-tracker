const CACHE_NAME = 'route-tracker-v2';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/lib/leaflet.min.js',
  '/lib/leaflet.min.css',
  '/src/main.js',
  '/src/engine.js',
  '/src/geo.js',
  '/src/gps.js',
  '/src/map.js',
  '/src/ui.js',
  '/src/schedule.json',
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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_ASSETS).then(() =>
        cache.addAll(TILE_CACHE.map(url => new Request(url, { mode: 'cors' })))
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
