// src/activeJourneyRecovery.js
//
// BusOps Driver — manual-selection/cab-device active-journey recovery on
// boot. Pure decision logic only, zero imports — same separation as
// announceDeviceLink.js/diversionAlert.js: no Supabase calls here, so it's
// unit-testable without a DOM/window. The RPC call itself
// (fetchActiveManualJourney) lives in supabaseApi.js.
//
// Scope, confirmed with the user before building this: the duty-card flow
// already has its own (semi-manual) "Resume Route" path — main.js's
// renderDutyCard()/launchDutyRoute() — and is untouched here. This only
// covers the manual-selection/cab-device flow (CAB-DEVICE-SETUP.md), which
// previously had no recovery at all — a reload always landed on "No duty
// assigned" even mid-route. Recovery jumps straight to the stop-confirm
// picker with the active journey's stops preloaded; it deliberately does
// NOT auto-pick the current stop index — the driver still confirms it, same
// trust level as the existing duty-card Resume button (see the plan's own
// discussion of GPS-derived-index risk: ambiguous stops near a shared
// terminus, stale recovery state, no human check on a PSVAIR-facing
// surface).

export const BOOT_ACTION = Object.freeze({
  DUTY_CARD:      'duty-card',
  VEHICLE_SETUP:  'vehicle-setup',
  RESUME_ACTIVE:  'resume-active-journey',
  NO_DUTY:        'no-duty',
});

// dutiesParam: the ?duties= URL param (string or null) — duty-card flow
// always wins when present, unchanged from before this feature existed.
// storedVehicleId: the device's commissioned vehicle (vehicleSetup.js), or
// null if never commissioned.
// activeJourney: the row returned by fetchActiveManualJourney(), or null
// if none/not found/lookup failed (a failed lookup is treated as "none" by
// the caller, not surfaced here — this function only sees the resolved
// value).
// now: injectable clock for tests.
//
// Only a journey started today (UK date) is resumed. One left 'in_progress'
// from an earlier day was abandoned mid-route (a test drive, a trip that
// never reached its last stop), not interrupted by a reload — resuming it
// put the driver on an old trip's "select a starting stop" screen instead
// of "No duty assigned". Owner's cut-off, 2026-09-27: end of the day.
export function resolveBootAction({ dutiesParam, storedVehicleId, activeJourney, now = new Date() }) {
  if (dutiesParam) return BOOT_ACTION.DUTY_CARD;
  if (!storedVehicleId) return BOOT_ACTION.VEHICLE_SETUP;
  if (activeJourney && startedToday(activeJourney.started_at, now)) return BOOT_ACTION.RESUME_ACTIVE;
  return BOOT_ACTION.NO_DUTY;
}

const ukDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});

// A missing or unparseable started_at can't be shown to be today, so it
// isn't resumed; the driver can still pick the same departure manually.
export function startedToday(startedAt, now) {
  if (!startedAt) return false;
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return false;
  return ukDate.format(started) === ukDate.format(now);
}
