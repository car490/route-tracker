// PSVAIR 2026 (Public Service Vehicles Accessible Information Regulations 2023)
// Live audio + on-screen visual announcements of next stop / final destination
// for in-scope local bus services.
//
// Primary audio path: pre-rendered Azure Neural TTS clips (see
// scripts/generate-announcement-audio.mjs), keyed by stop_id/service+
// destination exactly as built there — natural recorded voice instead of
// whatever Web Speech API voice happens to be installed on a given
// tablet. Falls back to live Web Speech API synthesis (shared/speech.js)
// whenever a clip is missing (new stop not yet regenerated, offline before
// first cache, etc.) so announcements never silently stop working. The
// clip-key scheme and playback engine live in shared/announcementAudio.js —
// announce/src/announceSpeech.js (Announce Solo) uses the same one, since
// that tier has no Driver device of its own to speak on its behalf.
//
// The spoken text for every state comes from shared/announceStates.js's
// resolveAnnouncementText — the same function the onboard sign uses for its
// on-screen headline — so the two can never drift out of consistency with
// each other (PSVAIR Regulation 12(1)).

import { broadcastAnnounce } from './announceLink.js';
import { listVoices, pickVoice } from '../../shared/speech.js';
import { resolveAnnouncementText } from '../../shared/announceStates.js';
import { clipKeysFor, createAnnouncementPlayer } from '../../shared/announcementAudio.js';

const MUTE_KEY = 'psvair-muted';
const VOICE_KEY = 'psvair-voice-uri';
const BANNER_SHOWN_KEY = 'psvair-banner-shown';
const AUDIO_BASE = './audio/announcements/';

const player = createAnnouncementPlayer(AUDIO_BASE);

let enabled = false;
let onAnnounce = null; // (text) => void, wired to the on-screen banner

export function setAnnouncementsEnabled(v) {
  enabled = v;
}

export function isMuted() {
  return localStorage.getItem(MUTE_KEY) === '1';
}

export function setMuted(v) {
  localStorage.setItem(MUTE_KEY, v ? '1' : '0');
  // Only used for muting: normal new announcements queue behind whatever's
  // playing (see speak() below) rather than cutting it off mid-sentence.
  if (v) player.stop();
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

// Queues rather than interrupts: cutting an announcement off mid-sentence
// to start a new one is worse than a short delay (see createAnnouncementPlayer
// in shared/announcementAudio.js).
function speak(text, audioKeys) {
  if (isMuted()) return;
  player.speak(text, audioKeys);
}

// Lets the voice picker play a sample regardless of the mute toggle — the
// driver is explicitly asking to hear it, not receiving a real announcement.
export function previewVoice(voiceURI) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(
    'This is Example Street. The next stop will be Example Road.');
  utterance.lang = 'en-GB';
  const voice = listVoices().find((v) => v.voiceURI === voiceURI) || pickVoice();
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
