// src/soloResumeStop.js
//
// BusOps Announce Solo — which stop a resumed trip should aim for after a
// power cut. The Driver PWA asks the driver to confirm the stop
// (driver/src/main.js's resumeSavedTrip); Solo has no driver, so it takes one
// GPS reading and works out which stretch of the remaining route it is on
// (owner-approved, 2026-09-28):
//   - standing at a stop still to come (within the 50 m arrival ring) → that stop
//   - otherwise the nearest stretch between two stops still to come → its far end
//   - never a stop before the one the saved trip was heading for
//   - no guess (null) if the reading's accuracy is worse than 100 m, it has
//     no accuracy figure, or it is more than 500 m from the rest of the route
// A null means "try again with the next reading", never "carry on anyway":
// announcing the wrong stop to passengers is worse than a few seconds' wait.
// Pure, no imports beyond the shared geofence radius.

import { GEOFENCE_RADIUS_M } from '../../shared/geofence.js';

export const MAX_ACCURACY_M = 100;
export const MAX_OFF_ROUTE_M = 500;

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_AT_EQUATOR = 111320;

// Flat local projection around the reading — accurate to well under a metre
// over the few kilometres between two bus stops.
function toLocal(point, origin) {
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  return {
    x: (point.lon - origin.lon) * M_PER_DEG_LON_AT_EQUATOR * cosLat,
    y: (point.lat - origin.lat) * M_PER_DEG_LAT,
  };
}

function distanceToSegmentM(p, a, b) {
  const A = toLocal(a, p);
  const B = toLocal(b, p);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, -(A.x * dx + A.y * dy) / lenSq));
  return Math.hypot(A.x + t * dx, A.y + t * dy);
}

function distanceM(p, a) {
  const A = toLocal(a, p);
  return Math.hypot(A.x, A.y);
}

export function pickResumeStop({ allStops, fromIndex, position }) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lon)) return null;
  if (!Number.isFinite(position.accuracy) || position.accuracy > MAX_ACCURACY_M) return null;
  if (!allStops?.length) return null;

  const last = allStops.length - 1;
  const start = Math.min(Math.max(Number.isInteger(fromIndex) ? fromIndex : 0, 0), last);

  for (let i = start; i <= last; i++) {
    if (distanceM(position, allStops[i]) <= GEOFENCE_RADIUS_M) return i;
  }

  let best = null;
  if (start === 0) best = { stopIndex: 0, distance: distanceM(position, allStops[0]) };
  for (let i = Math.max(start, 1); i <= last; i++) {
    const distance = distanceToSegmentM(position, allStops[i - 1], allStops[i]);
    if (!best || distance < best.distance) best = { stopIndex: i, distance };
  }
  return best && best.distance <= MAX_OFF_ROUTE_M ? best.stopIndex : null;
}
