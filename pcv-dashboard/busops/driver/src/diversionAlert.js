// src/diversionAlert.js
//
// Slice 2: Driver-Triggered Diversion Alert
// Pure state-transition logic for the driver-facing trigger/clear button.
// No Supabase calls here — the caller is responsible for persisting the
// diversion_alert_event row; this module only decides what should happen
// and carries the fixed announcement text.
//
// The announcement text is fixed here and never taken from a caller-supplied
// field, matching announceDiversion()'s zero-argument contract in
// src/announcements.js — there is no path for free text to reach either.

const ANNOUNCEMENT_TEXT = 'This bus is on diversion';

export function triggerDiversionAlert(activeJourney, { existingAlertState } = {}) {
  if (!activeJourney) {
    return { status: 'rejected', reason: 'no_active_journey' };
  }

  if (existingAlertState && existingAlertState.active) {
    return { status: 'already_active', queued: false };
  }

  return {
    status: 'fired',
    journey_id: activeJourney.journey_id,
    announcementText: ANNOUNCEMENT_TEXT,
    alertState: {
      active: true,
      journey_id: activeJourney.journey_id,
      vehicle_id: activeJourney.vehicle_id,
      driver_id: activeJourney.driver_id,
    },
  };
}

export function clearDiversionAlert(alertState) {
  if (!alertState) {
    return { status: 'no_op' };
  }

  return { status: 'cleared', diversionActive: false };
}
