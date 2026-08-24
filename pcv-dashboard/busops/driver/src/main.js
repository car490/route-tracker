import { startGpsTracking } from './gps.js';
import { updateUi, renderLog, setOnStopJump } from './ui.js';
import { initMap, updateMapPosition, invalidateSize } from './map.js';
import { log, getEntries } from './logger.js';
import { initDirections, syncCurrentStop, updateDirections } from './directions.js';
import {
  setAnnouncementsEnabled, onAnnouncementChange, announceJourneyStart,
  announceDiversion, isMuted, setMuted, isBannerShown, setBannerShown,
  listVoices, getSelectedVoiceURI, setSelectedVoiceURI, previewVoice,
} from './announcements.js';
import { sbFetch, rpc, fetchStopsForDeparture, fetchAvailableServices, fetchLocalBusVehicles, fetchCompanyName } from './supabaseApi.js';
import { announceApproachEvent, announceStopEvent } from './announceStopEvent.js';
import { triggerDiversionAlert, clearDiversionAlert } from './diversionAlert.js';
import { selectServiceManually } from './manualSelection.js';
import { getStoredVehicle, storeVehicle } from './vehicleSetup.js';
import {
  captureAnnounceSetup, connectAnnounceLink, disconnectAnnounceLink,
  broadcastState, broadcastSchedule, setAnnouncing,
} from './announceLink.js';
import { enqueuePendingTrip, getPendingTrips, removePendingTrip, markPendingTripAttempt } from './localStore.js';

const DEBUG = new URLSearchParams(window.location.search).has('debug');

// NaPTAN indicator suffixes like "(adj)"/"(opp)" give the precise pole/bay/
// side of the road — useful in the stop list and on the map where the driver
// is actually locating a stop, but just clutter in the route-header summary
// line. Stripped there only; every other use of a stop's name keeps it.
function stripIndicator(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, '');
}

// ── Testing-mode time shift (DEBUG only) ────────────────────────────────────
// Lets a tester run a journey outside its real scheduled hours: the whole
// stop schedule slides so the first stop's time becomes "now", preserving
// the real gaps between stops so on-time/late/ETA logic downstream
// (engine.js, gps.js, ui.js — all of which only ever read stop.time) still
// behaves meaningfully. Display-only; does not touch what gets uploaded to
// journey_stop_times, so the ops dashboard's variance calc (which recomputes
// "scheduled" from the DB's real departure_time) will show a test run as
// late/early — expected, not a bug.
function shiftStopTimes(stops, deltaMinutes) {
  return stops.map(stop => {
    const [h, m] = stop.time.split(':').map(Number);
    const shifted = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440;
    const nh = String(Math.floor(shifted / 60)).padStart(2, '0');
    const nm = String(shifted % 60).padStart(2, '0');
    return { ...stop, time: `${nh}:${nm}` };
  });
}

function minutesFromNow(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  return (now.getHours() * 60 + now.getMinutes()) - (h * 60 + m);
}

// ── Stop time upload ──────────────────────────────────────────────────────────

const UPLOADABLE_STOP_STATUSES = new Set(['arrived', 'departed', 'skipped_signal', 'skipped_detour']);

function buildStopTimeRows(jId, stopStates, stops) {
  const rows = [];
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const s = stopStates[i];
    if (!stop.timetable_stop_id || !s || !UPLOADABLE_STOP_STATUSES.has(s.status)) continue;
    rows.push({
      journey_id: jId,
      timetable_stop_id: stop.timetable_stop_id,
      arrived_at: s.arrivedAt ? s.arrivedAt.toISOString() : null,
      visit_status: s.status === 'skipped_signal' || s.status === 'skipped_detour' ? s.status : 'visited',
    });
  }
  return rows;
}

