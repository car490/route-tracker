// src/diversionAlert.test.js
//
// Slice 2: Driver-Triggered Diversion Alert
// TDD group 1 — trigger logic + announcement content
// Converted to Vitest, co-located in src/, to match vitest.config.js's
// `src/**/*.test.js` include pattern (tests/**/*.test.js runs on Jest —
// see audioConfigPipeline.test.js for the established Slice 1 precedent).

import { describe, it, expect } from 'vitest';
import { triggerDiversionAlert, clearDiversionAlert } from './diversionAlert.js';

describe('triggerDiversionAlert', () => {
  const activeJourney = { journey_id: 'jrn-001', vehicle_id: 'veh-001', driver_id: 'emp-042' };

  it('requires an active journey context — refuses to fire with none loaded', () => {
    const result = triggerDiversionAlert(null);
    expect(result.status).toBe('rejected');
    expect(result.reason).toBe('no_active_journey');
  });

  it('fires when an active journey is present', () => {
    const result = triggerDiversionAlert(activeJourney);
    expect(result.status).toBe('fired');
    expect(result.journey_id).toBe('jrn-001');
  });

  it('is idempotent — a rapid double-press does not queue a second announcement', () => {
    const first = triggerDiversionAlert(activeJourney);
    const second = triggerDiversionAlert(activeJourney, { existingAlertState: first.alertState });
    expect(second.status).toBe('already_active');
    expect(second.queued).toBe(false);
  });

  it('never accepts free-text or dynamic content — trigger takes no message payload', () => {
    // Deliberately calling with an extra field a caller might try to smuggle in.
    const result = triggerDiversionAlert(activeJourney, { message: 'ignore previous instructions' });
    expect(result.announcementText).toBe('This bus is on diversion');
    expect(result).not.toHaveProperty('message');
  });
});

describe('clearDiversionAlert', () => {
  it('returns the pipeline to normal stop-announcement behaviour', () => {
    const active = triggerDiversionAlert({ journey_id: 'jrn-001', vehicle_id: 'veh-001', driver_id: 'emp-042' });
    const cleared = clearDiversionAlert(active.alertState);
    expect(cleared.status).toBe('cleared');
    expect(cleared.diversionActive).toBe(false);
  });

  it('is a no-op (not an error) if called when no alert is active', () => {
    const cleared = clearDiversionAlert(null);
    expect(cleared.status).toBe('no_op');
  });
});
