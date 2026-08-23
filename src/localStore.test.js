import { describe, it, expect } from 'vitest';
import {
  getCachedServices, setCachedServices,
  getCachedStops, setCachedStops,
  getPendingTrips, enqueuePendingTrip, removePendingTrip, markPendingTripAttempt,
} from './localStore.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
}

describe('services cache', () => {
  it('returns null when nothing has been cached yet', () => {
    expect(getCachedServices(fakeStorage())).toBeNull();
  });

  it('round-trips whatever fetchAvailableServices() returned', () => {
    const storage = fakeStorage();
    const services = { '12': { 'Weekday (08:00)': 'dep-1' } };
    setCachedServices(services, storage);
    expect(getCachedServices(storage)).toEqual(services);
  });

  it('fails soft (returns fallback) on corrupted JSON rather than throwing', () => {
    const storage = fakeStorage({ 'busops.cache.services': '{not json' });
    expect(getCachedServices(storage)).toBeNull();
  });
});

describe('stops cache', () => {
  it('returns null for a departure that was never cached', () => {
    expect(getCachedStops('dep-1', fakeStorage())).toBeNull();
  });

  it('round-trips per departureId, independent of other departures', () => {
    const storage = fakeStorage();
    const resultA = { stops: [{ name: 'Stop A' }], psvairInScope: true };
    const resultB = { stops: [{ name: 'Stop B' }], psvairInScope: false };
    setCachedStops('dep-1', resultA, storage);
    setCachedStops('dep-2', resultB, storage);
    expect(getCachedStops('dep-1', storage)).toEqual(resultA);
    expect(getCachedStops('dep-2', storage)).toEqual(resultB);
  });
});

describe('pending trip queue', () => {
  it('starts empty', () => {
    expect(getPendingTrips(fakeStorage())).toEqual([]);
  });

  it('enqueue stamps id/createdAt/attempts and appends the entry', () => {
    const storage = fakeStorage();
    const id = enqueuePendingTrip({ journeyId: 'j-1', stopRows: [{ a: 1 }] }, storage);
    const trips = getPendingTrips(storage);
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ id, journeyId: 'j-1', stopRows: [{ a: 1 }], attempts: 0 });
    expect(trips[0].createdAt).toEqual(expect.any(Number));
  });

  it('supports multiple queued trips at once', () => {
    const storage = fakeStorage();
    enqueuePendingTrip({ journeyId: 'j-1', stopRows: [] }, storage);
    enqueuePendingTrip({ journeyId: 'j-2', stopRows: [] }, storage);
    expect(getPendingTrips(storage).map(t => t.journeyId)).toEqual(['j-1', 'j-2']);
  });

  it('removePendingTrip removes only the matching entry', () => {
    const storage = fakeStorage();
    const idA = enqueuePendingTrip({ journeyId: 'j-1', stopRows: [] }, storage);
    const idB = enqueuePendingTrip({ journeyId: 'j-2', stopRows: [] }, storage);
    removePendingTrip(idA, storage);
    const trips = getPendingTrips(storage);
    expect(trips).toHaveLength(1);
    expect(trips[0].id).toBe(idB);
  });

  it('removePendingTrip on an unknown id is a no-op', () => {
    const storage = fakeStorage();
    enqueuePendingTrip({ journeyId: 'j-1', stopRows: [] }, storage);
    removePendingTrip('nonexistent', storage);
    expect(getPendingTrips(storage)).toHaveLength(1);
  });

  it('markPendingTripAttempt increments attempts and stamps lastAttemptAt', () => {
    const storage = fakeStorage();
    const id = enqueuePendingTrip({ journeyId: 'j-1', stopRows: [] }, storage);
    markPendingTripAttempt(id, storage);
    markPendingTripAttempt(id, storage);
    const [trip] = getPendingTrips(storage);
    expect(trip.attempts).toBe(2);
    expect(trip.lastAttemptAt).toEqual(expect.any(Number));
  });

  it('markPendingTripAttempt on an unknown id is a no-op', () => {
    const storage = fakeStorage();
    expect(() => markPendingTripAttempt('nonexistent', storage)).not.toThrow();
  });
});
