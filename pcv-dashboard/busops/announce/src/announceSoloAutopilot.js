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
// Also only actually awake (GPS polling, and the screen itself — see
// onboard.js's wake-lock acquire/release) within the wake window around one
// of its own commissioned candidate departures — a device with none
// configured stays fully dormant, same conservative default as an empty
// candidate list. See isWithinDepartureWakeWindow in scheduleAutopilot.js.
// Replaces the old admin-configured announce_device_active_windows table
// (dropped 2026-09-04) — see that function's own header comment for why.
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
  findScheduleMatch, findTestingScheduleMatch, isJourneyComplete, isWithinDepartureWakeWindow,
  describeConfigUpdate,
} from './scheduleAutopilot.js';
import { shiftStopTimes } from '../../shared/scheduleTimeShift.js';
import {
  ANNOUNCE_STATES, DEVIATION_STOP_STATUS, resolveApproachOrArrivalState,
} from '../../shared/announceStates.js';
import { speakState } from './announceSpeech.js';

const IDLE_POLL_MS = 5000; // own-GPS check interval while no journey is active
// Boot-time candidate fetch retry — matches announceDeviceFeed.js's
// RECONNECT_DELAY_MS. Without this, a transient connectivity blip at boot
// (e.g. right after the device reconnects to WiFi) left candidates
// permanently empty for the rest of the day, with the device silently stuck
// on idle — first-beta-test feedback 2026-09-03.
const BOOT_FETCH_RETRY_MS = 3000;
const COMPLETION_TIMEOUT_MIN = 120; // safety net — no driver to notice a stuck journey
// How long the sign keeps showing the terminus state, and the screen itself
// stays awake (see onboard.js's wake lock), after the last stop is reached
// before reverting to idle/asleep — one number governing both the content
// hold and the power-state hold, per the user's own spec ("Screen Always on
// ... up until 10 minutes after the last stop has been reached"). Replaces
// the old 5-minute TERMINUS_HOLD_MS (which only ever governed the content
// hold, matching driver/src/main.js's TERMINUS_DISPLAY_MS) — deliberately
// not kept as a second, separate timer alongside a new power-hold timer;
// see docs/ANNOUNCE-PRODUCT-TIERS.md's simplification writeup, 2026-09-04.
// complete_journey (below) still fires immediately regardless of this hold
// — that's a backend/reporting concern, not a passenger-facing one.
const POST_JOURNEY_HOLD_MS = 10 * 60 * 1000;

function stripIndicator(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, '');
}

