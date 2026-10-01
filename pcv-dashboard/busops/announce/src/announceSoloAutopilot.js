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
//
// Power cut and no signal (docs/HARDWARE.md "Power loss and first boot",
// owner-approved 2026-09-28):
//   - the trip is saved on the tablet as it runs (shared/journeyCheckpoint.js,
//     own key); after a restart a saved trip under 2 hours old from today is
//     carried on — even outside the wake window — from the stop one GPS
//     reading puts it at (soloResumeStop.js; no driver to confirm one), and
//     the sign shows and says "The next stop is X" once
//   - starts and trip-end uploads go through an upload queue kept on the
//     tablet (soloTripQueue.js); a start with no signal runs on a journey id
//     made on the tablet, like the Driver PWA's offline manual start
//   - the departure list and each departure's stops are kept as an offline
//     copy (soloOfflineCache.js) so matching works with no signal
//
// Screen power (owner, 2026-09-30, screenPower/): the tablet is on a
// permanent supply so it never goes flat, and switches its own screen through
// Fully Kiosk — on from 30 min before each running journey's first stop to
// 15 min after its last, and whenever a trip is under way; off otherwise. The
// departures are re-read every hour so a Dashboard change (term time, a
// removed date) reaches the tablet without a restart.

import { startAnnounceGpsTracking } from './announceGps.js';
import {
  findScheduleMatch, findTestingScheduleMatch, isJourneyComplete, isWithinDepartureWakeWindow,
  describeConfigUpdate,
} from '../../shared/scheduleAutopilot.js';
import { shiftStopTimes } from '../../shared/scheduleTimeShift.js';
import {
  ANNOUNCE_STATES, DEVIATION_STOP_STATUS, resolveApproachOrArrivalState,
} from '../../shared/announceStates.js';
import { speakState } from './announceSpeech.js';
import { readCheckpoint, clearCheckpoint, createCheckpointRecorder } from '../../shared/journeyCheckpoint.js';
import { pickResumeStop } from './soloResumeStop.js';
import { createSoloTripQueue } from './soloTripQueue.js';
import { saveCandidates, loadCandidates, saveDepartureDetails, loadDepartureDetails } from './soloOfflineCache.js';
import { isScreenScheduledOn, describeScreenDay } from './screenPower/screenSchedule.js';
import { createFullyScreen, createScreenPower } from './screenPower/screenPower.js';

// Solo's own saved-trip key — see shared/journeyCheckpoint.js.
export const SOLO_CHECKPOINT_KEY = 'busops.announce.solo.journeyCheckpoint';
// How often queued starts/uploads are retried, and how often the departure
// list is re-read while running from the offline copy.
const QUEUE_RETRY_MS = 60 * 1000;

const IDLE_POLL_MS = 5000; // own-GPS check interval while no journey is active
// Boot-time candidate fetch retry — matches announceDeviceFeed.js's
// RECONNECT_DELAY_MS. Without this, a transient connectivity blip at boot
// (e.g. right after the device reconnects to WiFi) left candidates
// permanently empty for the rest of the day, with the device silently stuck
// on idle — first-beta-test feedback 2026-09-03.
const BOOT_FETCH_RETRY_MS = 3000;
// Re-reads the departures (and their term-time flags, added/removed dates,
// term dates) this often. Before, only a restart or a change to this
// device's own departure list re-read them.
const CANDIDATE_REFRESH_MS = 60 * 60 * 1000;
const COMPLETION_TIMEOUT_MIN = 120; // safety net — no driver to notice a stuck journey
// How long the sign keeps showing the terminus state, and the screen itself
// stays awake (see onboard.js's wake lock), after the last stop is reached
// before reverting to idle/asleep — one number governing both the content
// hold and the power-state hold, per the user's own spec ("Screen Always on
// ... up until 10 minutes after the last stop has been reached" — now 90 s,
// below). Replaces
// the old 5-minute TERMINUS_HOLD_MS (which only ever governed the content
// hold, matching driver/src/main.js's TERMINUS_DISPLAY_MS) — deliberately
// not kept as a second, separate timer alongside a new power-hold timer;
// see docs/ANNOUNCE-PRODUCT-TIERS.md's simplification writeup, 2026-09-04.
// complete_journey (below) still fires immediately regardless of this hold
// — that's a backend/reporting concern, not a passenger-facing one.
// 90 seconds since 2026-10-01 (owner, after a live run where the message was
// said once and covered by the idle screen within seconds): long enough for
// passengers to read it and hear it several times, short enough that the
// sign is ready for the next trip. Was 10 minutes.
const POST_JOURNEY_HOLD_MS = 90 * 1000;
// "This service terminates here …" is said again this often during the hold,
// start to start (0, 20, 40, 60 and 80 s) — the text stays on screen
// throughout, so the sound never stands alone (PSV(AI)R).
const TERMINUS_REPEAT_MS = 20 * 1000;

