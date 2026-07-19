import { startGpsTracking } from './gps.js';
import { updateUi, renderLog, setOnStopJump } from './ui.js';
import { initMap, updateMapPosition, invalidateSize } from './map.js';
import { log, getEntries } from './logger.js';
import { initDirections, syncCurrentStop, updateDirections } from './directions.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import {
  setAnnouncementsEnabled, onAnnouncementChange, announceJourneyStart,
  announceDiversion, isMuted, setMuted,
} from './announcements.js';
import { announceStopEvent } from './announceStopEvent.js';
import { triggerDiversionAlert, clearDiversionAlert } from './diversionAlert.js';

const DRIVER_TOKEN  = new URLSearchParams(window.location.search).get('token');
const DEPOT         = { name: 'Phil Haines Coaches Depot', lat: 52.950412, lon: -0.050110 };
const DEBUG         = new URLSearchParams(window.location.search).has('debug');

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function sbFetch(path, opts = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${DRIVER_TOKEN || SUPABASE_KEY}`,
      'Content-Type':  'application/json',
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

async function fetchStopsForDeparture(departureId) {
  const res = await sbFetch(
    `/rest/v1/schedule_view` +
    `?departure_id=eq.${departureId}` +
    `&select=timetable_stop_id,stop_type,scheduled_time,display_name,lat,lon,sequence,psvair_in_scope` +
    `&order=sequence`
  );
  if (!res.ok) throw new Error(res.status);
  const rows = await res.json();
  return {
    stops: rows.map(r => ({
      name: r.display_name,
      lat: r.lat,
      lon: r.lon,
      time: r.scheduled_time.substring(0, 5),
      stop_type: r.stop_type,
      timetable_stop_id: r.timetable_stop_id,
    })),
    psvairInScope: rows[0]?.psvair_in_scope ?? false,
  };
}

// ── Stop time upload ──────────────────────────────────────────────────────────

async function uploadStopTimes(jId, arrivals, stops) {
  const rows = [];
  for (let i = 1; i < stops.length - 1; i++) {
    const stop = stops[i];
    const a = arrivals[i];
    if (!stop.timetable_stop_id || !a || a === 'missed') continue;
    const isDate = a instanceof Date;
    rows.push({
      journey_id: jId,
      timetable_stop_id: stop.timetable_stop_id,
      arrived_at: isDate ? a.toISOString() : null,
      visit_status: isDate ? 'visited' : a.status,
    });
  }
  log('info', `Upload payload (${rows.length} rows): ${JSON.stringify(rows)}`);
  if (!rows.length) return { ok: true, count: 0 };
  const res = await sbFetch('/rest/v1/journey_stop_times', {
    method: 'POST',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify(rows),
  });
  const responseBody = res.ok ? '' : await res.text().catch(() => '(could not read response)');
  if (!res.ok) log('error', `Upload failed HTTP ${res.status}: ${responseBody}`);
  return { ok: res.ok, status: res.status, count: rows.length, responseBody };
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

function runTracker({ allStops, journeyId, driverId, vehicleId, initialStopIndex, serviceCode, servicePeriod, psvairEnabled, onComplete }) {
  document.getElementById('picker').hidden  = true;
  document.getElementById('tracker').hidden = false;
  document.getElementById('route-header').scrollIntoView();

  const firstStop = allStops[1];
  const lastStop  = allStops[allStops.length - 2];
  document.getElementById('header-service-code').textContent   = serviceCode;
  document.getElementById('header-service-period').textContent = servicePeriod ?? '';
  document.getElementById('header-line1').textContent          = `${firstStop.name} and`;
  document.getElementById('header-line2').textContent   = lastStop.name;
  document.getElementById('header-line3').textContent   = `To & From ${DEPOT.name}`;

  log('info', `Started: ${serviceCode}${servicePeriod ? ' ' + servicePeriod : ''} from "${allStops[initialStopIndex].name}"`);

  // ── PSVAIR 2026 announcements ─────────────────────────────────────────────
  // In-scope local bus services get a live audio + on-screen announcement of
  // the next stop / final destination, driven off the same GPS stop-advance
  // logic already tracking arrivals below.
  const psvairBanner = document.getElementById('psvair-banner');
  const psvairText    = document.getElementById('psvair-text');
  const psvairMuteBtn = document.getElementById('psvair-mute-btn');
  setAnnouncementsEnabled(!!psvairEnabled);
  psvairBanner.hidden = !psvairEnabled;
  let lastAnnouncedStopIdx = null;

  if (psvairEnabled) {
    onAnnouncementChange(text => { psvairText.textContent = text; });
    const setMuteBtnLabel = () => {
      psvairMuteBtn.textContent = isMuted() ? '\u{1F507}' : '\u{1F50A}';
      psvairMuteBtn.setAttribute('aria-label', isMuted() ? 'Unmute announcements' : 'Mute announcements');
    };
    setMuteBtnLabel();
    psvairMuteBtn.onclick = () => { setMuted(!isMuted()); setMuteBtnLabel(); };
    announceJourneyStart({ serviceCode, destination: lastStop.name });
  }

  // ── Diversion alert ────────────────────────────────────────────────────────
  // Driver-triggered fixed alert tone + fixed announcement, suppressing the
  // normal stop announcement while active. Only relevant on in-scope
  // PSVAIR routes, same gating as the banner above.
  const btnDiversion = document.getElementById('btn-diversion');
  btnDiversion.hidden = !psvairEnabled;
  let diversionAlertState = null;

  const setDiversionBtnLabel = () => {
    btnDiversion.textContent = diversionAlertState
      ? '✖ Clear Diversion Alert'
      : '↻ Start Diversion Alert';
    btnDiversion.classList.toggle('active', !!diversionAlertState);
  };
  setDiversionBtnLabel();

  btnDiversion.onclick = async () => {
    if (diversionAlertState) {
      const eventId = diversionAlertState.eventId;
      const cleared = clearDiversionAlert(diversionAlertState);
      diversionAlertState = cleared.diversionActive ? diversionAlertState : null;
      setDiversionBtnLabel();
      log('info', 'Diversion alert cleared');
      if (eventId) {
        sbFetch(`/rest/v1/diversion_alert_event?id=eq.${eventId}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({ cleared_at: new Date().toISOString() }),
        }).catch(() => {});
      }
      return;
    }

    const result = triggerDiversionAlert(
      journeyId ? { journey_id: journeyId, vehicle_id: vehicleId, driver_id: driverId } : null
    );
    if (result.status !== 'fired') return;

    diversionAlertState = result.alertState;
    setDiversionBtnLabel();
    announceDiversion();
    log('info', 'Diversion alert triggered');

    if (journeyId) {
      try {
        const res = await sbFetch('/rest/v1/diversion_alert_event', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify({ journey_id: journeyId, vehicle_id: vehicleId, driver_id: driverId }),
        });
        const [row] = await res.json();
        if (row && diversionAlertState) diversionAlertState.eventId = row.id;
      } catch (err) {
        console.warn('Failed to persist diversion alert:', err);
      }
    }
  };

  let activeTab = 'list', mapReady = false, arrivalsRef = [];
  let lastLat = null, lastLon = null, lastStopIdx = initialStopIndex;

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
    onGpsFix: journeyId
      ? ({ lat, lon, speed, accuracy, ts }) => {
          sbFetch('/rest/v1/journey_events', {
            method: 'POST',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              journey_id:  journeyId,
              event_type:  'gps_fix',
              lat,
              lon,
              occurred_at: ts,
              metadata:    { speed_mps: speed, accuracy },
            }),
          }).catch(() => {}); // fire-and-forget; GPS loop must not block
        }
      : null,
    onUpdate: ({ timing, nextStopIndex, speedMps, distanceToNextM, arrivals, earlyWait, atStop, lat, lon }) => {
      arrivalsRef = arrivals;
      lastStopIdx = nextStopIndex;
      if (lat !== undefined) { lastLat = lat; lastLon = lon; }

      // Real passenger-facing stops are indices [1, length-2]; 0 and length-1
      // are the depot padding stops and are never announced. Announce on
      // arrival (atStop set) rather than departure, so the "this stop /
      // next stop" pairing is heard while the vehicle is actually there.
      if (psvairEnabled && atStop && atStop.stopIndex !== lastAnnouncedStopIdx
          && atStop.stopIndex > 0 && atStop.stopIndex < allStops.length - 1) {
        lastAnnouncedStopIdx = atStop.stopIndex;
        const isFinal = atStop.stopIndex === allStops.length - 2;
        announceStopEvent({
          stopName: allStops[atStop.stopIndex].name,
          nextStopName: isFinal ? null : allStops[atStop.stopIndex + 1].name,
          isFinal,
          diversionActive: !!diversionAlertState,
        });
      }
      updateUi({ timing, nextStopIndex, schedule: allStops, speedMps, distanceToNextM, arrivals, earlyWait, atStop });
      if (lat !== undefined) updateMapPosition(lat, lon, nextStopIndex, arrivals);
      syncCurrentStop(nextStopIndex);
      if (activeTab === 'dir') updateDirections();
      if (activeTab === 'log') renderLog(getEntries());
    },
  });

  setOnStopJump(idx => tracker.jumpToStop(idx));

  // ── Incident reporting ────────────────────────────────────────────────────
  const btnIncident     = document.getElementById('btn-incident');
  const incidentOverlay = document.getElementById('incident-overlay');
  btnIncident.hidden = false;

  btnIncident.onclick = () => {
    document.getElementById('incident-category').value = 'Delay';
    document.getElementById('incident-desc').value = '';
    incidentOverlay.hidden = false;
  };

  document.getElementById('incident-cancel').onclick = () => {
    incidentOverlay.hidden = true;
  };

  document.getElementById('incident-submit').onclick = async () => {
    const category    = document.getElementById('incident-category').value;
    const description = document.getElementById('incident-desc').value.trim();
    incidentOverlay.hidden = true;

    if (journeyId) {
      const nearStop = allStops[lastStopIdx]?.name || '';
      sbFetch('/rest/v1/journey_events', {
        method: 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          journey_id:  journeyId,
          event_type:  'incident',
          lat:         lastLat,
          lon:         lastLon,
          occurred_at: new Date().toISOString(),
          metadata:    { category, description, near_stop: nearStop },
        }),
      }).catch(() => {});
    }
    log('info', `Incident: ${category}${description ? ' — ' + description : ''}`);
  };

  document.getElementById('btn-complete').onclick = async () => {
    if (!confirm('End trip and upload stop times?')) return;
    tracker.stop();
    btnIncident.hidden = true;
    btnDiversion.hidden = true;
    incidentOverlay.hidden = true;
    setAnnouncementsEnabled(false);
    psvairBanner.hidden = true;

    if (journeyId) {
      const uploadResult = await uploadStopTimes(journeyId, arrivalsRef, allStops);
      await rpc('complete_journey', { p_journey_id: journeyId }).catch(() => {});
      if (uploadResult.ok) {
        log('info', `Uploaded ${uploadResult.count} stop time(s)`);
      } else {
        alert(
          `Trip ended but stop times could not be saved.\n\n` +
          `HTTP status: ${uploadResult.status}\n` +
          `Server response: ${uploadResult.responseBody || '(empty)'}\n\n` +
          `Screenshot this message and contact ops.`
        );
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
    showNoDutyCard();
    return;
  }

  if (!duties || duties.length === 0) {
    showNoDutyCard();
    return;
  }

  for (const j of duties) {
    try {
      const result = j.timetable_departure_id ? await fetchStopsForDeparture(j.timetable_departure_id) : null;
      j.stops = result?.stops ?? [];
      j.psvairInScope = result?.psvairInScope ?? false;
    } catch (_) {
      j.stops = [];
      j.psvairInScope = false;
    }
  }

  duties.sort((a, b) => (a.first_stop_time || '').localeCompare(b.first_stop_time || ''));

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

    const notesHtml = j.notes
      ? `<div class="dc-route-notes">${j.notes.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`
      : '';

    card.innerHTML = `
      <div class="dc-route-top">
        <span class="dc-service-badge">${j.service_code}</span>
        <span class="dc-route-label">${j.timetable_name} ${j.direction}</span>
      </div>
      <div class="dc-route-stops">${firstStopName} &#8594; ${lastStopName}</div>
      <div class="dc-route-meta">
        <span class="dc-vehicle">${j.vehicle_registration}</span>
        <span class="dc-depart">Departs ${deptTime}</span>
      </div>
      ${notesHtml}
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
    document.getElementById('picker').hidden          = true;
    document.getElementById('picker-back-btn').hidden = true;
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

    document.getElementById('picker-back-btn').hidden = true;

    await acquireWakeLock();

    runTracker({
      allStops,
      journeyId: journey.journey_id,
      driverId: journey.driver_id,
      vehicleId: journey.vehicle_id,
      initialStopIndex,
      serviceCode: journey.service_code,
      servicePeriod: journey.timetable_name,
      psvairEnabled: journey.psvairInScope,
      onComplete: () => {
        journey.status = 'completed';
        renderDutyCard(duties, journeyIds);
      },
    });
  };
}

// ── No duty card screen ───────────────────────────────────────────────────────

function showNoDutyCard() {
  document.getElementById('no-duty-card').hidden = false;
  document.getElementById('duty-card').hidden    = true;
  document.getElementById('picker').hidden       = true;
  document.getElementById('tracker').hidden      = true;
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function init() {
  const dutiesParam = new URLSearchParams(window.location.search).get('duties');
  if (dutiesParam) {
    const journeyIds = dutiesParam.split(',').map(s => s.trim()).filter(Boolean);
    await initDutyCard(journeyIds);
  } else {
    showNoDutyCard();
  }
}

init().catch(console.error);
