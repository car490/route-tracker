import { haversine } from './geo.js';
import { computeTiming } from './engine.js';
import { findForwardMatch, isApproaching, GEOFENCE_RADIUS_M } from './geofence.js';
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

// PSVAIR "approaching" announcement lead distance — fixed radius rather than
// a speed-based ETA, same reasoning as the 50m/75m arrival hysteresis below:
// simple and consistent regardless of how fast the vehicle is going.
const APPROACHING_RADIUS_M = 250;

export function startGpsTracking({ schedule, lateAllowanceMin = 2, initialStopIndex = 0, onUpdate, onGpsFix, positionSource = browserGeolocationSource }) {
  let nextStopIndex = initialStopIndex;
  // Single source of truth for per-stop geofence state — one status per stop:
  // 'not_tracked' (before the driver's start point — never uploaded),
  // 'upcoming', 'approaching', 'arrived', 'departed', 'skipped_signal', 'skipped_detour'.
  const stopStates = schedule.map(() => ({ status: 'upcoming', arrivedAt: null, departedAt: null }));
  let gpsLostAt = null;
  let fixCount = 0;
  let approachAnnouncedIdx = null; // last stopIndex the 250m approach radius has already fired for — one-shot per stop, drives the PSVAIR approach announcement only (separate from stopStates' persistent 'approaching' status below)
  let pendingMatch = null; // { index, count } — forward geofence match awaiting a second confirming ping
  let lastGpsUploadMs = 0; // throttle GPS fix uploads to every 30 s

  for (let i = 0; i < initialStopIndex; i++) {
    stopStates[i].status = 'not_tracked';
  }

  if (initialStopIndex > 0) {
    log('info', `Starting from stop ${initialStopIndex}: ${schedule[initialStopIndex].name}`);
  }

  // Derive earlyWait from the dwelling stop on every fix.
  // Shows the banner whenever the vehicle is dwelling at a stop before its scheduled time.
  function computeEarlyWait(now, dwellIndex) {
    if (dwellIndex === null) return null;
    const stop = schedule[dwellIndex];
    if (!stop) return null;
    const [h, m] = stop.time.split(':').map(Number);
    const scheduledDepart = new Date(now);
    scheduledDepart.setHours(h, m, 0, 0);
    if (now >= scheduledDepart) return null;
    return { stopIndex: dwellIndex, scheduledTime: scheduledDepart, stopName: stop.name };
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
      const dwelling = stopStates[nextStopIndex].status === 'arrived';

      // Fires once per stop, the first fix that crosses the approach radius
      // while still moving toward it (not yet arrived) — kept separate from
      // the dwelling/off-route branch below since it's a one-shot distance
      // signal for the PSVAIR announcement, not the persistent 'approaching'
      // status tracked in stopStates further down.
      let approaching = null;
      if (!dwelling && nextStopIndex < schedule.length - 1
          && distanceToNextM <= APPROACHING_RADIUS_M
          && approachAnnouncedIdx !== nextStopIndex) {
        approachAnnouncedIdx = nextStopIndex;
        approaching = { stopIndex: nextStopIndex };
      }

      if (dwelling) {
        // Dwelling at a stop — wait for the vehicle to exit the geo-fence (75 m hysteresis)
        if (distanceToNextM > 75) {
          log('depart', `Departed: ${schedule[nextStopIndex].name}`);
          stopStates[nextStopIndex].status = 'departed';
          stopStates[nextStopIndex].departedAt = now;
          nextStopIndex++;
          distanceToNextM = haversine(latitude, longitude, schedule[nextStopIndex].lat, schedule[nextStopIndex].lon);
        }
      } else if (distanceToNextM < GEOFENCE_RADIUS_M) {
        // Entering geo-fence — record arrival, enter dwell mode. Includes
        // the final stop: there's no depot padding to exclude any more, so
        // every schedule index (0..length-1) is a real, arrivable stop.
        const arrivalTime = new Date();
        stopStates[nextStopIndex].status = 'arrived';
        stopStates[nextStopIndex].arrivedAt = arrivalTime;
        log('arrive', `Arrived: ${schedule[nextStopIndex].name} (${distanceToNextM.toFixed(0)} m)`);
        pendingMatch = null;

        // Log early arrival once on entry
        const [h, m] = schedule[nextStopIndex].time.split(':').map(Number);
        const scheduledDepart = new Date(arrivalTime);
        scheduledDepart.setHours(h, m, 0, 0);
        if (arrivalTime < scheduledDepart) {
          const minEarly = Math.round((scheduledDepart - arrivalTime) / 60000);
          log('info', `Running ${minEarly} min early — wait until ${scheduledDepart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        }
      } else {
        // Off-route: normal next-stop geofence missed — search forward for a later
        // stop the vehicle has actually reached (road closure / detour / GPS gap).
        // A no-op if nextStopIndex is already the last stop (nothing further
        // to search forward into).
        const match = findForwardMatch({ schedule, nextStopIndex, lat: latitude, lon: longitude, pendingMatch });
        pendingMatch = match.pendingMatch;

        if (match.matchedIndex !== null) {
          for (let k = nextStopIndex; k < match.matchedIndex; k++) {
            stopStates[k].status = match.status;
          }
          log('miss', `${match.status}: rejoined at ${schedule[match.matchedIndex].name} (skipped stop ${nextStopIndex}-${match.matchedIndex - 1})`);
          nextStopIndex = match.matchedIndex;

          const arrivalTime = new Date();
          stopStates[nextStopIndex].status = 'arrived';
          stopStates[nextStopIndex].arrivedAt = arrivalTime;
          log('arrive', `Arrived: ${schedule[nextStopIndex].name} (rejoin)`);
          distanceToNextM = haversine(latitude, longitude, schedule[nextStopIndex].lat, schedule[nextStopIndex].lon);
        } else {
          // Not close enough to arrive, and no forward match — track the
          // approach so the UI can show "approaching" ahead of "arrived".
          stopStates[nextStopIndex].status = isApproaching({ distanceM: distanceToNextM, speedMps }) ? 'approaching' : 'upcoming';
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

      const dwellIndex = stopStates[nextStopIndex].status === 'arrived' ? nextStopIndex : null;
      const atStop = dwellIndex !== null ? { stopIndex: dwellIndex } : null;
      const earlyWait = computeEarlyWait(now, dwellIndex);

      const timing = computeTiming({
        now,
        currentDistanceM: distanceToNextM,
        speedMps,
        nextStop: schedule[nextStopIndex],
        lateAllowanceMin,
      });

      onUpdate({ timing, nextStopIndex, speedMps, distanceToNextM, stopStates, earlyWait, atStop, approaching, lat: latitude, lon: longitude });
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
      approachAnnouncedIdx = null;
      pendingMatch = null;
      log('info', `Jumped to: ${schedule[idx].name}`);
      nextStopIndex = idx;
    },
  };
}
