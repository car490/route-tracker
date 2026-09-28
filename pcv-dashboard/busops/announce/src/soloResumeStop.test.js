// src/soloResumeStop.test.js
//
// Announce Solo has no driver to confirm where a resumed trip is. After a
// power cut it takes one GPS reading and works out which stretch of the
// route it is on, aiming for the next stop — or refuses to guess when the
// reading is poor or off the route (owner-approved rules, 2026-09-28).

import { describe, it, expect } from 'vitest';
import { pickResumeStop, MAX_ACCURACY_M, MAX_OFF_ROUTE_M } from './soloResumeStop.js';

// A straight north-south road, stops ~1.1 km apart (0.01° latitude).
const STOPS = [
  { name: 'A', lat: 52.90, lon: -0.10 },
  { name: 'B', lat: 52.91, lon: -0.10 },
  { name: 'C', lat: 52.92, lon: -0.10 },
  { name: 'D', lat: 52.93, lon: -0.10 },
];
const at = (lat, lon = -0.10, accuracy = 10) => ({ lat, lon, accuracy });

describe('pickResumeStop', () => {
  it('aims for the next stop when between two stops', () => {
    expect(pickResumeStop({ allStops: STOPS, fromIndex: 1, position: at(52.915) })).toBe(2);
  });

  it('counts a stop the vehicle is standing at as the one to aim for', () => {
    expect(pickResumeStop({ allStops: STOPS, fromIndex: 1, position: at(52.92) })).toBe(2);
  });

  it('never goes back before the stop the saved trip was heading for', () => {
    // GPS jitter reads ~55 m short of B, but the trip had already passed B.
    expect(pickResumeStop({ allStops: STOPS, fromIndex: 2, position: at(52.9095) })).toBe(2);
  });

  it('moves on past stops the vehicle went by while the power was off', () => {
    expect(pickResumeStop({ allStops: STOPS, fromIndex: 1, position: at(52.925) })).toBe(3);
  });

  it('handles a trip saved before it left the first stop', () => {
    expect(pickResumeStop({ allStops: STOPS, fromIndex: 0, position: at(52.9001) })).toBe(0);
    expect(pickResumeStop({ allStops: STOPS, fromIndex: 0, position: at(52.905) })).toBe(1);
  });

  it('tolerates a vehicle slightly off the line between stops (roads bend)', () => {
    // ~340 m east of the line, between B and C.
    expect(pickResumeStop({ allStops: STOPS, fromIndex: 1, position: at(52.915, -0.095) })).toBe(2);
  });

  it(`refuses to guess when the reading is worse than ${MAX_ACCURACY_M} m`, () => {
    expect(pickResumeStop({ allStops: STOPS, fromIndex: 1, position: at(52.915, -0.10, MAX_ACCURACY_M + 1) })).toBeNull();
  });

  it(`refuses to guess more than ${MAX_OFF_ROUTE_M} m from the rest of the route`, () => {
    // ~680 m east of the line.
    expect(pickResumeStop({ allStops: STOPS, fromIndex: 1, position: at(52.915, -0.09) })).toBeNull();
  });

  it('refuses to guess with no usable position', () => {
    expect(pickResumeStop({ allStops: STOPS, fromIndex: 1, position: null })).toBeNull();
    expect(pickResumeStop({ allStops: STOPS, fromIndex: 1, position: { lat: NaN, lon: 0, accuracy: 5 } })).toBeNull();
  });

  it('treats a reading with no accuracy figure as unusable', () => {
    expect(pickResumeStop({ allStops: STOPS, fromIndex: 1, position: { lat: 52.915, lon: -0.10 } })).toBeNull();
  });
});
