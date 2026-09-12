// Clip-key resolution and pre-rendered-clip playback engine shared between
// the Driver/Lite tier (driver/src/announcements.js) and Announce Solo
// (announce/src/announceSpeech.js). Extracted from driver/src/announcements.js
// 2026-09-07 so Solo can play the same natural recorded voice Driver/Lite
// already does, instead of relying on speechSynthesis alone — which doesn't
// exist at all in this tier's real Android WebView (confirmed live; see
// announce/src/announceSpeech.js's header comment).
//
// clipKeysFor's key scheme must stay identical to
// scripts/generate-announcement-audio.mjs's own job keys — no shared import
// between a browser module and that Node script, so keep them in sync by
// hand.

import { speakUtterance } from './speech.js';
import { ANNOUNCE_STATES } from './announceStates.js';

// NaPTAN stop names carry parenthetical indicators — "(opp)", "(adj)",
// "(o/s)", "(NW-bound)" etc. — useful for visually telling apart stops on
// either side of a road, but read awkwardly aloud by text-to-speech. Strip
// them for speech only; on-screen text keeps the full name.
function stripSpeechAnnotations(text) {
  return text.replace(/\s*\([^)]*\)/g, '');
}

// Same slug rule scripts/generate-announcement-audio.mjs uses to name
// per-service clips — must stay identical, since this is how the runtime
// finds the file the generator wrote for a given (serviceCode, destination).
function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ids carries whatever stop/service identifiers the current state needs to
// look up its pre-rendered clip(s) — a subset of { stopId, nextStopId,
// serviceCode, destination } depending on stateKey, all optional (missing
// ids just fall back to live synthesis, same as a missing clip file does).
//
//   service/<code>__<dest>  ROUTE_START, once per journey
//   approach/<stopId>       "This is X."               (APPROACHING, any stop)
//   departure/<stopId>      "The next stop is X."       (STOP_DEPARTURE, keyed
//                            by the *next* stop's id)
//   terminus                "This service terminates here, all change
//                            please." — fixed text, no stop name
//   diversion               "Attention, this bus is on diversion." — fixed
export function clipKeysFor(stateKey, vars, ids) {
  switch (stateKey) {
    case ANNOUNCE_STATES.ROUTE_START: {
      if (!ids.serviceCode || !ids.destination) return null;
      return [`service/${slug(ids.serviceCode)}__${slug(stripSpeechAnnotations(ids.destination))}`];
    }
    case ANNOUNCE_STATES.STOP_DEPARTURE:
      if (!ids.nextStopId) return null;
      return [`departure/${ids.nextStopId}`];
    case ANNOUNCE_STATES.APPROACHING:
      if (!ids.stopId) return null;
      return [`approach/${ids.stopId}`];
    case ANNOUNCE_STATES.AT_STOP:
      return ['terminus'];
    case ANNOUNCE_STATES.DIVERSION:
      return ['diversion'];
    default:
      return null;
  }
}

// Plays one pre-rendered clip. Resolves false (never rejects) on any
// failure — missing file, offline with nothing cached, decode error — so
// callers can fall back to live synthesis without a try/catch.
function playClip(audioBase, key, setCurrentAudio) {
  return new Promise((resolve) => {
    const audio = new Audio(`${audioBase}${key}.mp3`);
    setCurrentAudio(audio);
    audio.onended = () => resolve(true);
    audio.onerror = () => {
      console.warn(`[announcementAudio] clip failed to load: ${key}.mp3`, audio.error);
      resolve(false);
    };
    audio.play().catch((err) => {
      console.warn(`[announcementAudio] clip failed to play: ${key}.mp3`, err);
      resolve(false);
    });
  });
}

// All-or-nothing: if any clip in the sequence is missing, fall back to a
// single full-sentence speechSynthesis utterance rather than mixing a
// natural clip with a robotic one mid-announcement.
async function playSequence(audioBase, keys, setCurrentAudio) {
  for (const key of keys) {
    if (!(await playClip(audioBase, key, setCurrentAudio))) return false;
  }
  return true;
}

// Creates one playback engine with its own busy/queued/currentAudio state —
// call once per surface (Driver, Solo) rather than sharing a single
// instance, so the two tiers' playback never contend over the same state.
//
// audioBase is the clip directory: a relative path from the caller's own
// page (Driver, './audio/announcements/') or an absolute path from site
// root (Solo, '/driver/audio/announcements/' — announce/ and driver/ deploy
// under the same origin, see CLAUDE.md's Wrangler setup, so this is simpler
// than maintaining two different relative paths to the same clips).
export function createAnnouncementPlayer(audioBase) {
  let currentAudio = null; // in-flight pre-rendered clip, cleared once its sequence finishes
  let isBusy = false; // true from the moment something starts playing until it fully finishes
  // Holds at most the single most recent announcement that arrived while
  // something else was playing — never a growing backlog. If a newer event
  // supersedes it before its turn comes, it's simply overwritten and never
  // heard, which is correct: a stale "approaching X" isn't worth playing
  // once "stopped at X" has already superseded it.
  let queued = null; // { text, audioKeys } | null

  async function playNow(text, audioKeys) {
    isBusy = true;
    const ok = audioKeys && audioKeys.length
      ? await playSequence(audioBase, audioKeys, (audio) => { currentAudio = audio; })
      : false;
    if (!ok) await speakUtterance(stripSpeechAnnotations(text));
    currentAudio = null;
    isBusy = false;

    if (queued) {
      const next = queued;
      queued = null;
      playNow(next.text, next.audioKeys); // fire-and-forget — same as the original call
    }
  }

  return {
    // audioKeys: ordered list of pre-rendered clip keys (no .mp3/base path)
    // to try first — omit/leave empty to go straight to live synthesis
    // (used for previewVoice, and anywhere the caller has no stop/service
    // id to key on).
    //
    // Queues rather than interrupts: cutting an announcement off
    // mid-sentence to start a new one is worse than a short delay, and only
    // the single most recent queued announcement is ever kept (see `queued`
    // above), so a burst of fast events can't build up a stale backlog.
    speak(text, audioKeys) {
      if (isBusy) {
        queued = { text, audioKeys };
        return;
      }
      playNow(text, audioKeys);
    },
    // Stops whatever is currently audible — a live clip, a synthesis
    // utterance, or both — and drops anything queued.
    stop() {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
      isBusy = false;
      queued = null;
    },
  };
}
