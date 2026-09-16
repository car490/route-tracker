// @vitest-environment jsdom
//
// src/journeyAnnouncementPreflight.test.js
// (implementation: src/journeyAnnouncementPreflight.js)
//
// Phase 3 of docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md ("never synthesize") —
// journey-start half of the checklist. jsdom required for the same reason
// as announcements.test.js: this transitively imports
// shared/announcementAudio.js -> driver/src/config.js, which reads
// window.location at module scope. fetch is stubbed manually (no mocking
// library), matching tests/serviceWorkerAnnouncementClips.test.js's Jest
// pattern for the same announcement_clips endpoint.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeRequiredClipKeys, checkAnnouncementCoverage } from './journeyAnnouncementPreflight.js';

const ALL_STOPS = [
  { stop_id: 'stop-1', name: 'High Street' },
  { stop_id: 'stop-2', name: 'Church Road' },
  { stop_id: 'stop-9', name: 'Bus Station' },
];

describe('computeRequiredClipKeys', () => {
  it('builds one key per stop (approach + departure), the ROUTE_START key, and the two fixed keys', () => {
    const keys = computeRequiredClipKeys(ALL_STOPS, 'S116S', 'Bus Station');

    expect(keys).toEqual(expect.arrayContaining([
      'service/s116s__bus-station',
      'approach/stop-1', 'departure/stop-1',
      'approach/stop-2', 'departure/stop-2',
      'approach/stop-9', 'departure/stop-9',
      'terminus', 'diversion',
    ]));
    // 3 stops x 2 + 3 fixed/service keys, no duplicates
    expect(keys.length).toBe(9);
  });

  it('omits the ROUTE_START key entirely when serviceCode/destination are missing', () => {
    const keys = computeRequiredClipKeys(ALL_STOPS, null, null);
    expect(keys).not.toEqual(expect.arrayContaining([expect.stringMatching(/^service\//)]));
  });
});

describe('checkAnnouncementCoverage', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports full coverage and never records a gap when every key is confirmed', async () => {
    const required = computeRequiredClipKeys(ALL_STOPS, 'S116S', 'Bus Station');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => required.map((key) => ({ key })),
    });

    const result = await checkAnnouncementCoverage({
      allStops: ALL_STOPS, serviceCode: 'S116S', destination: 'Bus Station',
      journeyId: 'journey-1', vehicleId: 'vehicle-1', driverId: 'driver-1',
    });

    expect(result).toEqual({ missingCount: 0, missingKeys: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1); // the announcement_clips lookup only — no gap POST
    expect(fetchMock.mock.calls[0][0]).toContain('/rest/v1/announcement_clips?select=key');
  });

  it('reports missing keys and records a journey_start gap when some are unconfirmed', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/rest/v1/announcement_clips')) {
        // Only the ROUTE_START and terminus/diversion keys are confirmed —
        // every stop's approach/departure clip is missing.
        return { ok: true, json: async () => [{ key: 'service/s116s__bus-station' }, { key: 'terminus' }, { key: 'diversion' }] };
      }
      return { ok: true, json: async () => ({}) };
    });

    const result = await checkAnnouncementCoverage({
      allStops: ALL_STOPS, serviceCode: 'S116S', destination: 'Bus Station',
      journeyId: 'journey-1', vehicleId: 'vehicle-1', driverId: 'driver-1',
    });

    expect(result.missingCount).toBe(6); // approach+departure for 3 stops
    expect(result.missingKeys).toEqual(expect.arrayContaining(['approach/stop-1', 'departure/stop-9']));

    const gapCall = fetchMock.mock.calls.find(([url]) => url.includes('/rest/v1/announcement_coverage_gap'));
    expect(gapCall).toBeTruthy();
    const [, options] = gapCall;
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      journey_id: 'journey-1',
      vehicle_id: 'vehicle-1',
      driver_id: 'driver-1',
      stage: 'journey_start',
    });
    expect(body.missing_keys).toEqual(expect.arrayContaining(['approach/stop-1', 'departure/stop-9']));
  });
});