// resolution=ignore-duplicates makes this safe to call more than once for
// the same rows: journey_stop_times has a unique index on
// (journey_id, timetable_stop_id) (supabase/schema.sql), so a row that
// already landed from an earlier attempt is silently skipped rather than
// erroring. Needed because a queued trip (see enqueuePendingTrip below) may
// retry a POST whose rows already succeeded once, if the failure that
// queued it actually happened on the complete_journey call that follows.
async function postStopTimeRows(jId, rows) {
  log('info', `Upload payload (${rows.length} rows): ${JSON.stringify(rows)}`);
  if (!rows.length) return { ok: true, count: 0 };
  const res = await sbFetch('/rest/v1/journey_stop_times', {
    method: 'POST',
    headers: { 'Prefer': 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify(rows),
  });
  const responseBody = res.ok ? '' : await res.text().catch(() => '(could not read response)');
  if (!res.ok) log('error', `Upload failed HTTP ${res.status}: ${responseBody}`);
  return { ok: res.ok, status: res.status, count: rows.length, responseBody };
}

// Retries every trip that failed to reach Supabase at completeTrip() time
// (src/localStore.js's queue) — called once at startup and again on every
// 'online' event (see init() below). Silent on failure (no alert, no
// throw): a trip just stays queued for the next attempt, indefinitely.
async function flushPendingTrips() {
  for (const trip of getPendingTrips()) {
    try {
      const uploadResult = await postStopTimeRows(trip.journeyId, trip.stopRows);
      if (!uploadResult.ok) throw new Error(`stop times ${uploadResult.status}`);
      await rpc('complete_journey', { p_journey_id: trip.journeyId });
      removePendingTrip(trip.id);
      log('info', `Synced queued trip ${trip.journeyId} (${trip.stopRows.length} stop time(s))`);
    } catch (err) {
      markPendingTripAttempt(trip.id);
      log('warn', `Queued trip ${trip.journeyId} still can't sync: ${err.message}`);
    }
  }
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

function greetingPrefix() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning,';
  if (h < 17) return 'Good afternoon,';
  return 'Good evening,';
}

// Shown once a trip finishes (automatically or via the manual fallback).
// Dismissed by the OK tap or, if the driver doesn't touch it, on its own
// after a few seconds — either way runs onDismiss exactly once.
const TRIP_COMPLETE_AUTO_DISMISS_MS = 8000;

function showTripCompleteBanner(onDismiss) {
  const overlay = document.getElementById('trip-complete-overlay');
  const okBtn = document.getElementById('trip-complete-ok-btn');
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    overlay.hidden = true;
    onDismiss();
  };
  okBtn.onclick = dismiss;
  overlay.hidden = false;
  setTimeout(dismiss, TRIP_COMPLETE_AUTO_DISMISS_MS);
}

// ── Tracker ───────────────────────────────────────────────────────────────────