// Also inserts a space after a bare comma — every stops.announcement_name
// override is stored "Locality,Description" with no space (fine for
// onboard.js's renderHeadlineText(), which splits+trims on that comma, but
// rendered squished — "Boston,College" — wherever this value is used
// directly in a flowing sentence instead, e.g. destination below). See
// shared/announceStates.js's own copy of this function for the full writeup.
function stripIndicator(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, '').replace(/,(?=\S)/g, ', ');
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
  let scheduleResult, exceptionsResult, termDatesResult;
  try {
    [scheduleResult, exceptionsResult, termDatesResult] = await fetchCandidateTables(client, departureIds);
  } catch (_) {
    return null;
  }
  if (scheduleResult.error || !scheduleResult.data) return null;
  return buildCandidates(departureIds, scheduleResult, exceptionsResult, termDatesResult);
}

function fetchCandidateTables(client, departureIds) {
  return Promise.all([
    client
      .from('schedule_view')
      .select('departure_id, service_code, lat, lon, scheduled_time, sequence, days_of_week, school_term_time')
      .in('departure_id', departureIds)
      .order('sequence'),
    client
      .from('service_exceptions')
      .select('timetable_departure_id, exception_date, exception_type')
      .in('timetable_departure_id', departureIds),
    client.from('term_dates').select('start_date, end_date'),
  ]);
}

function buildCandidates(departureIds, scheduleResult, exceptionsResult, termDatesResult) {
  const exceptionsByDeparture = new Map();
  for (const row of exceptionsResult.data ?? []) {
    if (!exceptionsByDeparture.has(row.timetable_departure_id)) {
      exceptionsByDeparture.set(row.timetable_departure_id, { removedDates: [], addedDates: [] });
    }
    const bucket = exceptionsByDeparture.get(row.timetable_departure_id);
    (row.exception_type === 'removed' ? bucket.removedDates : bucket.addedDates).push(row.exception_date);
  }

  // Rows arrive ordered by sequence: the first per departure is its first
  // stop, the last its last stop (screenPower/screenSchedule.js's window end).
  const firstByDeparture = new Map();
  const lastTimeByDeparture = new Map();
  for (const row of scheduleResult.data) {
    if (!firstByDeparture.has(row.departure_id)) firstByDeparture.set(row.departure_id, row);
    lastTimeByDeparture.set(row.departure_id, row.scheduled_time.substring(0, 5));
  }
  const candidates = departureIds
    .map((id) => firstByDeparture.get(id))
    .filter(Boolean)
    .map((row) => {
      const { removedDates = [], addedDates = [] } = exceptionsByDeparture.get(row.departure_id) ?? {};
      return {
        departureId: row.departure_id,
        serviceCode: row.service_code,
        firstStopLat: row.lat,
        firstStopLon: row.lon,
        departureTime: row.scheduled_time.substring(0, 5),
        lastStopTime: lastTimeByDeparture.get(row.departure_id),
        daysOfWeek: row.days_of_week,
        schoolTermTime: row.school_term_time,
        removedDates,
        addedDates,
      };
    });
  return { candidates, termDateRanges: termDatesResult.data ?? [] };
}

