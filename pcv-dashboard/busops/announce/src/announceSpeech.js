// Announce Solo's audio path. Plays the same pre-rendered Azure Neural TTS
// clips the Driver/Lite tier plays, from the `announcement-audio` Supabase
// Storage bucket, via the shared playback engine
// (shared/announcementAudio.js). Phase 3 of
// docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md ("never synthesize") removed the live
// speechSynthesis fallback entirely — on this tier's real hardware (Android
// WebView via a generic kiosk host) that fallback was already a graceful
// no-op in practice (speechSynthesis doesn't exist in that WebView at all,
// confirmed live), so a clip that isn't rendered/cached yet now plays no
// audio and reports a coverage gap instead (see onGap below), matching what
// this tier's real devices already experienced.
//
// Never imported by onboard.js itself — onboard.js stays purely visual (see
// its own header comment); only announceSoloAutopilot.js calls this, since
// that's the one producer with no Driver device around to speak on its
// behalf.

import { resolveAnnouncementText } from '../../shared/announceStates.js';
import { clipKeysFor, createAnnouncementPlayer } from '../../shared/announcementAudio.js';
import { recordAnnouncementCoverageGap } from '../../shared/announcementCoverage.js';

const player = createAnnouncementPlayer({
  onGap: (missingKeys, text, context) => {
    recordAnnouncementCoverageGap({
      journeyId: context && context.journeyId,
      vehicleId: context && context.vehicleId,
      deviceId: context && context.deviceId,
      missingKeys,
      stage: 'live_stop',
    });
  },
});

// ids carries whatever stop/service identifiers stateKey needs to look up
// its pre-rendered clip — a subset of { stopId, nextStopId, serviceCode,
// destination } depending on stateKey, all optional (missing ids resolve to
// no clip keys, same as a genuinely missing clip file does) — see
// shared/announcementAudio.js's clipKeysFor. ids may also carry
// journeyId/vehicleId/deviceId (Solo has no driverId — a Solo autopilot
// device isn't linked to a vehicle at all, so announceSoloAutopilot.js
// passes its own announce_devices.id as deviceId instead) — unused for
// clip-key lookup, only forwarded to onGap so a coverage-gap alert can be
// attributed.
export function speakState(stateKey, vars, ids = {}) {
  const text = resolveAnnouncementText(stateKey, vars);
  if (!text) return;
  player.speak(text, clipKeysFor(stateKey, vars, ids), {
    journeyId: ids.journeyId,
    vehicleId: ids.vehicleId,
    deviceId: ids.deviceId,
  });
}