function runTracker({ allStops, journeyId, driverId, vehicleId, initialStopIndex, serviceCode, servicePeriod, psvairEnabled, accentColor, primaryColor, onComplete }) {
  document.getElementById('picker').hidden  = true;
  document.getElementById('tracker').hidden = false;
  document.getElementById('route-header').scrollIntoView();

  // No-op on any device not commissioned with a Pi target (see
  // announceLink.js) — safe to call unconditionally, including on the
  // cab-device bridge where there's no Pi at all.
  connectAnnounceLink();

  const firstStop  = allStops[0];
  // Second real stop — always exists: a route needs at least a first and a
  // last passenger stop, and on a 2-stop route this simply equals lastStop.
  const secondStop = allStops[1];
  const lastStop   = allStops[allStops.length - 1];
  document.getElementById('header-service-code').textContent = serviceCode;
  document.getElementById('header-line1').textContent =
    `${stripIndicator(firstStop.name)} → ${stripIndicator(lastStop.name)}`;

  // Tells the Controller which journey/stops this run's state updates refer
  // to — it has no Supabase access of its own to look this up (see
  // docs/CONTROLLER-REDESIGN.md §3/§6). accentColor/primaryColor are absent
  // on the manual-selection path (no company branding lookup there today);
  // broadcastSchedule/buildSchedulePayload already default both to null.
  broadcastSchedule({
    journeyId,
    serviceCode,
    destination: stripIndicator(lastStop.name),
    allStops,
    accentColor,
    primaryColor,
  });

  log('info', `Started: ${serviceCode}${servicePeriod ? ' ' + servicePeriod : ''} from "${allStops[initialStopIndex].name}"`);

  // ── PSVAIR 2026 announcements ─────────────────────────────────────────────
  // In-scope local bus services get a live audio + on-screen announcement of
  // the next stop / final destination, driven off the same GPS stop-advance
  // logic already tracking arrivals below.
  const psvairBanner     = document.getElementById('psvair-banner');
  const psvairText       = document.getElementById('psvair-text');
  const psvairMuteBtn    = document.getElementById('psvair-mute-btn');
  const psvairVoiceBtn   = document.getElementById('psvair-voice-btn');
  const psvairVoicePanel = document.getElementById('psvair-voice-panel');
  const psvairVoiceSelect  = document.getElementById('psvair-voice-select');
  const psvairVoiceTestBtn = document.getElementById('psvair-voice-test-btn');
  const psvairToggleBtn  = document.getElementById('psvair-toggle-btn');
  setAnnouncementsEnabled(!!psvairEnabled);

  // Banner defaults to collapsed — the running caption + mute/voice controls
  // are a driver convenience, not something needed every trip, and having it
  // open by default just eats space above the route header. The toggle
  // button itself only ever shows on PSVAIR-in-scope routes; the driver's
  // show/hide choice persists across the app (localStorage) rather than
  // resetting every journey.
  psvairToggleBtn.hidden = !psvairEnabled;
  const applyBannerVisibility = () => {
    const shown = isBannerShown();
    psvairBanner.hidden = !psvairEnabled || !shown;
    psvairToggleBtn.textContent = shown ? '\u{1F508} Hide Announcements' : '\u{1F50A} Announcements';
  };
  applyBannerVisibility();
  psvairToggleBtn.onclick = () => { setBannerShown(!isBannerShown()); applyBannerVisibility(); };
  // Starts at initialStopIndex, not null: if tracking begins already sitting
  // at/near the starting stop (a normal case, not just a demo artifact — the
  // very first GPS fix can satisfy that stop's geofence instantly, see
  // gps.js), that arrival would otherwise be (re-)announced on top of
  // announceJourneyStart above, which already covers the starting context.
  let lastAnnouncedStopIdx = initialStopIndex;
  // Guards completeTrip() against firing twice — once from GPS arrival at
  // the final stop and again from the manual fallback link, or from GPS
  // reporting arrival on more than one fix while parked at the final stop.
  let tripCompleted = false;

  if (psvairEnabled) {
    onAnnouncementChange(text => { psvairText.textContent = text; });
    const setMuteBtnLabel = () => {
      psvairMuteBtn.textContent = isMuted() ? '\u{1F507}' : '\u{1F50A}';
      psvairMuteBtn.setAttribute('aria-label', isMuted() ? 'Unmute announcements' : 'Mute announcements');
    };
    setMuteBtnLabel();
    psvairMuteBtn.onclick = () => { setMuted(!isMuted()); setMuteBtnLabel(); };

    // Voice list only becomes available once 'voiceschanged' fires on some
    // browsers (notably Chrome) — repopulate whenever it does, keeping the
    // driver's saved choice selected if it's in the refreshed list.
    const populateVoiceSelect = () => {
      const voices = listVoices();
      if (!voices.length) return;
      const current = psvairVoiceSelect.value || getSelectedVoiceURI();
      psvairVoiceSelect.innerHTML = '';
      voices.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = `${v.name} (${v.lang})`;
        psvairVoiceSelect.appendChild(opt);
      });
      if (current && voices.some(v => v.voiceURI === current)) {
        psvairVoiceSelect.value = current;
      }
    };
    populateVoiceSelect();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.addEventListener('voiceschanged', populateVoiceSelect);
    }

    psvairVoiceBtn.onclick = () => { psvairVoicePanel.hidden = !psvairVoicePanel.hidden; };
    psvairVoiceSelect.onchange = () => setSelectedVoiceURI(psvairVoiceSelect.value);
    psvairVoiceTestBtn.onclick = () => previewVoice(psvairVoiceSelect.value);

    announceJourneyStart({
      serviceCode,
      destination: lastStop.name,
      firstStopId: firstStop.stop_id,
      firstStopName: firstStop.name,
      nextStopId: secondStop.stop_id,
      nextStopName: secondStop.name,
    });
  }

  // ── Diversion alert ────────────────────────────────────────────────────────
  // Driver-triggered fixed alert tone + fixed announcement, suppressing the
  // normal stop announcement while active. Only relevant on in-scope
  // PSVAIR routes, same gating as the banner above.
  //
  // Collapsed like Announcements: tapping the top bar only reveals a
  // confirm/cancel panel, it doesn't fire the alert itself — broadcasting a
  // diversion alert to passengers deserves a deliberate second tap, not a
  // single accidental one.
  const btnDiversion        = document.getElementById('btn-diversion');
  const diversionPanel      = document.getElementById('diversion-panel');
  const diversionConfirmBtn = document.getElementById('diversion-confirm-btn');
  const diversionCancelBtn  = document.getElementById('diversion-cancel-btn');
  btnDiversion.hidden = !psvairEnabled;
  let diversionAlertState = null;

  const setDiversionBtnLabel = () => {
    const active = !!diversionAlertState;
    btnDiversion.textContent = active ? '⚠ Diversion Alert Active' : '↻ Diversion Alert';
    btnDiversion.classList.toggle('active', active);
    diversionConfirmBtn.textContent = active ? '✖ Clear Diversion Alert' : '↻ Start Diversion Alert';
  };
  setDiversionBtnLabel();

  btnDiversion.onclick = () => { diversionPanel.hidden = !diversionPanel.hidden; };
  diversionCancelBtn.onclick = () => { diversionPanel.hidden = true; };

  diversionConfirmBtn.onclick = async () => {
    diversionPanel.hidden = true;

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

  let activeTab = 'list', mapReady = false, stopStatesRef = [];
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
    onUpdate: ({ timing, nextStopIndex, speedMps, distanceToNextM, stopStates, earlyWait, atStop, approaching, lat, lon }) => {
      stopStatesRef = stopStates;
      lastStopIdx = nextStopIndex;
      if (lat !== undefined) { lastLat = lat; lastLon = lon; }

      // PSVAIR event 2 — approaching (fires once per stop off gps.js's
      // stopStates 'approaching' status, the same signal the stop list and
      // status card show). Silent for the final stop (announceApproachEvent
      // itself suppresses that case).
      if (psvairEnabled && approaching) {
        const isFinal = approaching.stopIndex === allStops.length - 1;
        announceApproachEvent({
          stopId: allStops[approaching.stopIndex].stop_id,
          stopName: allStops[approaching.stopIndex].name,
          isFinal,
          diversionActive: !!diversionAlertState,
        });
        // Display-only metadata for the onboard sign's push feed (see
        // announceLink.js) — audio itself stays on this device, never the
        // Pi. Cleared after a fixed window rather than tracking actual
        // playback completion — good enough for a "now announcing" hint.
        setAnnouncing(allStops[approaching.stopIndex].name);
        setTimeout(() => setAnnouncing(null), 6000);
      }

      // Announce on arrival (atStop set) rather than departure, so it's
      // heard while the vehicle is actually there (PSVAIR events 3 & 4).
      if (psvairEnabled && atStop && atStop.stopIndex !== lastAnnouncedStopIdx) {
        lastAnnouncedStopIdx = atStop.stopIndex;
        const isFinal = atStop.stopIndex === allStops.length - 1;
        announceStopEvent({
          nextStopId: isFinal ? null : allStops[atStop.stopIndex + 1].stop_id,
          nextStopName: isFinal ? null : allStops[atStop.stopIndex + 1].name,
          isFinal,
          diversionActive: !!diversionAlertState,
          serviceCode,
          destination: lastStop.name,
        });
        setAnnouncing(allStops[atStop.stopIndex].name);
        setTimeout(() => setAnnouncing(null), 6000);
      }

      // Trip completes on its own once the vehicle is confirmed at the
      // final stop — no driver action needed. completeTrip() itself is
      // also guarded by tripCompleted, but checking here too skips the
      // (harmless but pointless) extra calls from repeat GPS fixes while
      // still parked there.
      if (!tripCompleted && atStop && atStop.stopIndex === allStops.length - 1) {
        completeTrip();
      }

      updateUi({ timing, nextStopIndex, schedule: allStops, speedMps, distanceToNextM, stopStates, earlyWait, atStop });
      if (lat !== undefined) updateMapPosition(lat, lon, nextStopIndex, stopStates);
      syncCurrentStop(nextStopIndex);
      if (activeTab === 'dir') updateDirections();
      if (activeTab === 'log') renderLog(getEntries());

      // No-op unless this device is commissioned + connected to a Pi (see
      // announceLink.js) — never blocks tracking either way.
      broadcastState({
        journeyId,
        nextStopIndex,
        nextStopName: timing.nextStopName,
        atStop,
        approaching,
        earlyWait,
        timing,
        stopStates,
        diversionActive: !!diversionAlertState,
        isFinal: !!(atStop && atStop.stopIndex === allStops.length - 1),
      });
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

  // Runs once — either from GPS arrival at the final stop (see onUpdate
  // above) or from the manual fallback link below — uploads stop times,
  // marks the journey complete, and shows the completion banner.
  async function completeTrip() {
    if (tripCompleted) return;
    tripCompleted = true;

    tracker.stop();
    disconnectAnnounceLink();
    btnIncident.hidden = true;
    btnDiversion.hidden = true;
    diversionPanel.hidden = true;
    incidentOverlay.hidden = true;
    setAnnouncementsEnabled(false);
    psvairBanner.hidden = true;
    psvairToggleBtn.hidden = true;
    document.getElementById('btn-complete-manual').hidden = true;

    const finish = () => {
      document.getElementById('tracker').hidden = true;
      onComplete();
    };

    if (journeyId) {
      const stopRows = buildStopTimeRows(journeyId, stopStatesRef, allStops);
      let completed = false;
      try {
        const uploadResult = await postStopTimeRows(journeyId, stopRows);
        if (!uploadResult.ok) {
          throw new Error(`stop times upload failed: HTTP ${uploadResult.status} ${uploadResult.responseBody || ''}`);
        }
        await rpc('complete_journey', { p_journey_id: journeyId });
        completed = true;
      } catch (err) {
        log('warn', `Trip completion failed, queuing for retry: ${err.message}`);
      }

      if (completed) {
        log('info', `Uploaded ${stopRows.length} stop time(s)`);
        showTripCompleteBanner(finish);
      } else {
        enqueuePendingTrip({ journeyId, stopRows });
        alert(
          `Trip ended.\n\n${stopRows.length} stop time(s) saved on this device and will ` +
          `sync automatically once back in signal — no action needed.`
        );
        finish();
      }
    } else {
      log('warn', 'No journey ID — stop times not saved');
      alert('Trip ended.\n\nNo journey ID was set — stop times were not saved.\nAsk ops to share the driver link for this journey.');
      finish();
    }
  }

  document.getElementById('btn-complete-manual').onclick = () => {
    if (confirm('Complete this trip now and upload stop times?')) completeTrip();
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

  const allStops = journey.stops;

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

  const testingField = document.getElementById('testing-time-field');
  const useCurrentTimeCheckbox = document.getElementById('use-current-time-checkbox');
  if (DEBUG && allStops[0]) {
    document.getElementById('testing-departure-time').textContent = allStops[0].time;
    useCurrentTimeCheckbox.checked = false;
    testingField.hidden = false;
  } else {
    testingField.hidden = true;
  }

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

    const stopsForTracker = (DEBUG && useCurrentTimeCheckbox.checked)
      ? shiftStopTimes(allStops, minutesFromNow(allStops[0].time))
      : allStops;

    runTracker({
      allStops: stopsForTracker,
      journeyId: journey.journey_id,
      driverId: journey.driver_id,
      vehicleId: journey.vehicle_id,
      initialStopIndex,
      serviceCode: journey.service_code,
      servicePeriod: journey.timetable_name,
      psvairEnabled: journey.psvairInScope,
      accentColor: journey.accent_color,
      primaryColor: journey.primary_color,
      onComplete: () => {
        journey.status = 'completed';
        renderDutyCard(duties, journeyIds);
      },
    });
  };
}

// ── No duty card screen ───────────────────────────────────────────────────────

function showNoDutyCard() {
  document.getElementById('no-duty-card').hidden  = false;
  document.getElementById('duty-card').hidden     = true;
  document.getElementById('picker').hidden        = true;
  document.getElementById('manual-picker').hidden = true;
  document.getElementById('vehicle-setup').hidden = true;
  document.getElementById('tracker').hidden       = true;
  document.getElementById('ndc-vehicle-label').textContent = getStoredVehicle()?.label || '(none)';
}

// ── Vehicle setup (one-time per device — which vehicle is this?) ──────────────
// See src/vehicleSetup.js for why: the manual-selection flow below has no
// other way to attach a vehicle to the journeys it creates.

function initVehicleSetup() {
  const select    = document.getElementById('vehicle-setup-select');
  const backBtn   = document.getElementById('vehicle-setup-back-btn');
  const confirmBtn = document.getElementById('vehicle-setup-btn');

  async function loadVehicles() {
    select.innerHTML = '<option>Loading vehicles…</option>';
    select.disabled = true;
    confirmBtn.disabled = true;
    try {
      const vehicles = await fetchLocalBusVehicles();
      if (vehicles.length === 0) {
        select.innerHTML = '<option value="">No Local Bus vehicles found</option>';
        return;
      }
      select.innerHTML = '';
      vehicles.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.fleet_number ? `${v.registration} (Fleet ${v.fleet_number})` : v.registration;
        opt.dataset.label = v.registration;
        select.appendChild(opt);
      });
      select.disabled = false;
      confirmBtn.disabled = false;
    } catch (err) {
      console.error('Failed to load vehicles:', err);
      select.innerHTML = '<option value="">Couldn’t load vehicles — check connection</option>';
    }
  }

  confirmBtn.onclick = () => {
    const opt = select.selectedOptions[0];
    if (!opt || !opt.value) return;
    storeVehicle(opt.value, opt.dataset.label || opt.textContent);
    showNoDutyCard();
  };

  backBtn.onclick = () => showNoDutyCard();

  return {
    // Only offer Back once a vehicle is already set — first-ever commissioning
    // has nowhere useful to go back to (manual selection needs a vehicle).
    show() {
      document.getElementById('duty-card').hidden     = true;
      document.getElementById('no-duty-card').hidden  = true;
      document.getElementById('manual-picker').hidden = true;
      document.getElementById('picker').hidden        = true;
      document.getElementById('tracker').hidden       = true;
      document.getElementById('vehicle-setup').hidden = false;
      backBtn.hidden = !getStoredVehicle();
      loadVehicles();
    },
  };
}

