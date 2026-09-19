// Sign sizing maths (slice 1). Pure functions: no DOM, no network, no dependencies.
//
// Purpose: turn MEASURED physical sizes into pixel sizes (and back), so the
// BusOps Announce sign can be (a) shown at true physical size on a different
// screen and (b) sized from a physical target such as "lowercase letters at
// least 22 mm" instead of a nominal marketing diagonal.
//
// All lengths are millimetres unless the name says Px. "CSS px" means the
// units a web page lays out in; "device px" are physical screen pixels
// (device px = CSS px x devicePixelRatio).

const MM_PER_INCH = 25.4;
const EPSILON = 1e-6;

function requirePositive(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

/**
 * Pixel density of a display from its MEASURED lit area.
 * Returns px/mm across (x), down (y) and their mean, plus how far the two
 * disagree (square pixels mean any disagreement is measurement error).
 */
export function pxPerMm({ litWidthMm, litHeightMm, widthPx, heightPx } = {}) {
  requirePositive('litWidthMm', litWidthMm);
  requirePositive('litHeightMm', litHeightMm);
  requirePositive('widthPx', widthPx);
  requirePositive('heightPx', heightPx);
  const x = widthPx / litWidthMm;
  const y = heightPx / litHeightMm;
  const mean = (x + y) / 2;
  return { x, y, mean, mismatchPct: (Math.abs(x - y) / mean) * 100 };
}

export function pxToMm(px, density) {
  requirePositive('density', density);
  return px / density;
}

export function mmToPx(mm, density) {
  requirePositive('density', density);
  return mm * density;
}

/**
 * Rendered lowercase x-height, in mm, of text set at fontSizePx.
 * xHeightRatio = x-height / font-size for the actual font (about 0.5-0.55 for
 * common sans-serifs; measured from the loaded font in slice 2).
 */
export function xHeightMm({ fontSizePx, xHeightRatio, density } = {}) {
  requirePositive('fontSizePx', fontSizePx);
  requireRatio(xHeightRatio);
  return pxToMm(fontSizePx * xHeightRatio, density);
}

/** Font size in px whose lowercase x-height is targetMm. */
export function fontSizeForXHeightPx({ targetMm, xHeightRatio, density } = {}) {
  requirePositive('targetMm', targetMm);
  requireRatio(xHeightRatio);
  return mmToPx(targetMm / xHeightRatio, density);
}

function requireRatio(r) {
  if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0 || r > 1) {
    throw new RangeError(`xHeightRatio must be in (0, 1], got ${r}`);
  }
}

/**
 * The --min-text value, in vh, that renders lowercase letters at targetMm.
 * Depends only on physical lit HEIGHT (vh is a fraction of viewport height),
 * not on resolution or on a nominal diagonal:
 *   vh = 100 x targetMm / (xHeightRatio x litHeightMm)
 */
export function minTextVh({ targetMm = 22, xHeightRatio, litHeightMm } = {}) {
  requirePositive('targetMm', targetMm);
  requireRatio(xHeightRatio);
  requirePositive('litHeightMm', litHeightMm);
  return (100 * targetMm) / (xHeightRatio * litHeightMm);
}

/**
 * Faithful copy of onboard.js computeMinTextVh() as of 2026-09-18, kept here
 * ONLY so tests can pin and document today's behaviour: it sizes the CSS
 * font-size to 22 mm (not lowercase x-height) using a NOMINAL diagonal.
 */
export function legacyMinTextVh(diagonalInches, viewportWidthPx, viewportHeightPx) {
  if (!diagonalInches || !viewportWidthPx || !viewportHeightPx) return null;
  const diagonalPx = Math.sqrt(viewportWidthPx ** 2 + viewportHeightPx ** 2);
  const panelHeightMm = diagonalInches * MM_PER_INCH * (viewportHeightPx / diagonalPx);
  return (22 / panelHeightMm) * 100;
}

/**
 * How to show `panel` (the target display, e.g. the tablet) at true physical
 * size on `screen` (the review machine, e.g. the laptop).
 *
 * panel:  { litWidthMm, litHeightMm, cssWidthPx, cssHeightPx }
 * screen: { litWidthMm, resWidthPx, resHeightPx, osScale }
 *
 * The screen's density is taken from its measured WIDTH (one uniform scale,
 * never distorting the picture). The width/height disagreement is reported
 * as screenDensityMismatchPct when screen.litHeightMm is supplied.
 *
 * deviceScale: device px per panel CSS px (the panel's 1442 CSS px must span
 *   litWidthMm on screen).
 * cssScale: the scale to apply to a page laid out at the screen's own
 *   devicePixelRatio (= osScale), e.g. transform: scale(cssScale), or the
 *   equivalent browser zoom.
 */
export function replicaFrame({ panel, screen } = {}) {
  if (!panel || !screen) throw new RangeError('panel and screen are required');
  requirePositive('panel.litWidthMm', panel.litWidthMm);
  requirePositive('panel.litHeightMm', panel.litHeightMm);
  requirePositive('panel.cssWidthPx', panel.cssWidthPx);
  requirePositive('panel.cssHeightPx', panel.cssHeightPx);
  requirePositive('screen.litWidthMm', screen.litWidthMm);
  requirePositive('screen.resWidthPx', screen.resWidthPx);
  requirePositive('screen.resHeightPx', screen.resHeightPx);
  requirePositive('screen.osScale', screen.osScale);

  const density = screen.resWidthPx / screen.litWidthMm; // device px per mm
  const frameDeviceWidthPx = panel.litWidthMm * density;
  const frameDeviceHeightPx = panel.litHeightMm * density;
  const deviceScale = frameDeviceWidthPx / panel.cssWidthPx;

  const spareWidthPx = screen.resWidthPx - frameDeviceWidthPx;
  const spareHeightPx = screen.resHeightPx - frameDeviceHeightPx;
  const cropWidthPx = spareWidthPx < -EPSILON ? -spareWidthPx : 0;
  const cropHeightPx = spareHeightPx < -EPSILON ? -spareHeightPx : 0;

  let screenDensityMismatchPct = null;
  if (screen.litHeightMm !== undefined) {
    const d = pxPerMm({
      litWidthMm: screen.litWidthMm,
      litHeightMm: screen.litHeightMm,
      widthPx: screen.resWidthPx,
      heightPx: screen.resHeightPx,
    });
    screenDensityMismatchPct = d.mismatchPct;
  }

  return {
    density,
    deviceScale,
    cssScale: deviceScale / screen.osScale,
    frameDeviceWidthPx,
    frameDeviceHeightPx,
    spareWidthPx,
    spareHeightPx,
    fits: cropWidthPx === 0 && cropHeightPx === 0,
    cropWidthFraction: cropWidthPx / frameDeviceWidthPx,
    cropHeightFraction: cropHeightPx / frameDeviceHeightPx,
    screenDensityMismatchPct,
  };
}
