import { haversine } from './geo.js';
import { computeTiming } from './engine.js';
import { log } from './logger.js';

export function startGpsTracking({ schedule, lateAllowanceMin = 2, initialStopIndex = 0, onUpdate, onGpsFix }) {
  if (!navigator.geolocation) {
    log('error', 'Geolocation API not available');
    return { stop: () => {}, jumpToStop: () => {} };
  }

  let nextStopIndex = initialStopIndex;
  const arrivals = new Array(schedule.length).fill(null);
  let gpsLostAt = null;
  let fixCount = 0;
  let atStop = null; // { stopIndex } while vehicle is within the stop geo-fence
  let lastGpsUploadMs = 0; // throttle GPS fix uploads to every 30 s

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

  // Derive earlyWait from atStop state on every fix.
  // Shows the banner whenever the vehicle is dwelling at a stop before its scheduled time.
  function computeEarlyWait(now) {
    if (atStop === null) return null;
    const stop = schedule[atStop.stopIndex];
    if (!stop) return null;
    const [h, m] = stop.time.split(':').map(Number);
    const scheduledDepart = new Date(now);
    scheduledDepart.setHours(h, m, 0, 0);
    if (now >= scheduledDepart) return null;
    return { stopIndex: atStop.stopIndex, scheduledTime: scheduledDepart, stopName: stop.name };
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

      if (fixCount % 5 === 1) {
        log('gps', `Fix #${fixCount} — ${latitude.toFixed(5)}, ${longitude.toFixed(5)} — ${(speedMps * 3.6).toFixed(1)} km/h`);
      }

      let distanceToNextM = haversine(latitude, longitude, schedule[nextStopIndex].lat, schedule[nextStopIndex].lon);

      if (atStop !== null) {
        // Dwelling at a stop — wait for the vehicle to exit the geo-fence (75 m hysteresis)
        if (distanceToNextM > 75) {
          log('depart', `Departed: ${schedule[atStop.stopIndex].name}`);
          nextStopIndex++;
          atStop = null;
          distanceToNextM = haversine(latitude, longitude, schedule[nextStopIndex].lat, schedule[nextStopIndex].lon);
        }
      } else if (distanceToNextM < 50 && nextStopIndex < schedule.length - 1) {
        // Entering geo-fence — record arrival, enter dwell mode
        const arrivalTime = new Date();
        arrivals[nextStopIndex] = arrivalTime;
        log('arrive', `Arrived: ${schedule[nextStopIndex].name} (${distanceToNextM.toFixed(0)} m)`);
        atStop = { stopIndex: nextStopIndex };

        // Log early arrival once on entry
        const [h, m] = schedule[nextStopIndex].time.split(':').map(Number);
        const scheduledDepart = new Date(arrivalTime);
        scheduledDepart.setHours(h, m, 0, 0);
        if (arrivalTime < scheduledDepart) {
          const minEarly = Math.round((scheduledDepart - arrivalTime) / 60000);
          log('info', `Running ${minEarly} min early — wait until ${scheduledDepart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        }
      }

      // Throttled GPS fix upload — fire-and-forget every 30 s
      const nowMs = now.getTime();
      if (onGpsFix && nowMs - lastGpsUploadMs >= 30000) {
        lastGpsUploadMs = nowMs;
        onGpsFix({
          lat: latitude,
          lon: longitude,
          speed: speedMps,
          accuracy: position.coords.accuracy ?? null,
          ts: now.toISOString(),
        });
      }

      const earlyWait = computeEarlyWait(now);

      const timing = computeTiming({
        now,
        currentDistanceM: distanceToNextM,
        speedMps,
        nextStop: schedule[nextStopIndex],
        lateAllowanceMin,
      });

      onUpdate({ timing, nextStopIndex, speedMps, distanceToNextM, arrivals, earlyWait, atStop, lat: latitude, lon: longitude });
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
      atStop = null;
      log('info', `Jumped to: ${schedule[idx].name}`);
      nextStopIndex = idx;
    },
  };
}
