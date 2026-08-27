/**
 * BusOps Announce Lite — standalone schedule-autopilot idle-loop matcher.
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

/**
 * Completion for a standalone (driverless) journey: no driver to notice a
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
