// tests/scheduleAutopilot.test.js
//
// BusOps Announce Solo — schedule-autopilot idle-loop matcher.
// Same idiom as geofence.test.js/engine.test.js: pure function import,
// synthetic fixtures, no mocking. See docs/ANNOUNCE-PRODUCT-TIERS.md's
// "Schedule-autopilot" section (Phil Haines Travel case) for the design
// this implements: geofence AND time window must both match, and when more
// than one candidate matches (e.g. a shared-terminus outbound/return pair),
// the nearest scheduled departure time wins.

import {
  findScheduleMatch, findTestingScheduleMatch, isJourneyComplete, isWithinDepartureWakeWindow,
  describeConfigUpdate,
} from '../announce/src/scheduleAutopilot.js';

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

describe('findTestingScheduleMatch', () => {
  it('does not match within the normal-ish window — well under the 60min threshold', () => {
    const candidates = [candidate('dep-1', { ...DEPOT, departureTime: '08:00' })];
    const result = findTestingScheduleMatch({
      candidates, lat: DEPOT.lat, lon: DEPOT.lon, now: at(8, 45), terminusRadiusM: 150,
    });
    expect(result).toBeNull();
  });

  it('matches when at least 60 minutes from the scheduled time, and returns the shift', () => {
    const candidates = [candidate('dep-1', { ...DEPOT, departureTime: '08:00' })];
    const result = findTestingScheduleMatch({
      candidates, lat: DEPOT.lat, lon: DEPOT.lon, now: at(14, 0), terminusRadiusM: 150,
    });
    expect(result).toEqual({ candidate: candidates[0], shiftMinutes: 360 });
  });

  it('still requires the geofence — time alone is not enough', () => {
    const candidates = [candidate('dep-1', { ...DEPOT, departureTime: '08:00' })];
    const result = findTestingScheduleMatch({
      candidates, lat: AWAY.lat, lon: AWAY.lon, now: at(14, 0), terminusRadiusM: 150,
    });
    expect(result).toBeNull();
  });

  it('tie-break: nearest scheduled time wins among candidates past the threshold', () => {
    const near = candidate('dep-near', { ...DEPOT, departureTime: '08:00' }); // 6h away
    const far  = candidate('dep-far',  { ...DEPOT, departureTime: '06:00' }); // 8h away
    const result = findTestingScheduleMatch({
      candidates: [far, near], lat: DEPOT.lat, lon: DEPOT.lon, now: at(14, 0), terminusRadiusM: 150,
    });
    expect(result).toEqual({ candidate: near, shiftMinutes: 360 });
  });
});

