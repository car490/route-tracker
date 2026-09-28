// src/activeJourneyRecovery.test.js
//
// Pure boot-action resolution only, matching this repo's convention
// (announceDeviceLink.test.js): thin RPC wrappers (fetchActiveManualJourney
// in supabaseApi.js) aren't tested here, only the decision logic.

import { describe, it, expect } from 'vitest';
import { resolveBootAction, startedToday, BOOT_ACTION } from './activeJourneyRecovery.js';

// Midday BST, 27 Sep 2026.
const NOW = new Date('2026-09-27T11:00:00Z');

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
      activeJourney: { journey_id: 'j-active', started_at: '2026-09-27T06:30:00Z' },
      now: NOW,
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

  it('does not resume a journey left in progress from an earlier day', () => {
    expect(resolveBootAction({
      dutiesParam: null,
      storedVehicleId: 'veh-1',
      activeJourney: { journey_id: 'j-old', started_at: '2026-09-16T09:29:24Z' },
      now: NOW,
    })).toBe(BOOT_ACTION.NO_DUTY);
  });

  it('does not resume a journey with no start time', () => {
    expect(resolveBootAction({
      dutiesParam: null,
      storedVehicleId: 'veh-1',
      activeJourney: { journey_id: 'j-active', started_at: null },
      now: NOW,
    })).toBe(BOOT_ACTION.NO_DUTY);
  });
});

// A trip saved on this device (journeyCheckpoint.js) is the trip that was
// running when the power went, so it comes before everything else: before
// the duty card, before vehicle setup, before the server lookup — and it
// needs no signal.
describe('resolveBootAction — saved trip on this device', () => {
  const checkpoint = { journeyId: 'j-saved' };

  it('resumes a fresh saved trip ahead of a duty card', () => {
    expect(resolveBootAction({
      dutiesParam: 'j1,j2', storedVehicleId: 'veh-1', activeJourney: null, checkpoint, now: NOW,
    })).toBe(BOOT_ACTION.RESUME_CHECKPOINT);
  });

  it('resumes a fresh saved trip ahead of the server lookup and with no vehicle stored', () => {
    expect(resolveBootAction({
      dutiesParam: null, storedVehicleId: null,
      activeJourney: { journey_id: 'j-active', started_at: '2026-09-27T06:30:00Z' },
      checkpoint, now: NOW,
    })).toBe(BOOT_ACTION.RESUME_CHECKPOINT);
  });

  it('falls back to the existing order when there is no fresh saved trip', () => {
    expect(resolveBootAction({
      dutiesParam: 'j1', storedVehicleId: 'veh-1', activeJourney: null, checkpoint: null, now: NOW,
    })).toBe(BOOT_ACTION.DUTY_CARD);
  });
});

describe('startedToday', () => {
  it('uses the UK date, not UTC: 23:30 UTC in summer is already tomorrow in London', () => {
    expect(startedToday('2026-09-26T23:30:00Z', NOW)).toBe(true);
  });

  it('a journey from late yesterday (UK) is not today', () => {
    expect(startedToday('2026-09-26T22:30:00Z', NOW)).toBe(false);
  });

  it('rejects an unparseable start time', () => {
    expect(startedToday('not a date', NOW)).toBe(false);
  });
});
