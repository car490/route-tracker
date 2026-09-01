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

// savedURI is caller-supplied (driver/src/announcements.js persists one via
// localStorage; announce/src/announceSpeech.js has no voice-picker UI and
// always passes null) rather than read from storage here, so this stays a
// pure function of its arguments.
export function pickVoice(savedURI) {
  const voices = listVoices();
  if (!voices.length) return null;

  const saved = savedURI && voices.find((v) => v.voiceURI === savedURI);
  if (saved) return saved;

  for (const name of PREFERRED_VOICE_NAMES) {
    const match = voices.find((v) => v.name === name);
    if (match) return match;
  }
  return voices.find((v) => v.lang === 'en-GB') || voices[0];
}

// Resolves once the utterance finishes (or immediately if speech synthesis
// isn't available). savedVoiceURI is threaded straight through to
// pickVoice — see its own comment.
export function speakUtterance(text, savedVoiceURI = null) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB';
    const voice = pickVoice(savedVoiceURI);
    if (voice) utterance.voice = voice;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}
