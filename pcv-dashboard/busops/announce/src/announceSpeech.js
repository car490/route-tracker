// Standalone Announce Lite's only audio path. This tier has no driver
// device and ships no pre-rendered clips (driver/audio/ is driver-only —
// see CLAUDE.md's repo layout) — speechSynthesis is the whole story here,
// not a fallback for a missing clip the way it is for the Driver device
// (driver/src/announcements.js). Never imported by onboard.js itself —
// onboard.js stays purely visual (see its own header comment); only
// announceStandaloneAutopilot.js calls this, since that's the one producer
// with no Driver device around to speak on its behalf.

import { speakUtterance } from '../../shared/speech.js';
import { resolveAnnouncementText } from '../../shared/announceStates.js';

let isBusy = false;
// Holds at most the single most recent announcement that arrived while
// something else was playing — same reasoning as driver/src/announcements.js's
// own queue: a stale "approaching X" isn't worth playing once something
// newer has already superseded it.
let queued = null; // { stateKey, vars } | null

async function playNow(stateKey, vars) {
  isBusy = true;
  await speakUtterance(resolveAnnouncementText(stateKey, vars));
  isBusy = false;

  if (queued) {
    const next = queued;
    queued = null;
    playNow(next.stateKey, next.vars); // fire-and-forget — same as the original call
  }
}

export function speakState(stateKey, vars) {
  const text = resolveAnnouncementText(stateKey, vars);
  if (!text) return;
  if (isBusy) {
    queued = { stateKey, vars };
    return;
  }
  playNow(stateKey, vars);
}
