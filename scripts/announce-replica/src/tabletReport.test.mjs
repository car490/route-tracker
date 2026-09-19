// Tablet capture, part 1 — turning a MEASURED report into pass/fail checks. Tests written
// BEFORE the implementation (TDD).
//
// The report comes from probing the real sign over a read-only DevTools connection (part 3);
// this module is pure, so every rule is unit-tested without a tablet. Sizes arrive in CSS px
// and are converted to mm with the panel's measured lit height: the kiosk viewport fills the
// lit area, so px per mm = viewport height / lit height.
//
// Ground truth (owner, 2026-09-19): Solo tablet lit area 289 x 180 mm, viewport 1442 x 901.
// Only Lines 2 and 3 carry the 22 mm rule, read as lowercase x-height (the stricter reading).
// The sign AIMS at 22.1 mm (the rule plus a 0.1 mm margin): drawn at exactly 22.0 by the canvas method
// the real tablet's shortest letter measured 21.92 mm (2026-09-19), so the floor below has no slack.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateTabletReport, TARGETS, TOLERANCES, RULE_LINES23_MIN_MM, SOLO_LIT_HEIGHT_MM, SOLO_LIT_WIDTH_MM } from './tabletReport.mjs';

const LIT_HEIGHT_MM = 180;
const VIEWPORT = { w: 1442, h: 901 };
const PX_PER_MM = VIEWPORT.h / LIT_HEIGHT_MM; // 5.0056
const px = (mm) => +(mm * PX_PER_MM).toFixed(2);
const X_RATIO = 0.545; // Plus Jakarta Sans Bold, measured 2026-09-19

const row = (name, text, mm, weight = '700') => ({ name, text, fontPx: px(mm), weight });

/** A tablet showing a three-line stop state, every size exactly as designed. */
function threeLineReport(over = {}) {
  return {
    viewport: { ...VIEWPORT },
    fontLoaded: true,
    sign: { shown: true, dataState: 'stop_departure', threeLine: true },
    topbar: { heightPx: px(TARGETS.topbarMm) },
    line1: { heightPx: px(TARGETS.line1SlotMm) },
    rows: [
      row('Top bar: destination', 'to Boston, Bus Station', TARGETS.headerMm, '800'),
      row('Line 1 (verb / wait box)', 'The next stop is', TARGETS.headerMm),
      row('Line 2 (town)', 'Donington', TARGETS.lines23Mm / X_RATIO),
      row('Line 3 (stop)', 'Market Place', TARGETS.lines23Mm / X_RATIO),
      row('Brand wordmark', 'BusOps Announce', TARGETS.brandMm, '800'),
    ],
    glyphs: { weight: '700', canvasRatio: X_RATIO, rasterRatio: X_RATIO, shortestLowerRatio: X_RATIO, shortestLowerChar: 'u' },
    ...over,
  };
}

const by = (result, fragment) => result.checks.find((c) => c.name.includes(fragment));
const eval180 = (report) => evaluateTabletReport(report, { litHeightMm: LIT_HEIGHT_MM });

describe('a tablet showing the designed three-line layout', () => {
  test('passes every check', () => {
    const r = eval180(threeLineReport());
    assert.deepEqual(r.checks.filter((c) => c.status === 'fail'), []);
    assert.equal(r.ok, true);
  });

  test('reports the conversion it used: 5.0056 px/mm on the 180 mm tablet', () => {
    assert.ok(Math.abs(eval180(threeLineReport()).pxPerMm - 5.0056) < 0.0005);
  });

  test('states the measured millimetres in each detail so a person can read them', () => {
    const r = eval180(threeLineReport());
    assert.match(by(r, 'canvas').detail, /22\.10/);
    assert.match(by(r, 'top bar').detail, /22\.9|23\.0/);
  });
});

