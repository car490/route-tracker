/**
 * BusOps Announce (Lite/Solo) — internal-mode GPS tracking.
 *
 * Thin Announce-side wrapper around the shared GPS/geofence/engine tracking
 * state machine (moved to ../../shared/ for this reason — see
 * docs/ANNOUNCE-PRODUCT-TIERS.md's Lite/Solo tiers). An Announce tablet
 * running in `internal` gps_source mode (Solo, or a not-yet-linked Lite
 * device) has no Driver device to push it state, so it runs the same
 * tracking loop the Driver PWA uses, driven by its own on-device GPS
 * (shared/gps.js's default browser positionSource).
 */
import { startGpsTracking } from '../../shared/gps.js';

export function startAnnounceGpsTracking({ schedule, lateAllowanceMin, initialStopIndex, onUpdate, onGpsFix }) {
  return startGpsTracking({ schedule, lateAllowanceMin, initialStopIndex, onUpdate, onGpsFix });
}
