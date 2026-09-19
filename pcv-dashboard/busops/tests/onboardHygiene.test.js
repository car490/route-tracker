// tests/onboardHygiene.test.js
//
// The sign runs full-screen on a passenger-facing tablet. Investigation aids
// added while sizing it were marked TEMPORARY and must not ship long-term: the
// ?debug-size=1 overlay (2026-09-17) painted window size, --min-text and
// rendered font sizes over the live sign. It was removed on 2026-09-19 once the
// true-size harness (scripts/announce-replica) and the read-only CDP tablet
// capture (scripts/review-announce-solo.mjs) covered the same need. Written
// BEFORE the removal (TDD).

import fs from 'fs';
import path from 'path';

const onboardJs = fs.readFileSync(path.join(__dirname, '..', 'announce', 'src', 'onboard.js'), 'utf8');

describe('onboard.js has no temporary debug overlay', () => {
  it('does not read a debug-size URL parameter', () => {
    expect(onboardJs).not.toMatch(/debug-size/);
  });

  it('does not define or call the overlay function', () => {
    expect(onboardJs).not.toMatch(/applyDebugSizeOverlay/);
  });

  it('does not put a fixed, top-most, diagnostic box over the sign', () => {
    // the overlay used position:fixed with z-index 99999 and a monospace font
    expect(onboardJs).not.toMatch(/z-index:\s*99999/);
  });
});
