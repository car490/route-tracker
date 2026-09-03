// src/announceStopEvent.js
//
// Single gate that main.js calls instead of announceState() directly, so
// diversion suppression lives in one place. (Announcement audio, and this
// gate with it, stays Driver-side only — the onboard sign is a pure
// pushed-state renderer, see src/onboard.js.)

import { announceState } from './announcements.js';
import { ANNOUNCE_STATES } from '../../shared/announceStates.js';

// PSVAIR event 2 — approaching a stop (gps.js's stopStates 'approaching'
// status — ETA-projected from speed, falling back to a distance band).
// stateKey/vars are already resolved (shared/announceStates.js's
// resolveApproachOrArrivalState) — this is purely the diversion gate.
export function announceApproachEvent(stateKey, vars, ids, diversionActive) {
  if (diversionActive) return;
  announceState(stateKey, vars, ids);
}

// PSVAIR events 3 & 4 — vehicle has stopped. While a diversion alert is
// active, every arrival re-announces the diversion instead of the normal
// arrival text — a repeating reminder for passengers boarding at each stop
// along the diverted section, same behaviour as before this rebuild.
export function announceStopEvent(stateKey, vars, ids, diversionActive) {
  if (diversionActive) {
    announceState(ANNOUNCE_STATES.DIVERSION, {}, {});
    return;
  }
  announceState(stateKey, vars, ids);
}
