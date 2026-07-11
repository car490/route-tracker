// Standalone onboard route/announcement display. Siloed from main.js on
// purpose: no journey_id, no duty card, no incident reporting, no writes
// to Supabase at all — reads schedule_view, tracks GPS, announces live.
import { startGpsTracking } from './gps.js';
import { updateUi } from './ui.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import {
  setAnnouncementsEnabled, onAnnouncementChange, announceJourneyStart,
  announceNextStop, isMuted, setMuted,
} from './announcements.js';

const DEPOT = { name: 'Phil Haines Coaches Depot', lat: 52.950412, lon: -0.050110 };
const el = (id) => document.getElementById(id);

async function fetchSchedule() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/schedule_view` +
    `?select=timetable_stop_id,stop_type,scheduled_time,display_name,lat,lon,service_code,timetable_name,direction,departure_id,departure_time,sequence,psvair_in_scope` +
    `&order=service_code,departure_time,sequence`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`schedule_view ${res.status}`);
  const rows = await res.json();

  const schedule = {};
  for (const { service_code, timetable_name, direction, departure_id, departure_time, display_name, lat, lon, scheduled_time, stop_type, timetable_stop_id, psvair_in_scope } of rows) {
    if (!schedule[service_code]) schedule[service_code] = {};
    if (!schedule[service_code][departure_id]) {
      const deptStr = departure_time ? departure_time.substring(0, 5) : '';
      schedule[service_code][departure_id] = {
        service: service_code,
        label: `${timetable_name} ${direction} ${deptStr}`,
        psvairInScope: psvair_in_scope,
        stops: [],
      };
    }
    schedule[service_code][departure_id].stops.push({
      name: display_name, lat, lon, time: scheduled_time.substring(0, 5), stop_type, timetable_stop_id,
    });
  }
  return schedule;
}

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

// ── Wake lock — keep the mounted screen on ─────────────────────────────────
let wakeLock = null;
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      if (document.visibilityState === 'visible') acquireWakeLock();
    });
  } catch (_) { /* best-effort */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock === null) acquireWakeLock();
});

// ── Picker ───────────────────────────────────────────────────────────────
async function loadPicker() {
  const schedule = await fetchSchedule();

  const serviceSelect = el('service-select');
  const runSelect      = el('run-select');
  const stopSelect     = el('stop-select');

  serviceSelect.innerHTML = '';
  Object.keys(schedule).forEach((key) => {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = key;
    serviceSelect.appendChild(opt);
  });

  function buildAllStops() {
    const { stops } = schedule[serviceSelect.value][runSelect.value];
    return withDepotStops(stops);
  }

  function updateRunPicker() {
    const svcSchedule = schedule[serviceSelect.value] ?? {};
    runSelect.innerHTML = '';
    Object.keys(svcSchedule).forEach((key) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = svcSchedule[key].label ?? key;
      runSelect.appendChild(opt);
    });
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

  serviceSelect.onchange = () => { updateRunPicker(); updateStopPicker(); };
  runSelect.onchange = updateStopPicker;
  updateRunPicker();
  updateStopPicker();

  el('start-btn').onclick = async () => {
    const allStops = buildAllStops();
    const initialStopIndex = parseInt(stopSelect.value, 10) || 0;
    const { service, label, psvairInScope } = schedule[serviceSelect.value][runSelect.value];
    await acquireWakeLock();
    runDisplay({ allStops, initialStopIndex, serviceCode: service, servicePeriod: label, psvairEnabled: psvairInScope });
  };
}

// ── Tracker / announcement display ─────────────────────────────────────────
function runDisplay({ allStops, initialStopIndex, serviceCode, servicePeriod, psvairEnabled }) {
  el('picker').hidden  = true;
  el('tracker').hidden = false;

  const firstStop = allStops[1];
  const lastStop  = allStops[allStops.length - 2];
  el('header-service-code').textContent   = serviceCode;
  el('header-service-period').textContent = servicePeriod ?? '';
  el('header-line1').textContent = `${firstStop.name} and`;
  el('header-line2').textContent = lastStop.name;
  el('header-line3').textContent = `To & From ${DEPOT.name}`;

  const psvairBanner  = el('psvair-banner');
  const psvairText    = el('psvair-text');
  const psvairMuteBtn = el('psvair-mute-btn');
  setAnnouncementsEnabled(!!psvairEnabled);
  psvairBanner.hidden = !psvairEnabled;
  let lastAnnouncedIdx = initialStopIndex;

  if (psvairEnabled) {
    onAnnouncementChange((text) => { psvairText.textContent = text; });
    const setMuteBtnLabel = () => {
      psvairMuteBtn.textContent = isMuted() ? '\u{1F507}' : '\u{1F50A}';
      psvairMuteBtn.setAttribute('aria-label', isMuted() ? 'Unmute announcements' : 'Mute announcements');
    };
    setMuteBtnLabel();
    psvairMuteBtn.onclick = () => { setMuted(!isMuted()); setMuteBtnLabel(); };
    announceJourneyStart({ serviceCode, destination: lastStop.name });
  }

  const tracker = startGpsTracking({
    schedule: allStops,
    lateAllowanceMin: 2,
    initialStopIndex,
    onUpdate: ({ timing, nextStopIndex, speedMps, distanceToNextM, arrivals, earlyWait, atStop }) => {
      // Real passenger-facing stops are indices [1, length-2]; 0 and length-1
      // are the depot padding stops and are never announced.
      if (psvairEnabled && nextStopIndex !== lastAnnouncedIdx
          && nextStopIndex > 0 && nextStopIndex < allStops.length - 1) {
        lastAnnouncedIdx = nextStopIndex;
        announceNextStop({
          stopName: allStops[nextStopIndex].name,
          isFinal: nextStopIndex === allStops.length - 2,
        });
      }
      updateUi({ timing, nextStopIndex, schedule: allStops, speedMps, distanceToNextM, arrivals, earlyWait, atStop });
    },
  });

  el('btn-end').onclick = () => {
    if (!confirm('End display and return to route picker?')) return;
    tracker.stop();
    setAnnouncementsEnabled(false);
    psvairBanner.hidden = true;
    el('tracker').hidden = true;
    el('picker').hidden  = false;
  };
}

el('refresh-btn').onclick = () =>
  loadPicker().catch((err) => alert(`Could not load routes: ${err.message}`));

loadPicker().catch((err) => alert(`Could not load routes: ${err.message}`));
