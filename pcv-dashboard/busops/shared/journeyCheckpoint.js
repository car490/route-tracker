// shared/journeyCheckpoint.js
//
// Saves the trip in progress on the device as it runs, so a
// power cut mid-route (ignition off, flat tablet battery) loses nothing
// already recorded, and the trip can be picked up again on the next boot
// with or without signal (docs/HARDWARE.md "Power loss and first boot").
//
// Before this, arrival times for a trip lived only in the tracker's memory
// until completeTrip() uploaded them, and the only way back into a trip
// after a restart was a server lookup (activeJourneyRecovery.js), which
// needs signal.
//
// A checkpoint is resumable for 2 hours after it was last saved and only on
// the same UK day (owner, 2026-09-28; the same 2 hours the sign uses for a
// push it no longer trusts, announceDeviceFeed.js's STALE_PUSH_THRESHOLD_MS).
//
// Shared by the Driver PWA (driver/src/main.js) and Announce Solo
// (announce/src/announceSoloAutopilot.js), each under its own storage key
// (`key`, defaulting to the Driver's).
// Older than that it is "stale": not resumed, but its recorded stops are
// still handed back so main.js can queue them for upload rather than drop
// them.
//
// It holds ids, stop names/times/coordinates and arrival times: no token or
// other credential. Pure, injectable storage/clock, never throws — same
// conventions as localStore.js.

import { buildStopTimeRows } from './journeyStopTimes.js';

export const CHECKPOINT_KEY = 'busops.driver.journeyCheckpoint';
export const CHECKPOINT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const ukDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});

function isValid(c) {
  return !!c
    && typeof c.journeyId === 'string'
    && Array.isArray(c.stopRows)
    && Array.isArray(c.launch?.allStops) && c.launch.allStops.length > 0
    && !Number.isNaN(new Date(c.savedAt).getTime());
}

// { status: 'none' | 'fresh' | 'stale', checkpoint }
export function readCheckpoint({ storage = globalThis.localStorage, now = new Date(), key = CHECKPOINT_KEY } = {}) {
  let checkpoint = null;
  try {
    const raw = storage.getItem(key);
    if (raw) checkpoint = JSON.parse(raw);
  } catch (_) {
    checkpoint = undefined;
  }
  if (!checkpoint) {
    if (checkpoint === undefined) clearCheckpoint({ storage, key });
    return { status: 'none', checkpoint: null };
  }
  if (!isValid(checkpoint)) {
    clearCheckpoint({ storage, key });
    return { status: 'none', checkpoint: null };
  }
  const savedAt = new Date(checkpoint.savedAt);
  const fresh = now.getTime() - savedAt.getTime() <= CHECKPOINT_MAX_AGE_MS
    && ukDate.format(savedAt) === ukDate.format(now);
  return { status: fresh ? 'fresh' : 'stale', checkpoint };
}

export function clearCheckpoint({ storage = globalThis.localStorage, key = CHECKPOINT_KEY } = {}) {
  try {
    storage.removeItem(key);
  } catch (_) {}
}

// Stops recorded before the power cut come first and win: a stop recorded
// twice keeps its first (real) arrival time, the same row the server's
// ignore-duplicates upload would have kept.
export function mergeStopRows(savedRows, newRows) {
  const byStop = new Map();
  for (const row of [...(savedRows ?? []), ...(newRows ?? [])]) {
    if (!byStop.has(row.timetable_stop_id)) byStop.set(row.timetable_stop_id, row);
  }
  return [...byStop.values()];
}

// The stop to pre-select on the resume screen. The driver still confirms it:
// the same rule as every other resume path (activeJourneyRecovery.js's
// header comment).
export function suggestedResumeIndex(checkpoint) {
  const last = checkpoint.launch.allStops.length - 1;
  const idx = Number.isInteger(checkpoint.nextStopIndex) ? checkpoint.nextStopIndex : 0;
  return Math.min(Math.max(idx, 0), last);
}

// One per runTracker() call. Picks up the rows of a checkpoint already saved
// for this same journey (a resumed trip); `previous` exposes a checkpoint
// left by a different journey so the caller can queue its rows for upload
// before this trip overwrites it.
export function createCheckpointRecorder({
  journeyId, launch,
  storage = globalThis.localStorage,
  now = () => new Date(),
  key = CHECKPOINT_KEY,
}) {
  const existing = readCheckpoint({ storage, now: now(), key }).checkpoint;
  const sameJourney = existing?.journeyId === journeyId;
  const priorRows = sameJourney ? existing.stopRows : [];
  let lastWritten = null;

  function finalRows(stopStates) {
    return mergeStopRows(priorRows, buildStopTimeRows(journeyId, stopStates, launch.allStops));
  }

  function record({ stopStates, nextStopIndex }) {
    const stopRows = finalRows(stopStates);
    const signature = JSON.stringify([nextStopIndex, stopRows]);
    if (signature === lastWritten) return;
    try {
      storage.setItem(key, JSON.stringify({
        journeyId, launch, stopRows, nextStopIndex, savedAt: now().toISOString(),
      }));
      lastWritten = signature;
    } catch (_) {}
  }

  return {
    previous: existing && !sameJourney ? existing : null,
    record,
    finalRows,
    clear: () => clearCheckpoint({ storage, key }),
  };
}
