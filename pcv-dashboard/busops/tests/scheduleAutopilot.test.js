// tests/scheduleAutopilot.test.js
//
// BusOps Announce Lite — standalone schedule-autopilot idle-loop matcher.
// Same idiom as geofence.test.js/engine.test.js: pure function import,
// synthetic fixtures, no mocking. See docs/ANNOUNCE-PRODUCT-TIERS.md's
// "Schedule-autopilot" section (Phil Haines Travel case) for the design
// this implements: geofence AND time window must both match, and when more
// than one candidate matches (e.g. a shared-terminus outbound/return pair),
// the nearest scheduled departure time wins.

import { findScheduleMatch, isJourneyComplete } from '../announce/src/scheduleAutopilot.js';

// Bus depot terminus — both an outbound and a return service happen to
// start/end here, per the shared-terminus test below.
const DEPOT = { lat: 52.9, lon: -0.6 };
// Far enough away to sit outside a 150m geofence of DEPOT (~0.002 deg is
// ~200m+ at this latitude, matching geofence.test.js's own spacing comment).
const AWAY = { lat: 52.9025, lon: -0.6 };

function candidate(departureId, { lat, lon, departureTime }) {
  return { departureId, firstStopLat: lat, firstStopLon: lon, departureTime };
}

function at(hh, mm) {
  const d = new Date(2026, 7, 27, hh, mm, 0, 0);
  return d;
}

const DEFAULT_PARAMS = { terminusRadiusM: 150, matchWindowBeforeMin: 15, matchWindowAfterMin: 30 };

describe('findScheduleMatch', () => {
  it('matches a single candidate within both the geofence and the time window', () => {
    const candidates = [candidate('dep-1', { ...DEPOT, departureTime: '08:00' })];
    const result = findScheduleMatch({
      candidates, lat: DEPOT.lat, lon: DEPOT.lon, now: at(8, 5), ...DEFAULT_PARAMS,
    });
    expect(result).toEqual(candidates[0]);
  });

  it('does not match when outside the geofence, even if the time window is right', () => {
    const candidates = [candidate('dep-1', { ...DEPOT, departureTime: '08:00' })];
    const result = findScheduleMatch({
      candidates, lat: AWAY.lat, lon: AWAY.lon, now: at(8, 5), ...DEFAULT_PARAMS,
    });
    expect(result).toBeNull();
  });

  it('does not match when inside the geofence but outside the time window', () => {
    const candidates = [candidate('dep-1', { ...DEPOT, departureTime: '08:00' })];
    const result = findScheduleMatch({
      candidates, lat: DEPOT.lat, lon: DEPOT.lon, now: at(9, 0), ...DEFAULT_PARAMS,
    });
    expect(result).toBeNull();
  });

  it('respects the before/after window asymmetry (15 before, 30 after)', () => {
    const candidates = [candidate('dep-1', { ...DEPOT, departureTime: '08:00' })];
    // 16 minutes early — outside the 15-minute "before" allowance.
    expect(findScheduleMatch({
      candidates, lat: DEPOT.lat, lon: DEPOT.lon, now: at(7, 44), ...DEFAULT_PARAMS,
    })).toBeNull();
    // 29 minutes late — inside the 30-minute "after" allowance.
    expect(findScheduleMatch({
      candidates, lat: DEPOT.lat, lon: DEPOT.lon, now: at(8, 29), ...DEFAULT_PARAMS,
    })).toEqual(candidates[0]);
  });

  it('returns null when there are no candidates at all', () => {
    const result = findScheduleMatch({
      candidates: [], lat: DEPOT.lat, lon: DEPOT.lon, now: at(8, 0), ...DEFAULT_PARAMS,
    });
    expect(result).toBeNull();
  });

  it('tie-break: when two unrelated candidates both match, the nearest scheduled time wins', () => {
    const near = candidate('dep-near', { ...DEPOT, departureTime: '08:00' }); // 5 min away
    const far  = candidate('dep-far',  { ...DEPOT, departureTime: '08:20' }); // 15 min away
    const result = findScheduleMatch({
      candidates: [far, near], lat: DEPOT.lat, lon: DEPOT.lon, now: at(8, 5), ...DEFAULT_PARAMS,
    });
    expect(result).toEqual(near);
  });

  it('shared-terminus: outbound and return sharing the same stop are disambiguated by time alone', () => {
    // Same physical terminus (geofence can't distinguish them) — only the
    // scheduled time tells the outbound service (just left, still in
    // window) apart from the return service (due back later).
    const outbound = candidate('dep-outbound', { ...DEPOT, departureTime: '08:00' });
    const ret       = candidate('dep-return',   { ...DEPOT, departureTime: '08:25' });
    const result = findScheduleMatch({
      candidates: [outbound, ret], lat: DEPOT.lat, lon: DEPOT.lon, now: at(8, 3), ...DEFAULT_PARAMS,
    });
    expect(result).toEqual(outbound);
  });
});

describe('isJourneyComplete', () => {
  const STARTED_AT = at(8, 0);

  it('is complete once the vehicle is confirmed at the final stop', () => {
    const result = isJourneyComplete({
      atStop: { stopIndex: 4 }, allStopsLength: 5, startedAt: STARTED_AT, now: at(8, 30), timeoutMin: 120,
    });
    expect(result).toBe(true);
  });

  it('is not complete while dwelling at a non-final stop', () => {
    const result = isJourneyComplete({
      atStop: { stopIndex: 2 }, allStopsLength: 5, startedAt: STARTED_AT, now: at(8, 30), timeoutMin: 120,
    });
    expect(result).toBe(false);
  });

  it('is not complete mid-route with no atStop and well within the timeout', () => {
    const result = isJourneyComplete({
      atStop: null, allStopsLength: 5, startedAt: STARTED_AT, now: at(8, 30), timeoutMin: 120,
    });
    expect(result).toBe(false);
  });

  it('completes via the wall-clock timeout safety net when GPS never confirms final-stop arrival', () => {
    const result = isJourneyComplete({
      atStop: null, allStopsLength: 5, startedAt: STARTED_AT, now: at(10, 1), timeoutMin: 120,
    });
    expect(result).toBe(true);
  });
});
