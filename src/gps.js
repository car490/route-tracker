import { haversine } from './geo.js';
import { computeTiming } from './engine.js';
import { log } from './logger.js';

export function startGpsTracking({ schedule, lateAllowanceMin = 2, initialStopIndex = 0, onUpdate }) {
  if (!navigator.geolocation) {
    log('error', 'Geolocation API not available');
    return { stop: () => {}, jumpToStop: () => {} };
  }

  let nextStopIndex = initialStopIndex;
  const arrivals = new Array(schedule.length).fill(null);
  let gpsLostAt = null;
  let fixCount = 0;
  let earlyWait = null; // { stopIndex, scheduledTime, stopName }

  for (let i = 0; i < initialStopIndex; i++) {
    arrivals[i] = 'missed';
  }

  if (initialStopIndex > 0) {
    log('info', `Starting from stop ${initialStopIndex}: ${schedule[initialStopIndex].name}`);
  }

  function recoverFromGpsLoss(now) {
    const lostForSec = Math.round((now - gpsLostAt) / 1000);
    let resumeIdx = nextStopIndex;
    for (let i = nextStopIndex; i < schedule.length; i++) {
      const [h, m] = schedule[i].time.split(':').map(Number);
      const scheduled = new Date(now);
      scheduled.setHours(h, m, 0, 0);
      if ((now - scheduled) / 60000 < 5) { resumeIdx = i; break; }
      resumeIdx = i + 1;
    }
    resumeIdx = Math.min(resumeIdx, schedule.length - 1);
    const missedCount = resumeIdx - nextStopIndex;
    for (let i = nextStopIndex; i < resumeIdx; i++) arrivals[i] = 'missed';
    if (missedCount > 0) {
      log('miss', `GPS back after ${lostForSec}s — ${missedCount} stop(s) missed`);
    } else {
      log('gps', `GPS recovered after ${lostForSec}s`);
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
      fixCount++;

      if (gpsLostAt !== null) {
        const lostForMs = now.getTime() - gpsLostAt;
        if (lostForMs > 30000) {
          recoverFromGpsLoss(now);
        } else {
          log('gps', `GPS glitch cleared (${Math.round(lostForMs / 1000)}s)`);
        }
        gpsLostAt = null;
      }

      if (earlyWait !== null && now >= earlyWait.scheduledTime) {
        arrivals[earlyWait.stopIndex] = earlyWait.scheduledTime;
        log('info', `Departed on time: ${earlyWait.stopName}`);
        earlyWait = null;
      }

      if (fixCount % 5 === 1) {
        log('gps', `Fix #${fixCount} — ${latitude.toFixed(5)}, ${longitude.toFixed(5)} — ${(speedMps * 3.6).toFixed(1)} km/h`);
      }

      let distanceToNextM = haversine(latitude, longitude, schedule[nextStopIndex].lat, schedule[nextStopIndex].lon);

      if (distanceToNextM < 50 && nextStopIndex < schedule.length - 1) {
        const arrivalTime = new Date();
        earlyWait = null;

        const [h, m] = schedule[nextStopIndex].time.split(':').map(Number);
        const scheduledTime = new Date(arrivalTime);
        scheduledTime.setHours(h, m, 0, 0);

        arrivals[nextStopIndex] = arrivalTime;
        log('arrive', `Arrived: ${schedule[nextStopIndex].name} (${distanceToNextM.toFixed(0)} m)`);

        if ((arrivalTime - scheduledTime) / 60000 < -lateAllowanceMin) {
          earlyWait = { stopIndex: nextStopIndex, scheduledTime, stopName: schedule[nextStopIndex].name };
        }

        nextStopIndex++;
        distanceToNextM = haversine(latitude, longitude, schedule[nextStopIndex].lat, schedule[nextStopIndex].lon);
      }

      const timing = computeTiming({
        now,
        currentDistanceM: distanceToNextM,
        speedMps,
        nextStop: schedule[nextStopIndex],
        lateAllowanceMin,
      });

      onUpdate({ timing, nextStopIndex, speedMps, distanceToNextM, arrivals, earlyWait, lat: latitude, lon: longitude });
    },
    (err) => {
      if (gpsLostAt === null) {
        gpsLostAt = Date.now();
        log('error', `GPS lost: ${err.message}`);
      }
      console.error('GPS error:', err.message);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );

  return {
    stop: () => navigator.geolocation.clearWatch(watchId),
    jumpToStop: (idx) => {
      if (idx < 0 || idx >= schedule.length) return;
      earlyWait = null;
      log('info', `Jumped to: ${schedule[idx].name}`);
      nextStopIndex = idx;
    },
  };
}
