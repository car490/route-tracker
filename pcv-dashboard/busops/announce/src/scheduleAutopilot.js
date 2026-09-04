/**
 * BusOps Announce Solo — schedule-autopilot idle-loop matcher.
 * Pure — no side effects, no I/O, no Supabase/GPS access of its own — same
 * treatment as shared/geofence.js/engine.js. See docs/ANNOUNCE-PRODUCT-TIERS.md's
 * "Schedule-autopilot" section (built for Phil Haines Travel's two-route
 * case, where no route shares a start/end point with any other service —
 * that non-overlap is what makes this lightweight approach safe).
 */
import { haversine } from '../../shared/geo.js';

function minutesFromScheduled(departureTime, now) {
  const [h, m] = departureTime.split(':').map(Number);
  const scheduled = new Date(now);
  scheduled.setHours(h, m, 0, 0);
  return (now.getTime() - scheduled.getTime()) / 60000; // positive = now is after scheduled
}

/**
 * Both signals must match together — geofence alone can't disambiguate a
 * shared terminus (outbound/return of the same route both starting/ending
 * at the same stop), so when more than one candidate is within both the
 * geofence and its time window, the one closest to its own scheduled time
 * wins.
 *
 * @param {Object} params
 * @param {Array<{departureId: string, firstStopLat: number, firstStopLon: number, departureTime: string}>} params.candidates
 * @param {number} params.lat
 * @param {number} params.lon
 * @param {Date} params.now
 * @param {number} params.terminusRadiusM
 * @param {number} params.matchWindowBeforeMin
 * @param {number} params.matchWindowAfterMin
 * @returns {{departureId: string, firstStopLat: number, firstStopLon: number, departureTime: string}|null}
 */
export function findScheduleMatch({
  candidates, lat, lon, now,
  terminusRadiusM, matchWindowBeforeMin, matchWindowAfterMin,
}) {
  let best = null;
  let bestAbsDiffMin = Infinity;

  for (const candidate of candidates) {
    const distanceM = haversine(lat, lon, candidate.firstStopLat, candidate.firstStopLon);
    if (distanceM > terminusRadiusM) continue;

    const diffMin = minutesFromScheduled(candidate.departureTime, now);
    if (diffMin < -matchWindowBeforeMin || diffMin > matchWindowAfterMin) continue;

    const absDiffMin = Math.abs(diffMin);
    if (absDiffMin < bestAbsDiffMin) {
      best = candidate;
      bestAbsDiffMin = absDiffMin;
    }
  }

  return best;
}

// How far outside the normal match_window_before_min/match_window_after_min
// a candidate's scheduled time must be before the testing-only fallback
// below will consider it — keeps this well clear of the normal window
// (15/30 min defaults) so it only fires for a deliberately time-shifted
// test run, never as a second chance for a near-miss on a live device.
export const TESTING_TIME_SHIFT_THRESHOLD_MIN = 60;

/**
 * Testing-only fallback match, tried only when the device's testing_mode
 * flag is on and findScheduleMatch above found nothing. Drops the time
 * window entirely (geofence alone decides candidacy) but only considers a
 * candidate whose scheduled time is at least TESTING_TIME_SHIFT_THRESHOLD_MIN
 * minutes from now — mirrors the driver PWA's ?debug "use current time"
 * testing toggle (main.js / shared/scheduleTimeShift.js's shiftStopTimes),
 * but automatic since a driverless device has no one to tick a checkbox.
 * Same nearest-scheduled-time tie-break as findScheduleMatch.
 *
 * @param {Object} params
 * @param {Array<{departureId: string, firstStopLat: number, firstStopLon: number, departureTime: string}>} params.candidates
 * @param {number} params.lat
 * @param {number} params.lon
 * @param {Date} params.now
 * @param {number} params.terminusRadiusM
 * @returns {{candidate: Object, shiftMinutes: number}|null} shiftMinutes is
 *   how many minutes to slide the matched schedule by (now − scheduled) —
 *   pass straight to shiftStopTimes(stops, shiftMinutes).
 */
export function findTestingScheduleMatch({ candidates, lat, lon, now, terminusRadiusM }) {
  let best = null;
  let bestDiffMin = 0;
  let bestAbsDiffMin = Infinity;

  for (const candidate of candidates) {
    const distanceM = haversine(lat, lon, candidate.firstStopLat, candidate.firstStopLon);
    if (distanceM > terminusRadiusM) continue;

    const diffMin = minutesFromScheduled(candidate.departureTime, now);
    const absDiffMin = Math.abs(diffMin);
    if (absDiffMin < TESTING_TIME_SHIFT_THRESHOLD_MIN) continue;

    if (absDiffMin < bestAbsDiffMin) {
      best = candidate;
      bestDiffMin = diffMin;
      bestAbsDiffMin = absDiffMin;
    }
  }

  return best ? { candidate: best, shiftMinutes: bestDiffMin } : null;
}

