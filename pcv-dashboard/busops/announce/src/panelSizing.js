// BusOps Announce sign — panel sizing maths. Pure: no DOM, no network, no
// storage, so it can be unit-tested (tests/panelSizing.test.js) and so
// onboard.js (which touches window at module scope) doesn't have to be
// importable in a test.
//
// PSV(AI)R Reg 14(4): Lines 2 and 3 (locale and actual stop) must have no
// lowercase letter under 22 mm. Read strictly as lowercase x-height. That
// depends on two physical facts a browser cannot report on its own — the
// panel's real lit height and the rendered font's x-height — so the first is
// supplied once per named profile (measured with a ruler) and the second is
// measured at runtime from the font actually loaded (see onboard.js).

// Named display profiles, commissioned via ?panel-profile=<key>.
// diagonalInches: nominal size, used by the legacy calculation.
// litHeightMm (optional): MEASURED lit height. Present = the sign sizes
//   Lines 2/3 physically. Absent = the profile keeps the legacy calculation
//   until someone measures the panel.
//
// bar is the original ultra-wide destination-board plan (not yet built, no
// measured height); lite is the Announce Lite/Solo tablet, a LEVIRTU 14" Android
// tablet (OEM identity PIXGOOD M328-EEA), 1200x1920 native — lit area measured
// 289 x 180 mm on 2026-09-19. Its nominal 14" is kept only as the
// ?panel-diagonal= style fallback. A `monitor` profile (the Dell Pro P2426H demo
// display) existed until 2026-09-19 and was removed: the owner is not using it.
// A panel with no profile is commissioned with ?panel-diagonal=<inches>.
export const PANEL_PROFILES = {
  bar:     { diagonalInches: 28 },
  lite:    { diagonalInches: 14, litHeightMm: 180 },
};

// Typical for the sans-serifs this sign uses. Applied only when the runtime
// measurement is missing or implausible (see usableXHeightRatio).
export const DEFAULT_X_HEIGHT_RATIO = 0.52;
const MIN_PLAUSIBLE_X_HEIGHT_RATIO = 0.4;
const MAX_PLAUSIBLE_X_HEIGHT_RATIO = 0.7;

// The rule is 22 mm of lowercase x-height on Lines 2 and 3 (PSV(AI)R Reg 14(4), the owner's strict
// reading). The sign AIMS 0.1 mm higher. Measured on the real Solo tablet on 2026-09-19: sized to
// exactly 22.0 mm by canvas measureText, the drawn glyphs were 21.92 mm (0.3% short: measureText and the
// rasterised glyph disagree by up to a pixel at the 200 px it measures at), so the shortest lowercase
// letter failed the rule by 0.08 mm. 0.1 mm (0.45%) clears that shortfall with room to spare and costs
// a fraction of a millimetre of layout.
export const LINE_2_3_RULE_MM = 22;
export const LINE_2_3_MARGIN_MM = 0.1;
export const LINE_2_3_TARGET_MM = LINE_2_3_RULE_MM + LINE_2_3_MARGIN_MM;

const isPositiveNumber = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

// Legacy: sizes the CSS *font* to 22 mm from a nominal diagonal, which is
// only ~11 mm of lowercase x-height. Kept, unchanged, for profiles that have
// no measured lit height and for the explicit ?panel-diagonal= escape hatch.
export function computeMinTextVh(diagonalInches, viewportWidthPx, viewportHeightPx) {
  if (!diagonalInches || !viewportWidthPx || !viewportHeightPx) return null;
  const diagonalPx = Math.sqrt(viewportWidthPx ** 2 + viewportHeightPx ** 2);
  const panelHeightMm = diagonalInches * 25.4 * (viewportHeightPx / diagonalPx);
  return (22 / panelHeightMm) * 100;
}

// The --min-text value, in vh, whose rendered lowercase x-height is exactly
// targetMm. vh is a fraction of viewport height, so this depends only on the
// physical lit height, never on resolution:
//   vh = 100 * targetMm / (xHeightRatio * litHeightMm)
export function computeMinTextVhFromLitHeight({ litHeightMm, xHeightRatio, targetMm = LINE_2_3_TARGET_MM } = {}) {
  if (!isPositiveNumber(litHeightMm)) throw new RangeError(`litHeightMm must be a positive number, got ${litHeightMm}`);
  if (!isPositiveNumber(xHeightRatio) || xHeightRatio > 1) throw new RangeError(`xHeightRatio must be in (0, 1], got ${xHeightRatio}`);
  if (!isPositiveNumber(targetMm)) throw new RangeError(`targetMm must be a positive number, got ${targetMm}`);
  return (100 * targetMm) / (xHeightRatio * litHeightMm);
}

