// src/announceLiteMode.test.js
//
// BusOps Announce Lite — pure mode-hot-switch decision. Same separation as
// scheduleAutopilot.js/announceStandaloneAutopilot.js: this file only
// decides *whether* a mode switch is needed and to what; announceLiteFeed.js
// is the thin Supabase/DOM wiring that acts on the result, untested here
// per this repo's existing convention (announceDeviceLinkApi.js's header).

import { describe, it, expect } from 'vitest';
import { resolveModeSwitch } from './announceLiteMode.js';

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
