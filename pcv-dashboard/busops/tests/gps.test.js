import { startGpsTracking } from '../shared/gps.js';

// Stops spaced ~200m apart along latitude (0.0018 deg ≈ 200m), same
// convention as geofence.test.js, so each is unambiguously inside/outside
// the 50m geofence from any other stop's coords.
const LAT0 = 52.9;
const LON0 = -0.05;
const STEP = 0.0018;

function stop(i) {
  return { name: `Stop ${i}`, lat: LAT0 + i * STEP, lon: LON0, time: '08:00', stop_type: 'timing_point' };
}

const schedule = [stop(0), stop(1), stop(2), stop(3), stop(4)];

// Fake positionSource: captures the onFix callback so tests can drive fixes
// manually instead of depending on navigator.geolocation.
function makePositionSource() {
  let onFixCb = null;
  return {
    source: (onFix) => {
      onFixCb = onFix;
      return { stop: jest.fn() };
    },
    fix: ({ lat = LAT0, lon = LON0, speed = 0, accuracy = 5 } = {}) => {
      onFixCb({ coords: { latitude: lat, longitude: lon, speed, accuracy } });
    },
  };
}

function startTracker({ initialStopIndex = 0 } = {}) {
  const { source, fix } = makePositionSource();
  const onUpdate = jest.fn();
  const onGpsFix = jest.fn();
  const tracker = startGpsTracking({
    schedule,
    initialStopIndex,
    onUpdate,
    onGpsFix,
    positionSource: source,
  });
  return { tracker, fix, onUpdate, onGpsFix };
}

describe('startGpsTracking — pre-start gate (Bug 1)', () => {
  test('a later stop within geofence range before the first real arrival is never treated as arrived/skipped', () => {
    const { fix, onUpdate, onGpsFix } = startTracker({ initialStopIndex: 0 });

    // Driving toward the real start point, but passes within 50m of stop 3
    // (two consecutive pings — the confirmation threshold forward-match
    // would normally require once tracking has started).
    fix({ lat: stop(3).lat, lon: stop(3).lon });
    fix({ lat: stop(3).lat, lon: stop(3).lon });

    const lastCall = onUpdate.mock.calls.at(-1)[0];
    expect(lastCall.nextStopIndex).toBe(0);
    expect(lastCall.stopStates[3].status).not.toBe('arrived');
    expect(lastCall.stopStates[3].status).not.toBe('skipped_signal');
    expect(lastCall.stopStates[3].status).not.toBe('skipped_detour');
    expect(onGpsFix).not.toHaveBeenCalled();
  });

  test('normal forward-match/skip resumes once the vehicle has actually arrived at the start stop', () => {
    const { fix, onUpdate, onGpsFix } = startTracker({ initialStopIndex: 0 });

    // Real arrival at the start stop.
    fix({ lat: stop(0).lat, lon: stop(0).lon });
    expect(onUpdate.mock.calls.at(-1)[0].atStop).toEqual({ stopIndex: 0 });
    expect(onGpsFix).toHaveBeenCalledTimes(1);

    // Now a detour/skip ahead to stop 3 should behave normally: the first
    // fix that far away exits stop 0's dwell (departure, nextStopIndex->1),
    // then the next two consecutive pings at stop 3's coords confirm the
    // forward-match jump.
    fix({ lat: stop(3).lat, lon: stop(3).lon });
    fix({ lat: stop(3).lat, lon: stop(3).lon });
    fix({ lat: stop(3).lat, lon: stop(3).lon });

    const lastCall = onUpdate.mock.calls.at(-1)[0];
    expect(lastCall.nextStopIndex).toBe(3);
    expect(lastCall.stopStates[3].status).toBe('arrived');
  });

  test('jumpToStop counts as confirming the vehicle has genuinely started', () => {
    const { tracker, fix, onUpdate } = startTracker({ initialStopIndex: 0 });

    tracker.jumpToStop(2);

    // A later stop within range, without ever entering stop 2's own geofence —
    // forward-match should now be live because of the manual jump.
    fix({ lat: stop(4).lat, lon: stop(4).lon });
    fix({ lat: stop(4).lat, lon: stop(4).lon });

    const lastCall = onUpdate.mock.calls.at(-1)[0];
    expect(lastCall.nextStopIndex).toBe(4);
    expect(lastCall.stopStates[4].status).toBe('arrived');
  });
});

describe('startGpsTracking — departure edge (Bug 2)', () => {
  test('departedStopIndex is null while dwelling and on every other tick', () => {
    const { fix, onUpdate } = startTracker({ initialStopIndex: 0 });

    fix({ lat: stop(0).lat, lon: stop(0).lon }); // arrival
    expect(onUpdate.mock.calls.at(-1)[0].departedStopIndex).toBeNull();

    fix({ lat: stop(0).lat, lon: stop(0).lon }); // still dwelling
    expect(onUpdate.mock.calls.at(-1)[0].departedStopIndex).toBeNull();
  });

  test('departedStopIndex fires exactly on the 75m-exit tick, and nextStopIndex/timing already reflect the new stop', () => {
    const { fix, onUpdate } = startTracker({ initialStopIndex: 0 });

    fix({ lat: stop(0).lat, lon: stop(0).lon }); // arrival, dwelling begins

    // ~100m from stop 0 (>75m exit threshold), still ~100m short of stop 1 —
    // exits the dwell without accidentally arriving at stop 1 in the same tick.
    const exitLat = LAT0 + 0.5 * STEP;
    fix({ lat: exitLat, lon: LON0 });

    const departureCall = onUpdate.mock.calls.at(-1)[0];
    expect(departureCall.departedStopIndex).toBe(0);
    expect(departureCall.nextStopIndex).toBe(1);
    expect(departureCall.timing.scheduledTime).toBeInstanceOf(Date);
    expect(departureCall.stopStates[0].status).toBe('departed');

    // Next tick — departedStopIndex resets to null.
    fix({ lat: exitLat, lon: LON0 });
    expect(onUpdate.mock.calls.at(-1)[0].departedStopIndex).toBeNull();
  });

  test('departing from the final stop does not throw', () => {
    const lastIndex = schedule.length - 1;
    const { fix, onUpdate } = startTracker({ initialStopIndex: lastIndex });

    fix({ lat: stop(lastIndex).lat, lon: stop(lastIndex).lon }); // arrival at final stop

    const exitLat = stop(lastIndex).lat + 0.5 * STEP;
    expect(() => fix({ lat: exitLat, lon: LON0 })).not.toThrow();

    const departureCall = onUpdate.mock.calls.at(-1)[0];
    expect(departureCall.departedStopIndex).toBe(lastIndex);
    expect(departureCall.nextStopIndex).toBe(schedule.length);
    expect(departureCall.timing).toBeNull();

    // A further fix after running off the end of the schedule must not throw,
    // and (per the early-return guard) shouldn't produce another onUpdate call.
    const callsBefore = onUpdate.mock.calls.length;
    expect(() => fix({ lat: exitLat, lon: LON0 })).not.toThrow();
    expect(onUpdate.mock.calls.length).toBe(callsBefore);
  });
});
