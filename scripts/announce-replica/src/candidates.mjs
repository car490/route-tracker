// Slice 3 — candidate layouts for the sign (harness-only overrides).
//
// A candidate is a set of CSS-variable overrides plus a small block of extra CSS
// that the harness injects into the running sign. It never edits the sign's own
// files. Sizes are defined in millimetres and converted to vh from the panel's
// measured lit height, so they are physical, not nominal.
//
// Only Line 2 (locale) and Line 3 (actual stop) carry the 22 mm requirement,
// read as lowercase x-height. Their size comes solely from --min-text.
// Everything else is sized for comfortable reading and is smaller.

import { minTextVh } from './signSizing.mjs';

// Font sizes in millimetres for everything that is NOT Line 2/3.
// `header` is ONE size shared by the top bar text and Line 1 (owner, 2026-09-19:
// Line 1 is the same size as the top bar and never changes). `sentence` is only
// for the full-screen terminus / diversion states and the no-comma safety net.
export const TIERS = {
  compact:  { header: 11,   brand: 5.5, sentence: 20 },
  proposed: { header: 13.5, brand: 5.5, sentence: 24 },
  large:    { header: 16,   brand: 5.5, sentence: 28 },
};

const TOPBAR_FACTOR = 1.7; // bar height / bar text size (was 4.7x)
const LINE1_SLOT_FACTOR = 1.6; // fixed Line 1 depth / its text size: holds the two-line wait box

const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const round = (n) => Math.round(n * 1e6) / 1e6;

export function candidateLayout({ tier, litHeightMm, xHeightRatio, targetMm = 22 } = {}) {
  if (!Object.hasOwn(TIERS, tier)) throw new Error(`unknown tier: ${tier}`);
  if (!positive(litHeightMm)) throw new Error('litHeightMm must be a positive number');
  if (!positive(xHeightRatio)) throw new Error('xHeightRatio must be a positive number');
  if (!positive(targetMm)) throw new Error('targetMm must be a positive number');

  const t = TIERS[tier];
  const vh = (mm) => `${round((100 * mm) / litHeightMm)}vh`;
  const minText = minTextVh({ targetMm, xHeightRatio, litHeightMm });
  const lines23Mm = targetMm / xHeightRatio;
  const topbarMm = round(t.header * TOPBAR_FACTOR);
  const slotMm = round(t.header * LINE1_SLOT_FACTOR);

  const fontMm = {
    lines23: lines23Mm,
    line1: t.header,
    topbarText: t.header,
    brand: t.brand,
    sentence: t.sentence,
    topbar: topbarMm,
    line1Slot: slotMm,
  };

  const tokens = {
    '--min-text': `${minText}vh`,
    '--header-text': vh(t.header),
    '--logo-text': vh(t.brand),
    '--topbar-height': vh(topbarMm),
  };

  const css = [
    // Line 1: one size (the top bar's), one fixed depth, in every state.
    `#sign-headline.hl-three-line .hl-verb { font-size: ${vh(t.header)}; height: ${vh(slotMm)}; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1; }`,
    `#sign-headline.hl-three-line .hl-verb.hl-verb--early { padding: 0 2vw; line-height: 1.15; }`,
    `#sign-headline.hl-three-line .hl-verb--early .ewb-title { font-size: ${vh(t.header * 0.6)}; margin: 0; }`,
    `#sign-headline.hl-three-line .hl-verb--early .ewb-msg { font-size: ${vh(t.header * 0.42)}; margin: 0; }`,
    `#sign-headline.hl-three-line { line-height: 1.05; gap: 0.3vh; margin-top: 0; }`,
    `#sign-main { padding: 1.5vh 2.5vw; gap: 1.5vh; }`,
    // Sentence states: terminus and diversion (and the no-comma safety net) only.
    `#sign-headline:not(.hl-three-line) { font-size: ${vh(t.sentence)}; line-height: 1.2; font-weight: 800; }`,
    `.ewb-title { font-size: ${vh(t.sentence * 0.8)}; }`,
    `.ewb-msg { font-size: ${vh(t.sentence * 0.55)}; }`,
  ].join('\n');

  return { tier, tokens, css, fontMm };
}

/**
 * Rough vertical budget for the three-line state, in mm. An estimate to catch
 * obviously-wrong tiers before they are looked at; the harness measures the real thing.
 */
export function estimateThreeLineStackMm(candidate, litHeightMm) {
  const { fontMm: f } = candidate;
  const pad = 2 * 0.015 * litHeightMm;
  const gaps = 2 * 0.003 * litHeightMm;
  const totalMm = f.topbar + pad + f.line1Slot + 2 * (f.lines23 * 1.05) + gaps;
  const spareMm = litHeightMm - totalMm;
  const brandBlockMm = 1.7 * f.brand;
  return {
    totalMm,
    spareMm,
    brandBlockMm,
    brandFits: spareMm >= 10 && spareMm / 2 >= brandBlockMm + 2,
  };
}
