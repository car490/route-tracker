// src/announceDeviceLink.test.js
//
// BusOps Announce Lite — paired-install linking (Driver PWA side)
// Only the pure vehicle-id resolution is unit-tested here, matching this
// repo's convention (diversionAlert.js/.test.js): pure decision logic gets
// tests, thin Supabase RPC/fetch wrappers (link/unlink/fetch) don't —
// manualSelection.js, the closest analog, has no test file of its own either.

import { describe, it, expect } from 'vitest';
import { resolveVehicleIdForAnnounceLink } from './announceDeviceLink.js';

describe('resolveVehicleIdForAnnounceLink', () => {
  it('prefers the active journey\'s vehicle_id (duty-card flow)', () => {
    const activeJourney = { vehicle_id: 'veh-duty' };
    const storedVehicle = { id: 'veh-manual', label: 'AB12 CDE' };
    expect(resolveVehicleIdForAnnounceLink(activeJourney, storedVehicle)).toBe('veh-duty');
  });

  it('falls back to the commissioned vehicle when there is no active journey (manual-selection flow)', () => {
    const storedVehicle = { id: 'veh-manual', label: 'AB12 CDE' };
    expect(resolveVehicleIdForAnnounceLink(null, storedVehicle)).toBe('veh-manual');
  });

  it('falls back to the commissioned vehicle when the active journey has no vehicle_id', () => {
    const activeJourney = { vehicle_id: null };
    const storedVehicle = { id: 'veh-manual', label: 'AB12 CDE' };
    expect(resolveVehicleIdForAnnounceLink(activeJourney, storedVehicle)).toBe('veh-manual');
  });

  it('returns null when neither source has a vehicle', () => {
    expect(resolveVehicleIdForAnnounceLink(null, null)).toBeNull();
  });
});
