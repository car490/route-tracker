// PSVAIR 2026 (Public Service Vehicles Accessible Information Regulations 2023)
// Live audio + on-screen visual announcements of next stop / final destination
// for in-scope local bus services.
//
// Primary audio path: pre-rendered Azure Neural TTS clips (see
// scripts/generate-announcement-audio.mjs), keyed by stop_id/service+
// destination exactly as built there — natural recorded voice instead of
// whatever Web Speech API voice happens to be installed on a given
// tablet. Falls back to live Web Speech API synthesis whenever a clip is
// missing (new stop not yet regenerated, offline before first cache, etc.)
// so announcements never silently stop working.

const MUTE_KEY = 'psvair-muted';
const VOICE_KEY = 'psvair-voice-uri';
const AUDIO_BASE = './audio/announcements/';

// Known-good warmer-sounding voices, checked in order, across the platforms
// drivers actually use (Android Chrome, iOS Safari, Windows Edge/Chrome).
// First one installed on the device wins; if none match we fall back to the
// first en-GB voice, then whatever the browser gives us.
const PREFERRED_VOICE_NAMES = [
  'Google UK English Female',
  'Microsoft Sonia Online (Natural) - English (United Kingdom)',
  'Serena',
  'Microsoft Hazel',
  'Moira',
  'Karen',
];

let enabled = false;
let onAnnounce = null; // (text) => void, wired to the on-screen banner
let currentAudio = null; // in-flight pre-rendered clip, so mute can stop it mid-playback

export function setAnnouncementsEnabled(v) {
  enabled = v;
}

export function isMuted() {
  return localStorage.getItem(MUTE_KEY) === '1';
}

// Stops whatever is currently audible — a live clip, a synthesis utterance,
// or both — so a new announcement never overlaps one still in progress.
function stopCurrentPlayback() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

export function setMuted(v) {
  localStorage.setItem(MUTE_KEY, v ? '1' : '0');
  if (v) stopCurrentPlayback();
}

// speechSynthesis.getVoices() only returns the full list once the
// 'voiceschanged' event has fired on some browsers (notably Chrome) — callers
// populating a voice picker should also listen for that event themselves.
export function listVoices() {
  if (!('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices()
    .filter(v => v.lang.startsWith('en'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getSelectedVoiceURI() {
  return localStorage.getItem(VOICE_KEY) || '';
}

export function setSelectedVoiceURI(uri) {
  if (uri) localStorage.setItem(VOICE_KEY, uri);
  else localStorage.removeItem(VOICE_KEY);
}

function pickVoice() {
  const voices = listVoices();
  if (!voices.length) return null;

  const savedURI = getSelectedVoiceURI();
  const saved = savedURI && voices.find(v => v.voiceURI === savedURI);
  if (saved) return saved;

  for (const name of PREFERRED_VOICE_NAMES) {
    const match = voices.find(v => v.name === name);
    if (match) return match;
  }
  return voices.find(v => v.lang === 'en-GB') || voices[0];
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

function speakSynthesis(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(stripSpeechAnnotations(text));
  utterance.lang = 'en-GB';
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

// audioKeys: ordered list of pre-rendered clip keys (no .mp3/base path) to
// try first — omit/leave empty to go straight to live synthesis (used for
// previewVoice, and anywhere the caller has no stop/service id to key on).
function speak(text, audioKeys) {
  if (isMuted()) return;
  stopCurrentPlayback();
  if (audioKeys && audioKeys.length) {
    playSequence(audioKeys).then((ok) => { if (!ok) speakSynthesis(text); });
    return;
  }
  speakSynthesis(text);
}

// Lets the voice picker play a sample regardless of the mute toggle — the
// driver is explicitly asking to hear it, not receiving a real announcement.
export function previewVoice(voiceURI) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(
    'This is Example Street. The next stop will be Example Road.');
  utterance.lang = 'en-GB';
  const voice = listVoices().find(v => v.voiceURI === voiceURI) || pickVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function announce(text, audioKeys) {
  if (!enabled) return;
  speak(text, audioKeys);
  if (onAnnounce) onAnnounce(text);
}

// destination is the last stop's (display) name, exactly as passed by
// main.js/onboard.js — must match what the generator stripped/slugged for
// the same route, or the clip lookup misses and falls back to synthesis
// (not a bug, just a wasted clip until names line up again).
//
// PSVAIR event 1 (Start pressed): announces route+destination, then the
// starting stop, then the stop after it — all three as one spoken block.
export function announceJourneyStart({ serviceCode, destination, firstStopId, firstStopName, nextStopId, nextStopName }) {
  const clean = stripSpeechAnnotations(destination);
  const serviceKey = `service/${slug(serviceCode)}__${slug(clean)}`;
  const text = `This is a ${serviceCode} to ${clean}. This stop is ${firstStopName}. The next stop will be ${nextStopName}.`;
  const keys = firstStopId && nextStopId ? [serviceKey, `stop/${firstStopId}`, `next/${nextStopId}`] : null;
  announce(text, keys);
}

// PSVAIR event 2 (approaching a stop, ~250m out — see gps.js): names the
// stop about to be reached. Never called for the final stop — that's
// event 4's job instead (see announceStopEvent.js's announceApproachEvent).
export function announceApproaching({ stopId, stopName }) {
  announce(`This is ${stopName}.`, stopId ? [`arrive/${stopId}`] : null);
}

// PSVAIR events 3 & 4 (vehicle has stopped): a non-final stop repeats
// route+destination and names the next stop, for passengers boarding here.
// The final stop instead gets one fixed announcement — no stop name at all,
// since event 2's approach announcement or the on-screen sign already named
// it moments earlier.
export function announceAtStop({ nextStopId, nextStopName, isFinal, serviceCode, destination }) {
  if (isFinal) {
    announce(
      'This is the final stop. This bus terminates here, all change please.',
      ['final-stop', 'terminus-tail']
    );
  } else {
    const clean = stripSpeechAnnotations(destination);
    const serviceKey = `service/${slug(serviceCode)}__${slug(clean)}`;
    announce(
      `This is a ${serviceCode} to ${clean}, the next stop will be ${nextStopName}.`,
      serviceCode && destination && nextStopId ? [serviceKey, `next/${nextStopId}`] : null
    );
  }
}

// Fixed string only — takes no parameters, deliberately, so the "diversion
// announcements can never carry dynamic/free-text content" property is
// enforced at this TTS gateway itself, not just by callers behaving.
export function announceDiversion() {
  announce('This bus is on diversion', ['diversion']);
}
