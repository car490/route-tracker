// tests/panelSizing.test.js
//
// BusOps Announce sign sizing, slice A (physical sizing). Written BEFORE
// announce/src/panelSizing.js (TDD).
//
// PSV(AI)R Reg 14(4): Lines 2 and 3 (the locale and the actual stop) must
// have no lowercase letter smaller than 22 mm, read as lowercase x-height —
// the stricter reading. The old maths sized the CSS *font* to 22 mm from a
// nominal diagonal, which put the x-height at about 11 mm on the real Solo
// tablet. The new maths works from the panel's measured lit HEIGHT and the
// rendered font's measured x-height ratio, so the result is physical.
//
// Measured ground truth (owner, 2026-09-19): Solo tablet lit area 289 x 180 mm,
// sign viewport 1442 x 901 CSS px.

import fs from 'fs';
import path from 'path';
import {
  PANEL_PROFILES,
  DEFAULT_X_HEIGHT_RATIO,
  computeMinTextVh,
  computeMinTextVhFromLitHeight,
  usableXHeightRatio,
  resolveMinTextVh,
} from '../announce/src/panelSizing.js';

const TABLET = { viewportWidthPx: 1442, viewportHeightPx: 901 };
const LITE_LIT_HEIGHT_MM = 180;

// Physical x-height, in mm, of Line 2/3 text sized at `vh` on a panel whose
// lit height is `litHeightMm`, in a font with the given x-height ratio.
const xHeightMm = (vh, litHeightMm, ratio) => (vh / 100) * litHeightMm * ratio;

describe('computeMinTextVh (legacy diagonal maths, moved unchanged)', () => {
  it('lite profile diagonal (14") gives 11.675vh, matching the live tablet capture', () => {
    expect(computeMinTextVh(14, 1442, 901)).toBeCloseTo(11.675, 3);
  });

  it('returns null when any input is missing', () => {
    expect(computeMinTextVh(0, 1442, 901)).toBeNull();
    expect(computeMinTextVh(14, 0, 901)).toBeNull();
    expect(computeMinTextVh(14, 1442, 0)).toBeNull();
    expect(computeMinTextVh(undefined, 1442, 901)).toBeNull();
  });

  it('monitor profile (23.8" at 1920x1080) is unchanged at 7.42vh', () => {
    expect(computeMinTextVh(23.8, 1920, 1080)).toBeCloseTo(7.42, 2);
  });
});

describe('computeMinTextVhFromLitHeight', () => {
  it('22 mm x-height on a 180 mm lit height with ratio 0.52 needs 23.504vh', () => {
    expect(computeMinTextVhFromLitHeight({ litHeightMm: 180, xHeightRatio: 0.52 })).toBeCloseTo(23.5043, 3);
  });

  it.each([0.48, 0.5, 0.52, 0.55])('renders exactly 22 mm x-height for font ratio %s', (ratio) => {
    const vh = computeMinTextVhFromLitHeight({ litHeightMm: LITE_LIT_HEIGHT_MM, xHeightRatio: ratio });
    expect(xHeightMm(vh, LITE_LIT_HEIGHT_MM, ratio)).toBeCloseTo(22, 9);
  });

  it('a panel twice as tall needs half the vh for the same physical size', () => {
    const small = computeMinTextVhFromLitHeight({ litHeightMm: 180, xHeightRatio: 0.52 });
    const tall = computeMinTextVhFromLitHeight({ litHeightMm: 360, xHeightRatio: 0.52 });
    expect(tall).toBeCloseTo(small / 2, 9);
  });

  it('defaults the target to 22 mm and honours an explicit one', () => {
    const base = computeMinTextVhFromLitHeight({ litHeightMm: 180, xHeightRatio: 0.52 });
    expect(computeMinTextVhFromLitHeight({ litHeightMm: 180, xHeightRatio: 0.52, targetMm: 22 })).toBe(base);
    expect(computeMinTextVhFromLitHeight({ litHeightMm: 180, xHeightRatio: 0.52, targetMm: 11 })).toBeCloseTo(base / 2, 9);
  });

  it.each([
    ['zero ratio', { litHeightMm: 180, xHeightRatio: 0 }],
    ['ratio above 1', { litHeightMm: 180, xHeightRatio: 1.2 }],
    ['NaN ratio', { litHeightMm: 180, xHeightRatio: NaN }],
    ['string ratio', { litHeightMm: 180, xHeightRatio: '0.5' }],
    ['zero lit height', { litHeightMm: 0, xHeightRatio: 0.5 }],
    ['negative lit height', { litHeightMm: -180, xHeightRatio: 0.5 }],
    ['missing lit height', { xHeightRatio: 0.5 }],
    ['string lit height', { litHeightMm: '180', xHeightRatio: 0.5 }],
    ['negative target', { litHeightMm: 180, xHeightRatio: 0.5, targetMm: -22 }],
    ['no arguments at all', undefined],
  ])('rejects %s', (_label, args) => {
    expect(() => computeMinTextVhFromLitHeight(args)).toThrow(RangeError);
  });
});

