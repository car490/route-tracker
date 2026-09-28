// src/soloOfflineCache.js
//
// BusOps Announce Solo — an offline copy of this tablet's own settings
// (its announce_devices row) and the departures it serves, so a tablet that
// restarts with no signal after a power cut can still start and run
// (owner-approved, 2026-09-28). Before this, Solo read everything from
// Supabase at startup and sat blank, retrying every 3 s, until it could.
//
// Rules:
//   - Only the settings Solo needs are kept (DEVICE_FIELDS) — never the
//     pairing secret, never pushed journey data.
//   - A copy older than 7 days is not used: long enough to ride out a
//     weekend with no signal, short enough that a timetable change can't
//     linger. Every successful live read refreshes it.
//   - The copy is only used when the server can't be reached at all. If the
//     server answers and refuses (a revoked device reads zero rows under
//     RLS), the copy is deleted — revocation must not be outlived by a copy
//     (resolveOfflineBoot).
//   - Only Solo starts from a copy. A paired (Lite) tablet depends on its
//     Driver device, which re-pushes the trip itself after a restart.
//
// The device token is not part of this; it is stored separately
// (announceDeviceSetup.js). Pure, injectable storage/clock, never throws.

export const DEVICE_KEY = 'busops.announce.solo.device';
export const CANDIDATES_KEY = 'busops.announce.solo.candidates';
export const DEPARTURES_KEY = 'busops.announce.solo.departures';
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const DEVICE_FIELDS = [
  'id', 'company_id', 'vehicle_id', 'gps_source', 'candidate_departure_ids',
  'match_window_before_min', 'match_window_after_min', 'terminus_radius_m',
  'testing_mode', 'config_version',
];

function readJSON(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeJSON(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

const fresh = (entry, now) => !!entry
  && now.getTime() - new Date(entry.savedAt).getTime() <= CACHE_MAX_AGE_MS;

const idsKey = (ids) => [...(ids ?? [])].sort().join(',');

export function saveDeviceRow(row, { storage = globalThis.localStorage, now = new Date() } = {}) {
  const kept = {};
  for (const field of DEVICE_FIELDS) kept[field] = row?.[field] ?? null;
  writeJSON(storage, DEVICE_KEY, { savedAt: now.toISOString(), row: kept });
}

export function loadDeviceRow({ storage = globalThis.localStorage, now = new Date() } = {}) {
  const entry = readJSON(storage, DEVICE_KEY);
  return fresh(entry, now) && entry.row ? entry.row : null;
}

// Also drops the stops of any departure the device no longer serves.
export function saveCandidates(departureIds, result, { storage = globalThis.localStorage, now = new Date() } = {}) {
  writeJSON(storage, CANDIDATES_KEY, { savedAt: now.toISOString(), ids: idsKey(departureIds), result });
  const departures = readJSON(storage, DEPARTURES_KEY) ?? {};
  const keep = new Set(departureIds ?? []);
  const pruned = Object.fromEntries(Object.entries(departures).filter(([id]) => keep.has(id)));
  writeJSON(storage, DEPARTURES_KEY, pruned);
}

export function loadCandidates(departureIds, { storage = globalThis.localStorage, now = new Date() } = {}) {
  const entry = readJSON(storage, CANDIDATES_KEY);
  if (!fresh(entry, now) || entry.ids !== idsKey(departureIds)) return null;
  return entry.result ?? null;
}

export function saveDepartureDetails(departureId, details, { storage = globalThis.localStorage, now = new Date() } = {}) {
  const departures = readJSON(storage, DEPARTURES_KEY) ?? {};
  departures[departureId] = { savedAt: now.toISOString(), details };
  writeJSON(storage, DEPARTURES_KEY, departures);
}

export function loadDepartureDetails(departureId, { storage = globalThis.localStorage, now = new Date() } = {}) {
  const entry = (readJSON(storage, DEPARTURES_KEY) ?? {})[departureId];
  return fresh(entry, now) ? entry.details ?? null : null;
}

export function clearOfflineCache({ storage = globalThis.localStorage } = {}) {
  for (const key of [DEVICE_KEY, CANDIDATES_KEY, DEPARTURES_KEY]) {
    try {
      storage.removeItem(key);
    } catch (_) {}
  }
}

// A request that never got an answer (no signal) carries no PostgREST
// error code. PGRST116 is the server answering "no row visible to you" —
// what a revoked device gets under the device_self RLS policy.
const NO_ROW_VISIBLE = 'PGRST116';

// What to do when this device's own settings can't be read at startup:
//   'start-from-copy'  no answer from the server, and a Solo copy exists
//   'drop-copy'        the server says this device has no row it may see
//                      (revoked) — delete the copy
//   'wait'             anything else: keep retrying, as before
export function resolveOfflineBoot({ error, cachedRow }) {
  if (error?.code === NO_ROW_VISIBLE) return 'drop-copy';
  if (error?.code) return 'wait';
  if (cachedRow?.gps_source === 'internal') return 'start-from-copy';
  return 'wait';
}
