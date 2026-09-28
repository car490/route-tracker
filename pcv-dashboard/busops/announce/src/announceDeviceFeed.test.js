// @vitest-environment jsdom
//
// src/announceDeviceFeed.test.js
//
// Startup when the tablet's own settings (its announce_devices row) can't
// be read — the power-cut case, where the Solo tablet restarts with no
// signal (owner-approved, 2026-09-28; see soloOfflineCache.js):
//   - Solo starts from the offline copy, then switches to the live settings
//     once the server answers
//   - no copy, or a paired (Lite) tablet: waits and retries, as before
//   - the server answering "no row for you" (revoked) stops a Solo running
//     from the copy and deletes the copy
// jsdom because config.js reads self.location at import. The Supabase
// client (a global from the vendored UMD bundle), the sync helpers and the
// Solo loop itself are stubbed; only this file's startup decisions are
// under test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../shared/deviceStateSync.js', () => ({
  hydrate: vi.fn(),
  subscribeToChanges: vi.fn(() => ({ stop: vi.fn() })),
  startHeartbeat: vi.fn(() => ({ stop: vi.fn() })),
}));
vi.mock('./announceSoloAutopilot.js', () => ({ startSoloAutopilot: vi.fn() }));

import { hydrate, subscribeToChanges } from '../../shared/deviceStateSync.js';
import { startSoloAutopilot } from './announceSoloAutopilot.js';
import { connectAnnounceDeviceFeed } from './announceDeviceFeed.js';
import { saveDeviceRow, loadDeviceRow, DEVICE_KEY } from './soloOfflineCache.js';

const OFFLINE = Object.assign(new Error('TypeError: Failed to fetch'), { code: '' });
const REVOKED = Object.assign(new Error('JSON object requested, multiple (or no) rows returned'), { code: 'PGRST116' });

const SOLO_ROW = {
  id: 'device-1', company_id: 'co-1', vehicle_id: null, gps_source: 'internal',
  candidate_departure_ids: ['dep-1'], match_window_before_min: 15, match_window_after_min: 30,
  terminus_radius_m: 150, testing_mode: false, config_version: 3, pairing_secret: 'secret-uuid',
};

function fakeClient() {
  const chain = { select: () => chain, eq: () => chain, single: () => Promise.resolve({ data: null, error: { code: '' } }) };
  return { realtime: { setAuth: vi.fn() }, from: vi.fn(() => chain), rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) };
}

const callbacks = () => ({
  onSchedule: vi.fn(), onState: vi.fn(), onJourneyEnd: vi.fn(), onIdleNextDeparture: vi.fn(),
  onIdleBranding: vi.fn(), onSleep: vi.fn(),
});

async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('connectAnnounceDeviceFeed — starting with no signal', () => {
  let soloHandle;
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.stubGlobal('supabase', { createClient: vi.fn(() => fakeClient()) });
    soloHandle = { stop: vi.fn(), applyConfigUpdate: vi.fn(), refreshCandidates: vi.fn() };
    startSoloAutopilot.mockReset().mockReturnValue(soloHandle);
    hydrate.mockReset();
    subscribeToChanges.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // expected "retrying"/"no signal" warnings
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    console.warn.mockRestore?.();
  });

  it('keeps an offline copy of its settings after a live start — without the pairing secret', async () => {
    hydrate.mockResolvedValue(SOLO_ROW);
    connectAnnounceDeviceFeed('token', callbacks());
    await settle();
    expect(loadDeviceRow()).toMatchObject({ id: 'device-1', gps_source: 'internal', candidate_departure_ids: ['dep-1'] });
    expect(localStorage.getItem(DEVICE_KEY)).not.toContain('secret-uuid');
  });

  it('starts Solo from the offline copy when the server cannot be reached, then moves onto the live settings', async () => {
    saveDeviceRow(SOLO_ROW);
    hydrate.mockRejectedValueOnce(OFFLINE);
    connectAnnounceDeviceFeed('token', callbacks());
    await settle();

    expect(startSoloAutopilot).toHaveBeenCalledTimes(1);
    expect(startSoloAutopilot.mock.calls[0][1]).toMatchObject({ id: 'device-1', candidate_departure_ids: ['dep-1'] });
    expect(subscribeToChanges).not.toHaveBeenCalled();

    const liveRow = { ...SOLO_ROW, config_version: 4, candidate_departure_ids: ['dep-1', 'dep-2'] };
    hydrate.mockResolvedValueOnce(liveRow);
    await vi.advanceTimersByTimeAsync(3000);
    await settle();

    expect(startSoloAutopilot).toHaveBeenCalledTimes(1); // not started twice
    expect(soloHandle.applyConfigUpdate).toHaveBeenCalledWith(liveRow);
    expect(subscribeToChanges).toHaveBeenCalledTimes(1);
  });

  it('waits and retries, as before, when there is no copy', async () => {
    hydrate.mockRejectedValue(OFFLINE);
    connectAnnounceDeviceFeed('token', callbacks());
    await settle();
    await vi.advanceTimersByTimeAsync(9000);
    expect(startSoloAutopilot).not.toHaveBeenCalled();
    expect(hydrate.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not start a paired (Lite) tablet from a copy — it waits for its Driver', async () => {
    saveDeviceRow({ ...SOLO_ROW, gps_source: 'driver-device' });
    hydrate.mockRejectedValue(OFFLINE);
    connectAnnounceDeviceFeed('token', callbacks());
    await settle();
    expect(startSoloAutopilot).not.toHaveBeenCalled();
  });

  it('a revoked device running from the copy stops, goes to sleep, and the copy is deleted', async () => {
    saveDeviceRow(SOLO_ROW);
    hydrate.mockRejectedValueOnce(OFFLINE).mockRejectedValueOnce(REVOKED);
    const cb = callbacks();
    connectAnnounceDeviceFeed('token', cb);
    await settle();
    expect(startSoloAutopilot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    await settle();

    expect(soloHandle.stop).toHaveBeenCalled();
    expect(cb.onSleep).toHaveBeenCalled();
    expect(localStorage.getItem(DEVICE_KEY)).toBeNull();
  });
});
