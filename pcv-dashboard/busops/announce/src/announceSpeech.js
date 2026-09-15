// Announce Solo's audio path. Tries the same pre-rendered Azure Neural TTS
// clips the Driver/Lite tier plays (driver/audio/announcements/, served
// from the same origin as this app — see AUDIO_BASE below) via the shared
// playback engine (shared/announcementAudio.js), falling back to live
// speechSynthesis exactly like Driver/Lite does for a clip that isn't
// rendered/cached yet. On this tier's real hardware (Android WebView via a
// generic kiosk host) that fallback is currently still a graceful no-op —
// speechSynthesis doesn't exist in that WebView at all, confirmed live —
// but it's no regression, and becomes real coverage on any device that
// does have it.
//
// Never imported by onboard.js itself — onboard.js stays purely visual (see
// its own header comment); only announceSoloAutopilot.js calls this, since
// that's the one producer with no Driver device around to speak on its
// behalf.

import { resolveAnnouncementText } from '../../shared/announceStates.js';
import { clipKeysFor, createAnnouncementPlayer } from '../../shared/announcementAudio.js';

// Absolute path from site root, not a relative one — announce/ and driver/
// deploy under the same origin (see CLAUDE.md's Wrangler setup at
// pcv-dashboard/busops/), so this is simpler than maintaining two different
// relative paths to what's really the same clip directory.
const AUDIO_BASE = '/driver/audio/announcements/';

const player = createAnnouncementPlayer(AUDIO_BASE);

// ids carries whatever stop/service identifiers stateKey needs to look up
// its pre-rendered clip — a subset of { stopId, nextStopId, serviceCode,
// destination } depending on stateKey, all optional (missing ids just fall
// back to live synthesis, same as a missing clip file does) — see
// shared/announcementAudio.js's clipKeysFor.
export function speakState(stateKey, vars, ids = {}) {
  const text = resolveAnnouncementText(stateKey, vars);
  if (!text) return;
  player.speak(text, clipKeysFor(stateKey, vars, ids));
}
