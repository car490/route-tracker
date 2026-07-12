import { haversine } from './geo.js';
import { computeTiming } from './engine.js';
import { findForwardMatch } from './geofence.js';
import { log } from './logger.js';

// Default position source: the browser's own GPS via the Geolocation API.
// A caller can pass a different `positionSource` (same (onFix, onError) =>
// {stop()} shape) to feed fixes from elsewhere — e.g. onboard.js polling a
// Raspberry Pi's local GPS bridge instead of navigator.geolocation.
function browserGeolocationSource(onFix, onError) {
  if (!navigator.geolocation) {
    onError(new Error('Geolocation API not available'));
    return { stop: () => {} };
  }
  const watchId = navigator.geolocation.watchPosition(
    onFix,
    onError,
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
  return { stop: () => navigator.geolocation.clearWatch(watchId) };
}

export function startGpsTracking({ schedule, lateAllowanceMin = 2, initialStopIndex = 0, onUpdate, onGpsFix, positionSource = browserGeolocationSource }) {
  let nextStopIndex = initialStopIndex;
  const arrivals = new Array(schedule.length).fill(null);
  let gpsLostAt = null;
  let fixCount = 0;
  let atStop = null; // { stopIndex } while vehicle is within the stop geo-fence
  let pendingMatch = null; // { index, count } — forward geofence match awaiting a second confirming ping
  let lastGpsUploadMs = 0; // throttle GPS fix uploads to every 30 s

  for (let i = 0; i < initialStopIndex; i++) {
    arrivals[i] = 'missed';
  }

  if (initialStopIndex > 0) {
    log('info', `Starting from stop ${initialStopIndex}: ${schedule[initialStopIndex].name}`);
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

  const source = positionSource(
    (position) => {
      const { latitude, longitude } = position.coords;
      const rawSpeed = position.coords.speed ?? 0;
      const speedMps = rawSpeed > 1 ? rawSpeed : 0;

      if (nextStopIndex >= schedule.length) return;

      const now = new Date();
      fixCount++;

      if (gpsLostAt !== null) {
        log('gps', `GPS recovered after ${Math.round((now.getTime() - gpsLostAt) / 1000)}s`);
        gpsLostAt = null;
      }

      if (fixCount % 5 === 1) {
        log('gps', `Fix #${fixCount} — ${latitude.toFixed(5)}, ${longitude.toFixed(5)} — ${(speedMps * 2.236936).toFixed(1)} mph`);
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
        pendingMatch = null;

        // Log early arrival once on entry
        const [h, m] = schedule[nextStopIndex].time.split(':').map(Number);
        const scheduledDepart = new Date(arrivalTime);
        scheduledDepart.setHours(h, m, 0, 0);
        if (arrivalTime < scheduledDepart) {
          const minEarly = Math.round((scheduledDepart - arrivalTime) / 60000);
          log('info', `Running ${minEarly} min early — wait until ${scheduledDepart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        }
      } else if (nextStopIndex < schedule.length - 1) {
        // Off-route: normal next-stop geofence missed — search forward for a later
        // stop the vehicle has actually reached (road closure / detour / GPS gap).
        const match = findForwardMatch({ schedule, nextStopIndex, lat: latitude, lon: longitude, pendingMatch });
        pendingMatch = match.pendingMatch;

        if (match.matchedIndex !== null) {
          for (let k = nextStopIndex; k < match.matchedIndex; k++) {
            arrivals[k] = { status: match.status };
          }
          log('miss', `${match.status}: rejoined at ${schedule[match.matchedIndex].name} (skipped stop ${nextStopIndex}-${match.matchedIndex - 1})`);
          nextStopIndex = match.matchedIndex;

          const arrivalTime = new Date();
          arrivals[nextStopIndex] = arrivalTime;
          log('arrive', `Arrived: ${schedule[nextStopIndex].name} (rejoin)`);
          atStop = { stopIndex: nextStopIndex };
          distanceToNextM = haversine(latitude, longitude, schedule[nextStopIndex].lat, schedule[nextStopIndex].lon);
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
    }
  );

  return {
    stop: () => source.stop(),
    jumpToStop: (idx) => {
      if (idx < 0 || idx >= schedule.length) return;
      atStop = null;
      pendingMatch = null;
      log('info', `Jumped to: ${schedule[idx].name}`);
      nextStopIndex = idx;
    },
  };
}
