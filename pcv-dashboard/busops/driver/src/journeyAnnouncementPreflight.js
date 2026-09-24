// Phase 3 of docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md ("never synthesize") --
// journey-start half of the checklist. Driver-only: only this tier has an
// explicit "journey start" moment (a picker screen, then a Start button) to
// run a preflight check against -- Solo is autopilot-driven with no
// equivalent moment, so its coverage gaps only ever surface at the
// live-per-stop layer (see shared/announcementAudio.js's onGap wiring).
//
// Pure/testable on purpose: this returns a plain result rather than touching
// the DOM itself, so main.js's three journey-start call sites (duty card,
// resume, manual selection) decide what UI (showInfoBanner) to show, and
// this can be unit-tested without runTracker or a real page (main.js itself
// has no test file today -- see journeyAnnouncementPreflight.test.js).

import { ANNOUNCE_STATES } from '../../shared/announceStates.js';
import { clipKeysFor } from '../../shared/announcementAudio.js';
import { fetchConfirmedClipKeys, recordAnnouncementCoverageGap } from '../../shared/announcementCoverage.js';

// Every clip key a journey over allStops could possibly need: the one
// ROUTE_START key, an approach/departure pair per stop (any stop could be
// "the next stop" for a STOP_DEPARTURE announcement, and any stop can be
// approached), plus the two fixed-text keys (terminus, diversion) that carry
// no stop id at all. Reuses clipKeysFor (shared/announcementAudio.js) rather
// than re-deriving the key scheme, so this can never drift from what
// playback actually looks up.
export function computeRequiredClipKeys(allStops, serviceCode, destination) {
  const keys = new Set();
  const add = (list) => (list || []).forEach((key) => keys.add(key));

  add(clipKeysFor(ANNOUNCE_STATES.ROUTE_START, {}, { serviceCode, destination }));
  add(clipKeysFor(ANNOUNCE_STATES.AT_STOP, {}, {}));
  add(clipKeysFor(ANNOUNCE_STATES.DIVERSION, {}, {}));

  for (const stop of allStops) {
    add(clipKeysFor(ANNOUNCE_STATES.APPROACHING, {}, { stopId: stop.stop_id }));
    add(clipKeysFor(ANNOUNCE_STATES.STOP_DEPARTURE, {}, { nextStopId: stop.stop_id }));
  }

  return [...keys];
}

// Plain-English banner body for a set of missing clip keys. Only approach/
// departure keys name a stop (counted once per stop); the route-start,
// terminus and diversion clips are named for what they are, so a missing
// route-start clip no longer reads as "1 stop".
export function describeMissingAudio(missingKeys) {
  const stopIds = new Set();
  let routeStart = false;
  let terminus = false;
  let diversion = false;

  for (const key of missingKeys) {
    if (key.startsWith('service/')) routeStart = true;
    else if (key === 'terminus') terminus = true;
    else if (key === 'diversion') diversion = true;
    else stopIds.add(key.slice(key.indexOf('/') + 1));
  }

  const parts = [];
  if (routeStart) parts.push('the route start announcement');
  if (stopIds.size) parts.push(`${stopIds.size} stop${stopIds.size === 1 ? '' : 's'} on this route`);
  if (terminus) parts.push('the end of route announcement');
  if (diversion) parts.push('the diversion announcement');

  const list = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : parts[0];
  return `Audio not yet ready for ${list}. The screen will still show every stop.`;
}

// Never blocks journey start -- this only reports what's missing so the
// caller can show a non-blocking warning and move on; runTracker fires
// regardless of this call's outcome (or even its failure -- callers should
// treat a rejected promise the same as "couldn't confirm", not stop the
// journey over it).
export async function checkAnnouncementCoverage({ allStops, serviceCode, destination, journeyId, vehicleId, driverId }) {
  const required = computeRequiredClipKeys(allStops, serviceCode, destination);
  const confirmed = await fetchConfirmedClipKeys(required);
  const missingKeys = required.filter((key) => !confirmed.has(key));

  if (missingKeys.length) {
    await recordAnnouncementCoverageGap({ journeyId, vehicleId, driverId, missingKeys, stage: 'journey_start' });
  }

  return { missingCount: missingKeys.length, missingKeys };
}