describe('usableXHeightRatio (a bad canvas measurement must never size the sign)', () => {
  it('passes a plausible measured ratio through', () => {
    expect(usableXHeightRatio(0.517)).toEqual({ ratio: 0.517, fellBack: false });
  });

  it('accepts the boundaries 0.40 and 0.70', () => {
    expect(usableXHeightRatio(0.4)).toEqual({ ratio: 0.4, fellBack: false });
    expect(usableXHeightRatio(0.7)).toEqual({ ratio: 0.7, fellBack: false });
  });

  it.each([0, -0.5, 0.39, 0.71, 1, Infinity, NaN, undefined, null, '0.5'])(
    'falls back to the default ratio for %s',
    (measured) => {
      expect(usableXHeightRatio(measured)).toEqual({ ratio: DEFAULT_X_HEIGHT_RATIO, fellBack: true });
    },
  );

  it('the default ratio is 0.52', () => {
    expect(DEFAULT_X_HEIGHT_RATIO).toBe(0.52);
  });
});

describe('PANEL_PROFILES', () => {
  it('lite (Solo tablet) carries its measured 180 mm lit height and keeps its nominal diagonal', () => {
    expect(PANEL_PROFILES.lite.litHeightMm).toBe(180);
    expect(PANEL_PROFILES.lite.diagonalInches).toBe(14);
  });

  it('bar and monitor have no measured lit height, so they keep today\'s calculation', () => {
    expect(PANEL_PROFILES.bar.litHeightMm).toBeUndefined();
    expect(PANEL_PROFILES.monitor.litHeightMm).toBeUndefined();
    expect(PANEL_PROFILES.bar.diagonalInches).toBe(28);
    expect(PANEL_PROFILES.monitor.diagonalInches).toBe(23.8);
  });
});

