// src/announceStopEvent.js
//
// Slice 2: Driver-Triggered Diversion Alert
// Single gate that main.js and onboard.js call instead of announceAtStop/
// announceApproaching directly, so diversion suppression lives in one place.

import { announceApproaching, announceAtStop, announceDiversion } from './announcements.js';

// PSVAIR event 2 — approaching a stop (gps.js's stopStates 'approaching'
// status — ETA-projected from speed, falling back to a distance band).
// Silent for the final stop by design: that gets one combined announcement
// at arrival instead (event 4, via announceStopEvent below), not a
// separate heads-up.
export function announceApproachEvent({ stopId, stopName, isFinal, diversionActive }) {
  if (diversionActive || isFinal) return;
  announceApproaching({ stopId, stopName });
}

// PSVAIR events 3 & 4 — vehicle has stopped.
export function announceStopEvent({ nextStopId, nextStopName, isFinal, diversionActive, serviceCode, destination }) {
  if (diversionActive) {
    announceDiversion();
    return;
  }
  announceAtStop({ nextStopId, nextStopName, isFinal, serviceCode, destination });
}
