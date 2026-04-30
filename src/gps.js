import { haversine } from './geo.js';
import { computeTiming } from './engine.js';

/**
 * Starts GPS tracking and calls onUpdate on each position fix.
 *
 * @param {Object} params
 * @param {Array}  params.schedule        - ordered array of stop objects
 * @param {number} [params.lateAllowanceMin=2]
 * @param {Function} params.onUpdate      - called with timing data on each fix
 * @returns {{ stop: Function }}
 */
export function startGpsTracking({ schedule, lateAllowanceMin = 2, onUpdate }) {
  if (!navigator.geolocation) {
    console.error('Geolocation API not available');
    return { stop: () => {} };
  }

  let nextStopIndex = 0;
  const arrivals = new Array(schedule.length).fill(null);
  let gpsLostAt = null;

  // When GPS is restored after a meaningful outage, advance past any stops
  // whose scheduled time is more than 5 minutes in the past, marking them missed.
  function recoverFromGpsLoss(now) {
    let resumeIdx = nextStopIndex;
    for (let i = nextStopIndex; i < schedule.length; i++) {
      const [h, m] = schedule[i].time.split(':').map(Number);
      const scheduled = new Date(now);
      scheduled.setHours(h, m, 0, 0);
      if ((now - scheduled) / 60000 < 5) {
        resumeIdx = i;
        break;
      }
      resumeIdx = i + 1;
    }
    resumeIdx = Math.min(resumeIdx, schedule.length - 1);
    for (let i = nextStopIndex; i < resumeIdx; i++) {
      arrivals[i] = 'missed';
    }
    nextStopIndex = resumeIdx;
  }

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      const rawSpeed = position.coords.speed ?? 0;
      const speedMps = rawSpeed > 1 ? rawSpeed : 0;

      if (nextStopIndex >= schedule.length) return;

      const now = new Date();

      if (gpsLostAt !== null) {
        const lostForMs = now.getTime() - gpsLostAt;
        if (lostForMs > 30000) {
          recoverFromGpsLoss(now);
        }
        gpsLostAt = null;
      }

      let distanceToNextM = haversine(
        latitude,
        longitude,
        schedule[nextStopIndex].lat,
        schedule[nextStopIndex].lon
      );

      if (distanceToNextM < 30 && nextStopIndex < schedule.length - 1) {
        arrivals[nextStopIndex] = new Date();
        nextStopIndex++;
        distanceToNextM = haversine(
          latitude,
          longitude,
          schedule[nextStopIndex].lat,
          schedule[nextStopIndex].lon
        );
      }

      const timing = computeTiming({
        now,
        currentDistanceM: distanceToNextM,
        speedMps,
        nextStop: schedule[nextStopIndex],
        lateAllowanceMin,
      });

      onUpdate({ timing, nextStopIndex, speedMps, distanceToNextM, arrivals, lat: latitude, lon: longitude });
    },
    (err) => {
      if (gpsLostAt === null) gpsLostAt = Date.now();
      console.error('GPS error:', err.message);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );

  return { stop: () => navigator.geolocation.clearWatch(watchId) };
}