// Returns null (not { candidates: [], termDateRanges: [] }) on a fetch
// failure, distinct from "genuinely no candidates configured" — callers
// need that distinction to know whether to retry (see refreshCandidates
// below). days_of_week/school_term_time come straight off
// timetable_departures via schedule_view, term_dates/service_exceptions are
// fetched alongside — together the single source of truth for which days
// this candidate actually runs, reused by isWithinDepartureWakeWindow
// instead of a separately admin-maintained day/time table (see that
// function's own header comment). service_exceptions is queried unfiltered
// by type (added + removed) since isCandidateRunningOn needs both.
async function fetchCandidateDepartures(client, departureIds) {
  if (!departureIds?.length) return { candidates: [], termDateRanges: [] };
  const [scheduleResult, exceptionsResult, termDatesResult] = await Promise.all([
    client
      .from('schedule_view')
      .select('departure_id, lat, lon, scheduled_time, sequence, days_of_week, school_term_time')
      .in('departure_id', departureIds)
      .order('sequence'),
    client
      .from('service_exceptions')
      .select('timetable_departure_id, exception_date, exception_type')
      .in('timetable_departure_id', departureIds),
    client.from('term_dates').select('start_date, end_date'),
  ]);
  if (scheduleResult.error || !scheduleResult.data) return null;

  const exceptionsByDeparture = new Map();
  for (const row of exceptionsResult.data ?? []) {
    if (!exceptionsByDeparture.has(row.timetable_departure_id)) {
      exceptionsByDeparture.set(row.timetable_departure_id, { removedDates: [], addedDates: [] });
    }
    const bucket = exceptionsByDeparture.get(row.timetable_departure_id);
    (row.exception_type === 'removed' ? bucket.removedDates : bucket.addedDates).push(row.exception_date);
  }

  const firstByDeparture = new Map();
  for (const row of scheduleResult.data) {
    if (!firstByDeparture.has(row.departure_id)) firstByDeparture.set(row.departure_id, row);
  }
  const candidates = departureIds
    .map((id) => firstByDeparture.get(id))
    .filter(Boolean)
    .map((row) => {
      const { removedDates = [], addedDates = [] } = exceptionsByDeparture.get(row.departure_id) ?? {};
      return {
        departureId: row.departure_id,
        firstStopLat: row.lat,
        firstStopLon: row.lon,
        departureTime: row.scheduled_time.substring(0, 5),
        daysOfWeek: row.days_of_week,
        schoolTermTime: row.school_term_time,
        removedDates,
        addedDates,
      };
    });
  return { candidates, termDateRanges: termDatesResult.data ?? [] };
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

export function startSoloAutopilot(client, initialDeviceRow, { onSchedule, onState, onIdleNextDeparture, onJourneyEnd, onSleep, onGpsSourceChanged }) {
  // Live reference, not a frozen snapshot — applyConfigUpdate() below
  // replaces it in place, and tryMatch()/reportNextDeparture() always read
  // whatever it currently points to, so a dashboard edit (testing_mode,
  // terminus_radius_m, match windows) takes effect on the very next
  // idle-poll tick instead of requiring a device reload.
  let deviceRow = initialDeviceRow;
  let candidates = [];
  let termDateRanges = [];
  let activeJourney = null; // { journeyId, startedAt, tracker }
  // Starts undetermined (not false!) — applyWakeState()'s transition check
  // is `awake === isAwake`, and false is a real, reachable outcome (asleep
  // outside any window), so starting there would make the very first
  // "we're asleep" determination look like a no-op non-transition and
  // silently never call onSleep at boot. null guarantees the first real
  // determination, whichever way it goes, always fires its callback once.
  let isAwake = null;

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

  // Shows/hides the idle screen itself (and, via onSleep/reportNextDeparture,
  // the physical screen power — see onboard.js's wake lock) based on
  // whether *now* falls inside the wake window around one of this device's
  // own candidate departures. Previously only GPS polling (the idleTimer
  // below) was gated by this — the idle screen (branding, logo,
  // next-departure caption) stayed lit around the clock regardless, which
  // made no sense for a device that only runs a school-run twice a day.
  // Never touches anything while a journey is actually active — a window
  // ending mid-route must not blank the sign out from under real
  // passengers; only ever affects the idle state either side of one.
  function applyWakeState() {
    if (activeJourney) return;
    const awake = isWithinDepartureWakeWindow(
      new Date(), candidates, deviceRow.match_window_before_min, deviceRow.match_window_after_min, termDateRanges
    );
    if (awake === isAwake) return;
    isAwake = awake;
    if (awake) reportNextDeparture();
    else onSleep?.();
  }

  async function refreshCandidates() {
    const result = await fetchCandidateDepartures(client, deviceRow.candidate_departure_ids ?? []);
    if (result === null) {
      setTimeout(refreshCandidates, BOOT_FETCH_RETRY_MS);
      return;
    }
    candidates = result.candidates;
    termDateRanges = result.termDateRanges;
    applyWakeState(); // first real determination of awake/asleep, now that candidates are actually loaded
    if (isAwake) reportNextDeparture();
  }

  // Applies a fresh announce_devices row read after a live config change
  // (see shared/deviceStateSync.js's subscribeToChanges, wired in by
  // announceDeviceFeed.js). Only candidate_departure_ids needs an explicit
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
    // Delayed (POST_JOURNEY_HOLD_MS), not immediate — mirrors driver/src/
    // main.js's completeTrip(). activeJourney was just set to null above;
    // if tryMatch() finds a new candidate before this timer fires, it's
    // non-null again by the time this runs, and this guard skips clearing
    // the sign out from under that new journey (same race this device's
    // idle loop could otherwise hit that main.js's own activeTrackerId
    // guard protects against).
    setTimeout(() => {
      if (activeJourney) return;
      onJourneyEnd?.();
      // Recompute fresh rather than trusting isAwake — POST_JOURNEY_HOLD_MS
      // is 10 minutes, easily enough for the device to have drifted outside
      // every candidate's own wake window while this journey's terminus
      // message was still showing.
      isAwake = isWithinDepartureWakeWindow(
        new Date(), candidates, deviceRow.match_window_before_min, deviceRow.match_window_after_min, termDateRanges
      );
      if (isAwake) reportNextDeparture();
      else onSleep?.();
    }, POST_JOURNEY_HOLD_MS);
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
    // Mirrors lastAnnouncedStopIdx for the approaching edge — without this,
    // "This is X." re-fires on every GPS tick for the whole approach window
    // (see shared/geofence.js's isApproaching()) instead of once. Beta-test
    // feedback 2026-09-03; same fix applied to driver/src/main.js's
    // equivalent Lite-tier handling.
    let lastAnnouncedApproachIdx = null;
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
            if (state.approaching.stopIndex !== lastAnnouncedApproachIdx) {
              lastAnnouncedApproachIdx = state.approaching.stopIndex;
              speakState(lastState.stateKey, lastState.vars);
            }
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
    // Confirms the vehicle's position immediately, the same way a manual
    // override does (shared/gps.js's jumpToStop sets hasReachedStart=true) —
    // needed because Solo's own match just fired at terminus_radius_m
    // (150m default, deliberately loose for a depot/terminus forecourt),
    // which is well outside GEOFENCE_RADIUS_M (50m, gps.js's own street-stop
    // arrival threshold). Without this, hasReachedStart could stay false for
    // the rest of the journey if the vehicle never physically enters that
    // tighter 50m ring around stop 0's exact coordinates — freezing arrival/
    // approach/forward-match detection at nextStopIndex=0 permanently. Found
    // live 2026-09-04: this is why a whole multi-hour Solo journey produced
    // no announcements past the initial ROUTE_START.
    tracker.jumpToStop(0);
    activeJourney = { journeyId: resolvedId, startedAt, tracker };
  }

  refreshCandidates();

  const idleTimer = setInterval(() => {
    applyWakeState(); // catches a wake window opening/closing since the last tick — see its own comment
    if (activeJourney || !navigator.geolocation || !isAwake) return;
    // Stay fully dormant (no geolocation call at all — no battery/data use)
    // outside every candidate's own wake window. A device with no
    // candidates configured at all never wakes — see
    // isWithinDepartureWakeWindow's own comment for why that's the safe
    // default.
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