describe('Lines 2 and 3: 22 mm lowercase x-height', () => {
  test('too small by the old maths (about 11 mm) fails on canvas and pixels', () => {
    const r = eval180(threeLineReport({
      rows: threeLineReport().rows.map((x) => (x.name.startsWith('Line 2') || x.name.startsWith('Line 3') ? { ...x, fontPx: px(11 / X_RATIO) } : x)),
    }));
    assert.equal(by(r, 'canvas').status, 'fail');
    assert.equal(by(r, 'pixels').status, 'fail');
    assert.equal(r.ok, false);
  });

  test('the shortest lowercase letter under 22 mm fails even if the "x" reads 22', () => {
    // a font whose shortest letter is 0.54 of the size while the sized "x" is 0.545: 21.8 mm
    const r = eval180(threeLineReport({ glyphs: { ...threeLineReport().glyphs, shortestLowerRatio: 0.54, shortestLowerChar: 'v' } }));
    assert.equal(by(r, 'shortest lowercase').status, 'fail');
    assert.match(by(r, 'shortest lowercase').detail, /v/);
  });

  test('canvas and pixel measurements disagreeing by more than 0.15 mm is flagged', () => {
    const r = eval180(threeLineReport({ glyphs: { ...threeLineReport().glyphs, rasterRatio: 0.55 } }));
    assert.equal(by(r, 'agree').status, 'fail');
  });

  test('the aim is 22.1 mm and the rule floor is 22 mm', () => {
    assert.equal(TARGETS.lines23Mm, 22.1);
    assert.equal(RULE_LINES23_MIN_MM, 22);
  });

  test('within 0.1 mm of the 22.1 aim passes; 0.2 mm out fails', () => {
    const at = (mm) => eval180(threeLineReport({
      rows: threeLineReport().rows.map((x) => (x.name.startsWith('Line 2') || x.name.startsWith('Line 3') ? { ...x, fontPx: px(mm / X_RATIO) } : x)),
    }));
    // literal numbers on purpose: a test that reads TOLERANCES back would pass for any tolerance
    assert.equal(by(at(22.19), 'canvas').status, 'pass');
    assert.equal(by(at(22.01), 'canvas').status, 'pass');
    assert.equal(by(at(22.3), 'canvas').status, 'fail');
    assert.equal(by(at(21.9), 'canvas').status, 'fail');
  });

  test('the shortest lowercase letter has NO slack: 21.97 mm fails (it passed under the old 0.05 mm allowance), 22.0 passes', () => {
    const shortest = (mm) => eval180(threeLineReport({ glyphs: { ...threeLineReport().glyphs, shortestLowerRatio: (mm / (TARGETS.lines23Mm / X_RATIO)) } }));
    assert.equal(by(shortest(21.97), 'shortest lowercase').status, 'fail');
    assert.equal(by(shortest(21.92), 'shortest lowercase').status, 'fail'); // what the tablet measured at the old exact-22 sizing
    assert.equal(by(shortest(22.0), 'shortest lowercase').status, 'pass');
    assert.equal(by(shortest(22.03), 'shortest lowercase').status, 'pass'); // what the margin gives on the tablet
  });

  test('a weight other than the 700 the sizing assumes fails', () => {
    const r = eval180(threeLineReport({
      rows: threeLineReport().rows.map((x) => (x.name.startsWith('Line 2') ? { ...x, weight: '400' } : x)),
      glyphs: { ...threeLineReport().glyphs, weight: '400' },
    }));
    assert.equal(by(r, 'weight').status, 'fail');
  });

  test('a fallback font (web font not loaded) fails: the x-heights cannot be trusted', () => {
    const r = eval180(threeLineReport({ fontLoaded: false }));
    assert.equal(by(r, 'font').status, 'fail');
  });
});

describe('the top bar, Line 1 and the brand mark', () => {
  test('a 52 mm bar (the pre-slice-B bug) fails, and so does a bar over 20% of the panel', () => {
    const r = eval180(threeLineReport({ topbar: { heightPx: px(52) } }));
    assert.equal(by(r, 'top bar depth').status, 'fail');
    assert.equal(by(r, '20%').status, 'fail');
  });

  test('top bar text and Line 1 must both be 13.5 mm', () => {
    const r = eval180(threeLineReport({
      rows: threeLineReport().rows.map((x) => (x.name.startsWith('Line 1') ? { ...x, fontPx: px(20) } : x)),
    }));
    assert.equal(by(r, 'Line 1').status, 'fail');
  });

  test('the Line 1 slot is a fixed 21.6 mm', () => {
    assert.equal(by(eval180(threeLineReport({ line1: { heightPx: px(60) } })), 'slot').status, 'fail');
  });

  test('the brand mark main line is 5.5 mm', () => {
    const r = eval180(threeLineReport({
      rows: threeLineReport().rows.map((x) => (x.name === 'Brand wordmark' ? { ...x, fontPx: px(7.5) } : x)),
    }));
    assert.equal(by(r, 'brand').status, 'fail');
  });

  test('the wait box, when showing, is 8.1 mm title and 5.7 mm message', () => {
    const wait = [row('Wait box title', 'WAIT HERE', TARGETS.waitTitleMm, '800'), row('Wait box message', 'Running early', TARGETS.waitMsgMm, '600')];
    const good = eval180(threeLineReport({ rows: [...threeLineReport().rows, ...wait] }));
    assert.equal(by(good, 'wait box title').status, 'pass');
    assert.equal(by(good, 'wait box message').status, 'pass');
    const bad = eval180(threeLineReport({ rows: [...threeLineReport().rows, row('Wait box title', 'WAIT HERE', 17, '800'), wait[1]] }));
    assert.equal(by(bad, 'wait box title').status, 'fail');
  });

  test('without a wait box there is no wait box check', () => {
    assert.equal(by(eval180(threeLineReport()), 'wait box'), undefined);
  });
});

