// Device-local resilience: last-known-good route/schedule data, and a queue
// of end-of-trip uploads that haven't been confirmed by Supabase yet. See
// docs/TODO.md (or the PR this shipped in) for the fuller rationale — in
// short, supabaseApi.js falls back to the cache half of this on a failed
// fetch, and main.js drains the queue half on reconnect, so a Supabase
// outage never loses a driver's stop times or strands the picker.
//
// Storage is injectable (defaults to the real browser API), same pattern as
// vehicleSetup.js/announceLink.js's captureAnnounceSetup, so this is
// unit-testable without a DOM. Every read/write fails soft — a private
// browsing tab or a full storage quota degrades to "cache miss" /
// "queue write silently dropped", never a thrown error the caller has to
// handle.

const SERVICES_KEY      = 'busops.cache.services';
const STOPS_KEY_PREFIX  = 'busops.cache.stops.';
const PENDING_TRIPS_KEY = 'busops.queue.pendingTrips';

function readJSON(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw === null || raw === undefined ? fallback : JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function writeJSON(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (_) {
    // Quota exceeded, storage disabled, etc. — nothing more useful to do
    // than leave the previous cached value (if any) in place.
  }
}

// ── Route/schedule cache ─────────────────────────────────────────────────

export function getCachedServices(storage = globalThis.localStorage) {
  return readJSON(storage, SERVICES_KEY, null);
}

export function setCachedServices(services, storage = globalThis.localStorage) {
  writeJSON(storage, SERVICES_KEY, services);
}

export function getCachedStops(departureId, storage = globalThis.localStorage) {
  return readJSON(storage, `${STOPS_KEY_PREFIX}${departureId}`, null);
}

export function setCachedStops(departureId, result, storage = globalThis.localStorage) {
  writeJSON(storage, `${STOPS_KEY_PREFIX}${departureId}`, result);
}

// ── Pending-trip queue ───────────────────────────────────────────────────
// One entry per completeTrip() that failed to upload — created once, at
// end of trip, never re-derived, so a queued entry survives even if the
// journey's stop list would fetch differently by the time it's retried.

export function getPendingTrips(storage = globalThis.localStorage) {
  return readJSON(storage, PENDING_TRIPS_KEY, []);
}

function setPendingTrips(trips, storage) {
  writeJSON(storage, PENDING_TRIPS_KEY, trips);
}

// entry: { journeyId, stopRows } — id/createdAt/attempts are stamped here so
// callers don't have to.
export function enqueuePendingTrip(entry, storage = globalThis.localStorage) {
  const trips = getPendingTrips(storage);
  const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  trips.push({ id, createdAt: Date.now(), attempts: 0, ...entry });
  setPendingTrips(trips, storage);
  return id;
}

export function removePendingTrip(id, storage = globalThis.localStorage) {
  setPendingTrips(getPendingTrips(storage).filter(t => t.id !== id), storage);
}

// Called after a failed retry so a future "N pending" indicator (see
// docs/TODO.md) has something to show — never used to give up on an entry,
// retries continue indefinitely.
export function markPendingTripAttempt(id, storage = globalThis.localStorage) {
  const trips = getPendingTrips(storage);
  const trip = trips.find(t => t.id === id);
  if (!trip) return;
  trip.attempts += 1;
  trip.lastAttemptAt = Date.now();
  setPendingTrips(trips, storage);
}
