import { describe, it, expect } from 'vitest';
import { sunTimes } from './sunTimes.js';

// Reference times are HM Nautical Almanac Office / timeanddate.com published
// values for London (51.5074, -0.1278), in UTC. The NOAA approximation used by
// sunTimes() is good to about a minute at UK latitudes; 3 minutes of slack
// keeps the test about the algorithm, not the last decimal.
const LONDON = { lat: 51.5074, lon: -0.1278 };
const TOLERANCE_MS = 3 * 60 * 1000;

function utc(iso) {
  return new Date(iso).getTime();
}

describe('sunTimes', () => {
  it('matches the published London midsummer sunrise and sunset', () => {
    const { sunrise, sunset } = sunTimes(new Date('2026-06-21T12:00:00Z'), LONDON);
    expect(Math.abs(sunrise.getTime() - utc('2026-06-21T03:43:00Z'))).toBeLessThan(TOLERANCE_MS);
    expect(Math.abs(sunset.getTime() - utc('2026-06-21T20:21:00Z'))).toBeLessThan(TOLERANCE_MS);
  });

  it('matches the published London midwinter sunrise and sunset', () => {
    const { sunrise, sunset } = sunTimes(new Date('2026-12-21T12:00:00Z'), LONDON);
    expect(Math.abs(sunrise.getTime() - utc('2026-12-21T08:04:00Z'))).toBeLessThan(TOLERANCE_MS);
    expect(Math.abs(sunset.getTime() - utc('2026-12-21T15:53:00Z'))).toBeLessThan(TOLERANCE_MS);
  });

  it('works on the UTC calendar day of the given instant, whatever its time', () => {
    const early = sunTimes(new Date('2026-06-21T00:05:00Z'), LONDON);
    const late = sunTimes(new Date('2026-06-21T23:55:00Z'), LONDON);
    expect(early.sunrise.getTime()).toBe(late.sunrise.getTime());
    expect(early.sunset.getTime()).toBe(late.sunset.getTime());
  });

  it('reports polar day and polar night instead of inventing times', () => {
    const svalbard = { lat: 78.22, lon: 15.65 };
    expect(sunTimes(new Date('2026-06-21T12:00:00Z'), svalbard)).toEqual({ sunrise: null, sunset: null, polar: 'day' });
    expect(sunTimes(new Date('2026-12-21T12:00:00Z'), svalbard)).toEqual({ sunrise: null, sunset: null, polar: 'night' });
  });
});
