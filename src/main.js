import { startGpsTracking } from './gps.js';
import { updateUi, renderLog, setOnStopJump } from './ui.js';
import { initMap, updateMapPosition, centreOnPosition, invalidateSize } from './map.js';
import { log, getEntries } from './logger.js';
import { initDirections, syncCurrentStop, updateDirections } from './directions.js';

const SUPABASE_URL = 'https://nwhayupsvcelyiwltdqo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_gij_rPjr2EJrcv0W9sU-Ow_C3nNqGcn';

async function fetchSchedule() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/schedule_view` +
      `?select=service_code,period,name,lat,lon,scheduled_time,sequence` +
      `&order=service_code,period,sequence`;
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = await res.json();
    const schedule = {};
    for (const { service_code, period, name, lat, lon, scheduled_time } of rows) {
      if (!schedule[service_code]) schedule[service_code] = {};
      if (!schedule[service_code][period])
        schedule[service_code][period] = { service: service_code, stops: [] };
      schedule[service_code][period].stops.push({
        name, lat, lon, time: scheduled_time.slice(0, 5),
      });
    }
    return schedule;
  } catch (err) {
    console.warn('Supabase unavailable, using schedule.json fallback', err);
    const res = await fetch('./src/schedule.json');
    return res.json();
  }
}

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
  if (document.visibilityState === 'visible' && wakeLock === null) acquireWakeLock();
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

const DEBUG = new URLSearchParams(window.location.search).has('debug');

async function init() {
  const schedule = await fetchSchedule();

  const serviceSelect = document.getElementById('service-select');
  const runSelect     = document.getElementById('run-select');
  const stopSelect    = document.getElementById('stop-select');

  Object.keys(schedule).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key;
    serviceSelect.appendChild(opt);
  });

  runSelect.value = new Date().getHours() < 12 ? 'am' : 'pm';

  function buildAllStops() {
    const { stops } = schedule[serviceSelect.value][runSelect.value];
    return withDepotStops(stops);
  }

  function updateStopPicker() {
    const allStops = buildAllStops();
    stopSelect.innerHTML = '';
    allStops.forEach((stop, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${stop.time}  ${stop.name}`;
      stopSelect.appendChild(opt);
    });
  }

  serviceSelect.addEventListener('change', updateStopPicker);
  runSelect.addEventListener('change', updateStopPicker);
  updateStopPicker();

  document.getElementById('start-btn').addEventListener('click', async () => {
    const allStops = buildAllStops();
    const initialStopIndex = parseInt(stopSelect.value, 10) || 0;
    const { service } = schedule[serviceSelect.value][runSelect.value];

    document.getElementById('header-service').textContent = service;
    document.getElementById('header-line1').textContent = `${allStops[1].name} and`;
    document.getElementById('header-line2').textContent = allStops[allStops.length - 2].name;
    document.getElementById('header-line3').textContent = `To & From ${DEPOT.name}`;

    document.getElementById('picker').hidden  = true;
    document.getElementById('tracker').hidden = false;
    document.getElementById('route-header').scrollIntoView();

    log('info', `Started: ${service} ${runSelect.value.toUpperCase()} from "${allStops[initialStopIndex].name}"`);

    await acquireWakeLock();

    let lastLat = null;
    let lastLon = null;
    let activeTab = 'list';
    let mapReady = false;

    function showTab(tab) {
      activeTab = tab;
      document.getElementById('stop-list').hidden       = tab !== 'list';
      document.getElementById('map-view').hidden        = tab !== 'map';
      document.getElementById('directions-view').hidden = tab !== 'dir';
      document.getElementById('log-view').hidden        = tab !== 'log';
      document.getElementById('btn-list').classList.toggle('toggle-active', tab === 'list');
      document.getElementById('btn-map').classList.toggle('toggle-active', tab === 'map');
      document.getElementById('btn-dir').classList.toggle('toggle-active', tab === 'dir');
      document.getElementById('btn-log').classList.toggle('toggle-active', tab === 'log');
      if (tab === 'map') {
        if (!mapReady) {
          mapReady = true;
          initMap(allStops);  // container is visible now — fitBounds works correctly
        } else {
          invalidateSize();
        }
      }
      if (tab === 'log') renderLog(getEntries());
      if (tab === 'dir') updateDirections();
    }

    document.getElementById('btn-list').addEventListener('click', () => showTab('list'));
    document.getElementById('btn-map').addEventListener('click',  () => showTab('map'));
    if (!DEBUG) {
      document.getElementById('btn-dir').addEventListener('click', () => showTab('dir'));
    } else {
      document.getElementById('btn-dir').hidden = true;
    }
    if (DEBUG) {
      document.getElementById('btn-log').addEventListener('click', () => showTab('log'));
    } else {
      document.getElementById('btn-log').hidden = true;
    }

    initDirections(allStops, initialStopIndex);

    const tracker = startGpsTracking({
      schedule: allStops,
      lateAllowanceMin: 2,
      initialStopIndex,
      onUpdate: ({ timing, nextStopIndex, speedMps, distanceToNextM, arrivals, earlyWait, lat, lon }) => {
        updateUi({ timing, nextStopIndex, schedule: allStops, speedMps, distanceToNextM, arrivals, earlyWait });
        if (lat !== undefined) {
          lastLat = lat; lastLon = lon;
          updateMapPosition(lat, lon, nextStopIndex, arrivals);
        }
        syncCurrentStop(nextStopIndex);
        if (activeTab === 'dir') updateDirections();
        if (activeTab === 'log') renderLog(getEntries());
      },
    });

    setOnStopJump((idx) => tracker.jumpToStop(idx));
  });
}

init().catch(console.error);