/**
 * Decides what a live config-row update should trigger for a running
 * Solo device (announceSoloAutopilot.js). testing_mode, terminus_radius_m,
 * and the match-window fields all take effect simply by the caller
 * replacing its deviceRow reference — tryMatch() reads them fresh every
 * idle-poll tick, no extra signal needed. candidate_departure_ids is the
 * one field that needs an explicit flag, since honoring it requires an
 * actual network re-fetch (schedule_view lookup via refreshCandidates()).
 * gps_source is flagged separately so a device linked/unlinked mid-session
 * (the "hot-switch" announceDeviceFeed.js's own header previously
 * disclaimed) can tear down one mode and start the other.
 *
 * @param {Object|null} prevRow
 * @param {Object} nextRow
 * @returns {{candidatesChanged: boolean, gpsSourceChanged: boolean}}
 */
export function describeConfigUpdate(prevRow, nextRow) {
  const prevCandidates = prevRow?.candidate_departure_ids ?? [];
  const nextCandidates = nextRow?.candidate_departure_ids ?? [];
  return {
    candidatesChanged: JSON.stringify(prevCandidates) !== JSON.stringify(nextCandidates),
    gpsSourceChanged: (prevRow?.gps_source ?? null) !== (nextRow?.gps_source ?? null),
  };
}

/**
 * Completion for a Solo (driverless) journey: no driver to notice a
 * journey stuck in_progress, so final-stop geofence arrival is backed by a
 * wall-clock timeout safety net. Mirrors main.js's own final-stop check
 * (`atStop.stopIndex === allStops.length - 1`) — deliberately not
 * onboard.js's render()-only `isFinal` (index-overflow, idle-display text
 * only, a different semantic).
 *
 * @param {Object} params
 * @param {{stopIndex: number}|null} params.atStop
 * @param {number} params.allStopsLength
 * @param {Date} params.startedAt
 * @param {Date} params.now
 * @param {number} params.timeoutMin
 * @returns {boolean}
 */
export function isJourneyComplete({ atStop, allStopsLength, startedAt, now, timeoutMin }) {
  if (atStop && atStop.stopIndex === allStopsLength - 1) return true;
  const elapsedMin = (now.getTime() - startedAt.getTime()) / 60000;
  return elapsedMin >= timeoutMin;
}

/**
 * Whether "now" falls inside the wake window around any candidate's own
 * scheduled departure — a Solo device only wakes (GPS polling, and the
 * screen itself — see announceSoloAutopilot.js's isAwake) within
 * [scheduled_time - beforeMin, scheduled_time + afterMin] of a departure
 * it's actually commissioned for, on a day that departure actually runs
 * (candidate.daysOfWeek — ISO day-of-week, 1=Mon..7=Sun, matching
 * timetable_departures.days_of_week/`extract(isodow from ...)` elsewhere in
 * this schema — NOT the same 0-indexed convention as the old
 * announce_device_active_windows.day_of_week column).
 *
 * Replaces that admin-configured announce_device_active_windows table
 * entirely (dropped 2026-09-04) — it hand-duplicated day/time data that
 * already lives on the timetable itself; see
 * docs/ANNOUNCE-PRODUCT-TIERS.md for the writeup. Reuses the exact same
 * before/after minute window as findScheduleMatch's own match-validity
 * check (matchWindowBeforeMin/matchWindowAfterMin) — one meaning for "how
 * close to departure do we care", not a second, near-duplicate check that
 * could quietly drift out of sync with it.
 *
 * Known edge case, not handled: a departure scheduled within beforeMin
 * minutes of midnight could have its own wake window start on the previous
 * calendar day, whose ISO day-of-week this check would then reject. Not a
 * real scenario for any currently commissioned route (all run well clear of
 * midnight) — flagged rather than engineered around.
 *
 * No candidates configured at all means the device never wakes — same
 * conservative default a freshly registered device already gets from an
 * empty candidate_departure_ids list: it stays inert until someone
 * deliberately commissions it.
 *
 * @param {Date} now
 * @param {Array<{departureTime: string, daysOfWeek: number[]}>} candidates
 * @param {number} beforeMin
 * @param {number} afterMin
 * @returns {boolean}
 */
export function isWithinDepartureWakeWindow(now, candidates, beforeMin, afterMin) {
  if (!candidates?.length) return false;
  const isoDow = now.getDay() === 0 ? 7 : now.getDay(); // JS Date: 0=Sun..6=Sat -> ISO dow: 1=Mon..7=Sun
  return candidates.some((candidate) => {
    if (!candidate.daysOfWeek?.includes(isoDow)) return false;
    const diffMin = minutesFromScheduled(candidate.departureTime, now);
    return diffMin >= -beforeMin && diffMin <= afterMin;
  });
}
