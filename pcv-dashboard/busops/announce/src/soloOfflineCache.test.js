// src/soloOfflineCache.test.js
//
// Announce Solo's offline copy of its own settings and departures, so a
// tablet that restarts with no signal (power cut) can still start
// (owner-approved, 2026-09-28). Only safe fields are kept, the copy is only
// used when the server cannot be reached at all, and a server that answers
// "no" (revoked device) deletes it.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveDeviceRow, loadDeviceRow, saveCandidates, loadCandidates,
  saveDepartureDetails, loadDepartureDetails, clearOfflineCache,
  resolveOfflineBoot, CACHE_MAX_AGE_MS, DEVICE_KEY,
} from './soloOfflineCache.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    keys: () => [...data.keys()],
  };
}

const NOW = new Date('2026-09-28T07:00:00Z');
const later = (ms) => new Date(NOW.getTime() + ms);

const ROW = {
  id: 'device-1', company_id: 'co-1', vehicle_id: null, label: 'Solo 1',
  gps_source: 'internal', link_state: 'unlinked',
  candidate_departure_ids: ['dep-1', 'dep-2'],
  match_window_before_min: 15, match_window_after_min: 30, terminus_radius_m: 150,
  testing_mode: false, config_version: 4,
  pairing_secret: 'secret-uuid', revoked_at: null,
  latest_schedule: { big: 'thing' }, latest_state: null, state_updated_at: null,
  last_seen_at: '2026-09-28T06:00:00Z', created_at: '2026-01-01T00:00:00Z',
};

const CANDIDATES = { candidates: [{ departureId: 'dep-1', serviceCode: 'S1', departureTime: '08:00' }], termDateRanges: [] };
const DETAILS = { serviceCode: 'S1', allStops: [{ name: 'A', lat: 1, lon: 1, time: '08:00', timetable_stop_id: 'ts-1' }] };

let storage;
beforeEach(() => { storage = memoryStorage(); });

describe('device settings copy', () => {
  it('keeps only the settings Solo needs to run — never the pairing secret or pushed journey data', () => {
    saveDeviceRow(ROW, { storage, now: NOW });
    const raw = storage.getItem(DEVICE_KEY);
    expect(raw).not.toContain('secret-uuid');
    expect(raw).not.toContain('pairing_secret');
    expect(raw).not.toContain('latest_schedule');
    expect(loadDeviceRow({ storage, now: NOW })).toEqual({
      id: 'device-1', company_id: 'co-1', vehicle_id: null, gps_source: 'internal',
      candidate_departure_ids: ['dep-1', 'dep-2'],
      match_window_before_min: 15, match_window_after_min: 30, terminus_radius_m: 150,
      testing_mode: false, config_version: 4,
    });
  });

  it(`is not used once older than ${CACHE_MAX_AGE_MS / 86400000} days`, () => {
    saveDeviceRow(ROW, { storage, now: NOW });
    expect(loadDeviceRow({ storage, now: later(CACHE_MAX_AGE_MS) })).not.toBeNull();
    expect(loadDeviceRow({ storage, now: later(CACHE_MAX_AGE_MS + 1) })).toBeNull();
  });

  it('treats corrupt data as no copy', () => {
    storage.setItem(DEVICE_KEY, '{nope');
    expect(loadDeviceRow({ storage, now: NOW })).toBeNull();
  });
});

describe('departures copy', () => {
  it('returns the saved departure list for the same set of departures, in any order', () => {
    saveCandidates(['dep-1', 'dep-2'], CANDIDATES, { storage, now: NOW });
    expect(loadCandidates(['dep-2', 'dep-1'], { storage, now: NOW })).toEqual(CANDIDATES);
  });

  it('is not used once the device serves a different set of departures', () => {
    saveCandidates(['dep-1', 'dep-2'], CANDIDATES, { storage, now: NOW });
    expect(loadCandidates(['dep-1'], { storage, now: NOW })).toBeNull();
  });

  it('keeps each departure\'s stops, only for departures the device still serves', () => {
    saveDepartureDetails('dep-1', DETAILS, { storage, now: NOW });
    saveDepartureDetails('dep-9', DETAILS, { storage, now: NOW });
    saveCandidates(['dep-1'], CANDIDATES, { storage, now: NOW }); // dep-9 dropped from the device
    expect(loadDepartureDetails('dep-1', { storage, now: NOW })).toEqual(DETAILS);
    expect(loadDepartureDetails('dep-9', { storage, now: NOW })).toBeNull();
  });

  it(`departure copies are not used once older than ${CACHE_MAX_AGE_MS / 86400000} days`, () => {
    saveCandidates(['dep-1'], CANDIDATES, { storage, now: NOW });
    saveDepartureDetails('dep-1', DETAILS, { storage, now: NOW });
    expect(loadCandidates(['dep-1'], { storage, now: later(CACHE_MAX_AGE_MS + 1) })).toBeNull();
    expect(loadDepartureDetails('dep-1', { storage, now: later(CACHE_MAX_AGE_MS + 1) })).toBeNull();
  });
});

describe('clearOfflineCache', () => {
  it('removes every copy', () => {
    saveDeviceRow(ROW, { storage, now: NOW });
    saveCandidates(['dep-1'], CANDIDATES, { storage, now: NOW });
    saveDepartureDetails('dep-1', DETAILS, { storage, now: NOW });
    clearOfflineCache({ storage });
    expect(storage.keys()).toEqual([]);
  });
});

describe('resolveOfflineBoot', () => {
  const offline = { message: 'TypeError: Failed to fetch', code: '' };
  const refused = { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' };
  const soloRow = { gps_source: 'internal' };

  it('starts Solo from the copy when the server cannot be reached', () => {
    expect(resolveOfflineBoot({ error: offline, cachedRow: soloRow })).toBe('start-from-copy');
  });

  it('waits when there is no copy', () => {
    expect(resolveOfflineBoot({ error: offline, cachedRow: null })).toBe('wait');
  });

  it('waits for a paired (Lite) device — it depends on its Driver, not on a copy', () => {
    expect(resolveOfflineBoot({ error: offline, cachedRow: { gps_source: 'driver-device' } })).toBe('wait');
  });

  it('deletes the copy when the server answers and refuses (e.g. device revoked)', () => {
    expect(resolveOfflineBoot({ error: refused, cachedRow: soloRow })).toBe('drop-copy');
  });

  it('waits, keeping the copy, on any other server error (e.g. a timeout)', () => {
    expect(resolveOfflineBoot({ error: { message: 'canceling statement due to statement timeout', code: '57014' }, cachedRow: soloRow })).toBe('wait');
  });

  it('treats a thrown fetch error with no code as unreachable', () => {
    expect(resolveOfflineBoot({ error: new TypeError('Failed to fetch'), cachedRow: soloRow })).toBe('start-from-copy');
  });
});
