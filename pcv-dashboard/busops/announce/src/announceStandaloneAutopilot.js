// BusOps Announce Lite — standalone (driverless) schedule-autopilot mode.
// Wires the pure matcher (scheduleAutopilot.js) to this device's own GPS
// (announceGps.js) and the existing manual-selection RPCs
// (get_or_create_manual_journey/start_journey/complete_journey — reused
// verbatim, no new tracking logic), driven by the Supabase client
// announceLiteFeed.js already authenticated with this device's token.
//
// Only reached when a device's gps_source is 'internal' and it has at
// least one candidate_departure_id configured (see AnnounceDeviceLinkPage.jsx
// and the announce_devices schema) — a freshly registered standalone device
// with no candidates yet just shows the idle screen, same as before this
// feature existed.
//
// Hard precondition (see docs/ANNOUNCE-PRODUCT-TIERS.md): only safe when the
// commissioned candidate routes' start/end points don't overlap with any
// other service's stops — that's what makes matching on geofence+time alone
// sufficient. Diversion alerts and the general shared-terminus-with-other-
// services case are explicitly out of scope here.

import { startAnnounceGpsTracking } from './announceGps.js';
import { findScheduleMatch, findTestingScheduleMatch, isJourneyComplete, describeConfigUpdate } from './scheduleAutopilot.js';
import { shiftStopTimes } from '../../shared/scheduleTimeShift.js';

const IDLE_POLL_MS = 5000; // own-GPS check interval while no journey is active
const COMPLETION_TIMEOUT_MIN = 120; // safety net — no driver to notice a stuck journey

function stripIndicator(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, '');
}

async function fetchCandidateDepartures(client, departureIds) {
  if (!departureIds?.length) return [];
  const { data, error } = await client
    .from('schedule_view')
    .select('departure_id, lat, lon, scheduled_time, sequence')
    .in('departure_id', departureIds)
    .order('sequence');
  if (error || !data) return [];
  const firstByDeparture = new Map();
  for (const row of data) {
    if (!firstByDeparture.has(row.departure_id)) firstByDeparture.set(row.departure_id, row);
  }
  return departureIds
    .map((id) => firstByDeparture.get(id))
    .filter(Boolean)
    .map((row) => ({
      departureId: row.departure_id,
      firstStopLat: row.lat,
      firstStopLon: row.lon,
      departureTime: row.scheduled_time.substring(0, 5),
    }));
}

async function fetchDepartureDetails(client, departureId) {
  const { data, error } = await client
    .from('schedule_view')
    .select('service_code, display_name, lat, lon, scheduled_time, stop_type, timetable_stop_id, stop_id, sequence')
    .eq('departure_id', departureId)
    .order('sequence');
  if (error || !data?.length) return null;
  return {
    serviceCode: data[0].service_code,
    allStops: data.map((r) => ({
      name: r.display_name,
      lat: r.lat,
      lon: r.lon,
      time: r.scheduled_time.substring(0, 5),
      stop_type: r.stop_type,
      timetable_stop_id: r.timetable_stop_id,
      stop_id: r.stop_id,
    })),
  };
}

// Milliseconds until a candidate's next occurrence of its scheduled time
// (today, or tomorrow if today's has already passed) — for the idle
// screen's "next departure" display, not for matching (findScheduleMatch
// only cares about the current window).
function msUntilNextOccurrence(departureTime, now) {
  const [h, m] = departureTime.split(':').map(Number);
  const scheduled = new Date(now);
  scheduled.setHours(h, m, 0, 0);
  let diff = scheduled.getTime() - now.getTime();
  if (diff < 0) diff += 24 * 60 * 60 * 1000;
  return diff;
}

