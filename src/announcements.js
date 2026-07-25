// PSVAIR 2026 (Public Service Vehicles Accessible Information Regulations 2023)
// Live audio + on-screen visual announcements of next stop / final destination
// for in-scope local bus services. Audio uses the Web Speech API — no
// dependency, works offline once the OS voice is installed.

const MUTE_KEY = 'psvair-muted';
const VOICE_KEY = 'psvair-voice-uri';

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

export function setAnnouncementsEnabled(v) {
  enabled = v;
}

export function isMuted() {
  return localStorage.getItem(MUTE_KEY) === '1';
}

export function setMuted(v) {
  localStorage.setItem(MUTE_KEY, v ? '1' : '0');
  if (v && 'speechSynthesis' in window) window.speechSynthesis.cancel();
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

function speak(text) {
  if (isMuted() || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(stripSpeechAnnotations(text));
  utterance.lang = 'en-GB';
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

// Lets the voice picker play a sample regardless of the mute toggle — the
// driver is explicitly asking to hear it, not receiving a real announcement.
export function previewVoice(voiceURI) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(
    'This stop is Example Street. The next stop is Example Road.');
  utterance.lang = 'en-GB';
  const voice = listVoices().find(v => v.voiceURI === voiceURI) || pickVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function announce(text) {
  if (!enabled) return;
  speak(text);
  if (onAnnounce) onAnnounce(text);
}

export function announceJourneyStart({ serviceCode, destination }) {
  announce(`This is the ${serviceCode} service to ${destination}.`);
}

export function announceAtStop({ stopName, nextStopName, isFinal }) {
  announce(isFinal
    ? `This is ${stopName}. This bus terminates here, all change please.`
    : `This stop is ${stopName}. The next stop is ${nextStopName}.`);
}

// Fixed string only — takes no parameters, deliberately, so the "diversion
// announcements can never carry dynamic/free-text content" property is
// enforced at this TTS gateway itself, not just by callers behaving.
export function announceDiversion() {
  announce('This bus is on diversion');
}
