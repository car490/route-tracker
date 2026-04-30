import { startGpsTracking } from './gps.js';
import { updateUi } from './ui.js';
import { initMap, updateMapPosition, centreOnPosition, invalidateSize } from './map.js';

let wakeLock = null;

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) { setWakeLockWarning(true); return; }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    setWakeLockWarning(false);
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      if (document.visibilityState === 'visible') acquireWakeLock();
    });
  } catch (_) {
    setWakeLockWarning(true);
  }
}

function setWakeLockWarning(show) {
  const el = document.getElementById('wakelock-warning');
  if (el) el.hidden = !show;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock === null) {
    acquireWakeLock();
  }
});

const DEPOT = { name: 'Phil Haines Coaches Depot', lat: 52.950412, lon: -0.050110 };

function shiftTime(timeStr, deltaMinutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = ((h * 60 + m + deltaMinutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}


function withDepotStops(stops) {
  return [
    { ...DEPOT, time: shiftTime(stops[0].time, -30) },
    ...stops,
    { ...DEPOT, time: shiftTime(stops[stops.length - 1].time, +30) },
  ];
}

async function init() {
  const response = await fetch('./src/schedule.json');
  const schedule = await response.json();

  const serviceSelect = document.getElementById('service-select');
  const runSelect     = document.getElementById('run-select');

  Object.keys(schedule).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key;
    serviceSelect.appendChild(opt);
  });

  runSelect.value = new Date().getHours() < 12 ? 'am' : 'pm';

  document.getElementById('start-btn').addEventListener('click', async () => {
    const { service, stops } = schedule[serviceSelect.value][runSelect.value];
    const allStops = withDepotStops(stops);

    document.getElementById('header-service').textContent = service;
    document.getElementById('header-line1').textContent =
      `${allStops[1].name} — ${allStops[allStops.length - 2].name}`;
    document.getElementById('header-line2').textContent = `To & From ${DEPOT.name}`;

    document.getElementById('picker').hidden  = true;
    document.getElementById('tracker').hidden = false;
    document.getElementById('route-header').scrollIntoView();

    await acquireWakeLock();
    initMap(allStops);

    let lastLat = null;
    let lastLon = null;

    document.getElementById('btn-list').addEventListener('click', () => {
      document.getElementById('stop-list').hidden = false;
      document.getElementById('map-view').hidden  = true;
      document.getElementById('btn-list').classList.add('toggle-active');
      document.getElementById('btn-map').classList.remove('toggle-active');
    });

    document.getElementById('btn-map').addEventListener('click', () => {
      document.getElementById('stop-list').hidden = true;
      document.getElementById('map-view').hidden  = false;
      document.getElementById('btn-map').classList.add('toggle-active');
      document.getElementById('btn-list').classList.remove('toggle-active');
      invalidateSize();
      if (lastLat !== null) centreOnPosition(lastLat, lastLon);
    });

    startGpsTracking({
      schedule: allStops,
      lateAllowanceMin: 2,
      onUpdate: ({ timing, nextStopIndex, speedMps, distanceToNextM, arrivals, lat, lon }) => {
        updateUi({ timing, nextStopIndex, schedule: allStops, speedMps, distanceToNextM, arrivals });
        if (lat !== undefined) {
          lastLat = lat; lastLon = lon;
          updateMapPosition(lat, lon, nextStopIndex, arrivals);
        }
      },
    });
  });
}

init().catch(console.error);
