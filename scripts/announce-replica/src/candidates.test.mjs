// Slice 3 — candidate layouts for the sign. Tests written BEFORE the code.
//
// A candidate is a set of CSS-variable overrides plus a small block of extra
// CSS that the HARNESS injects into the running sign. It never edits the sign's
// own files. Sizes are defined in millimetres and converted to vh from the
// panel's measured lit height, so they are physical, not nominal.
//
// Owner's rule (2026-09-18): only Line 2 (locale) and Line 3 (actual stop) carry
// the 22 mm requirement, read as lowercase x-height. Everything else is sized
// for comfortable reading by passengers with full vision, and is smaller.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { TIERS, candidateLayout, estimateThreeLineStackMm } from './candidates.mjs';
import { minTextVh } from './signSizing.mjs';

const H = 180;      // tablet lit height, mm
const RATIO = 0.52; // x-height / font-size (real font measured in the browser)
const vhToMm = (v) => (parseFloat(v) / 100) * H;
const build = (tier, ratio = RATIO) => candidateLayout({ tier, litHeightMm: H, xHeightRatio: ratio });

describe('candidateLayout — tiers and tokens', () => {
  test('offers compact, proposed and large', () => {
    assert.deepEqual(Object.keys(TIERS), ['compact', 'proposed', 'large']);
  });

  test('rejects an unknown tier and bad inputs', () => {
    assert.throws(() => build('huge'));
    assert.throws(() => candidateLayout({ tier: 'proposed', litHeightMm: 0, xHeightRatio: RATIO }));
    assert.throws(() => candidateLayout({ tier: 'proposed', litHeightMm: H, xHeightRatio: 0 }));
  });

  test('returns the four sign tokens as vh strings', () => {
    const c = build('proposed');
    for (const k of ['--min-text', '--header-text', '--logo-text', '--topbar-height']) {
      assert.match(c.tokens[k], /^\d+(\.\d+)?vh$/, k);
    }
  });
});

describe('the 22 mm rule holds in every tier (compliance guard-rail)', () => {
  for (const tier of ['compact', 'proposed', 'large']) {
    test(`${tier}: Line 2/3 lowercase x-height is exactly 22 mm`, () => {
      const c = build(tier);
      assert.equal(c.tokens['--min-text'], `${minTextVh({ targetMm: 22, xHeightRatio: RATIO, litHeightMm: H })}vh`);
      const fontMm = vhToMm(c.tokens['--min-text']);
      assert.ok(Math.abs(fontMm * RATIO - 22) < 1e-9, `x-height ${fontMm * RATIO}`);
    });
  }

  test('a font with a different x-height ratio still lands on 22 mm', () => {
    for (const ratio of [0.48, 0.5, 0.55]) {
      const c = build('proposed', ratio);
      assert.ok(Math.abs(vhToMm(c.tokens['--min-text']) * ratio - 22) < 1e-9, `ratio ${ratio}`);
    }
  });

  test('the target is configurable', () => {
    const c = candidateLayout({ tier: 'proposed', litHeightMm: H, xHeightRatio: RATIO, targetMm: 25 });
    assert.ok(Math.abs(vhToMm(c.tokens['--min-text']) * RATIO - 25) < 1e-9);
  });
});

describe('everything else is smaller than Lines 2/3 but far bigger than today', () => {
  for (const tier of ['compact', 'proposed', 'large']) {
    test(`${tier}: no other text reaches Line 2/3's size`, () => {
      const c = build(tier);
      const big = c.fontMm.lines23;
      assert.ok(c.fontMm.line1 < big && c.fontMm.topbarText < big && c.fontMm.brand < big && c.fontMm.sentence < big);
    });

    test(`${tier}: top bar text and Line 1 are well above today's 5.8 mm (29 px) font`, () => {
      const c = build(tier);
      assert.ok(c.fontMm.topbarText >= 11 && c.fontMm.line1 >= 11, `${c.fontMm.topbarText} / ${c.fontMm.line1}`);
    });
  }

  test('tiers are strictly ordered compact < proposed < large for every non-rule element', () => {
    const a = build('compact').fontMm; const b = build('proposed').fontMm; const c = build('large').fontMm;
    for (const k of ['line1', 'topbarText', 'sentence', 'topbar', 'line1Slot']) {
      assert.ok(a[k] < b[k] && b[k] < c[k], k);
    }
  });
});

