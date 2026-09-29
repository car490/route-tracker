/**
 * @jest-environment jsdom
 */
// tests/driverAutoStart.test.js
//
// Guards how main.js wires the Driver's automatic mode (driver/src/autostart/,
// docs/DECISIONS.md "Driver automatic mode"). The slice's behaviour is
// tested in its own Vitest files; this checks the wiring rules that keep it
// safe in the app:
//   - it exists only without a duty card (ops' assignment always wins);
//   - it only offers while the waiting (no duty) screen is showing;
//   - it restarts, and forgets the finished journey, whenever that screen
//     comes back (after a journey, or backing out of the manual picker);
//   - an automatic start goes through the same path as the manual Start
//     button, so tracking, announcements and the Controller feed behave
//     identically.

import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'driver', 'src', 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'driver', 'index.html'), 'utf8');

function fnBody(name) {
  const start = mainJs.search(new RegExp(`(async )?function ${name}\\(`));
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  // The body starts at the ") {" closing the parameter list, not the first
  // "{" (a destructured parameter would be that).
  for (let i = mainJs.indexOf(') {', start) + 2; i < mainJs.length; i++) {
    if (mainJs[i] === '{') depth++;
    if (mainJs[i] === '}' && --depth === 0) return mainJs.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

test('imports the slice', () => {
  expect(mainJs).toMatch(/import \{ initAutoStart, getBrowserPosition \} from '\.\/autostart\/autoStartController\.js';/);
  expect(mainJs).toMatch(/import \{ createAutoStartOverlay \} from '\.\/autostart\/autoStartOverlay\.js';/);
  expect(mainJs).toMatch(/import \{ fetchCandidateData \} from '\.\/autostart\/candidates\.js';/);
});

test('is only set up when there is no duty card', () => {
  const init = fnBody('init');
  expect(init).toMatch(/if \(!dutiesParam\) \{\s*autoStart = initAutoStart\(/);
});

test('only offers while the waiting (no duty) screen is showing', () => {
  expect(fnBody('init')).toMatch(/isActive: \(\) => !document\.getElementById\('no-duty-card'\)\.hidden/);
});

test('uses the ?debug testing fallback only in debug mode', () => {
  expect(fnBody('init')).toMatch(/testing: DEBUG,/);
});

test('restarts whenever the waiting screen is shown again', () => {
  const body = fnBody('showNoDutyCard');
  expect(body).toMatch(/autoStart\.journeyEnded\(\);/);
  expect(body).toMatch(/autoStart\.resume\(\);/);
  expect(body).toMatch(/autoStart\.start\(\);/);
});

test('an automatic start and the manual Start button share one launch path', () => {
  expect(fnBody('startAutomaticJourney')).toMatch(/selectServiceManually\(/);
  expect(fnBody('startAutomaticJourney')).toMatch(/rejectRefusal: true/);
  expect(fnBody('startAutomaticJourney')).toMatch(/await launchManualResult\(result\);/);
  expect(fnBody('initManualSelection')).toMatch(/await launchManualResult\(result\);/);
  const launch = fnBody('launchManualResult');
  expect(launch).toMatch(/acquireWakeLock\(\)/);
  expect(launch).toMatch(/runAnnouncementPreflight\(/);
  expect(launch).toMatch(/runTracker\(result\)/);
});

test('the waiting screen says automatic start is on, only when it is', () => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const note = doc.getElementById('ndc-auto-note');
  expect(note).not.toBeNull();
  expect(note.hidden).toBe(true);
  expect(note.textContent).toMatch(/The journey tracking will start automatically when you are at the first stop/);
  expect(fnBody('init')).toMatch(/document\.getElementById\('ndc-auto-note'\)\.hidden = false;/);
});

// Owner, 2026-09-29: letting the device start the journey is the
// recommended action, so it is said first; picking by hand is the "Or".
// The "Or" sits inside the note so it hides with it (duty-card mode, where
// automatic mode is never on).
test('the waiting screen puts automatic start first, then "Or", then picking by hand', () => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const screen = doc.getElementById('no-duty-card');
  const note = doc.getElementById('ndc-auto-note');
  const body = screen.querySelector('.ndc-body');
  expect(note.querySelector('.ndc-or').textContent.trim()).toBe('Or');
  expect(body.textContent.trim()).toBe("Tap below to select one of today's journeys.");
  expect(note.compareDocumentPosition(body) & 4 /* DOCUMENT_POSITION_FOLLOWING */).toBeTruthy();
});
