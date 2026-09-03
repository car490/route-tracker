import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { getCachedServices, setCachedServices, getCachedStops, setCachedStops } from './localStore.js';

// Driver token is read lazily (not at module load) so this module has no
// top-level `window` access — it can be imported from a non-browser
// context (e.g. Jest, which runs in Node) without throwing.
function driverToken() {
  return typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('token')
    : null;
}

export async function sbFetch(path, opts = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${driverToken() || SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      ...(opts.headers ?? {}),
    },
  });
}

export async function rpc(fn, args) {
  const res = await sbFetch(`/rest/v1/rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `RPC ${fn}: ${res.status}`);
  }
  return res.json();
}

// Distinct service_code -> "period label" -> departure_id, for the manual
// service-selection fallback (src/manualSelection.js). Sourced from
// schedule_view — same single source of truth every other stop/departure
// lookup in this app uses, rather than a separately-maintained list — so a
// new route just shows up here the next time the picker is opened, no code
// change needed. schedule_view is one row per stop, not per departure
// (PostgREST has no server-side DISTINCT), so rows are deduped client-side
// on departure_id. The period label includes the departure time (not just
// the timetable name) since a timetable can run more than once a day.
//
// Filtered to routes tagged 'Local Bus' only — same reasoning as
// fetchLocalBusVehicles(): this flow exists for registered local bus
// services, not school contracts/private hire/excursions, which still go
// through ops-assigned duty cards. Deliberately NOT filtered on
// psvair_in_scope (broader — 'Open Door Schools' also requires_bods=true in
// seed data, see schema.sql) or done as a PostgREST array-contains query
// param — filtered here client-side alongside the existing per-row work
// instead, since journey_type is already coming back on every row anyway.
//
// Falls back to the last successful result (src/localStore.js) if Supabase
// can't be reached at all — a live fetch is always attempted first since
// routes/timetables do change, the cache is only a last resort so the
// picker isn't a dead end during an outage. A cache miss on top of a live
// failure still throws, same as before this fallback existed.
export async function fetchAvailableServices() {
  let rows;
  try {
    const res = await sbFetch(
      `/rest/v1/schedule_view` +
      `?select=service_code,timetable_name,departure_id,departure_time,journey_type` +
      `&order=service_code,departure_time`
    );
    if (!res.ok) throw new Error(`schedule_view ${res.status}`);
    rows = await res.json();
  } catch (err) {
    const cached = getCachedServices();
    if (cached) return cached;
    throw err;
  }

  const services = {};
  const seenDepartures = new Set();
  for (const r of rows) {
    if (!r.journey_type?.includes('Local Bus')) continue;
    if (seenDepartures.has(r.departure_id)) continue;
    seenDepartures.add(r.departure_id);
    const label = `${r.timetable_name} (${r.departure_time.substring(0, 5)})`;
    (services[r.service_code] ??= {})[label] = r.departure_id;
  }
  setCachedServices(services);
  return services;
}

// Active, 'Local Bus'-tagged vehicles, for the Driver PWA's one-time
// vehicle-commissioning picker (src/vehicleSetup.js). The RLS policy
// (anon_read_local_bus, migration_vehicle_journey_types_manual_journey.sql)
// already restricts anon to exactly this set — no filtering needed here,
// this is just the select/order.
export async function fetchLocalBusVehicles() {
  const res = await sbFetch(`/rest/v1/vehicles?select=id,registration,fleet_number&order=registration`);
  if (!res.ok) throw new Error(`vehicles ${res.status}`);
  return res.json();
}

// The operator's display name, shown on the picker/duty-card screens
// (src/main.js's init()) instead of a hardcoded company name. anon_read on
// companies is `using (true)` (schema.sql) — deliberately unscoped, since
// this deployment model is one Supabase project per operator, so "the
// company" is unambiguous. Best-effort/cosmetic only: callers should treat
// a thrown error the same as "keep whatever's already in the DOM".
export async function fetchCompanyName() {
  const res = await sbFetch(`/rest/v1/companies?select=name&limit=1`);
  if (!res.ok) throw new Error(`companies ${res.status}`);
  const rows = await res.json();
  return rows[0]?.name ?? null;
}

// Falls back to the last successful result for this departureId
// (src/localStore.js) if Supabase can't be reached — same live-first,
// cache-as-last-resort shape as fetchAvailableServices() above.
export async function fetchStopsForDeparture(departureId) {
  let rows;
  try {
    const res = await sbFetch(
      `/rest/v1/schedule_view` +
      `?departure_id=eq.${departureId}` +
      `&select=timetable_stop_id,stop_id,stop_type,scheduled_time,display_name,lat,lon,sequence,psvair_in_scope` +
      `&order=sequence`
    );
    if (!res.ok) throw new Error(res.status);
    rows = await res.json();
  } catch (err) {
    const cached = getCachedStops(departureId);
    if (cached) return cached;
    throw err;
  }
  const result = {
    stops: rows.map(r => ({
      name: r.display_name,
      lat: r.lat,
      lon: r.lon,
      time: r.scheduled_time.substring(0, 5),
      stop_type: r.stop_type,
      timetable_stop_id: r.timetable_stop_id,
      stop_id: r.stop_id,
    })),
    psvairInScope: rows[0]?.psvair_in_scope ?? false,
  };
  setCachedStops(departureId, result);
  return result;
}

// Manual-selection/cab-device active-journey recovery — see
// activeJourneyRecovery.js's header comment for the full rationale. Called
// once on boot when the device has a commissioned vehicle but no duty-card
// link; returns the same row shape as get_duty_card (one row, or none) so
// main.js can feed it straight into the existing stop-confirm picker.
export async function fetchActiveManualJourney(vehicleId) {
  const rows = await rpc('get_active_manual_journey', { p_vehicle_id: vehicleId });
  return rows?.[0] ?? null;
}

// Warms the offline cache for every valid manual-selection route in one
// pass, called best-effort from main.js's init() whenever the device is
// online — not just the lazy per-departure caching fetchStopsForDeparture()
// already does on its own as a side effect of a driver actually opening
// that route. Without this, a route the driver has never manually picked
// before (e.g. right after Controller-AP-only bench testing, or a genuinely
// new route added since the last real sync) would have no cached stops to
// fall back to, and manualSelection.js's offline path would have nothing to
// show even though the journey itself can still start.
//
// Sequential, not Promise.all — this can be dozens of departures on a slow
// or intermittent connection, and fetchStopsForDeparture()'s own live-first
// behavior means a burst of parallel requests wouldn't be meaningfully
// faster (Supabase/PostgREST is the bottleneck, not client-side latency).
// Failures are swallowed per-departure so one bad/unreachable route doesn't
// stop the rest from caching — same fail-soft philosophy as
// localStore.js's readJSON/writeJSON.
export async function preloadAllRoutes() {
  let services;
  try {
    services = await fetchAvailableServices();
  } catch {
    return;
  }
  const departureIds = new Set();
  for (const periods of Object.values(services)) {
    for (const departureId of Object.values(periods)) {
      departureIds.add(departureId);
    }
  }
  for (const departureId of departureIds) {
    await fetchStopsForDeparture(departureId).catch(() => {});
  }
}
