// BusOps Announce Solo — driverless schedule-autopilot mode.
// Wires the pure matcher (scheduleAutopilot.js) to this device's own GPS
// (announceGps.js) and the existing manual-selection RPCs
// (get_or_create_manual_journey/start_journey/complete_journey — reused
// verbatim, no new tracking logic), driven by the Supabase client
// announceDeviceFeed.js already authenticated with this device's token.
//
// Only reached when a device's gps_source is 'internal' and it has at
// least one candidate_departure_id configured (see AnnounceDeviceLinkPage.jsx
// and the announce_devices schema) — a freshly registered Solo device
// with no candidates yet just shows the idle screen, same as before this
// feature existed.
//
// Also only actually polls its own GPS during its configured active
// windows (announce_device_active_windows — day_of_week/window_start/
// window_end, same shape as employees' own employee_availability table) —
// a device with none configured stays fully dormant, same conservative
// default as an empty candidate list. See isWithinActiveWindow in
// scheduleAutopilot.js.
//
// Hard precondition (see docs/ANNOUNCE-PRODUCT-TIERS.md): only safe when the
// commissioned candidate routes' start/end points don't overlap with any
// other service's stops — that's what makes matching on geofence+time alone
// sufficient. The general shared-terminus-with-other-services case is
// explicitly out of scope here.
//
// No Driver device is present on this tier, so this module is also the one
// place that resolves *and speaks* the full 7-state announcement sequence
// (see shared/announceStates.js) for a Solo journey — everything the
// Driver device would otherwise do, via announceSpeech.js's speechSynthesis
// (no pre-rendered clips exist for this tier). This includes diversion: with
// no driver to press a button, a diversion here is auto-detected from
// shared/geofence.js's existing 'skipped_detour' classification (more than
// one timing-point stop bypassed before rejoining) — a one-shot alert per
// occurrence, not an ongoing mode, since there's no driver to clear it
// either (see the deviation-tracking block in tryMatch's onUpdate below).

import { startAnnounceGpsTracking } from './announceGps.js';
import {
  findScheduleMatch, findTestingScheduleMatch, isJourneyComplete, isWithinActiveWindow,
} from './scheduleAutopilot.js';
import { shiftStopTimes } from '../../shared/scheduleTimeShift.js';
import {
  ANNOUNCE_STATES, DEVIATION_STOP_STATUS, resolveApproachOrArrivalState,
} from '../../shared/announceStates.js';
import { speakState } from './announceSpeech.js';

const IDLE_POLL_MS = 5000; // own-GPS check interval while no journey is active
const COMPLETION_TIMEOUT_MIN = 120; // safety net — no driver to notice a stuck journey
// How long the sign keeps showing the terminus state before reverting to
// idle — matches driver/src/main.js's TERMINUS_DISPLAY_MS exactly (same
// user feedback 2026-09-02: passengers need real time to read/hear "all
// change please" and disembark). Only the *display* reset is delayed —
// complete_journey (below) still fires immediately, since that's a
// backend/reporting concern, not a passenger-facing one.
const TERMINUS_HOLD_MS = 5 * 60 * 1000;

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

