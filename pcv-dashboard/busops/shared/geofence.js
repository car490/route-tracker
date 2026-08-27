/**
 * Pure forward-searching geofence matcher — no side effects, no I/O.
 *
 * Used when the vehicle misses the immediate next stop's geofence (e.g. a
 * road closure detour). Searches forward only (never back) through the
 * remaining stops for a match, and requires the same stop to match on two
 * consecutive calls before confirming a jump, to avoid false positives from
 * parallel/nearby roads.
 */
import { haversine } from './geo.js';

export const GEOFENCE_RADIUS_M = 50; // matches the existing arrival threshold in gps.js

// Skip severity is classified by how many *timing_point* stops were bypassed —
// routing_point stops are map-shaping only and don't count. Starting point;
// tune against real timing-point spacing on live routes.
export const SKIPPED_SIGNAL_MAX_TIMING_POINTS = 1;

// "Approaching" thresholds — projected by current speed, falling back to a
// wider distance band when speed is too low/noisy to project a reliable ETA
// (e.g. stationary in traffic, or a jumpy GPS fix).
export const APPROACH_ETA_SECONDS = 90;
export const APPROACH_FALLBACK_RADIUS_M = 300;
export const APPROACH_MIN_SPEED_MPS = 1;

/**
 * @param {Object} params
 * @param {number} params.distanceM - metres to the stop's geofence centre
 * @param {number} params.speedMps
 * @returns {boolean}
 */
export function isApproaching({ distanceM, speedMps }) {
  if (distanceM <= GEOFENCE_RADIUS_M) return false; // already inside the arrival geofence

  if (speedMps >= APPROACH_MIN_SPEED_MPS) {
    return distanceM / speedMps <= APPROACH_ETA_SECONDS;
  }
  return distanceM <= APPROACH_FALLBACK_RADIUS_M;
}

/**
 * @param {Object} params
 * @param {Array}  params.schedule - full stop list (lat, lon, stop_type)
 * @param {number} params.nextStopIndex - index of the stop that was NOT matched this tick
 * @param {number} params.lat
 * @param {number} params.lon
 * @param {{index: number, count: number}|null} params.pendingMatch - carried across calls
 * @returns {{matchedIndex: number|null, status: string|null, pendingMatch: {index: number, count: number}|null}}
 */
export function findForwardMatch({ schedule, nextStopIndex, lat, lon, pendingMatch }) {
  for (let i = nextStopIndex + 1; i < schedule.length; i++) {
    const distance = haversine(lat, lon, schedule[i].lat, schedule[i].lon);
    if (distance < GEOFENCE_RADIUS_M) {
      const count = pendingMatch && pendingMatch.index === i ? pendingMatch.count + 1 : 1;

      if (count >= 2) {
        const skippedTimingPoints = schedule
          .slice(nextStopIndex, i)
          .filter((s) => s.stop_type === 'timing_point').length;
        const status =
          skippedTimingPoints <= SKIPPED_SIGNAL_MAX_TIMING_POINTS ? 'skipped_signal' : 'skipped_detour';
        return { matchedIndex: i, status, pendingMatch: null };
      }

      return { matchedIndex: null, status: null, pendingMatch: { index: i, count } };
    }
  }

  return { matchedIndex: null, status: null, pendingMatch: null };
}
