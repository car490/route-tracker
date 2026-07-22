// src/announceStopEvent.js
//
// Slice 2: Driver-Triggered Diversion Alert
// Single gate that main.js and onboard.js call instead of announceAtStop
// directly, so diversion suppression lives in one place.

import { announceAtStop, announceDiversion } from './announcements.js';

export function announceStopEvent({ stopName, nextStopName, isFinal, diversionActive }) {
  if (diversionActive) {
    announceDiversion();
    return;
  }
  announceAtStop({ stopName, nextStopName, isFinal });
}