describe('sentence states (terminus, diversion, no-comma stop name)', () => {
  const sentenceReport = (mm) => threeLineReport({
    sign: { shown: true, dataState: 'at_stop', threeLine: false },
    line1: null,
    rows: [
      row('Top bar: destination', 'to Boston, Bus Station', TARGETS.headerMm, '800'),
      row('Sentence headline', 'This service terminates here.', mm, '800'),
      row('Brand wordmark', 'BusOps Announce', TARGETS.brandMm, '800'),
    ],
  });

  test('24 mm passes, and no Line 2/3 check is made because there are no such lines', () => {
    const r = eval180(sentenceReport(24));
    assert.equal(by(r, 'sentence').status, 'pass');
    assert.equal(by(r, 'canvas'), undefined);
    assert.equal(r.ok, true);
  });

  test('the 40 mm inherited size (the pre-slice-D bug) fails', () => {
    assert.equal(by(eval180(sentenceReport(40.4)), 'sentence').status, 'fail');
  });
});

describe('idle screen or asleep (no sign showing)', () => {
  const idle = () => threeLineReport({
    sign: { shown: false, dataState: 'idle', threeLine: false },
    line1: null,
    rows: [row('Brand wordmark', 'BusOps Announce', TARGETS.brandMm, '800')],
    glyphs: null,
  });

  test('still checks the top bar, the brand mark and the font, and skips the rest', () => {
    const r = eval180(idle());
    assert.equal(by(r, 'top bar depth').status, 'pass');
    assert.equal(by(r, 'brand').status, 'pass');
    assert.equal(by(r, 'canvas'), undefined);
    assert.equal(r.state, 'idle');
    assert.equal(r.ok, true);
  });

  test('says plainly that no journey state was on screen', () => {
    assert.ok(eval180(idle()).notes.some((n) => /no journey|idle/i.test(n)));
  });
});

describe('the kiosk viewport', () => {
  test('must fill the lit area: aspect 1.606 within 1.5%, else the mm conversion is wrong', () => {
    const r = eval180(threeLineReport({ viewport: { w: 1442, h: 780 } })); // browser chrome eating height
    assert.equal(by(r, 'viewport').status, 'fail');
  });

  test('1442 x 901 on a 289 x 180 mm panel passes', () => {
    assert.equal(by(eval180(threeLineReport()), 'viewport').status, 'pass');
  });
});

describe('robustness', () => {
  test('rejects a missing or non-positive lit height instead of guessing', () => {
    assert.throws(() => evaluateTabletReport(threeLineReport(), {}), RangeError);
    assert.throws(() => evaluateTabletReport(threeLineReport(), { litHeightMm: 0 }), RangeError);
    assert.throws(() => evaluateTabletReport(threeLineReport(), { litHeightMm: '180' }), RangeError);
  });

  test('rejects a report with no viewport', () => {
    assert.throws(() => eval180({ ...threeLineReport(), viewport: undefined }), TypeError);
  });

  test('a three-line state whose Line 2/3 rows are missing fails loudly rather than passing by omission', () => {
    const r = eval180(threeLineReport({ rows: threeLineReport().rows.filter((x) => !x.name.startsWith('Line 2')) }));
    assert.equal(r.ok, false);
    assert.equal(by(r, 'Line 2 and Line 3').status, 'fail');
  });

  test('a three-line state with no glyph measurements fails rather than passing by omission', () => {
    const r = eval180(threeLineReport({ glyphs: null }));
    assert.equal(r.ok, false);
  });
});

describe('the Solo tablet defaults', () => {
  test('are the ruler figures the owner measured: 289 x 180 mm', () => {
    assert.equal(SOLO_LIT_WIDTH_MM, 289);
    assert.equal(SOLO_LIT_HEIGHT_MM, 180);
  });

  test('agree with the lite profile the sign itself uses (panelSizing.js), so the two cannot drift apart', () => {
    // read as text, not imported: panelSizing.js sits in a package without "type": "module",
    // and importing it made the CLI print a Node warning on every run
    const src = readFileSync(fileURLToPath(new URL('../../../pcv-dashboard/busops/announce/src/panelSizing.js', import.meta.url)), 'utf8');
    const lite = /lite:\s*\{[^}]*litHeightMm:\s*(\d+(?:\.\d+)?)/.exec(src);
    assert.ok(lite, 'could not find the lite profile in panelSizing.js');
    assert.equal(Number(lite[1]), SOLO_LIT_HEIGHT_MM);
  });
});
