// src/activeJourneyRecovery.test.js
//
// Pure boot-action resolution only, matching this repo's convention
// (announceDeviceLink.test.js): thin RPC wrappers (fetchActiveManualJourney
// in supabaseApi.js) aren't tested here, only the decision logic.

import { describe, it, expect } from 'vitest';
import { resolveBootAction, BOOT_ACTION } from './activeJourneyRecovery.js';

describe('resolveBootAction', () => {
  it('always prefers the duty-card flow when a duties param is present', () => {
    expect(resolveBootAction({
      dutiesParam: 'j1,j2',
      storedVehicleId: 'veh-1',
      activeJourney: { journey_id: 'j-active' },
    })).toBe(BOOT_ACTION.DUTY_CARD);
  });

  it('goes to vehicle setup when no vehicle has ever been commissioned', () => {
    expect(resolveBootAction({
      dutiesParam: null,
      storedVehicleId: null,
      activeJourney: null,
    })).toBe(BOOT_ACTION.VEHICLE_SETUP);
  });

  it('resumes the active journey when one exists for the commissioned vehicle', () => {
    expect(resolveBootAction({
      dutiesParam: null,
      storedVehicleId: 'veh-1',
      activeJourney: { journey_id: 'j-active' },
    })).toBe(BOOT_ACTION.RESUME_ACTIVE);
  });

  it('falls back to the no-duty screen when commissioned but nothing is active', () => {
    expect(resolveBootAction({
      dutiesParam: null,
      storedVehicleId: 'veh-1',
      activeJourney: null,
    })).toBe(BOOT_ACTION.NO_DUTY);
  });

  it('duty-card param wins even over vehicle commissioning being absent', () => {
    expect(resolveBootAction({
      dutiesParam: 'j1',
      storedVehicleId: null,
      activeJourney: null,
    })).toBe(BOOT_ACTION.DUTY_CARD);
  });
});
