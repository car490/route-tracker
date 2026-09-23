// Slice 1 — sign sizing maths. Tests written BEFORE the implementation (TDD).
//
// Ground truth (all measured by the owner, not derived from nominal specs):
//   Tablet (BusOps Announce Solo): lit area 289 x 180 mm, sign viewport
//     1442 x 901 CSS px (= 1920x1200 native at DPR ~1.33).
//   Laptop (review machine):       lit area 344 x 194 mm, 1920 x 1080 px,
//     Windows display scaling 150%.
//   Rule: in Lines 2 and 3 no lowercase character may be less than 22 mm
//     (interpreted as x-height, the stricter reading).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  pxPerMm,
  pxToMm,
  mmToPx,
  xHeightMm,
  fontSizeForXHeightPx,
  minTextVh,
  legacyMinTextVh,
  replicaFrame,
} from './signSizing.mjs';

const approx = (actual, expected, tol, msg) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg ?? 'value'}: expected ${expected} +/- ${tol}, got ${actual}`,
  );

const TABLET = { litWidthMm: 289, litHeightMm: 180, cssWidthPx: 1442, cssHeightPx: 901 };
const LAPTOP = { litWidthMm: 344, litHeightMm: 194, resWidthPx: 1920, resHeightPx: 1080, osScale: 1.5 };
const X_HEIGHT_RATIO = 0.52; // typical sans-serif; the real font's ratio is measured in slice 2

describe('pxPerMm — pixel density from measured lit area', () => {
  test('tablet: about 4.99 px/mm across, 5.01 down, mismatch under 0.5%', () => {
    const d = pxPerMm({ litWidthMm: 289, litHeightMm: 180, widthPx: 1442, heightPx: 901 });
    approx(d.x, 4.9896, 0.001, 'x density');
    approx(d.y, 5.0056, 0.001, 'y density');
    approx(d.mean, 4.9976, 0.001, 'mean density');
    assert.ok(d.mismatchPct < 0.5, `mismatch ${d.mismatchPct}% should be under 0.5%`);
  });

  test('rejects zero, negative and non-numeric inputs', () => {
    assert.throws(() => pxPerMm({ litWidthMm: 0, litHeightMm: 180, widthPx: 1442, heightPx: 901 }));
    assert.throws(() => pxPerMm({ litWidthMm: 289, litHeightMm: -1, widthPx: 1442, heightPx: 901 }));
    assert.throws(() => pxPerMm({ litWidthMm: 289, litHeightMm: 180, widthPx: NaN, heightPx: 901 }));
    assert.throws(() => pxPerMm({}));
  });
});

describe('pxToMm / mmToPx', () => {
  test('round trip is lossless', () => {
    const density = 4.9976;
    approx(pxToMm(mmToPx(22, density), density), 22, 1e-9);
  });

  test('105.2 px is about 21 mm at tablet density', () => {
    approx(pxToMm(105.2, 5.0056), 21.02, 0.01);
  });
});

describe('legacyMinTextVh — pins the CURRENT behaviour of onboard.js computeMinTextVh', () => {
  test('lite profile (nominal 14") gives 11.675vh, matching the live tablet capture', () => {
    approx(legacyMinTextVh(14, 1442, 901), 11.675, 0.001);
  });

  test('returns null when any input is missing, like the original', () => {
    assert.equal(legacyMinTextVh(0, 1442, 901), null);
    assert.equal(legacyMinTextVh(14, 0, 901), null);
    assert.equal(legacyMinTextVh(14, 1442, 0), null);
  });
});

describe('the current sign versus the 22mm lowercase rule (documents the shortfall)', () => {
  const vh = 901 / 100; // px per vh on the tablet
  const density = 5.0056; // px per mm, vertical, measured

  test('today --min-text renders a font about 21 mm tall', () => {
    const fontPx = legacyMinTextVh(14, 1442, 901) * vh;
    approx(fontPx, 105.2, 0.1, 'font px');
    approx(pxToMm(fontPx, density), 21.0, 0.1, 'font mm');
  });

  test('and lowercase x-height is only about 11 mm, roughly half of the 22 mm required', () => {
    const fontPx = legacyMinTextVh(14, 1442, 901) * vh;
    const x = xHeightMm({ fontSizePx: fontPx, xHeightRatio: X_HEIGHT_RATIO, density });
    approx(x, 10.9, 0.1, 'lowercase x-height mm');
    assert.ok(x < 22 * 0.55, 'current lowercase x-height is under 55% of the requirement');
  });
});

describe('minTextVh — size Lines 2/3 from the measured lit height and the font x-height', () => {
  test('22 mm x-height on a 180 mm lit height with ratio 0.52 needs about 23.5vh', () => {
    approx(minTextVh({ targetMm: 22, xHeightRatio: X_HEIGHT_RATIO, litHeightMm: 180 }), 23.504, 0.01);
  });

  test('is independent of pixel resolution (depends only on physical height)', () => {
    const a = minTextVh({ targetMm: 22, xHeightRatio: X_HEIGHT_RATIO, litHeightMm: 180 });
    const b = minTextVh({ targetMm: 22, xHeightRatio: X_HEIGHT_RATIO, litHeightMm: 180 });
    assert.equal(a, b);
  });

  test('a taller panel needs fewer vh for the same physical size', () => {
    const small = minTextVh({ targetMm: 22, xHeightRatio: X_HEIGHT_RATIO, litHeightMm: 180 });
    const tall = minTextVh({ targetMm: 22, xHeightRatio: X_HEIGHT_RATIO, litHeightMm: 360 });
    approx(tall, small / 2, 1e-9);
  });

  test('defaults the target to 22 mm', () => {
    approx(
      minTextVh({ xHeightRatio: X_HEIGHT_RATIO, litHeightMm: 180 }),
      minTextVh({ targetMm: 22, xHeightRatio: X_HEIGHT_RATIO, litHeightMm: 180 }),
      1e-12,
    );
  });

  test('rejects impossible inputs (ratio must be 0 < r <= 1)', () => {
    assert.throws(() => minTextVh({ xHeightRatio: 0, litHeightMm: 180 }));
    assert.throws(() => minTextVh({ xHeightRatio: 1.2, litHeightMm: 180 }));
    assert.throws(() => minTextVh({ xHeightRatio: 0.5, litHeightMm: 0 }));
    assert.throws(() => minTextVh({ targetMm: -22, xHeightRatio: 0.5, litHeightMm: 180 }));
  });
});

describe('fontSizeForXHeightPx / xHeightMm round trip', () => {
  test('font sized for 22 mm x-height renders exactly 22 mm x-height', () => {
    const density = 5.0056;
    const fontPx = fontSizeForXHeightPx({ targetMm: 22, xHeightRatio: X_HEIGHT_RATIO, density });
    approx(fontPx, 211.8, 0.1, 'font px');
    approx(xHeightMm({ fontSizePx: fontPx, xHeightRatio: X_HEIGHT_RATIO, density }), 22, 1e-9);
  });

  test('agrees with minTextVh on the tablet', () => {
    const vh = minTextVh({ targetMm: 22, xHeightRatio: X_HEIGHT_RATIO, litHeightMm: 180 });
    const fromVh = (vh / 100) * 901;
    const fromMm = fontSizeForXHeightPx({ targetMm: 22, xHeightRatio: X_HEIGHT_RATIO, density: 901 / 180 });
    approx(fromVh, fromMm, 1e-9);
  });
});

describe('replicaFrame — showing the tablet at true physical size on the laptop', () => {
  test('fits fully: about 1613 x 1005 device px on a 1920 x 1080 screen', () => {
    const f = replicaFrame({ panel: TABLET, screen: LAPTOP });
    approx(f.frameDeviceWidthPx, 1613.0, 0.5, 'frame width');
    approx(f.frameDeviceHeightPx, 1004.7, 0.5, 'frame height');
    assert.equal(f.fits, true);
    approx(f.spareWidthPx, 307.0, 0.5, 'spare width');
    approx(f.spareHeightPx, 75.3, 0.5, 'spare height');
    assert.equal(f.cropWidthFraction, 0);
    assert.equal(f.cropHeightFraction, 0);
  });

  test('at 150% OS scaling the 1442 CSS px frame needs a CSS scale of about 0.746 (75%)', () => {
    const f = replicaFrame({ panel: TABLET, screen: LAPTOP });
    approx(f.deviceScale, 1.1186, 0.001, 'device px per panel CSS px');
    approx(f.cssScale, 0.7457, 0.001, 'css scale at 150% OS scaling');
  });

  test('at 100% OS scaling cssScale equals deviceScale', () => {
    const f = replicaFrame({ panel: TABLET, screen: { ...LAPTOP, osScale: 1 } });
    approx(f.cssScale, f.deviceScale, 1e-12);
  });

  test('reports the crop when the screen is too small', () => {
    // A 289 mm wide screen at 1920 px would be 6.64 px/mm: the frame width fits
    // exactly, but the height (180 mm = 1195 px) exceeds 1080 px.
    const tight = { litWidthMm: 289, litHeightMm: 162.6, resWidthPx: 1920, resHeightPx: 1080, osScale: 1.5 };
    const f = replicaFrame({ panel: TABLET, screen: tight });
    assert.equal(f.fits, false);
    assert.ok(f.spareHeightPx < 0, 'negative spare height');
    approx(f.cropHeightFraction, 0.096, 0.002, 'cropped fraction of the frame height');
    assert.equal(f.cropWidthFraction, 0);
  });

  test('the laptop width and height measurements agree to about 0.3% (square pixels)', () => {
    // 344 mm across 1920 px = 5.581 px/mm; 194 mm down 1080 px = 5.567 px/mm.
    // Pixels are square, so the two must agree; the frame scale uses the WIDTH and any
    // disagreement is surfaced (screenDensityMismatchPct) for the ruler check. An earlier
    // 334 mm typo showed up here as a 3.2% mismatch.
    const f = replicaFrame({ panel: TABLET, screen: LAPTOP });
    approx(f.screenDensityMismatchPct, 0.26, 0.05, 'screen density mismatch %');
  });

  test('rejects invalid input', () => {
    assert.throws(() => replicaFrame({ panel: TABLET, screen: { ...LAPTOP, osScale: 0 } }));
    assert.throws(() => replicaFrame({ panel: { ...TABLET, cssWidthPx: 0 }, screen: LAPTOP }));
    assert.throws(() => replicaFrame({ panel: TABLET, screen: { ...LAPTOP, litWidthMm: -1 } }));
    assert.throws(() => replicaFrame({}));
  });
});

describe('the committed panel measurements (replica/panels.json) are self-consistent', () => {
  // Pixels are square, so a screen's width and height densities must agree. A typo in one
  // measured figure (334 mm instead of 344 mm for the laptop's width) once made the true-size
  // replica about 3% too large and went unnoticed because nothing checked the figures against
  // each other. Fails if either the tablet or the laptop is more than 1% out.
  const CONFIG = JSON.parse(readFileSync(fileURLToPath(new URL('../replica/panels.json', import.meta.url)), 'utf8'));

  test('the tablet: 289 x 180 mm against 1442 x 901 CSS px', () => {
    const d = pxPerMm({ ...pick(CONFIG.panel, 'litWidthMm', 'litHeightMm'), widthPx: CONFIG.panel.cssWidthPx, heightPx: CONFIG.panel.cssHeightPx });
    assert.ok(d.mismatchPct < 1, `tablet width/height density disagree by ${d.mismatchPct.toFixed(2)}%`);
  });

  test('the laptop: 344 x 194 mm against 1920 x 1080 px', () => {
    const d = pxPerMm({ ...pick(CONFIG.screen, 'litWidthMm', 'litHeightMm'), widthPx: CONFIG.screen.resWidthPx, heightPx: CONFIG.screen.resHeightPx });
    assert.ok(d.mismatchPct < 1, `laptop width/height density disagree by ${d.mismatchPct.toFixed(2)}%`);
  });

  test('the laptop width is the owner\'s ruler figure, 344 mm', () => {
    assert.equal(CONFIG.screen.litWidthMm, 344);
    assert.equal(CONFIG.screen.litHeightMm, 194);
  });
});

function pick(obj, ...keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
