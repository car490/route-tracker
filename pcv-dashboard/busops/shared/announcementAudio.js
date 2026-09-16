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
//
// Phase 2 of docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md: playback now tries the
// server-rendered clip in the `announcement-audio` Supabase Storage bucket
// first (kept in sync automatically by Phase 1's trigger+cron pipeline),
// falling back to the bundled `driver/audio/announcements/` copy the old
// manual `npm run generate:audio` script produces — a **temporary** fallback
// for the transition, per that doc's Rollout step 2, removed once parity is
// proven on dev then production.
//
// Phase 3 ("never synthesize"): if neither source has a working clip, this
// module no longer falls back to live speechSynthesis at all — see
// createAnnouncementPlayer's onGap below. A stop with no confirmed clip
// plays no audio, ever; the caller's onAnnounce/onGap callbacks are what let
// it still show visual text and record a loud ops-facing alert instead.

import { ANNOUNCE_STATES } from './announceStates.js';
import { SUPABASE_URL } from '../driver/src/config.js';

// Public Storage bucket -- anon-readable by design (see
// supabase/migration_announcement_audio_bucket.sql), so no key/auth needed
// to fetch a clip, same trust level as the bundled .mp3 files this replaces.
// Exported so tests assert against this single source of truth rather than
// reconstructing the URL a second time.
export const STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/announcement-audio/`;

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
// ids resolve to no clip keys, same as a genuinely missing clip file does —
// see createAnnouncementPlayer's onGap for what happens then).
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

// Plays one clip from a single URL. Resolves false (never rejects) on any
// failure — missing file, offline with nothing cached, decode error — so
// callers can try the next source (or fall back to live synthesis) without
// a try/catch.
function playClipFromUrl(url, setCurrentAudio) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    setCurrentAudio(audio);
    audio.onended = () => resolve(true);
    audio.onerror = () => {
      console.warn(`[announcementAudio] clip failed to load: ${url}`, audio.error);
      resolve(false);
    };
    audio.play().catch((err) => {
      console.warn(`[announcementAudio] clip failed to play: ${url}`, err);
      resolve(false);
    });
  });
}

// Tries the Storage-backed clip first, then the bundled fallback copy — see
// this file's header comment. Only the second attempt uses audioBase, so a
// clip Phase 1's pipeline hasn't rendered yet (or a transient Storage
// failure) still plays from whatever shipped with the last deploy, same
// reliability as before Phase 2.
function playClip(audioBase, key, setCurrentAudio) {
  return playClipFromUrl(`${STORAGE_BASE}${key}.mp3`, setCurrentAudio)
    .then((ok) => (ok ? true : playClipFromUrl(`${audioBase}${key}.mp3`, setCurrentAudio)));
}

// All-or-nothing: if any clip in the sequence is missing, the whole
// announcement plays no audio rather than mixing a natural clip with dead
// air partway through (see Phase 3's removal of the old speechSynthesis
// fallback below). Reports the first key that had no working source (neither
// Storage nor bundled) so the caller can record a coverage-gap alert.
async function playSequence(audioBase, keys, setCurrentAudio) {
  for (const key of keys) {
    if (!(await playClip(audioBase, key, setCurrentAudio))) return { ok: false, missingKey: key };
  }
  return { ok: true };
}

// Creates one playback engine with its own busy/queued/currentAudio state —
// call once per surface (Driver, Solo) rather than sharing a single
// instance, so the two tiers' playback never contend over the same state.
//
// audioBase is the *bundled-fallback* clip directory, tried only after the
// Storage-backed clip fails (see playClip above): a relative path from the
// caller's own page (Driver, './audio/announcements/') or an absolute path
// from site root (Solo, '/driver/audio/announcements/' — announce/ and
// driver/ deploy under the same origin, see CLAUDE.md's Wrangler setup, so
// this is simpler than maintaining two different relative paths to the same
// clips).
//
// onGap(missingKeys, text, context), optional: called instead of ever
// falling back to speechSynthesis (Phase 3, "never synthesize" — see docs/
// ANNOUNCEMENT-AUDIO-SYNC-PLAN.md) whenever neither clip source has a
// working file for this announcement. Callers (driver/src/announcements.js,
// announce/src/announceSpeech.js) wire this to
// shared/announcementCoverage.js's recordAnnouncementCoverageGap, using
// `context` (see speak() below) for the journeyId/vehicleId/driverId that
// call needs. Playback itself plays nothing in this case — the caller's own
// onAnnounce-style callback is what still shows the visual text, unaffected
// by this.
export function createAnnouncementPlayer(audioBase, { onGap } = {}) {
  let currentAudio = null; // in-flight pre-rendered clip, cleared once its sequence finishes
  let isBusy = false; // true from the moment something starts playing until it fully finishes
  // Holds at most the single most recent announcement that arrived while
  // something else was playing — never a growing backlog. If a newer event
  // supersedes it before its turn comes, it's simply overwritten and never
  // heard, which is correct: a stale "approaching X" isn't worth playing
  // once "stopped at X" has already superseded it.
  let queued = null; // { text, audioKeys, context } | null

  async function playNow(text, audioKeys, context) {
    isBusy = true;
    const result = audioKeys && audioKeys.length
      ? await playSequence(audioBase, audioKeys, (audio) => { currentAudio = audio; })
      : { ok: false };
    if (!result.ok && onGap) onGap(result.missingKey ? [result.missingKey] : (audioKeys || []), text, context);
    currentAudio = null;
    isBusy = false;

    if (queued) {
      const next = queued;
      queued = null;
      playNow(next.text, next.audioKeys, next.context); // fire-and-forget — same as the original call
    }
  }

  return {
    // audioKeys: ordered list of pre-rendered clip keys (no .mp3/base path)
    // to try — omit/leave empty to play nothing and report a gap via onGap
    // (any caller with no stop/service id to key on hits this; previewVoice
    // in announcements.js bypasses this player entirely, calling
    // window.speechSynthesis directly, since it's a settings/testing
    // feature, not a live passenger announcement).
    //
    // context: opaque, passed straight through to onGap alongside the
    // missing keys (e.g. { journeyId, vehicleId, driverId }) — this module
    // has no opinion on its shape, it just carries whatever the caller needs
    // to record a coverage-gap alert for *this* announcement.
    //
    // Queues rather than interrupts: cutting an announcement off
    // mid-sentence to start a new one is worse than a short delay, and only
    // the single most recent queued announcement is ever kept (see `queued`
    // above), so a burst of fast events can't build up a stale backlog.
    speak(text, audioKeys, context) {
      if (isBusy) {
        queued = { text, audioKeys, context };
        return;
      }
      playNow(text, audioKeys, context);
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