describe('describeConfigUpdate', () => {
  // A live Solo device (announceSoloAutopilot.js) keeps
  // tryMatch() reading testing_mode/terminus_radius_m/match-window fields
  // straight off its current deviceRow reference, so replacing that
  // reference is enough for those to take effect on the very next idle-poll
  // tick — no extra signal needed. candidate_departure_ids is the one field
  // that requires an actual network re-fetch (schedule_view lookup), so
  // that's the one change this function needs to flag explicitly.
  const BASE = {
    testing_mode: false,
    terminus_radius_m: 150,
    match_window_before_min: 15,
    match_window_after_min: 30,
    candidate_departure_ids: ['dep-1', 'dep-2'],
    gps_source: 'internal',
  };

  it('flags no changes when the row is identical', () => {
    expect(describeConfigUpdate(BASE, { ...BASE })).toEqual({
      candidatesChanged: false,
      gpsSourceChanged: false,
    });
  });

  it('flags candidatesChanged when candidate_departure_ids differs', () => {
    const next = { ...BASE, candidate_departure_ids: ['dep-1', 'dep-3'] };
    expect(describeConfigUpdate(BASE, next)).toEqual({
      candidatesChanged: true,
      gpsSourceChanged: false,
    });
  });

  it('does not flag candidatesChanged for testing_mode/match-window-only edits', () => {
    // These take effect just by tryMatch() reading the replaced deviceRow
    // reference — no re-fetch needed, so this must stay false.
    const next = { ...BASE, testing_mode: true, terminus_radius_m: 200, match_window_after_min: 45 };
    expect(describeConfigUpdate(BASE, next).candidatesChanged).toBe(false);
  });

  it('flags gpsSourceChanged when a device is linked/unlinked mid-session', () => {
    const next = { ...BASE, gps_source: 'driver-device' };
    expect(describeConfigUpdate(BASE, next)).toEqual({
      candidatesChanged: false,
      gpsSourceChanged: true,
    });
  });

  it('treats a null previous row as no prior candidates, so an empty next list is not a change', () => {
    expect(describeConfigUpdate(null, { ...BASE, candidate_departure_ids: [] }).candidatesChanged).toBe(false);
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

describe('isWithinDepartureWakeWindow', () => {
  // 2026-08-24 is a Monday (ISO day-of-week 1, matching
  // timetable_departures.days_of_week/extract(isodow from ...) elsewhere in
  // this schema); 2026-08-25 is a Tuesday (ISO 2).
  const MONDAY_MORNING = (hh, mm) => new Date(2026, 7, 24, hh, mm, 0, 0);
  const TUESDAY_MORNING = (hh, mm) => new Date(2026, 7, 25, hh, mm, 0, 0);
  const WEEKDAYS = [1, 2, 3, 4, 5];

  function dep(departureTime, daysOfWeek = WEEKDAYS) {
    return { departureTime, daysOfWeek };
  }

  it('never wakes when no candidates are configured at all', () => {
    expect(isWithinDepartureWakeWindow(MONDAY_MORNING(8, 0), [], 10, 30)).toBe(false);
    expect(isWithinDepartureWakeWindow(MONDAY_MORNING(8, 0), null, 10, 30)).toBe(false);
  });

  it('is awake inside the window around a candidate departure on a day it runs', () => {
    const candidates = [dep('08:00')];
    expect(isWithinDepartureWakeWindow(MONDAY_MORNING(7, 50), candidates, 10, 30)).toBe(true); // 10 min before
    expect(isWithinDepartureWakeWindow(MONDAY_MORNING(8, 30), candidates, 10, 30)).toBe(true); // 30 min after
  });

  it('is dormant outside the before/after window, even on a day the candidate runs', () => {
    const candidates = [dep('08:00')];
    expect(isWithinDepartureWakeWindow(MONDAY_MORNING(7, 49), candidates, 10, 30)).toBe(false); // 11 min before
    expect(isWithinDepartureWakeWindow(MONDAY_MORNING(8, 31), candidates, 10, 30)).toBe(false); // 31 min after
  });

  it('is dormant on a day the candidate does not run, even at the right time', () => {
    const candidates = [dep('08:00', [6, 7])]; // Saturday/Sunday only
    expect(isWithinDepartureWakeWindow(MONDAY_MORNING(8, 0), candidates, 10, 30)).toBe(false);
  });

  it('is awake if ANY candidate is within its own window, even when others are not', () => {
    const morning = dep('08:00');
    const afternoon = dep('15:30');
    expect(isWithinDepartureWakeWindow(MONDAY_MORNING(8, 0), [morning, afternoon], 10, 30)).toBe(true);
    expect(isWithinDepartureWakeWindow(TUESDAY_MORNING(12, 0), [morning, afternoon], 10, 30)).toBe(false); // dead gap between runs
  });

  // 2026-08-24 (the MONDAY_MORNING fixture date) falls inside this range;
  // 2026-08-25 (TUESDAY_MORNING) does not.
  const IN_TERM_RANGE = [{ start_date: '2026-08-24', end_date: '2026-08-24' }];

  it('a school_term_time candidate is dormant on a weekday outside every term_dates range', () => {
    const candidates = [{ ...dep('08:00'), schoolTermTime: true }];
    expect(isWithinDepartureWakeWindow(MONDAY_MORNING(8, 0), candidates, 10, 30, IN_TERM_RANGE)).toBe(true);
    expect(isWithinDepartureWakeWindow(TUESDAY_MORNING(8, 0), candidates, 10, 30, IN_TERM_RANGE)).toBe(false);
  });

  it('a school_term_time candidate with no term_dates ranges at all never wakes', () => {
    const candidates = [{ ...dep('08:00'), schoolTermTime: true }];
    expect(isWithinDepartureWakeWindow(MONDAY_MORNING(8, 0), candidates, 10, 30)).toBe(false);
  });

  it('a removed exception on today overrides an otherwise-running day (INSET day)', () => {
    const candidates = [{ ...dep('08:00'), schoolTermTime: true, removedDates: ['2026-08-24'] }];
    expect(isWithinDepartureWakeWindow(MONDAY_MORNING(8, 0), candidates, 10, 30, IN_TERM_RANGE)).toBe(false);
  });

  it('an added exception on today wakes the device even outside days_of_week/term_dates', () => {
    const candidates = [{ departureTime: '08:00', daysOfWeek: [6, 7], addedDates: ['2026-08-24'] }]; // weekend-only pattern, plus a one-off Monday
    expect(isWithinDepartureWakeWindow(MONDAY_MORNING(8, 0), candidates, 10, 30)).toBe(true);
  });

  it('a non-school_term_time candidate ignores term_dates entirely, even if today is outside every range', () => {
    const candidates = [dep('08:00')];
    expect(isWithinDepartureWakeWindow(MONDAY_MORNING(8, 0), candidates, 10, 30, [])).toBe(true);
  });
});
