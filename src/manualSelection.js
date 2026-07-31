import { routeData } from './routeData.js';
import { rpc, fetchStopsForDeparture } from './supabaseApi.js';

// Fallback path for the "no active duties" dead-end: driver picks a
// service/variant by hand instead of following a duty card. Produces the
// exact param bag runTracker() already expects from the duty-card path
// (see main.js launchDutyRoute), so runTracker() downstream needs zero
// changes regardless of which path produced it.
//
// initialStopIndex is always 0 here — deliberate "start of route" default
// for a picker-less flow, not a mirror of either existing flow's DOM
// <select> fallback.
export async function selectServiceManually(serviceCode, servicePeriod, { onComplete = () => {} } = {}) {
  const departureId = routeData[serviceCode]?.[servicePeriod];
  if (!departureId) {
    throw new Error(`Service/variant not found: ${serviceCode} / ${servicePeriod}`);
  }

  const [{ journey_id: journeyId }] = await rpc('get_or_create_manual_journey', {
    p_timetable_departure_id: departureId,
  });

  // Mirrors the duty-card path's start_journey call (main.js's
  // launchDutyRoute) — without this, journeys.status never leaves
  // 'scheduled', so the NextStop onboard display (which waits for
  // get_duty_card to report in_progress) never wakes, and complete_journey
  // silently no-ops at the end since it requires status = 'in_progress'.
  // No-ops harmlessly (returns false, doesn't throw) if already in_progress
  // from an earlier manual start today.
  await rpc('start_journey', { p_journey_id: journeyId });

  // Stops (and PSVAIR scope) come from schedule_view, same single source
  // of truth the duty-card path uses — never duplicated here.
  const { stops, psvairInScope } = await fetchStopsForDeparture(departureId);

  return {
    allStops: stops,
    journeyId,
    initialStopIndex: 0,
    serviceCode,
    servicePeriod,
    psvairEnabled: psvairInScope,
    onComplete,
  };
}