async function fetchDepartureDetails(client, departureId) {
  let data, error;
  try {
    ({ data, error } = await client
      .from('schedule_view')
      .select('service_code, display_name, lat, lon, scheduled_time, stop_type, timetable_stop_id, stop_id, sequence')
      .eq('departure_id', departureId)
      .order('sequence'));
  } catch (err) {
    error = err;
  }
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

const logScreen = (msg) => console.info(`[screen] ${msg}`);

export function startSoloAutopilot(client, initialDeviceRow, { onSchedule, onState, onIdleNextDeparture, onJourneyEnd, onSleep, onGpsSourceChanged }, {
  storage = globalThis.localStorage, screen = createFullyScreen(), log = logScreen,
} = {}) {
  // Live reference, not a frozen snapshot — applyConfigUpdate() below
  // replaces it in place, and tryMatch()/reportNextDeparture() always read
  // whatever it currently points to, so a dashboard edit (testing_mode,
  // terminus_radius_m, match windows) takes effect on the very next
  // idle-poll tick instead of requiring a device reload.
  let deviceRow = initialDeviceRow;
  let candidates = [];
  let termDateRanges = [];
  let activeJourney = null; // { journeyId, startedAt, tracker, allStops }
  // Latest per-stop tracker state for the active journey only -- read once,
  // at completion, to build journey_stop_times rows (see completeActiveJourney).
  // Previously nothing captured this at all: Solo created, started and
  // completed journeys on its own but never wrote a single arrival/lateness
  // record, so every Solo-tracked journey was invisible to the same PSVAIR
  // compliance reporting the Driver PWA's equivalent journeys feed.
  let latestStopStates = [];
  // Starts undetermined (not false!) — applyWakeState()'s transition check
  // is `awake === isAwake`, and false is a real, reachable outcome (asleep
  // outside any window), so starting there would make the very first
  // "we're asleep" determination look like a no-op non-transition and
  // silently never call onSleep at boot. null guarantees the first real
  // determination, whichever way it goes, always fires its callback once.
  let isAwake = null;
  // Screen power: false until departures (live or the offline copy) are in
  // hand — until then the screen stays on. holdUntil covers the terminus
  // hold after a trip (POST_JOURNEY_HOLD_MS).
  let candidatesLoaded = false;
  let holdUntil = 0;
  let holdTimer = null; // ends the terminus hold (completeActiveJourney)
  let terminusRepeatTimer = null; // says the terminus message again during the hold
  const screenPower = createScreenPower({ screen, log });

  const queue = createSoloTripQueue({ client, storage });
  const flushQueue = () => { queue.flush().catch(() => {}); };

  // Stop times of a saved trip that won't be carried on: uploaded, but the
  // journey is not marked complete (same rule as the Driver PWA).
  function queueUnfinishedTrip(checkpoint) {
    if (!checkpoint?.stopRows?.length) return;
    queue.enqueueTrip({ journeyId: checkpoint.journeyId, stopRows: checkpoint.stopRows, completeJourney: false });
  }

  // A trip saved when the power went. Carried on by tryResume() from the
  // idle loop once a usable GPS reading places it on the route; given up
  // (its stops queued) if it passes its 2-hour window first.
  let pendingResume = null;
  {
    const saved = readCheckpoint({ storage, key: SOLO_CHECKPOINT_KEY });
    if (saved.status === 'stale') {
      queueUnfinishedTrip(saved.checkpoint);
      clearCheckpoint({ storage, key: SOLO_CHECKPOINT_KEY });
    } else if (saved.status === 'fresh') {
      pendingResume = saved.checkpoint;
    }
  }

  // One entry per distinct service among this device's candidates, not one
  // merged soonest-overall time — a device commissioned for two real
  // services (or, as here, dozens of same-service test clones) previously
  // showed a single ambiguous time that could belong to either, telling a
  // waiting passenger/driver nothing concrete. Found live 2026-09-06
  // reviewing the idle screen against a device carrying both S116x/S125x
  // candidates. Sorted by service code for a stable on-screen order.
  function reportNextDeparture() {
    if (!candidates.length) {
      onIdleNextDeparture?.(null);
      return;
    }
    const now = new Date();
    const bestByService = new Map();
    for (const candidate of candidates) {
      const msUntil = msUntilNextOccurrence(candidate.departureTime, now);
      const current = bestByService.get(candidate.serviceCode);
      if (!current || msUntil < current.msUntil) {
        bestByService.set(candidate.serviceCode, { serviceCode: candidate.serviceCode, departureTime: candidate.departureTime, msUntil });
      }
    }
    const next = [...bestByService.values()]
      .sort((a, b) => a.serviceCode.localeCompare(b.serviceCode))
      .map(({ serviceCode, departureTime }) => ({ serviceCode, departureTime }));
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
    // The sign is in use — leave the screen alone (signInUse below).
    if (signInUse()) return;
    const awake = isWithinDepartureWakeWindow(
      new Date(), candidates, deviceRow.match_window_before_min, deviceRow.match_window_after_min, termDateRanges
    );
    if (awake === isAwake) return;
    isAwake = awake;
    showIdleForWakeState();
  }

  // Outside the window: the idle screen (branding) with no next-departure
  // line, not a blank screen (owner, 2026-09-29, after the first live run).
  // The screen now follows the tablet's power, so a blank page was a lit
  // white panel that looked broken, and a page can't switch a sleeping
  // screen back on anyway (a wake lock only keeps one on). No departure line
  // because reportNextDeparture() works from time of day only and would
  // promise one on a day with no service. onSleep (blank) is now only for a
  // device the server has revoked (announceDeviceFeed.js).
  function showIdleForWakeState() {
    if (isAwake) reportNextDeparture();
    else onIdleNextDeparture?.(null);
  }

  // True while the sign, not the idle screen, must be showing: a trip under
  // way, a saved trip waiting to be carried on after a power cut, or the
  // terminus hold. Nothing may ask for the idle screen then — it is drawn on
  // top of the sign (onboard.html), so asking covered "This stop is …"
  // mid-trip and the terminus message seconds after the last stop (live
  // Solo test, 2026-10-01). The idle screen catches up when the hold ends.
  function signInUse() {
    return !!activeJourney || !!pendingResume || Date.now() < holdUntil;
  }

  function stopTerminusHold() {
    clearTimeout(holdTimer);
    clearInterval(terminusRepeatTimer);
    holdTimer = null;
    terminusRepeatTimer = null;
  }

  // Everything that must keep the screen on whatever the timetable says:
  // a trip under way (or being set up, or waiting to carry on after a power
  // cut), the terminus hold, a departure's wake window.
  function updateScreen() {
    const now = new Date();
    screenPower.update({
      now,
      dataReady: candidatesLoaded,
      scheduledOn: isScreenScheduledOn(now, candidates, termDateRanges),
      keepOn: !!activeJourney || !!pendingResume || matching || now.getTime() < holdUntil || isAwake === true,
    });
  }

  function useCandidates(result) {
    candidates = result.candidates;
    termDateRanges = result.termDateRanges;
    candidatesLoaded = true;
    applyWakeState(); // first real determination of awake/asleep, now that candidates are actually loaded
    if (isAwake && !signInUse()) reportNextDeparture(); // refreshes the next-departure line; never over the sign
    log(describeScreenDay(new Date(), candidates, termDateRanges));
    updateScreen();
  }

  // One pending retry at most — the hourly re-read must not stack a new
  // retry chain on top of one already waiting for the signal to come back.
  let retryTimer = null;
  function retryRefresh(ms) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(refreshCandidates, ms);
  }

  // Live first. With no signal, the offline copy (if this device has one for
  // the same departures) stands in, and the live read is retried less often.
  async function refreshCandidates() {
    const ids = deviceRow.candidate_departure_ids ?? [];
    const result = await fetchCandidateDepartures(client, ids);
    if (result === null) {
      const copy = candidates.length ? null : loadCandidates(ids, { storage });
      if (copy) useCandidates(copy);
      retryRefresh(candidates.length ? QUEUE_RETRY_MS : BOOT_FETCH_RETRY_MS);
      return;
    }
    clearTimeout(retryTimer);
    saveCandidates(ids, result, { storage });
    useCandidates(result);
    warmDepartureCopies(result.candidates);
  }

  // Keeps every candidate's stops on the tablet so a departure can be
  // started with no signal. Best-effort, one at a time.
  async function warmDepartureCopies(list) {
    for (const candidate of list) await refreshDepartureCopy(candidate.departureId);
  }

  // The saved copy first, so a match starts at once even with no signal
  // (supabase-js retries a failed read for several seconds before giving
  // up); the copy is refreshed from the server in the background, and on
  // every candidate refresh (warmDepartureCopies). No copy yet: live.
  async function refreshDepartureCopy(departureId) {
    const details = await fetchDepartureDetails(client, departureId);
    if (details) saveDepartureDetails(departureId, details, { storage });
    return details;
  }

  async function getDepartureDetails(departureId) {
    const copy = loadDepartureDetails(departureId, { storage });
    if (copy) {
      refreshDepartureCopy(departureId).catch(() => {});
      return copy;
    }
    return refreshDepartureCopy(departureId);
  }

  // Tries to register a new journey with the server; with no signal the
  // start is queued and the journey runs on the tablet-made id meanwhile.
  async function startJourneyOnServer(departureId, journeyId) {
    try {
      const { data: created, error } = await client.rpc('get_or_create_manual_journey', {
        p_timetable_departure_id: departureId,
        p_journey_id: journeyId,
      });
      if (!error) {
        const resolvedId = created?.[0]?.journey_id ?? journeyId;
        const { error: startError } = await client.rpc('start_journey', { p_journey_id: resolvedId });
        if (!startError) return resolvedId;
        queue.enqueueStart({ journeyId: resolvedId, departureId });
        return resolvedId;
      }
    } catch (_) {}
    queue.enqueueStart({ journeyId, departureId });
    return journeyId;
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
    const { journeyId, tracker, recorder, terminus } = activeJourney;
    tracker.stop();
    // Same table/shape/idempotency the Driver PWA's completeTrip() already
    // uses (see shared/journeyStopTimes.js), sent through the upload queue
    // (soloTripQueue.js: record_journey_stop_times, then complete_journey)
    // so a failed send is kept and retried instead of only logged. Includes
    // any stops recorded before a power cut (the recorder's saved rows).
    queue.enqueueTrip({ journeyId, stopRows: recorder.finalRows(latestStopStates), completeJourney: true });
    recorder.clear();
    flushQueue();
    activeJourney = null;
    holdUntil = Date.now() + POST_JOURNEY_HOLD_MS;
    stopTerminusHold();
    // Said again every TERMINUS_REPEAT_MS while the hold lasts — only if the
    // last stop was actually reached (a trip ended by the 2-hour safety net
    // has no terminus message to repeat).
    if (terminus) {
      terminusRepeatTimer = setInterval(() => {
        speakState(terminus.stateKey, terminus.vars, terminus.ids);
      }, TERMINUS_REPEAT_MS);
    }
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
    holdTimer = setTimeout(() => {
      stopTerminusHold();
      if (activeJourney) return;
      onJourneyEnd?.();
      // Recompute fresh rather than trusting isAwake — the device can have
      // left every candidate's wake window during the trip or the hold (a
      // trip longer than the window's 30 minutes after departure always has).
      isAwake = isWithinDepartureWakeWindow(
        new Date(), candidates, deviceRow.match_window_before_min, deviceRow.match_window_after_min, termDateRanges
      );
      showIdleForWakeState();
    }, POST_JOURNEY_HOLD_MS);
  }

  // True while a match is being set up (stops read, journey registered).
  // Without it the next 5 s idle tick could match the same departure again
  // and start a second journey — likely on a slow or missing connection.
  let matching = false;

  async function tryMatch(lat, lon) {
    if (activeJourney || matching || !candidates.length) return;
    matching = true;
    try {
      await matchAndStart(lat, lon);
    } finally {
      matching = false;
    }
  }

  async function matchAndStart(lat, lon) {
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

    const details = await getDepartureDetails(match.departureId);
    if (!details) return; // near-miss costs nothing — stays idle, tries again next tick
    if (shiftMinutes) details.allStops = shiftStopTimes(details.allStops, shiftMinutes);

    const resolvedId = await startJourneyOnServer(match.departureId, crypto.randomUUID());
    beginTracking({
      journeyId: resolvedId,
      departureId: match.departureId,
      serviceCode: details.serviceCode,
      allStops: details.allStops,
      startedAt: new Date(),
      initialStopIndex: 0,
      resumed: false,
    });
  }

  // Carries on a saved trip once one GPS reading places it on the route.
  // A poor or off-route reading just waits for the next idle tick.
  function tryResume(position) {
    if (!pendingResume || activeJourney) return;
    const saved = pendingResume;
    if (readCheckpoint({ storage, key: SOLO_CHECKPOINT_KEY }).status !== 'fresh') {
      pendingResume = null;
      queueUnfinishedTrip(saved);
      clearCheckpoint({ storage, key: SOLO_CHECKPOINT_KEY });
      flushQueue();
      return;
    }
    const { allStops, serviceCode, departureId, startedAt } = saved.launch;
    const stopIndex = pickResumeStop({ allStops, fromIndex: saved.nextStopIndex, position });
    if (stopIndex === null) return;
    pendingResume = null;
    beginTracking({
      journeyId: saved.journeyId,
      departureId,
      serviceCode,
      allStops,
      startedAt: new Date(startedAt),
      initialStopIndex: stopIndex,
      resumed: true,
    });
  }

  // Everything from "the journey is under way" on, shared by a fresh match
  // and a carried-on saved trip. A resumed trip past its first stop opens
  // on "The next stop is X" (shown and said once) instead of Start of Route.
  function beginTracking({ journeyId: resolvedId, departureId, serviceCode, allStops, startedAt, initialStopIndex, resumed }) {
    const details = { serviceCode, allStops };
    // A new trip during the previous one's terminus hold takes the sign over:
    // no more of the old terminus message, and the old hold can't end this
    // trip's sign.
    stopTerminusHold();
    holdUntil = 0;

    // Forwarded to speakState's ids everywhere below, purely so a coverage-
    // gap alert (Phase 3, "never synthesize" -- shared/announcementCoverage.js)
    // stays attributable. vehicleId is normally null here -- a Solo autopilot
    // device (deviceRow.gps_source = 'internal') isn't linked to a vehicle at
    // all, that's what makes it Solo rather than Lite -- deviceId is the one
    // that's always populated for this tier.
    const announceContext = { journeyId: resolvedId, vehicleId: deviceRow.vehicle_id, deviceId: deviceRow.id };

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
    // the atStop edge below. A trip carried on after a power cut, past its
    // first stop, opens on "The next stop is X" instead — the sign and the
    // audio change together (PSV(AI)R), and passengers hear the sign is
    // working again.
    const routeStartVars = { serviceCode: details.serviceCode, destination: stripIndicator(lastStop.name) };
    let lastState;
    if (resumed && initialStopIndex > 0) {
      const nextStop = details.allStops[initialStopIndex];
      const resumeVars = { ...routeStartVars, nextStopName: stripIndicator(nextStop.name) };
      lastState = { stateKey: ANNOUNCE_STATES.STOP_DEPARTURE, vars: resumeVars };
      onState({ type: 'state', ts: Date.now(), journeyId: resolvedId, ...lastState, earlyWait: null });
      speakState(ANNOUNCE_STATES.STOP_DEPARTURE, resumeVars, {
        serviceCode: details.serviceCode, destination: lastStop.name, nextStopId: nextStop.stop_id, ...announceContext,
      });
    } else {
      lastState = { stateKey: ANNOUNCE_STATES.ROUTE_START, vars: routeStartVars };
      onState({ type: 'state', ts: Date.now(), journeyId: resolvedId, stateKey: ANNOUNCE_STATES.ROUTE_START, vars: routeStartVars, earlyWait: null });
      speakState(ANNOUNCE_STATES.ROUTE_START, routeStartVars, { serviceCode: details.serviceCode, destination: lastStop.name, ...announceContext });
    }

    // Saves the trip on the tablet as it runs (see file header). A saved
    // trip for a different journey is being replaced: its stops are queued
    // first.
    const recorder = createCheckpointRecorder({
      journeyId: resolvedId,
      launch: { allStops: details.allStops, serviceCode: details.serviceCode, departureId, startedAt: startedAt.toISOString() },
      storage,
      key: SOLO_CHECKPOINT_KEY,
    });
    if (recorder.previous) {
      queueUnfinishedTrip(recorder.previous);
      flushQueue();
    }
    let lastNextStopIndex = initialStopIndex;
    recorder.record({ stopStates: [], nextStopIndex: initialStopIndex });

    let lastAnnouncedStopIdx = null;
    // Mirrors lastAnnouncedStopIdx for the approaching edge — without this,
    // "This is X." re-fires on every GPS tick for the whole approach window
    // (see shared/geofence.js's isApproaching()) instead of once. Beta-test
    // feedback 2026-09-03; same fix applied to driver/src/main.js's
    // equivalent Lite-tier handling.
    let lastAnnouncedApproachIdx = null;
    const announcedDetourStops = new Set(); // one-shot per stop — see file header

    latestStopStates = []; // fresh per journey -- see completeActiveJourney's use of this
    const tracker = startAnnounceGpsTracking({
      schedule: details.allStops,
      initialStopIndex,
      onUpdate: (state) => {
        latestStopStates = state.stopStates ?? latestStopStates;
        if (Number.isInteger(state.nextStopIndex)) lastNextStopIndex = state.nextStopIndex;
        recorder.record({ stopStates: latestStopStates, nextStopIndex: lastNextStopIndex });
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
          speakState(ANNOUNCE_STATES.DIVERSION, {}, announceContext);
          if (state.atStop) lastAnnouncedStopIdx = state.atStop.stopIndex; // still counts as "arrival announced" for this stop
        } else {
          if (state.approaching) {
            lastState = resolveApproachOrArrivalState({ approaching: state.approaching, atStop: null, allStops: details.allStops });
            if (state.approaching.stopIndex !== lastAnnouncedApproachIdx) {
              lastAnnouncedApproachIdx = state.approaching.stopIndex;
              speakState(lastState.stateKey, lastState.vars, { stopId: details.allStops[state.approaching.stopIndex].stop_id, ...announceContext });
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
              const ids = { stopId: details.allStops[state.atStop.stopIndex].stop_id, ...announceContext };
              speakState(lastState.stateKey, lastState.vars, ids);
              // Repeated during the terminus hold (completeActiveJourney).
              if (activeJourney) activeJourney.terminus = { stateKey: lastState.stateKey, vars: lastState.vars, ids };
            } else {
              const departureVars = {
                serviceCode: details.serviceCode,
                destination: stripIndicator(lastStop.name),
                nextStopName: stripIndicator(details.allStops[state.atStop.stopIndex + 1].name),
              };
              lastState = { stateKey: ANNOUNCE_STATES.STOP_DEPARTURE, vars: departureVars };
              speakState(ANNOUNCE_STATES.STOP_DEPARTURE, departureVars, {
                serviceCode: details.serviceCode, destination: lastStop.name,
                nextStopId: details.allStops[state.atStop.stopIndex + 1].stop_id,
                ...announceContext,
              });
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
    // A carried-on trip is confirmed at the stop the GPS reading put it on
    // (soloResumeStop.js), for the same reason.
    tracker.jumpToStop(initialStopIndex);
    activeJourney = { journeyId: resolvedId, startedAt, tracker, allStops: details.allStops, recorder };
  }

  refreshCandidates();
  const refreshTimer = setInterval(refreshCandidates, CANDIDATE_REFRESH_MS);
  flushQueue();
  const queueTimer = setInterval(() => { if (queue.pending()) flushQueue(); }, QUEUE_RETRY_MS);
  const onOnline = () => flushQueue();
  globalThis.addEventListener?.('online', onOnline);

  const idleTimer = setInterval(() => {
    applyWakeState(); // catches a wake window opening/closing since the last tick — see its own comment
    updateScreen();
    if (activeJourney || !navigator.geolocation) return;
    // A saved trip waiting to be carried on is checked every tick, whatever
    // the wake window says — the trip is already under way.
    if (pendingResume) {
      navigator.geolocation.getCurrentPosition(
        (pos) => tryResume({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        () => tryResume(null), // no fix: still lets an expired saved trip be given up
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
      return;
    }
    if (!isAwake) return;
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
      clearInterval(queueTimer);
      clearInterval(refreshTimer);
      clearTimeout(retryTimer);
      // This loop's sign (a trip, or its terminus hold) is ended here: the
      // idle screen no longer covers it (idleScreen.js), so whatever runs
      // next (a Lite sign after pairing) would otherwise start under it.
      const showingSign = !!activeJourney || holdTimer !== null;
      stopTerminusHold(); // whatever runs next must not be talked over, or have its sign ended, by this loop's hold
      globalThis.removeEventListener?.('online', onOnline);
      activeJourney?.tracker?.stop();
      if (showingSign) onJourneyEnd?.();
      // Whatever runs next (a Lite sign after pairing, a restarted Solo)
      // must not inherit a screen this loop switched off.
      if (screen.available()) screen.turnOn();
    },
    refreshCandidates,
    applyConfigUpdate,
  };
}
