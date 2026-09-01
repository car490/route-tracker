// PSVAIR 2026 (Public Service Vehicles Accessible Information Regulations 2023)
// Live audio + on-screen visual announcements of next stop / final destination
// for in-scope local bus services.
//
// Primary audio path: pre-rendered Azure Neural TTS clips (see
// scripts/generate-announcement-audio.mjs), keyed by stop_id/service+
// destination exactly as built there — natural recorded voice instead of
// whatever Web Speech API voice happens to be installed on a given
// tablet. Falls back to live Web Speech API synthesis (shared/speech.js —
// also announce/src/announceSpeech.js's only audio path, see that file)
// whenever a clip is missing (new stop not yet regenerated, offline before
// first cache, etc.) so announcements never silently stop working.
//
// The spoken text for every state comes from shared/announceStates.js's
// resolveAnnouncementText — the same function the onboard sign uses for its
// on-screen headline — so the two can never drift out of consistency with
// each other (PSVAIR Regulation 12(1)).

import { broadcastAnnounce } from './announceLink.js';
import { listVoices, pickVoice, speakUtterance } from '../../shared/speech.js';
import { ANNOUNCE_STATES, resolveAnnouncementText } from '../../shared/announceStates.js';

const MUTE_KEY = 'psvair-muted';
const VOICE_KEY = 'psvair-voice-uri';
const BANNER_SHOWN_KEY = 'psvair-banner-shown';
const AUDIO_BASE = './audio/announcements/';

let enabled = false;
let onAnnounce = null; // (text) => void, wired to the on-screen banner
let currentAudio = null; // in-flight pre-rendered clip, cleared once its sequence finishes
let isBusy = false; // true from the moment something starts playing until it fully finishes
// Holds at most the single most recent announcement that arrived while
// something else was playing — never a growing backlog. If a newer event
// supersedes it before its turn comes, it's simply overwritten and never
// heard, which is correct: a stale "approaching X" isn't worth playing once
// "stopped at X" has already superseded it.
let queued = null; // { text, audioKeys } | null

export function setAnnouncementsEnabled(v) {
  enabled = v;
}

export function isMuted() {
  return localStorage.getItem(MUTE_KEY) === '1';
}

// Stops whatever is currently audible — a live clip, a synthesis utterance,
// or both — and drops anything queued. Only used for muting: normal new
// announcements queue behind whatever's playing (see speak()) rather than
// cutting it off mid-sentence.
function stopCurrentPlayback() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  isBusy = false;
  queued = null;
}

export function setMuted(v) {
  localStorage.setItem(MUTE_KEY, v ? '1' : '0');
  if (v) stopCurrentPlayback();
}

// Whether the driver has opted to show the on-screen caption/mute/voice
// banner — shown by default; a driver who prefers it out of the way can
// collapse it (setBannerShown(false)), remembered from then on via the
// same key.
export function isBannerShown() {
  return localStorage.getItem(BANNER_SHOWN_KEY) !== '0';
}

export function setBannerShown(v) {
  localStorage.setItem(BANNER_SHOWN_KEY, v ? '1' : '0');
}

export { listVoices };

export function getSelectedVoiceURI() {
  return localStorage.getItem(VOICE_KEY) || '';
}

export function setSelectedVoiceURI(uri) {
  if (uri) localStorage.setItem(VOICE_KEY, uri);
  else localStorage.removeItem(VOICE_KEY);
}

export function onAnnouncementChange(fn) {
  onAnnounce = fn;
}

// NaPTAN stop names carry parenthetical indicators — "(opp)", "(adj)",
// "(o/s)", "(NW-bound)" etc. — useful for visually telling apart stops on
// either side of a road, but read awkwardly aloud by text-to-speech. Strip
// them for speech only; the on-screen text (onAnnounce below) keeps the
// full name.
function stripSpeechAnnotations(text) {
  return text.replace(/\s*\([^)]*\)/g, '');
}

// Same slug rule scripts/generate-announcement-audio.mjs uses to name
// per-service clips — must stay identical, since this is how the runtime
// finds the file the generator wrote for a given (serviceCode, destination).
function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Plays one pre-rendered clip. Resolves false (never rejects) on any
// failure — missing file, offline with nothing cached, decode error —
// so callers can fall back to live synthesis without a try/catch.
function playClip(key) {
  return new Promise((resolve) => {
    const audio = new Audio(`${AUDIO_BASE}${key}.mp3`);
    currentAudio = audio;
    audio.onended = () => resolve(true);
    audio.onerror = () => {
      console.warn(`[announcements] clip failed to load: ${key}.mp3`, audio.error);
      resolve(false);
    };
    audio.play().catch((err) => {
      console.warn(`[announcements] clip failed to play: ${key}.mp3`, err);
      resolve(false);
    });
  });
}

