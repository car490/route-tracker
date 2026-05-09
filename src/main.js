import { startGpsTracking } from './gps.js';
import { updateUi, renderLog, setOnStopJump } from './ui.js';
import { initMap, updateMapPosition, invalidateSize } from './map.js';
import { log, getEntries } from './logger.js';
import { initDirections, syncCurrentStop, updateDirections } from './directions.js';

const SUPABASE_URL = 'https://nwhayupsvcelyiwltdqo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_gij_rPjr2EJrcv0W9sU-Ow_C3nNqGcn';
const DEPOT       = { name: 'Phil Haines Coaches Depot', lat: 52.950412, lon: -0.050110 };
const DEBUG       = new URLSearchParams(window.location.search).has('debug');

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function sbFetch(path, opts = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  });
}

async function rpc(fn, args) {
  const res = await sbFetch(`/rest/v1/rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`RPC ${fn}: ${res.status}`);
  return res.json();
}

// ── Schedule fetching ─────────────────────────────────────────────────────────

async function fetchStopsForTimetable(timetableId) {
  const res = await sbFetch(
    `/rest/v1/schedule_view` +
    `?timetable_id=eq.${timetableId}` +
    `&select=timetable_stop_id,stop_type,scheduled_time,name,lat,lon,sequence` +
    `&order=sequence`
  );
  if (!res.ok) throw new Error(res.status);
  const rows = await res.json();
  return rows.map(r => ({
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    time: r.scheduled_time.substring(0, 5),
    stop_type: r.stop_type,
    timetable_stop_id: r.timetable_stop_id,
  }));
}

async function fetchAllSchedules() {
  try {
    const res = await sbFetch(
      `/rest/v1/schedule_view` +
      `?select=timetable_stop_id,stop_type,scheduled_time,name,lat,lon,service_code,period,direction,sequence` +
      `&order=service_code,period,direction,sequence`
    );
    if (!res.ok) throw new Error(res.status);
    const rows = await res.json();
    const schedule = {};
    for (const { service_code, period, direction, name, lat, lon, scheduled_time, stop_type, timetable_stop_id } of rows) {
      if (!schedule[service_code]) schedule[service_code] = {};
      const runKey = `${period} ${direction}`;
      if (!schedule[service_code][runKey])
        schedule[service_code][runKey] = { service: service_code, period, direction, stops: [] };
      schedule[service_code][runKey].stops.push({
        name, lat, lon, time: scheduled_time.substring(0, 5), stop_type, timetable_stop_id,
      });
    }
    return schedule;
  } catch (err) {
    console.warn('Supabase unavailable, using schedule.json fallback', err);
    const res = await fetch('./src/schedule.json');
    return res.json();
  }
}

// ── Stop time upload ──────────────────────────────────────────────────────────

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
  const res = await sbFetch('/rest/v1/journey_stop_times', {
    method: 'POST',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify(rows),
  });
  return { ok: res.ok, status: res.status, count: rows.length };
}

// ── Wake lock ─────────────────────────────────────────────────────────────────

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
  } catch (_) { setWakeLockWarning(true); }
}

function setWakeLockWarning(show) {
  const el = document.getElementById('wakelock-warning');
  if (el) el.hidden = !show;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock === null) acquireWakeLock();
});

// ── Utilities ─────────────────────────────────────────────────────────────────

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

function greetingPrefix() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning,';
  if (h < 17) return 'Good afternoon,';
  return 'Good evening,';
}

// ── Tracker ───────────────────────────────────────────────────────────────────

function runTracker({ allStops, journeyId, initialStopIndex, serviceLabel, onComplete }) {
  document.getElementById('picker').hidden  = true;
  document.getElementById('tracker').hidden = false;
  document.getElementById('route-header').scrollIntoView();

  const firstStop = allStops[1];
  const lastStop  = allStops[allStops.length - 2];
  document.getElementById('header-service').textContent = serviceLabel;
  document.getElementById('header-line1').textContent   = `${firstStop.name} and`;
  document.getElementById('header-line2').textContent   = lastStop.name;
  document.getElementById('header-line3').textContent   = `To & From ${DEPOT.name}`;

  log('info', `Started: ${serviceLabel} from "${allStops[initialStopIndex].name}"`);

  let activeTab = 'list', mapReady = false, arrivalsRef = [];

  function showTab(tab) {
    activeTab = tab;
    document.getElementById('stop-list').hidden       = tab !== 'list';
    document.getElementById('map-view').hidden        = tab !== 'map';
    document.getElementById('directions-view').hidden = tab !== 'dir';
    document.getElementById('log-view').hidden        = tab !== 'log';
    ['list', 'map', 'dir', 'log'].forEach(t =>
      document.getElementById(`btn-${t}`).classList.toggle('toggle-active', t === tab)
    );
    if (tab === 'map') {
      if (!mapReady) { mapReady = true; initMap(allStops); }
      else           { invalidateSize(); }
    }
    if (tab === 'log') renderLog(getEntries());
    if (tab === 'dir') updateDirections();
  }

  document.getElementById('btn-list').onclick = () => showTab('list');
  document.getElementById('btn-map').onclick  = () => showTab('map');
  if (!DEBUG) {
    document.getElementById('btn-dir').hidden = false;
    document.getElementById('btn-dir').onclick = () => showTab('dir');
  } else {
    document.getElementById('btn-dir').hidden = true;
  }
  if (DEBUG) {
    document.getElementById('btn-log').hidden = false;
    document.getElementById('btn-log').onclick = () => showTab('log');
  } else {
    document.getElementById('btn-log').hidden = true;
  }

  showTab('list');
  initDirections(allStops, initialStopIndex);

  const tracker = startGpsTracking({
    schedule: allStops,
    lateAllowanceMin: 2,
    initialStopIndex,
    onUpdate: ({ timing, nextStopIndex, speedMps, distanceToNextM, arrivals, earlyWait, atStop, lat, lon }) => {
      arrivalsRef = arrivals;
      updateUi({ timing, nextStopIndex, schedule: allStops, speedMps, distanceToNextM, arrivals, earlyWait, atStop });
      if (lat !== undefined) updateMapPosition(lat, lon, nextStopIndex, arrivals);
      syncCurrentStop(nextStopIndex);
      if (activeTab === 'dir') updateDirections();
      if (activeTab === 'log') renderLog(getEntries());
    },
  });

  setOnStopJump(idx => tracker.jumpToStop(idx));

  document.getElementById('btn-complete').onclick = async () => {
    if (!confirm('End trip and upload stop times?')) return;
    tracker.stop();

    if (journeyId) {
      const [uploadResult] = await Promise.all([
        uploadStopTimes(journeyId, arrivalsRef, allStops),
        rpc('complete_journey', { p_journey_id: journeyId }).catch(() => {}),
      ]);
      if (uploadResult.ok) {
        log('info', `Uploaded ${uploadResult.count} stop time(s)`);
      } else {
        log('warn', `Upload failed (HTTP ${uploadResult.status})`);
        alert(`Trip ended but stop times could not be saved (error ${uploadResult.status}).\nPlease contact ops.`);
      }
    } else {
      log('warn', 'No journey ID — stop times not saved');
      alert('Trip ended.\n\nNo journey ID was set — stop times were not saved.\nAsk ops to share the driver link for this journey.');
    }

    document.getElementById('tracker').hidden = true;
    onComplete();
  };
}

// ── Duty card mode ────────────────────────────────────────────────────────────

async function initDutyCard(journeyIds) {
  let duties;
  try {
    duties = await rpc('get_duty_card', { journey_ids: journeyIds });
  } catch (err) {
    console.error('Failed to load duty card:', err);
    initPickerMode();
    return;
  }

  if (!duties || duties.length === 0) {
    initPickerMode();
    return;
  }

  for (const j of duties) {
    try {
      j.stops = j.timetable_id ? await fetchStopsForTimetable(j.timetable_id) : [];
    } catch (_) {
      j.stops = [];
    }
  }

  renderDutyCard(duties, journeyIds);
}

function renderDutyCard(duties, journeyIds) {
  document.getElementById('duty-card').hidden = false;
  document.getElementById('picker').hidden    = true;
  document.getElementById('tracker').hidden   = true;

  document.getElementById('dc-greeting-prefix').textContent = greetingPrefix();
  document.getElementById('dc-driver-name').textContent     = duties[0]?.driver_name || 'Driver';
  document.getElementById('dc-date').textContent = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const container = document.getElementById('dc-routes');
  container.innerHTML = '';

  duties.forEach((j, idx) => {
    const card = document.createElement('div');
    card.className = `dc-route-card dc-route-${j.status}`;

    const firstStopName = j.stops[0]?.name      || '—';
    const lastStopName  = j.stops[j.stops.length - 1]?.name || j.last_stop_name || '—';
    const deptTime      = j.first_stop_time || '—';

    let actionHtml;
    if (j.status === 'completed') {
      actionHtml = `<div class="dc-done-badge">&#10003; Completed</div>`;
    } else if (j.status === 'in_progress') {
      actionHtml = `<button class="dc-action-btn dc-resume-btn" data-idx="${idx}">Resume Route</button>`;
    } else {
      actionHtml = `<button class="dc-action-btn" data-idx="${idx}">Start Route</button>`;
    }

    card.innerHTML = `
      <div class="dc-route-top">
        <span class="dc-service-badge">${j.service_code}</span>
        <span class="dc-route-label">${j.period} ${j.direction}</span>
      </div>
      <div class="dc-route-stops">${firstStopName} &#8594; ${lastStopName}</div>
      <div class="dc-route-meta">
        <span class="dc-vehicle">${j.vehicle_registration}</span>
        <span class="dc-depart">Departs ${deptTime}</span>
      </div>
      ${actionHtml}
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('.dc-action-btn').forEach(btn => {
    btn.addEventListener('click', () =>
      launchDutyRoute(duties, parseInt(btn.dataset.idx, 10), journeyIds)
    );
  });
}

async function launchDutyRoute(duties, idx, journeyIds) {
  const journey = duties[idx];

  if (!journey.stops.length) {
    alert('No stops available for this route.');
    return;
  }

  const allStops = withDepotStops(journey.stops);

  document.getElementById('duty-card').hidden             = true;
  document.getElementById('picker').hidden                = false;
  document.getElementById('picker-service-field').hidden  = true;
  document.getElementById('picker-run-field').hidden      = true;
  document.getElementById('picker-back-btn').hidden       = false;

  const stopSelect = document.getElementById('stop-select');
  stopSelect.innerHTML = '';
  allStops.forEach((stop, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${stop.time}  ${stop.name}`;
    stopSelect.appendChild(opt);
  });

  document.getElementById('picker-back-btn').onclick = () => {
    document.getElementById('picker').hidden               = true;
    document.getElementById('picker-service-field').hidden = false;
    document.getElementById('picker-run-field').hidden     = false;
    document.getElementById('picker-back-btn').hidden      = true;
    renderDutyCard(duties, journeyIds);
  };

  document.getElementById('start-btn').onclick = async () => {
    const initialStopIndex = parseInt(stopSelect.value, 10) || 0;

    if (journey.status === 'scheduled') {
      try {
        await rpc('start_journey', { p_journey_id: journey.journey_id });
        journey.status = 'in_progress';
      } catch (err) {
        console.warn('Failed to start journey:', err);
      }
    }

    document.getElementById('picker-service-field').hidden = false;
    document.getElementById('picker-run-field').hidden     = false;
    document.getElementById('picker-back-btn').hidden      = true;

    await acquireWakeLock();

    runTracker({
      allStops,
      journeyId: journey.journey_id,
      initialStopIndex,
      serviceLabel: `${journey.service_code} ${journey.period}`,
      onComplete: () => {
        journey.status = 'completed';
        renderDutyCard(duties, journeyIds);
      },
    });
  };
}

