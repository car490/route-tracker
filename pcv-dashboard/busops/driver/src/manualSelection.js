import { rpc, fetchStopsForDeparture } from './supabaseApi.js';
import { enqueuePendingJourneyStart } from './localStore.js';

// Fallback path for the "no active duties" dead-end: driver picks a
// service/variant by hand instead of following a duty card. Produces the
// exact param bag runTracker() already expects from the duty-card path
// (see main.js launchDutyRoute), so runTracker() downstream needs zero
// changes regardless of which path produced it.
//
// departureId comes from the caller (main.js's dynamically-fetched services
// map, see supabaseApi.js's fetchAvailableServices) — this function has no
// lookup of its own, it just needs a valid id. serviceCode/servicePeriod are
// carried through only for display, not re-derived here. vehicleId is this
// device's once-commissioned vehicle (see src/vehicleSetup.js) — optional
// here (the RPC defaults it to null) since a stale/pre-commissioning device
// shouldn't hard-fail, but main.js only reaches this function once a vehicle
// is set, so it's effectively always present in practice.
//
// initialStopIndex is always 0 here — deliberate "start of route" default
// for a picker-less flow, not a mirror of either existing flow's DOM
// <select> fallback.
//
// journeyId is always generated client-side (crypto.randomUUID()), online
// or offline, and passed to get_or_create_manual_journey as p_journey_id —
// see the migration that added that param (20260825100305) for why: it
// means a journey started while Supabase is unreachable (e.g. the Driver is
// joined only to the Controller's isolated AP with no SIM — see
// docs/HARDWARE.md's SIM requirement) uses the exact same id locally
// (tracking, the Controller push feed, journey_events writes) as the one
// that eventually lands in the database once queued via
// enqueuePendingJourneyStart and flushed by main.js's
// flushPendingJourneyStarts() — no reconciliation needed on the (expected,
// common) happy path where no one else created this journey first.
//
// Stops come from fetchStopsForDeparture(), which already falls back to
// src/localStore.js's cache on a failed fetch (see that function) — so this
// works offline as long as the route was cached at least once before, which
// preloadAllRoutes() (called from main.js's init(), see supabaseApi.js)
// does proactively for every valid route as soon as the device is online,
// not just lazily on first manual visit.
export async function selectServiceManually(departureId, serviceCode, servicePeriod, vehicleId, { onComplete = () => {} } = {}) {
  if (!departureId) {
    throw new Error(`No departure selected for ${serviceCode} / ${servicePeriod}`);
  }

  const journeyId = crypto.randomUUID();
  let liveJourneyId = null;
  try {
    const [{ journey_id: resolvedId }] = await rpc('get_or_create_manual_journey', {
      p_timetable_departure_id: departureId,
      p_journey_id: journeyId,
      ...(vehicleId ? { p_vehicle_id: vehicleId } : {}),
    });

    // Mirrors the duty-card path's start_journey call (main.js's
    // launchDutyRoute) — without this, journeys.status never leaves
    // 'scheduled', so the BusOps Announce onboard display (which waits for
    // get_duty_card to report in_progress) never wakes, and complete_journey
    // silently no-ops at the end since it requires status = 'in_progress'.
    // No-ops harmlessly (returns false, doesn't throw) if already
    // in_progress from an earlier manual start today.
    await rpc('start_journey', { p_journey_id: resolvedId });
    liveJourneyId = resolvedId;
  } catch (err) {
    // Supabase unreachable (or some other failure) — queue both RPC calls
    // for main.js's flushPendingJourneyStarts() to retry on reconnect, and
    // carry on using the locally-generated id so tracking/the Controller
    // push feed can start right now regardless. A genuine validation error
    // (bad departureId, service doesn't run today) would also land here and
    // get queued rather than surfaced immediately — an accepted tradeoff:
    // this path exists specifically for "can't tell the difference from a
    // dead network", and the same request will simply fail visibly again
    // once flushed, same as it would have live.
    enqueuePendingJourneyStart({ journeyId, departureId, vehicleId: vehicleId ?? null });
  }

  // Stops (and PSVAIR scope) come from schedule_view, same single source
  // of truth the duty-card path uses — never duplicated here. Falls back to
  // the local cache on its own if this is also unreachable right now.
  const { stops, psvairInScope } = await fetchStopsForDeparture(departureId);

  return {
    allStops: stops,
    journeyId: liveJourneyId ?? journeyId,
    initialStopIndex: 0,
    serviceCode,
    servicePeriod,
    psvairEnabled: psvairInScope,
    onComplete,
  };
}
