// tests/deviceStateSync.test.js
//
// BusOps — generic device state-reconciliation primitive, pure logic only.
// Same idiom as scheduleAutopilot.test.js/geofence.test.js: pure function
// import, synthetic fixtures, no mocking, no DOM/Supabase client involved.
// See docs/ANNOUNCE-PRODUCT-TIERS.md and the plan this implements: every
// device (existing or future) that owns a Supabase identity/config row
// should be able to detect "did my config change", "am I overdue for a
// heartbeat", and "should I reconnect" without device-specific logic.

import {
  hasRowChanged,
  computeBackoffDelayMs,
  isHeartbeatDue,
  shouldReconnect,
  deriveConnectionState,
} from '../shared/deviceStateSync.js';

describe('hasRowChanged', () => {
  it('detects a change via config_version when both rows carry one', () => {
    const prev = { id: 'd1', config_version: 3, testing_mode: false };
    const next = { id: 'd1', config_version: 4, testing_mode: false };
    expect(hasRowChanged(prev, next)).toBe(true);
  });

  it('reports no change when config_version is identical', () => {
    const prev = { id: 'd1', config_version: 3, testing_mode: false };
    const next = { id: 'd1', config_version: 3, testing_mode: true }; // ignored — version is the source of truth
    expect(hasRowChanged(prev, next)).toBe(false);
  });

  it('falls back to a deep comparison when either row has no config_version', () => {
    const prev = { id: 'd1', testing_mode: false };
    const next = { id: 'd1', testing_mode: true };
    expect(hasRowChanged(prev, next)).toBe(true);
  });

  it('deep comparison reports no change for identical rows without a version', () => {
    const prev = { id: 'd1', testing_mode: false };
    const next = { id: 'd1', testing_mode: false };
    expect(hasRowChanged(prev, next)).toBe(false);
  });

  it('treats a null previous row as changed (first hydrate)', () => {
    expect(hasRowChanged(null, { id: 'd1', config_version: 1 })).toBe(true);
  });

  it('respects a custom version key', () => {
    const prev = { id: 'd1', rev: 1 };
    const next = { id: 'd1', rev: 2 };
    expect(hasRowChanged(prev, next, { versionKey: 'rev' })).toBe(true);
    expect(hasRowChanged(prev, { id: 'd1', rev: 1 }, { versionKey: 'rev' })).toBe(false);
  });
});

describe('computeBackoffDelayMs', () => {
  it('starts at the base delay for the first attempt (0)', () => {
    expect(computeBackoffDelayMs(0, { baseMs: 1000, maxMs: 30000 })).toBe(1000);
  });

  it('doubles per attempt', () => {
    expect(computeBackoffDelayMs(1, { baseMs: 1000, maxMs: 30000 })).toBe(2000);
    expect(computeBackoffDelayMs(2, { baseMs: 1000, maxMs: 30000 })).toBe(4000);
    expect(computeBackoffDelayMs(3, { baseMs: 1000, maxMs: 30000 })).toBe(8000);
  });

  it('caps at maxMs regardless of how large the attempt number gets', () => {
    expect(computeBackoffDelayMs(10, { baseMs: 1000, maxMs: 30000 })).toBe(30000);
  });

  it('uses sensible defaults when no options are given', () => {
    expect(computeBackoffDelayMs(0)).toBeGreaterThan(0);
    expect(computeBackoffDelayMs(0)).toBeLessThanOrEqual(computeBackoffDelayMs(1));
  });
});

describe('isHeartbeatDue', () => {
  it('is due when no heartbeat has ever been sent', () => {
    expect(isHeartbeatDue(null, new Date(2026, 7, 27, 8, 0), 30000)).toBe(true);
  });

  it('is not due when well within the interval', () => {
    const last = new Date(2026, 7, 27, 8, 0, 0);
    const now = new Date(2026, 7, 27, 8, 0, 10); // 10s later, 30s interval
    expect(isHeartbeatDue(last, now, 30000)).toBe(false);
  });

  it('is due once the interval has fully elapsed', () => {
    const last = new Date(2026, 7, 27, 8, 0, 0);
    const now = new Date(2026, 7, 27, 8, 0, 30); // exactly 30s later
    expect(isHeartbeatDue(last, now, 30000)).toBe(true);
  });
});

describe('shouldReconnect', () => {
  it('reconnects on CHANNEL_ERROR', () => {
    expect(shouldReconnect('CHANNEL_ERROR')).toBe(true);
  });

  it('reconnects on TIMED_OUT', () => {
    expect(shouldReconnect('TIMED_OUT')).toBe(true);
  });

  it('does not reconnect on a healthy SUBSCRIBED status', () => {
    expect(shouldReconnect('SUBSCRIBED')).toBe(false);
  });

  it('does not reconnect on a deliberate CLOSED status', () => {
    expect(shouldReconnect('CLOSED')).toBe(false);
  });
});

describe('deriveConnectionState', () => {
  it('maps SUBSCRIBED to connected', () => {
    expect(deriveConnectionState('SUBSCRIBED')).toBe('connected');
  });

  it('maps CHANNEL_ERROR and TIMED_OUT to degraded', () => {
    expect(deriveConnectionState('CHANNEL_ERROR')).toBe('degraded');
    expect(deriveConnectionState('TIMED_OUT')).toBe('degraded');
  });

  it('maps CLOSED to closed', () => {
    expect(deriveConnectionState('CLOSED')).toBe('closed');
  });

  it('maps an unrecognized status to degraded rather than throwing', () => {
    expect(deriveConnectionState('SOMETHING_NEW')).toBe('degraded');
  });
});