// ── Standalone picker mode ────────────────────────────────────────────────────

async function initPickerMode() {
  const schedule = await fetchAllSchedules();

  document.getElementById('duty-card').hidden             = true;
  document.getElementById('picker').hidden                = false;
  document.getElementById('picker-service-field').hidden  = false;
  document.getElementById('picker-run-field').hidden      = false;
  document.getElementById('picker-back-btn').hidden       = true;

  const serviceSelect = document.getElementById('service-select');
  const runSelect     = document.getElementById('run-select');
  const stopSelect    = document.getElementById('stop-select');

  Object.keys(schedule).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = key;
    serviceSelect.appendChild(opt);
  });

  function updateRunPicker() {
    const runs = Object.keys(schedule[serviceSelect.value] ?? {});
    runSelect.innerHTML = '';
    runs.forEach(key => {
      const opt = document.createElement('option');
      opt.value = key; opt.textContent = key;
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
      opt.value = i; opt.textContent = `${stop.time}  ${stop.name}`;
      stopSelect.appendChild(opt);
    });
  }

  serviceSelect.addEventListener('change', () => { updateRunPicker(); updateStopPicker(); });
  runSelect.addEventListener('change', updateStopPicker);
  updateRunPicker();
  updateStopPicker();

  const legacyJourneyId = new URLSearchParams(window.location.search).get('journey');

  document.getElementById('start-btn').onclick = async () => {
    const allStops         = buildAllStops();
    const initialStopIndex = parseInt(stopSelect.value, 10) || 0;
    const { service }      = schedule[serviceSelect.value][runSelect.value];

    await acquireWakeLock();

    runTracker({
      allStops,
      journeyId: legacyJourneyId,
      initialStopIndex,
      serviceLabel: service,
      onComplete: () => {
        document.getElementById('picker').hidden = false;
      },
    });
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function init() {
  const dutiesParam = new URLSearchParams(window.location.search).get('duties');
  if (dutiesParam) {
    const journeyIds = dutiesParam.split(',').map(s => s.trim()).filter(Boolean);
    await initDutyCard(journeyIds);
  } else {
    await initPickerMode();
  }
}

init().catch(console.error);