async function fetchActiveWindows(client, deviceId) {
  const { data, error } = await client
    .from('announce_device_active_windows')
    .select('day_of_week, window_start, window_end')
    .eq('announce_device_id', deviceId);
  if (error || !data) return [];
  return data;
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

export function startSoloAutopilot(client, deviceRow, { onSchedule, onState, onIdleNextDeparture, onJourneyEnd }) {
  let candidates = [];
  let activeWindows = [];
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

  async function refreshActiveWindows() {
    activeWindows = await fetchActiveWindows(client, deviceRow.id);
  }

  function completeActiveJourney() {
    if (!activeJourney) return;
    const { journeyId, tracker } = activeJourney;
    tracker.stop();
    // Promise.resolve(...) adopts the vendored supabase-js query builder into
    // a real native Promise before calling .catch() -- the builder itself is
    // thenable (awaiting it elsewhere in this file works fine) but is not an
    // actual Promise instance, so it has no .catch() of its own. Confirmed
    // live, 2026-09-01: calling .catch() on it directly threw
    // "client.rpc(...).catch is not a function" in a real browser, silently
    // breaking journey completion (the RPC error never actually needed
    // catching in practice, but the throw happened before the RPC call even
    // went out).
    Promise.resolve(client.rpc('complete_journey', { p_journey_id: journeyId })).catch(() => {});
    activeJourney = null;
    // Hides the now-stale #onboard-sign and clears its reveal timers — same
    // onJourneyEnd() the base/Lite tiers already call on their own
    // journey-end signals (onboard.js). Previously missing here entirely,
    // so a completed Solo journey's sign stayed visibly on top of the idle
    // screen (see onboard.html's DOM order/z-index) until the next journey
    // started. reportNextDeparture() is what actually shows the correct
    // next-departure caption on that idle screen — kept together with
    // onJourneyEnd() here since both only make sense once idle is actually
    // being shown.
    //
    // Delayed (TERMINUS_HOLD_MS), not immediate — mirrors driver/src/
    // main.js's completeTrip(). activeJourney was just set to null above;
    // if tryMatch() finds a new candidate before this timer fires, it's
    // non-null again by the time this runs, and this guard skips clearing
    // the sign out from under that new journey (same race this device's
    // idle loop could otherwise hit that main.js's own activeTrackerId
    // guard protects against).
    setTimeout(() => {
      if (activeJourney) return;
      onJourneyEnd?.();
      reportNextDeparture();
    }, TERMINUS_HOLD_MS);
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

    // Start of Route — fires once, before GPS tracking starts, same as the
    // Driver device's equivalent call in main.js. Every stop from here on
    // (including the first) gets its own normal arrival announcement off
    // the atStop edge below.
    const routeStartVars = { serviceCode: details.serviceCode, destination: stripIndicator(lastStop.name) };
    onState({ type: 'state', ts: Date.now(), journeyId: resolvedId, stateKey: ANNOUNCE_STATES.ROUTE_START, vars: routeStartVars, earlyWait: null });
    speakState(ANNOUNCE_STATES.ROUTE_START, routeStartVars);

    let lastAnnouncedStopIdx = null;
    const announcedDetourStops = new Set(); // one-shot per stop — see file header
    let lastState = { stateKey: ANNOUNCE_STATES.ROUTE_START, vars: routeStartVars };

    const startedAt = new Date();
    const tracker = startAnnounceGpsTracking({
      schedule: details.allStops,
      onUpdate: (state) => {
        const isFinal = !!(state.atStop && state.atStop.stopIndex === details.allStops.length - 1);

        // Auto-detected diversion (PSVAIR Regulation 10) — the only trigger
        // available on this driverless tier. gps.js confirms a detour on
        // the exact same tick it advances into the rejoined stop's own
        // arrival (see shared/gps.js's forward-match branch), so a newly
        // detected deviation here takes over this tick's announcement
        // entirely — audio and visual alike — the same way a driver-
        // triggered diversion supersedes (rather than stacks with) the
        // normal arrival announcement in announceStopEvent.js. One-shot:
        // only for the tick it's first detected on; the very next real
        // approaching/atStop edge (a later tick) naturally supersedes the
        // display again — there's no driver to explicitly clear it the way
        // the button-triggered path on the base Announce tier or Lite works.
        const deviatedStop = (state.stopStates ?? []).findIndex(
          (s, i) => s.status === DEVIATION_STOP_STATUS && !announcedDetourStops.has(i)
        );
        if (deviatedStop !== -1) {
          (state.stopStates ?? []).forEach((s, i) => {
            if (s.status === DEVIATION_STOP_STATUS) announcedDetourStops.add(i);
          });
          lastState = { stateKey: ANNOUNCE_STATES.DIVERSION, vars: {} };
          speakState(ANNOUNCE_STATES.DIVERSION, {});
          if (state.atStop) lastAnnouncedStopIdx = state.atStop.stopIndex; // still counts as "arrival announced" for this stop
        } else {
          if (state.approaching) {
            lastState = resolveApproachOrArrivalState({ approaching: state.approaching, atStop: null, allStops: details.allStops });
            speakState(lastState.stateKey, lastState.vars);
          }

          // Redesigned 2026-09-02, mirrors driver/src/main.js's same
          // restructure: only the final stop gets its own arrival
          // announcement (the terminus message) — an intermediate stop's
          // arrival used to also speak "This stop is X" right after
          // approach had just said "This is X" moments earlier. Straight
          // to departure for an intermediate stop now instead.
          if (state.atStop && state.atStop.stopIndex !== lastAnnouncedStopIdx) {
            lastAnnouncedStopIdx = state.atStop.stopIndex;

            if (isFinal) {
              lastState = resolveApproachOrArrivalState({ approaching: null, atStop: state.atStop, allStops: details.allStops });
              speakState(lastState.stateKey, lastState.vars);
            } else {
              const departureVars = {
                serviceCode: details.serviceCode,
                destination: stripIndicator(lastStop.name),
                nextStopName: stripIndicator(details.allStops[state.atStop.stopIndex + 1].name),
              };
              lastState = { stateKey: ANNOUNCE_STATES.STOP_DEPARTURE, vars: departureVars };
              speakState(ANNOUNCE_STATES.STOP_DEPARTURE, departureVars);
            }
          }
        }

        // Pushed every tick, same reasoning as main.js's equivalent: keeps
        // earlyWait live on the sign between announcement edges without
        // re-triggering audio (that's separately edge-guarded above).
        onState({
          type: 'state', ts: Date.now(), journeyId: resolvedId,
          stateKey: lastState.stateKey, vars: lastState.vars, earlyWait: state.earlyWait,
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

  refreshCandidates();
  refreshActiveWindows();

  const idleTimer = setInterval(() => {
    if (activeJourney || !navigator.geolocation) return;
    // Stay fully dormant (no geolocation call at all — no battery/data use)
    // outside this device's configured active windows. A device with no
    // windows configured at all never wakes — see isWithinActiveWindow's
    // own comment for why that's the safe default, matching an empty
    // candidate_departure_ids list's existing no-op behaviour.
    if (!isWithinActiveWindow(new Date(), activeWindows)) return;
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
    refreshActiveWindows,
  };
}
