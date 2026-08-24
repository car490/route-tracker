// One-time vehicle commissioning for the manual-selection flow — see
// vehicleSetup.js header comment and docs/TODO.md "Manual-selection flow —
// no vehicle/driver on the journey". Storage is injectable (a plain fake
// here), same pattern as announceLink.js's captureAnnounceSetup, so no DOM
// or real localStorage is needed.

import { describe, it, expect } from 'vitest';
import { getStoredVehicle, storeVehicle } from './vehicleSetup.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
}

describe('getStoredVehicle', () => {
  it('returns null when no vehicle has been commissioned', () => {
    expect(getStoredVehicle(fakeStorage())).toBeNull();
  });

  it('returns the stored id/label once commissioned', () => {
    const storage = fakeStorage({ vehicleId: 'veh-1', vehicleLabel: 'AB12 CDE' });
    expect(getStoredVehicle(storage)).toEqual({ id: 'veh-1', label: 'AB12 CDE' });
  });

  it('defaults label to empty string if only the id was ever stored', () => {
    const storage = fakeStorage({ vehicleId: 'veh-1' });
    expect(getStoredVehicle(storage)).toEqual({ id: 'veh-1', label: '' });
  });
});

describe('storeVehicle', () => {
  it('persists id and label so a later getStoredVehicle call sees them', () => {
    const storage = fakeStorage();
    storeVehicle('veh-2', 'XY99 ZZZ', storage);
    expect(getStoredVehicle(storage)).toEqual({ id: 'veh-2', label: 'XY99 ZZZ' });
  });

  it('stores an empty label rather than throwing when label is omitted', () => {
    const storage = fakeStorage();
    storeVehicle('veh-3', undefined, storage);
    expect(getStoredVehicle(storage)).toEqual({ id: 'veh-3', label: '' });
  });
});
