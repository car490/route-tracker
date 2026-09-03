import { findForwardMatch, isApproaching, GEOFENCE_RADIUS_M, APPROACH_ETA_SECONDS, APPROACH_FALLBACK_RADIUS_M } from '../shared/geofence.js';

// Stops spaced ~200m apart along latitude (0.0018 deg ≈ 200m) so each is
// unambiguously inside/outside the 50m geofence from any other stop's coords.
const LAT0 = 52.9;
const LON0 = -0.05;
const STEP = 0.0018;

function stop(i, stop_type = 'timing_point') {
  return { name: `Stop ${i}`, lat: LAT0 + i * STEP, lon: LON0, time: '08:00', stop_type };
}

const schedule = [
  stop(0), stop(1), stop(2), stop(3), stop(4), stop(5), stop(6),
];

describe('findForwardMatch', () => {
  test('no forward stop within radius — resets pendingMatch', () => {
    // Vehicle far from every stop
    const result = findForwardMatch({
      schedule,
      nextStopIndex: 1,
      lat: LAT0 + 50 * STEP,
      lon: LON0,
      pendingMatch: null,
    });

    expect(result.matchedIndex).toBeNull();
    expect(result.status).toBeNull();
    expect(result.pendingMatch).toBeNull();
  });

  test('single matching ping — returns pending confirmation, does not jump yet', () => {
    const result = findForwardMatch({
      schedule,
      nextStopIndex: 1,
      lat: stop(3).lat,
      lon: stop(3).lon,
      pendingMatch: null,
    });

    expect(result.matchedIndex).toBeNull();
    expect(result.pendingMatch).toEqual({ index: 3, count: 1 });
  });

  test('second consecutive matching ping on same index confirms the jump', () => {
    const first = findForwardMatch({
      schedule,
      nextStopIndex: 1,
      lat: stop(3).lat,
      lon: stop(3).lon,
      pendingMatch: null,
    });
    const second = findForwardMatch({
      schedule,
      nextStopIndex: 1,
      lat: stop(3).lat,
      lon: stop(3).lon,
      pendingMatch: first.pendingMatch,
    });

    expect(second.matchedIndex).toBe(3);
    expect(second.pendingMatch).toBeNull();
  });

  test('a ping matching a different forward index resets the count instead of accumulating', () => {
    const first = findForwardMatch({
      schedule,
      nextStopIndex: 1,
      lat: stop(3).lat,
      lon: stop(3).lon,
      pendingMatch: null,
    });
    // Second ping matches stop 4 instead of stop 3 — should reset to count 1 on index 4
    const second = findForwardMatch({
      schedule,
      nextStopIndex: 1,
      lat: stop(4).lat,
      lon: stop(4).lon,
      pendingMatch: first.pendingMatch,
    });

    expect(second.matchedIndex).toBeNull();
    expect(second.pendingMatch).toEqual({ index: 4, count: 1 });
  });

  test('skipping exactly 1 timing_point classifies as skipped_signal', () => {
    // nextStopIndex=1, matched stop=3 → stops 1,2 are bypassed; both timing_point
    // would be 2 skipped, so make stop 2 a routing_point to leave exactly 1 timing_point skipped (stop 1)
    const mixedSchedule = [
      stop(0), stop(1, 'timing_point'), stop(2, 'routing_point'), stop(3), stop(4),
    ];
    const first = findForwardMatch({
      schedule: mixedSchedule, nextStopIndex: 1, lat: stop(3).lat, lon: stop(3).lon, pendingMatch: null,
    });
    const result = findForwardMatch({
      schedule: mixedSchedule, nextStopIndex: 1, lat: stop(3).lat, lon: stop(3).lon, pendingMatch: first.pendingMatch,
    });

    expect(result.matchedIndex).toBe(3);
    expect(result.status).toBe('skipped_signal');
  });

  test('skipping 2 timing_points classifies as skipped_detour', () => {
    const mixedSchedule = [
      stop(0), stop(1, 'timing_point'), stop(2, 'timing_point'), stop(3), stop(4),
    ];
    const first = findForwardMatch({
      schedule: mixedSchedule, nextStopIndex: 1, lat: stop(3).lat, lon: stop(3).lon, pendingMatch: null,
    });
    const result = findForwardMatch({
      schedule: mixedSchedule, nextStopIndex: 1, lat: stop(3).lat, lon: stop(3).lon, pendingMatch: first.pendingMatch,
    });

    expect(result.matchedIndex).toBe(3);
    expect(result.status).toBe('skipped_detour');
  });

  test('intervening routing_point stops do not count toward the gap', () => {
    // Between nextStopIndex=1 and matched=4, stops 2 and 3 are routing_point —
    // only stop 1 itself (timing_point) is skipped, so this should stay skipped_signal
    // even though the raw index gap is 3.
    const mixedSchedule = [
      stop(0), stop(1, 'timing_point'), stop(2, 'routing_point'), stop(3, 'routing_point'), stop(4, 'timing_point'),
    ];
    const first = findForwardMatch({
      schedule: mixedSchedule, nextStopIndex: 1, lat: stop(4).lat, lon: stop(4).lon, pendingMatch: null,
    });
    const result = findForwardMatch({
      schedule: mixedSchedule, nextStopIndex: 1, lat: stop(4).lat, lon: stop(4).lon, pendingMatch: first.pendingMatch,
    });

    expect(result.matchedIndex).toBe(4);
    expect(result.status).toBe('skipped_signal');
  });
});

describe('isApproaching', () => {
  test('inside the arrival geofence is not "approaching" — it should already be "arrived"', () => {
    expect(isApproaching({ distanceM: GEOFENCE_RADIUS_M - 1, speedMps: 10 })).toBe(false);
  });

  test('moving with an ETA inside the window counts as approaching', () => {
    // 200 m at 10 m/s = 20 s ETA, well inside APPROACH_ETA_SECONDS
    expect(isApproaching({ distanceM: 200, speedMps: 10 })).toBe(true);
  });

  test('moving but too far away for the ETA window is not approaching', () => {
    const distanceM = APPROACH_ETA_SECONDS * 10 + 500; // ETA far beyond the window at 10 m/s
    expect(isApproaching({ distanceM, speedMps: 10 })).toBe(false);
  });

  test('stationary/noisy speed falls back to the distance band', () => {
    expect(isApproaching({ distanceM: APPROACH_FALLBACK_RADIUS_M - 1, speedMps: 0 })).toBe(true);
    expect(isApproaching({ distanceM: APPROACH_FALLBACK_RADIUS_M + 1, speedMps: 0 })).toBe(false);
  });

  test('moving fast enough, ETA governs even beyond the fallback distance band', () => {
    // 1000 m at 50 m/s = 20 s ETA — inside the ETA window despite being well outside the fallback radius
    expect(isApproaching({ distanceM: 1000, speedMps: 50 })).toBe(true);
  });
});