// All-or-nothing: if any clip in the sequence is missing, fall back to a
// single full-sentence speechSynthesis utterance rather than mixing a
// natural clip with a robotic one mid-announcement.
async function playSequence(keys) {
  for (const key of keys) {
    if (!(await playClip(key))) return false;
  }
  return true;
}

// Plays one announcement to completion, then plays whatever's queued (if
// anything arrived while this one was playing) — never both at once. See
// speak() below for why a new announcement queues instead of interrupting.
async function playNow(text, audioKeys) {
  isBusy = true;
  const ok = audioKeys && audioKeys.length ? await playSequence(audioKeys) : false;
  if (!ok) await speakUtterance(stripSpeechAnnotations(text), getSelectedVoiceURI() || null);
  currentAudio = null;
  isBusy = false;

  if (queued) {
    const next = queued;
    queued = null;
    playNow(next.text, next.audioKeys); // fire-and-forget — same as the original call
  }
}

// audioKeys: ordered list of pre-rendered clip keys (no .mp3/base path) to
// try first — omit/leave empty to go straight to live synthesis (used for
// previewVoice, and anywhere the caller has no stop/service id to key on).
//
// Queues rather than interrupts: cutting an announcement off mid-sentence
// to start a new one is worse than a short delay, and only the single most
// recent queued announcement is ever kept (see `queued` above), so a burst
// of fast events can't build up a stale backlog.
function speak(text, audioKeys) {
  if (isMuted()) return;
  if (isBusy) {
    queued = { text, audioKeys };
    return;
  }
  playNow(text, audioKeys);
}

// Lets the voice picker play a sample regardless of the mute toggle — the
// driver is explicitly asking to hear it, not receiving a real announcement.
export function previewVoice(voiceURI) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(
    'This is Example Street. The next stop will be Example Road.');
  utterance.lang = 'en-GB';
  const voice = listVoices().find((v) => v.voiceURI === voiceURI) || pickVoice(voiceURI);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function announce(text, audioKeys) {
  if (!enabled) return;
  // Broadcast to a commissioned Controller (docs/HARDWARE.md §4)
  // alongside local playback, not instead of it — most of the fleet
  // has no Controller deployed yet, so local playback stays the only
  // audio path for those vehicles; broadcastAnnounce is a no-op there
  // anyway (see its own comment). Gated on the same mute check speak()
  // itself applies below, so muting this device also mutes what it sends
  // onward rather than leaving the Controller to announce independently.
  if (!isMuted()) broadcastAnnounce(text, audioKeys);
  speak(text, audioKeys);
  if (onAnnounce) onAnnounce(text);
}

// ids carries whatever stop/service identifiers the current state needs to
// look up its pre-rendered clip(s) — a subset of { stopId, nextStopId,
// serviceCode, destination } depending on stateKey, all optional (missing
// ids just fall back to live synthesis, same as a missing clip file does).
function clipKeysFor(stateKey, vars, ids) {
  switch (stateKey) {
    case ANNOUNCE_STATES.ROUTE_START: {
      if (!ids.serviceCode || !ids.destination || !ids.stopId) return null;
      const keys = [
        `service/${slug(ids.serviceCode)}__${slug(stripSpeechAnnotations(ids.destination))}`,
        `arrive/${ids.stopId}`,
      ];
      if (ids.nextStopId) keys.push(`next/${ids.nextStopId}`);
      return keys;
    }
    case ANNOUNCE_STATES.STOP_DEPARTURE: {
      if (!ids.serviceCode || !ids.destination || !ids.nextStopId) return null;
      return [
        `service/${slug(ids.serviceCode)}__${slug(stripSpeechAnnotations(ids.destination))}`,
        `next/${ids.nextStopId}`,
      ];
    }
    case ANNOUNCE_STATES.AT_STOP:
      if (!ids.stopId) return null;
      return vars.isFinal ? [`arrive/${ids.stopId}`, 'terminus-tail'] : [`arrive/${ids.stopId}`];
    case ANNOUNCE_STATES.DIVERSION:
      return ['diversion'];
    default:
      return null;
  }
}

// The one PSVAIR announcement gateway — resolves the spoken text from the
// same shared template the onboard sign renders on screen, then plays the
// matching pre-rendered clip sequence (falling back to synthesis of that
// exact text if a clip is missing). See announceStopEvent.js for the call
// sites that decide which stateKey/vars apply and when.
export function announceState(stateKey, vars, ids = {}) {
  const text = resolveAnnouncementText(stateKey, vars);
  if (!text) return;
  announce(text, clipKeysFor(stateKey, vars, ids));
}