describe('resolveMinTextVh — which sizing path applies', () => {
  const measure = (ratio) => jest.fn(() => ratio);

  it('a profile with a lit height uses the physical path: 22 mm x-height on the tablet', () => {
    const measureRatio = measure(0.52);
    const out = resolveMinTextVh({ profile: PANEL_PROFILES.lite, ...TABLET, measureXHeightRatio: measureRatio });
    expect(out.source).toBe('lit-height');
    expect(out.vh).toBeCloseTo(23.5043, 3);
    expect(out.ratioFellBack).toBe(false);
    expect(measureRatio).toHaveBeenCalledTimes(1);
  });

  it.each([0.48, 0.5, 0.52, 0.55])('the physical path lands on 22 mm for a measured ratio of %s', (ratio) => {
    const out = resolveMinTextVh({ profile: PANEL_PROFILES.lite, ...TABLET, measureXHeightRatio: measure(ratio) });
    expect(xHeightMm(out.vh, LITE_LIT_HEIGHT_MM, ratio)).toBeCloseTo(22, 9);
  });

  it('an explicit ?panel-diagonal= still wins over the profile, and never measures a font', () => {
    const measureRatio = measure(0.52);
    const out = resolveMinTextVh({
      explicitDiagonalInches: 14, profile: PANEL_PROFILES.lite, ...TABLET, measureXHeightRatio: measureRatio,
    });
    expect(out.source).toBe('explicit-diagonal');
    expect(out.vh).toBeCloseTo(11.675, 3);
    expect(measureRatio).not.toHaveBeenCalled();
  });

  it('an explicit diagonal works with no profile at all', () => {
    const out = resolveMinTextVh({ explicitDiagonalInches: 23.8, viewportWidthPx: 1920, viewportHeightPx: 1080 });
    expect(out.source).toBe('explicit-diagonal');
    expect(out.vh).toBeCloseTo(7.42, 2);
  });

  it.each([
    ['monitor', PANEL_PROFILES.monitor, 1920, 1080],
    ['bar', PANEL_PROFILES.bar, 2560, 720],
  ])('%s has no lit height, so it gets exactly today\'s number and never measures a font', (_n, profile, w, h) => {
    const measureRatio = measure(0.52);
    const out = resolveMinTextVh({ profile, viewportWidthPx: w, viewportHeightPx: h, measureXHeightRatio: measureRatio });
    expect(out.source).toBe('profile-diagonal');
    expect(out.vh).toBe(computeMinTextVh(profile.diagonalInches, w, h));
    expect(measureRatio).not.toHaveBeenCalled();
  });

  it('no profile and no explicit diagonal gives null, so the CSS default (17vh) stands', () => {
    expect(resolveMinTextVh({ ...TABLET })).toEqual({ vh: null, source: null, ratioFellBack: false });
  });

  it.each([NaN, 0, 5, undefined])('an unusable measured ratio (%s) falls back to 0.52 and says so', (bad) => {
    const out = resolveMinTextVh({ profile: PANEL_PROFILES.lite, ...TABLET, measureXHeightRatio: measure(bad) });
    expect(out.source).toBe('lit-height');
    expect(out.vh).toBeCloseTo(23.5043, 3);
    expect(out.ratioFellBack).toBe(true);
  });

  it('a measurement that throws (no canvas) falls back rather than breaking the sign', () => {
    const throwing = jest.fn(() => { throw new Error('canvas unavailable'); });
    const out = resolveMinTextVh({ profile: PANEL_PROFILES.lite, ...TABLET, measureXHeightRatio: throwing });
    expect(out.source).toBe('lit-height');
    expect(out.vh).toBeCloseTo(23.5043, 3);
    expect(out.ratioFellBack).toBe(true);
  });

  it('a lit-height profile with no measuring function at all also falls back safely', () => {
    const out = resolveMinTextVh({ profile: PANEL_PROFILES.lite, ...TABLET });
    expect(out.vh).toBeCloseTo(23.5043, 3);
    expect(out.ratioFellBack).toBe(true);
  });

  it('the physical path does not depend on the viewport size', () => {
    const a = resolveMinTextVh({ profile: PANEL_PROFILES.lite, viewportWidthPx: 1442, viewportHeightPx: 901, measureXHeightRatio: measure(0.52) });
    const b = resolveMinTextVh({ profile: PANEL_PROFILES.lite, viewportWidthPx: 800, viewportHeightPx: 600, measureXHeightRatio: measure(0.52) });
    expect(a.vh).toBe(b.vh);
  });
});

describe('service worker precache', () => {
  // The sign is network-first with runtime caching, so a missing entry only
  // hurts a tablet that is offline on its first load after a deploy — but
  // that is exactly the moment a kiosk cannot recover from.
  it('lists announce/src/panelSizing.js so the new module is available offline', () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
    expect(sw).toContain("'./announce/src/panelSizing.js'");
  });
});
