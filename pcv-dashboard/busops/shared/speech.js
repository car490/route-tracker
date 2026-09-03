// Shared browser speechSynthesis helpers — genuinely shared between
// driver/src/announcements.js (used there as the fallback when a
// pre-rendered Azure clip is missing/uncached) and
// announce/src/announceSpeech.js (used there as the *only* audio path —
// Announce Solo ships no pre-rendered clips at all, see that
// file's header comment). Side-effecting (real Web Speech API calls), same
// category as shared/gps.js's live-GPS layer — not a pure module.

// Known-good natural-sounding male English-GB voices, checked in order,
// across the platforms these devices actually run (Android Chrome, iOS
// Safari, Windows Edge/Chrome) — matches en-GB-RyanNeural, the voice the
// pre-rendered Azure clips use (see scripts/generate-announcement-audio.mjs).
// First one installed wins; if none match, falls back to the first en-GB
// voice, then whatever the browser gives us.
export const PREFERRED_VOICE_NAMES = [
  'Google UK English Male',
  'Microsoft Ryan Online (Natural) - English (United Kingdom)',
  'Daniel',
  'Arthur',
  'Microsoft George',
];

// speechSynthesis.getVoices() only returns the full list once the
// 'voiceschanged' event has fired on some browsers (notably Chrome) —
// callers populating a voice picker should also listen for that event
// themselves.
export function listVoices() {
  if (!('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices()
    .filter((v) => v.lang.startsWith('en'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Deliberately deterministic — always resolves the same way given the same
// installed voice list, never influenced by a per-device saved preference.
// Used to accept a savedURI override (driver/src/announcements.js's voice
// picker persisted one via localStorage) that took priority over
// PREFERRED_VOICE_NAMES; found live, 2026-09-02, as the actual cause of
// "we have a mixture" of voices across devices — the picker's own <select>
// defaults to whichever installed voice sorts first alphabetically
// (listVoices() below), completely unrelated to voice *quality*, and once
// picked (even accidentally) it silently overrode the preferred list on
// that device from then on. Every real announcement must always use the
// one canonical UK male voice — never a per-device choice, never whatever
// the browser considers "default". The driver PWA's voice-picker UI still
// exists for previewing an installed voice on demand (previewVoice() in
// announcements.js calls listVoices() directly, not this function), it
// just no longer has any effect on what a real announcement actually uses.
export function pickVoice() {
  const voices = listVoices();
  if (!voices.length) return null;

  for (const name of PREFERRED_VOICE_NAMES) {
    const match = voices.find((v) => v.name === name);
    if (match) return match;
  }
  return voices.find((v) => v.lang === 'en-GB') || voices[0];
}

// Resolves once the utterance finishes (or immediately if speech synthesis
// isn't available).
export function speakUtterance(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB';
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}