// The one size shared by the top bar text and Line 1 (owner, 2026-09-19).
// Neither carries the 22 mm rule — only Lines 2/3 do — so this is a comfortable
// reading size, defined in mm and converted from the measured lit height so it
// stays physical: 13.5 mm is 7.5vh on the 180 mm Solo tablet. onboard.css hangs
// the bar depth (1.7x, 23 mm), the Line 1 slot (1.6x, 21.6 mm) and the wait
// box text (0.6x / 0.42x) off --header-text, so this is the only number needed.
export const HEADER_TEXT_MM = 13.5;

// The full-screen sentence states — terminus ("all change please"), diversion,
// and the no-comma safety net where a stop name can't be split into three
// lines — at 24 mm (owner, 2026-09-19). Also no 22 mm rule (only Lines 2/3
// have it), so a comfortable size that fits the panel. 13.3vh on the tablet.
export const SENTENCE_TEXT_MM = 24;

// The brand mark's main line ("BusOps Announce"), 5.5 mm (owner, 2026-09-19);
// 3.06vh on the tablet. Its two smaller lines are fixed ratios of it in
// onboard.css, so they follow.
export const BRAND_TEXT_MM = 5.5;

// mm -> vh from the measured lit height, so a size defined in millimetres
// stays physical: vh = 100 * mm / litHeightMm.
function mmToVh(litHeightMm, targetMm) {
  if (!isPositiveNumber(litHeightMm)) throw new RangeError(`litHeightMm must be a positive number, got ${litHeightMm}`);
  if (!isPositiveNumber(targetMm)) throw new RangeError(`targetMm must be a positive number, got ${targetMm}`);
  return (100 * targetMm) / litHeightMm;
}

export function computeHeaderTextVh({ litHeightMm, targetMm = HEADER_TEXT_MM } = {}) {
  return mmToVh(litHeightMm, targetMm);
}

export function computeSentenceTextVh({ litHeightMm, targetMm = SENTENCE_TEXT_MM } = {}) {
  return mmToVh(litHeightMm, targetMm);
}

export function computeBrandTextVh({ litHeightMm, targetMm = BRAND_TEXT_MM } = {}) {
  return mmToVh(litHeightMm, targetMm);
}

// A canvas measurement can fail (no canvas, font not loaded, 0 back from a
// blank glyph). A wrong ratio would silently mis-size the sign, so anything
// outside a plausible range is replaced by the default and flagged.
export function usableXHeightRatio(measured) {
  const plausible = isPositiveNumber(measured)
    && measured >= MIN_PLAUSIBLE_X_HEIGHT_RATIO
    && measured <= MAX_PLAUSIBLE_X_HEIGHT_RATIO;
  return plausible
    ? { ratio: measured, fellBack: false }
    : { ratio: DEFAULT_X_HEIGHT_RATIO, fellBack: true };
}

// Decides which sizing path applies. Precedence:
//   1. explicit ?panel-diagonal= (legacy maths; the documented escape hatch)
//   2. profile with litHeightMm (physical maths; measures the font)
//   3. profile with only a diagonal (legacy maths)
//   4. nothing: vh is null, so CSS's own --min-text default stands
// headerTextVh (top bar / Line 1), sentenceTextVh (terminus, diversion) and
// brandTextVh (the brand mark) are physical only on path 2, where the lit height
// is trusted; otherwise null and onboard.css's own defaults stand.
// measureXHeightRatio is only ever called on path 2, and may throw or return
// junk — either falls back to the default ratio rather than breaking the sign.
export function resolveMinTextVh({
  explicitDiagonalInches, profile, viewportWidthPx, viewportHeightPx, measureXHeightRatio,
} = {}) {
  if (explicitDiagonalInches) {
    return {
      vh: computeMinTextVh(explicitDiagonalInches, viewportWidthPx, viewportHeightPx),
      source: 'explicit-diagonal',
      ratioFellBack: false,
      headerTextVh: null,
      sentenceTextVh: null,
      brandTextVh: null,
    };
  }
  if (profile?.litHeightMm) {
    let measured;
    try {
      measured = measureXHeightRatio?.();
    } catch (_) {
      measured = undefined; // treated as unusable below
    }
    const { ratio, fellBack } = usableXHeightRatio(measured);
    return {
      vh: computeMinTextVhFromLitHeight({ litHeightMm: profile.litHeightMm, xHeightRatio: ratio }),
      source: 'lit-height',
      ratioFellBack: fellBack,
      headerTextVh: computeHeaderTextVh({ litHeightMm: profile.litHeightMm }),
      sentenceTextVh: computeSentenceTextVh({ litHeightMm: profile.litHeightMm }),
      brandTextVh: computeBrandTextVh({ litHeightMm: profile.litHeightMm }),
    };
  }
  if (profile?.diagonalInches) {
    return {
      vh: computeMinTextVh(profile.diagonalInches, viewportWidthPx, viewportHeightPx),
      source: 'profile-diagonal',
      ratioFellBack: false,
      headerTextVh: null,
      sentenceTextVh: null,
      brandTextVh: null,
    };
  }
  return {
    vh: null, source: null, ratioFellBack: false, headerTextVh: null, sentenceTextVh: null, brandTextVh: null,
  };
}