describe('the brand mark is present but quiet (owner, 2026-09-19: 5.5 mm)', () => {
  for (const tier of ['compact', 'proposed', 'large']) {
    test(`${tier}: brand wordmark is 5.5 mm`, () => {
      const c = build(tier);
      assert.equal(c.fontMm.brand, 5.5);
      assert.ok(Math.abs(vhToMm(c.tokens['--logo-text']) - 5.5) < 1e-4);
    });
  }
});

describe('Line 1 is the same size as the top bar text, and its depth never changes (owner, 2026-09-19)', () => {
  for (const tier of ['compact', 'proposed', 'large']) {
    test(`${tier}: Line 1 font equals the top bar text font, from one token`, () => {
      const c = build(tier);
      assert.equal(c.fontMm.line1, c.fontMm.topbarText);
      assert.ok(c.css.includes(`font-size: ${c.tokens['--header-text']}`), 'Line 1 must use the --header-text value');
    });

    test(`${tier}: Line 1 has a fixed depth so plain text and the wait box sit in the same slot`, () => {
      const c = build(tier);
      assert.ok(c.fontMm.line1Slot >= 1.5 * c.fontMm.line1, 'slot must hold the two-line wait box');
      assert.match(c.css, /#sign-headline\.hl-three-line \.hl-verb \{[^}]*\bheight: \d/);
    });

    test(`${tier}: no route-start special case remains; route start uses the same three-line rules as every other stop`, () => {
      assert.ok(!build(tier).css.includes('route_start'));
    });

    test(`${tier}: the wait box fits inside the fixed Line 1 slot`, () => {
      const c = build(tier);
      const need = (c.fontMm.line1 * 0.6 + c.fontMm.line1 * 0.42) * 1.2;
      assert.ok(need < c.fontMm.line1Slot, `${need} mm needs to fit ${c.fontMm.line1Slot} mm`);
    });
  }
});

describe('the top bar cannot balloon around small text again', () => {
  for (const tier of ['compact', 'proposed', 'large']) {
    test(`${tier}: bar height is 1.5-2.2x its text (was 4.7x)`, () => {
      const c = build(tier);
      const ratio = c.fontMm.topbar / c.fontMm.topbarText;
      assert.ok(ratio >= 1.5 && ratio <= 2.2, `ratio ${ratio}`);
      assert.ok(Math.abs(vhToMm(c.tokens['--topbar-height']) - c.fontMm.topbar) < 1e-4);
    });

    test(`${tier}: bar is under 20% of the panel height`, () => {
      assert.ok(build(tier).fontMm.topbar < 0.2 * H);
    });
  }
});

describe('estimateThreeLineStackMm — the three-line state must fit the panel', () => {
  for (const tier of ['compact', 'proposed', 'large']) {
    test(`${tier}: stack fits with room for the brand mark above and below the lines`, () => {
      const e = estimateThreeLineStackMm(build(tier), H);
      assert.ok(e.totalMm < H, `total ${e.totalMm} mm of ${H}`);
      assert.ok(e.spareMm >= 10, `spare ${e.spareMm}`);
      assert.equal(e.brandFits, true, `brand block ${e.brandBlockMm} mm needs ${e.brandBlockMm + 2}, half-spare ${e.spareMm / 2}`);
    });
  }

  test('reports a failure when the numbers do not fit (guards the guard)', () => {
    const c = build('large');
    const e = estimateThreeLineStackMm(c, 120);
    assert.equal(e.brandFits, false);
    assert.ok(e.spareMm < 10);
  });
});

describe('extra CSS is safe to inject and covers the right selectors', () => {
  for (const tier of ['compact', 'proposed', 'large']) {
    test(`${tier}: targets Line 1, the sentence states, the wait box and the layout`, () => {
      const css = build(tier).css;
      for (const sel of [
        '#sign-headline.hl-three-line .hl-verb',
        '#sign-headline:not(.hl-three-line)',
        '.hl-verb--early .ewb-title',
        '#sign-main',
      ]) assert.ok(css.includes(sel), `missing ${sel}`);
    });

    test(`${tier}: contains no urls, imports, scripts or style-breaking text`, () => {
      const css = build(tier).css;
      assert.ok(!/url\(|@import|<|>|expression\(|javascript:/i.test(css), css);
    });

    test(`${tier}: never touches Line 2/3 sizing directly (those come only from --min-text)`, () => {
      const css = build(tier).css;
      assert.ok(!/\.hl-town|\.hl-stop|--min-text/.test(css));
    });
  }
});
