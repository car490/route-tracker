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
      `?select=timetable_stop_id,stop_type,scheduled_time,name,lat,lon,service_code,period,direction,sequence` +
      `&order=service_code,period,direction,sequence`;
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = await res.json();
    const schedule = {};
    for (const { service_code, period, direction, name, lat, lon, scheduled_time, stop_type, timetable_stop_id } of rows) {
      if (!schedule[service_code]) schedule[service_code] = {};
      const runKey = `${period} ${direction}`;
      if (!schedule[service_code][runKey])
        schedule[service_code][runKey] = { service: service_code, period, direction, stops: [] };
      schedule[service_code][runKey].stops.push({
        name, lat, lon, time: scheduled_time.slice(0, 5), stop_type, timetable_stop_id,
      });
    }
    return schedule;
  } catch (err) {
    console.warn('Supabase unavailable, using schedule.json fallback', err);
    const res = await fetch('./src/schedule.json');
    return res.json();
  }
}

// Batch-uploads arrived_at timestamps to journey_stop_times.
// Requires driver auth and a journey_id URL param — fails gracefully if absent.
async function uploadStopTimes(jId, arrivals, stops) {
  const rows = [];
  for (let i = 1; i < stops.length - 1; i++) {
    const stop = stops[i];
    if (!stop.timetable_stop_id || !arrivals[i] || arrivals[i] === 'missed') continue;
    rows.push({
      journey_id: jId,
      timetable_stop_id: stop.timetable_stop_id,
      arrived_at: arrivals[i].toISOString(),
    });
  }
  if (!rows.length) return { ok: true, count: 0 };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/journey_stop_times`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  return { ok: res.ok, status: res.status, count: rows.length };
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

const DEBUG     = new URLSearchParams(window.location.search).has('debug');
const journeyId = new URLSearchParams(window.location.search).get('journey');

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

  function updateRunPicker() {
    const runs = Object.keys(schedule[serviceSelect.value] ?? {});
    runSelect.innerHTML = '';
    runs.forEach(key => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = key;
      runSelect.appendChild(opt);
    });
    const hour = new Date().getHours();
    const preferred = hour < 12
      ? runs.find(k => k.startsWith('Early Morning') || k.startsWith('Morning'))
      : runs.find(k => k.startsWith('Afternoon') || k.startsWith('Evening'));
    runSelect.value = preferred ?? runs[0] ?? '';
  }

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

  serviceSelect.addEventListener('change', () => { updateRunPicker(); updateStopPicker(); });
  runSelect.addEventListener('change', updateStopPicker);
  updateRunPicker();
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

    log('info', `Started: ${service} ${runSelect.value} from "${allStops[initialStopIndex].name}"`);

    await acquireWakeLock();

    let lastLat = null;
    let lastLon = null;
    let activeTab = 'list';
    let mapReady = false;
    let arrivalsRef = [];

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
          initMap(allStops);
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
      onUpdate: ({ timing, nextStopIndex, speedMps, distanceToNextM, arrivals, earlyWait, atStop, lat, lon }) => {
        arrivalsRef = arrivals;
        updateUi({ timing, nextStopIndex, schedule: allStops, speedMps, distanceToNextM, arrivals, earlyWait, atStop });
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

    document.getElementById('btn-complete').addEventListener('click', async () => {
      if (!confirm('End trip and upload stop times?')) return;
      tracker.stop();
      if (!journeyId) {
        log('warn', 'No journey ID in URL — add ?journey=<uuid> to upload stop times');
        return;
      }
      const result = await uploadStopTimes(journeyId, arrivalsRef, allStops);
      log('info', result.ok
        ? `Uploaded ${result.count} stop time(s)`
        : `Upload failed (HTTP ${result.status})`);
    });
  });
}

init().catch(console.error);