// ── Manual service selection (fallback when no duty card is assigned) ─────────

function initManualSelection() {
  const serviceSelect = document.getElementById('manual-service-select');
  const periodSelect  = document.getElementById('manual-period-select');
  const startBtn      = document.getElementById('manual-start-btn');

  // Populated fresh from Supabase each time the picker is opened (see
  // ndc-manual-btn below) rather than once at startup — this is the live
  // set of routes the company runs, not a bundled/hardcoded list, so a
  // route added today is pickable today with no app update.
  let services = {};

  const testingField  = document.getElementById('manual-testing-time-field');
  const testingTimeEl = document.getElementById('manual-testing-departure-time');
  const useCurrentTimeCheckbox = document.getElementById('manual-use-current-time-checkbox');

  // Read-only preview fetch (fetchStopsForDeparture never creates/starts a
  // journey) so the departure time can be shown before the driver commits by
  // tapping Start — DEBUG-only since it's an extra round-trip real drivers
  // don't need.
  async function updateTestingDepartureTime() {
    if (!DEBUG) { testingField.hidden = true; return; }
    const departureId = services[serviceSelect.value]?.[periodSelect.value];
    if (!departureId) { testingField.hidden = true; return; }
    try {
      const { stops } = await fetchStopsForDeparture(departureId);
      if (!stops.length) { testingField.hidden = true; return; }
      testingTimeEl.textContent = stops[0].time;
      useCurrentTimeCheckbox.checked = false;
      testingField.hidden = false;
    } catch (_) {
      testingField.hidden = true;
    }
  }

  const populatePeriods = () => {
    periodSelect.innerHTML = '';
    Object.keys(services[serviceSelect.value] ?? {}).forEach(period => {
      const opt = document.createElement('option');
      opt.value = period;
      opt.textContent = period;
      periodSelect.appendChild(opt);
    });
    updateTestingDepartureTime();
  };
  serviceSelect.onchange = populatePeriods;
  periodSelect.onchange = updateTestingDepartureTime;

  async function loadServices() {
    serviceSelect.innerHTML = '<option>Loading services…</option>';
    serviceSelect.disabled = true;
    startBtn.disabled = true;
    try {
      services = await fetchAvailableServices();
      serviceSelect.innerHTML = '';
      Object.keys(services).sort().forEach(code => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = code;
        serviceSelect.appendChild(opt);
      });
      populatePeriods();
      serviceSelect.disabled = false;
      startBtn.disabled = false;
    } catch (err) {
      console.error('Failed to load services:', err);
      serviceSelect.innerHTML = '<option>Couldn’t load services — check connection</option>';
    }
  }

  document.getElementById('ndc-manual-btn').onclick = () => {
    document.getElementById('no-duty-card').hidden  = true;
    document.getElementById('manual-picker').hidden = false;
    loadServices();
  };

  document.getElementById('manual-back-btn').onclick = () => {
    document.getElementById('manual-picker').hidden = true;
    showNoDutyCard();
  };

  startBtn.onclick = async () => {
    startBtn.disabled = true;
    try {
      const departureId = services[serviceSelect.value]?.[periodSelect.value];
      const vehicleId = getStoredVehicle()?.id;
      const result = await selectServiceManually(departureId, serviceSelect.value, periodSelect.value, vehicleId, {
        onComplete: showNoDutyCard,
      });

      if (DEBUG && useCurrentTimeCheckbox.checked && result.allStops[0]) {
        result.allStops = shiftStopTimes(result.allStops, minutesFromNow(result.allStops[0].time));
      }

      document.getElementById('manual-picker').hidden = true;
      await acquireWakeLock();

      runTracker(result);
    } catch (err) {
      console.error('Manual service selection failed:', err);
      alert(`Couldn't start this service:\n${err.message}`);
    } finally {
      startBtn.disabled = false;
    }
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function init() {
  // Retries any trip(s) that failed to reach Supabase at completion time on
  // a previous visit (src/localStore.js's queue) — covers the app being
  // reopened after sitting offline overnight. Also re-attempted on every
  // 'online' event below, for a mid-session reconnect. Best-effort/silent,
  // same treatment as fetchCompanyName() just below.
  flushPendingTrips().catch(() => {});
  window.addEventListener('online', () => flushPendingTrips().catch(() => {}));

  // Real operator name for the picker/duty-card screens' brand heading —
  // best-effort and non-blocking (doesn't delay showing the actual
  // functional screens below); on failure (e.g. offline before any cache
  // exists) the generic "BusOps Driver" default already in index.html stands.
  fetchCompanyName()
    .then(name => {
      if (!name) return;
      document.querySelectorAll('.picker-brand, .ndc-brand').forEach(el => { el.textContent = name; });
    })
    .catch(() => {});

  // Dedicated tablet mount, not a driver's own phone — keep the screen awake
  // from boot (duty-card/picker screens included), not just once tracking
  // starts, so the wakelock-warning banner only ever appears on a genuine
  // Wake Lock API failure rather than "haven't pressed Start yet".
  acquireWakeLock();

  initManualSelection();
  const vehicleSetup = initVehicleSetup();
  document.getElementById('ndc-change-vehicle-btn').onclick = () => vehicleSetup.show();

  // One-time commissioning step for the Driver -> Pi push feed (see
  // announceLink.js) — harmless no-op on every visit that isn't it.
  captureAnnounceSetup(new URLSearchParams(window.location.search));

  const dutiesParam = new URLSearchParams(window.location.search).get('duties');
  if (dutiesParam) {
    // A duty card already carries its own ops-assigned vehicle per journey —
    // vehicle commissioning is only for the manual-selection path below.
    const journeyIds = dutiesParam.split(',').map(s => s.trim()).filter(Boolean);
    await initDutyCard(journeyIds);
  } else if (getStoredVehicle()) {
    showNoDutyCard();
  } else {
    vehicleSetup.show();
  }
}

init().catch(console.error);
