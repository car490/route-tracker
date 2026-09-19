// tests/onboardLayoutCss.test.js
//
// BusOps Announce sign sizing, slice B: the top bar and Line 1 share one
// size, the bar has a fixed depth, and Line 1 has a fixed-depth slot that also
// holds the "wait here" box. Written BEFORE the CSS change (TDD).
//
// These are structure guards on onboard.css, not a rendering test — the real
// geometry (23 mm bar, 21.6 mm slot, 13.5 mm text, no collisions) is proved
// by the replica harness against the real sign (scripts/announce-replica,
// `npm run verify`). What they pin here is the *shape* that makes the harness
// numbers hold: every size hangs off ONE token (--header-text), never off
// --min-text, which carries only Lines 2/3 (the 22 mm rule).
//
// Plan sizes, as multiples of the 13.5 mm header text:
//   top bar 23 mm = 1.7x   Line 1 slot 21.6 mm = 1.6x
//   wait box title 8.1 mm = 0.6x   wait box message 5.7 mm = 0.42x (5.67 mm)

import fs from 'fs';
import path from 'path';

const css = fs
  .readFileSync(path.join(__dirname, '..', 'announce', 'onboard.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ''); // comments can mention any token; only real declarations count

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The declaration block of the rule whose selector is exactly `selector`.
function ruleBody(selector) {
  const m = new RegExp(`(?:^|[};])\\s*${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule found for selector: ${selector}`);
  return m[1];
}

// Value of `prop` inside a declaration block, or undefined.
function declared(body, prop) {
  const m = new RegExp(`(?:^|[;\\s])${escapeRegExp(prop)}\\s*:\\s*([^;]+)`).exec(body);
  return m?.[1].trim();
}

// The k in `calc(var(--header-text) * k)`, or null if the value isn't that shape.
function headerMultiple(value) {
  const m = /^calc\(\s*var\(--header-text\)\s*\*\s*([\d.]+)\s*\)$/.exec(value ?? '');
  return m ? Number(m[1]) : null;
}

const ROOT = () => ruleBody(':root');
const LINE_1 = '#sign-headline.hl-three-line .hl-verb';
const WAIT_BOX = '#sign-headline.hl-three-line .hl-verb.hl-verb--early';
const WAIT_TITLE = '#sign-headline.hl-three-line .hl-verb--early .ewb-title';
const WAIT_MSG = '#sign-headline.hl-three-line .hl-verb--early .ewb-msg';

describe('layout tokens hang off one header size', () => {
  it.each([
    ['--topbar-height', 1.7],
    ['--line1-slot', 1.6],
    ['--wait-title-text', 0.6],
    ['--wait-msg-text', 0.42],
  ])('%s is %sx --header-text', (token, multiple) => {
    expect(headerMultiple(declared(ROOT(), token))).toBe(multiple);
  });

  it('the top bar depth no longer follows --min-text (it was 1.3x the Line 2/3 size)', () => {
    expect(declared(ROOT(), '--topbar-height')).not.toContain('--min-text');
  });
});

describe('top bar', () => {
  it('has a fixed depth from --topbar-height', () => {
    expect(declared(ruleBody('#sign-topbar'), 'height')).toBe('var(--topbar-height)');
  });

  it('its text is the shared header size', () => {
    // the service code and destination share one rule, so match on the joined selector
    expect(css).toMatch(/\.route-code,\s*\.route-destination\s*\{[^}]*font-size:\s*var\(--header-text\)/);
  });
});

describe('Line 1 slot (verb line and wait box)', () => {
  it('is the shared header size', () => {
    expect(declared(ruleBody(LINE_1), 'font-size')).toBe('var(--header-text)');
  });

  it('has a fixed depth from --line1-slot, in every state', () => {
    expect(declared(ruleBody(LINE_1), 'height')).toBe('var(--line1-slot)');
  });

  it('the wait box fills that same slot rather than growing it: no height of its own', () => {
    expect(declared(ruleBody(WAIT_BOX), 'height')).toBeUndefined();
    expect(declared(ruleBody(WAIT_BOX), 'min-height')).toBeUndefined();
  });

  it('the wait box title and message use their own fixed tokens', () => {
    expect(declared(ruleBody(WAIT_TITLE), 'font-size')).toBe('var(--wait-title-text)');
    expect(declared(ruleBody(WAIT_MSG), 'font-size')).toBe('var(--wait-msg-text)');
  });
});

describe('--min-text carries Lines 2 and 3 only', () => {
  it.each([
    ['top bar', '#sign-topbar'],
    ['Line 1', LINE_1],
    ['wait box', WAIT_BOX],
    ['wait box title', WAIT_TITLE],
    ['wait box message', WAIT_MSG],
  ])('%s does not reference --min-text', (_name, selector) => {
    expect(ruleBody(selector)).not.toContain('--min-text');
  });
});

describe('vertical budget on the 180 mm tablet', () => {
  it('the headline block no longer shifts up by a fraction of --min-text', () => {
    // it was calc(var(--min-text) * -0.15): harmless at 11.7vh, -3.4vh once Lines 2/3 reach 22 mm
    expect(declared(ruleBody('#sign-headline.hl-three-line'), 'margin-top')).not.toContain('--min-text');
  });

  it('the middle band pads 1.5vh / 2.5vw, so a stop name has 1370 px of the 1442 px width', () => {
    // the stop-name review tooling (scripts/announce-replica) measures against exactly this width
    expect(declared(ruleBody('#sign-main'), 'padding')).toBe('1.5vh 2.5vw');
  });
});

// Slice D: terminus and diversion (and the no-comma sentence) at 24 mm, and the
// brand mark's main line at 5.5 mm. onboard.js sets --sentence-text and
// --logo-text from the lit height; the CSS defaults keep panels with no
// measured height exactly as they were.
describe('slice D: sentence states', () => {
  it('--sentence-text defaults to --min-text, so a panel with no measured height is unchanged', () => {
    expect(declared(ROOT(), '--sentence-text')).toBe('var(--min-text)');
  });

  it('the headline (every sentence state) takes its size from --sentence-text', () => {
    expect(declared(ruleBody('#sign-headline'), 'font-size')).toBe('var(--sentence-text)');
  });

  it('Lines 2 and 3 stay on --min-text explicitly, so the 22 mm rule can never follow the sentence size', () => {
    // they used to inherit --min-text from #sign-headline; that rule now carries the sentence size
    expect(declared(ruleBody('#sign-headline.hl-three-line'), 'font-size')).toBe('var(--min-text)');
  });

  it('nothing on the three-line path (Line 1, wait box, bar) references --sentence-text', () => {
    for (const selector of ['#sign-topbar', LINE_1, WAIT_BOX, WAIT_TITLE, WAIT_MSG]) {
      expect(ruleBody(selector)).not.toContain('--sentence-text');
    }
  });
});

describe('slice D: brand mark', () => {
  it('the main line is --logo-text', () => {
    expect(declared(ruleBody('.bo-wordmark'), 'font-size')).toBe('var(--logo-text)');
  });

  it.each([
    ['.cm-powered-by', 0.5],
    ['.cm-wordmark', 0.6875],
  ])('%s keeps its ratio to the main line (%s)', (selector, multiple) => {
    const value = declared(ruleBody(selector), 'font-size');
    const m = /^calc\(\s*var\(--logo-text\)\s*\*\s*([\d.]+)\s*\)$/.exec(value ?? '');
    expect(m && Number(m[1])).toBe(multiple);
  });
});
