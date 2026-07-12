// PSVAIR 2026 (Public Service Vehicles Accessible Information Regulations 2023)
// Live audio + on-screen visual announcements of next stop / final destination
// for in-scope local bus services. Audio uses the Web Speech API — no
// dependency, works offline once the OS voice is installed.

const MUTE_KEY = 'psvair-muted';

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

export function onAnnouncementChange(fn) {
  onAnnounce = fn;
}

function speak(text) {
  if (isMuted() || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-GB';
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
