// src/announceLiteMode.test.js
//
// BusOps Announce Lite — pure mode-hot-switch decision. Same separation as
// scheduleAutopilot.js/announceSoloAutopilot.js: this file only decides
// *whether* a mode switch is needed and to what; announceDeviceFeed.js is
// the thin Supabase/DOM wiring that acts on the result, untested here per
// this repo's existing convention (announceDeviceLinkApi.js's header).

import { describe, it, expect } from 'vitest';
import { resolveModeSwitch, shouldSelfHeal } from './announceLiteMode.js';

describe('resolveModeSwitch', () => {
  it('returns null when gps_source is unchanged', () => {
    expect(resolveModeSwitch('internal', { gps_source: 'internal' })).toBeNull();
    expect(resolveModeSwitch('driver-device', { gps_source: 'driver-device' })).toBeNull();
  });

  it('returns the new mode when a device is linked mid-session (internal -> driver-device)', () => {
    expect(resolveModeSwitch('internal', { gps_source: 'driver-device' })).toBe('driver-device');
  });

  it('returns the new mode when a device is unlinked mid-session (driver-device -> internal)', () => {
    expect(resolveModeSwitch('driver-device', { gps_source: 'internal' })).toBe('internal');
  });

  it('returns null when the row has no gps_source at all (defensive — never crash on a malformed push)', () => {
    expect(resolveModeSwitch('internal', {})).toBeNull();
  });
});

describe('shouldSelfHeal', () => {
  it('never self-heals a device with no candidate departures — a genuine Lite (paired) install', () => {
    expect(shouldSelfHeal({ candidateDepartureIds: [], msSinceLastPush: Infinity, timeoutMs: 600000 })).toBe(false);
    expect(shouldSelfHeal({ candidateDepartureIds: null, msSinceLastPush: Infinity, timeoutMs: 600000 })).toBe(false);
  });

  it('does not self-heal a Solo-commissioned device while within the timeout', () => {
    expect(shouldSelfHeal({ candidateDepartureIds: ['dep-1'], msSinceLastPush: 300000, timeoutMs: 600000 })).toBe(false);
  });

  it('self-heals a Solo-commissioned device once the timeout has elapsed with no push', () => {
    expect(shouldSelfHeal({ candidateDepartureIds: ['dep-1'], msSinceLastPush: 600000, timeoutMs: 600000 })).toBe(true);
    expect(shouldSelfHeal({ candidateDepartureIds: ['dep-1'], msSinceLastPush: 900000, timeoutMs: 600000 })).toBe(true);
  });
});
