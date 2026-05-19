import { computeTiming } from '../src/engine.js';

const NEXT_STOP = { name: 'High Street', time: '08:00' };
const LATE_ALLOWANCE_MIN = 5;

function makeNow(h, m) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

describe('computeTiming', () => {
  test('on time — ETA matches scheduled time exactly', () => {
    // now=07:50, speed=1 m/s, distance=600m → ETA = 07:50 + 600s = 08:00
    const result = computeTiming({
      now: makeNow(7, 50),
      currentDistanceM: 600,
      speedMps: 1,
      nextStop: NEXT_STOP,
      lateAllowanceMin: LATE_ALLOWANCE_MIN,
    });

    expect(result.status).toBe('on-time');
    expect(result.minutesDifference).toBeCloseTo(0, 1);
    expect(result.nextStopName).toBe('High Street');
  });

  test('late within 5 minutes — ETA is 3 minutes late, still on-time within allowance', () => {
    // now=07:50, speed=1 m/s, distance=780m → ETA = 07:50 + 780s = 08:03 (+3 min)
    const result = computeTiming({
      now: makeNow(7, 50),
      currentDistanceM: 780,
      speedMps: 1,
      nextStop: NEXT_STOP,
      lateAllowanceMin: LATE_ALLOWANCE_MIN,
    });

    expect(result.status).toBe('on-time');
    expect(result.minutesDifference).toBeCloseTo(3, 1);
  });

  test('late beyond 5 minutes — ETA is 7 minutes late', () => {
    // now=07:50, speed=1 m/s, distance=1020m → ETA = 07:50 + 1020s = 08:07 (+7 min)
    const result = computeTiming({
      now: makeNow(7, 50),
      currentDistanceM: 1020,
      speedMps: 1,
      nextStop: NEXT_STOP,
      lateAllowanceMin: LATE_ALLOWANCE_MIN,
    });

    expect(result.status).toBe('late');
    expect(result.minutesDifference).toBeCloseTo(7, 1);
  });

  test('early — ETA is 4 minutes before scheduled', () => {
    // now=07:50, speed=1 m/s, distance=360m → ETA = 07:50 + 360s = 07:56 (−4 min)
    const result = computeTiming({
      now: makeNow(7, 50),
      currentDistanceM: 360,
      speedMps: 1,
      nextStop: NEXT_STOP,
      lateAllowanceMin: LATE_ALLOWANCE_MIN,
    });

    expect(result.status).toBe('early');
    expect(result.minutesDifference).toBeCloseTo(-4, 1);
  });
});