export function startStandaloneAutopilot(client, initialDeviceRow, { onSchedule, onState, onIdleNextDeparture, onGpsSourceChanged }) {
  // Live reference, not a frozen snapshot — applyConfigUpdate() below
  // replaces it in place, and tryMatch()/reportNextDeparture() always read
  // whatever it currently points to, so a dashboard edit (testing_mode,
  // terminus_radius_m, match windows) takes effect on the very next
  // idle-poll tick instead of requiring a device reload.
  let deviceRow = initialDeviceRow;
  let candidates = [];
  let activeJourney = null; // { journeyId, startedAt, tracker }

  function reportNextDeparture() {
    if (!candidates.length) {
      onIdleNextDeparture?.(null);
      return;
    }
    const now = new Date();
    const next = [...candidates].sort(
      (a, b) => msUntilNextOccurrence(a.departureTime, now) - msUntilNextOccurrence(b.departureTime, now)
    )[0];
    onIdleNextDeparture?.(next);
  }

  async function refreshCandidates() {
    candidates = await fetchCandidateDepartures(client, deviceRow.candidate_departure_ids ?? []);
    if (!activeJourney) reportNextDeparture();
  }

  function completeActiveJourney() {
    if (!activeJourney) return;
    const { journeyId, tracker } = activeJourney;
    tracker.stop();
    client.rpc('complete_journey', { p_journey_id: journeyId }).catch(() => {});
    activeJourney = null;
    reportNextDeparture();
  }

  async function tryMatch(lat, lon) {
    if (activeJourney || !candidates.length) return;
    const now = new Date();
    let match = findScheduleMatch({
      candidates, lat, lon, now,
      terminusRadiusM: deviceRow.terminus_radius_m,
      matchWindowBeforeMin: deviceRow.match_window_before_min,
      matchWindowAfterMin: deviceRow.match_window_after_min,
    });

    // Testing-only fallback: a match well outside the normal time window
    // (device deliberately driven to the terminus at an odd hour to test)
    // still starts the journey, but with its stop schedule shifted to now
    // — see scheduleAutopilot.js's findTestingScheduleMatch for the
    // threshold/rationale. Off by default (testing_mode), so a live device
    // never takes this path.
    let shiftMinutes = 0;
    if (!match && deviceRow.testing_mode) {
      const testingMatch = findTestingScheduleMatch({
        candidates, lat, lon, now,
        terminusRadiusM: deviceRow.terminus_radius_m,
      });
      if (testingMatch) {
        match = testingMatch.candidate;
        shiftMinutes = testingMatch.shiftMinutes;
      }
    }
    if (!match) return;

    const details = await fetchDepartureDetails(client, match.departureId);
    if (!details) return; // near-miss costs nothing — stays idle, tries again next tick
    if (shiftMinutes) details.allStops = shiftStopTimes(details.allStops, shiftMinutes);

    const journeyId = crypto.randomUUID();
    const { data: created } = await client.rpc('get_or_create_manual_journey', {
      p_timetable_departure_id: match.departureId,
      p_journey_id: journeyId,
    });
    const resolvedId = created?.[0]?.journey_id ?? journeyId;
    await client.rpc('start_journey', { p_journey_id: resolvedId });

    const lastStop = details.allStops[details.allStops.length - 1];
    onSchedule({
      type: 'schedule',
      ts: Date.now(),
      journeyId: resolvedId,
      serviceCode: details.serviceCode,
      destination: stripIndicator(lastStop.name),
      stops: details.allStops,
      accentColor: null,
      primaryColor: null,
    });

    const startedAt = new Date();
    const tracker = startAnnounceGpsTracking({
      schedule: details.allStops,
      onUpdate: (state) => {
        const isFinal = !!(state.atStop && state.atStop.stopIndex === details.allStops.length - 1);
        onState({
          type: 'state',
          ts: Date.now(),
          journeyId: resolvedId,
          nextStopIndex: state.nextStopIndex,
          nextStopName: details.allStops[state.nextStopIndex]?.name,
          atStop: state.atStop,
          approaching: state.approaching,
          earlyWait: state.earlyWait,
          timing: state.timing,
          stopStates: state.stopStates,
          diversionActive: false, // no driver to trigger one — see file header
          isFinal,
        });
        if (isJourneyComplete({
          atStop: state.atStop, allStopsLength: details.allStops.length,
          startedAt, now: new Date(), timeoutMin: COMPLETION_TIMEOUT_MIN,
        })) {
          completeActiveJourney();
        }
      },
    });
    activeJourney = { journeyId: resolvedId, startedAt, tracker };
  }

  // Applies a fresh announce_devices row read after a live config change
  // (see deviceStateSync.js's subscribeToChanges, wired in by
  // announceLiteFeed.js). Only candidate_departure_ids needs an explicit
  // re-fetch — everything else tryMatch() already reads off the live
  // `deviceRow` reference this function replaces. gps_source flipping
  // (device linked/unlinked while running) is surfaced via
  // onGpsSourceChanged so the caller can tear this loop down and start the
  // other mode, rather than this module trying to hot-switch itself.
  function applyConfigUpdate(nextRow) {
    const { candidatesChanged, gpsSourceChanged } = describeConfigUpdate(deviceRow, nextRow);
    deviceRow = nextRow;
    if (candidatesChanged) refreshCandidates();
    if (gpsSourceChanged) onGpsSourceChanged?.(nextRow);
  }

  refreshCandidates();

  const idleTimer = setInterval(() => {
    if (activeJourney || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => tryMatch(pos.coords.latitude, pos.coords.longitude),
      () => {}, // GPS error — just skip this tick, retried on the next one
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
  }, IDLE_POLL_MS);

  return {
    stop: () => {
      clearInterval(idleTimer);
      activeJourney?.tracker?.stop();
    },
    refreshCandidates,
    applyConfigUpdate,
  };
}
