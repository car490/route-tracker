// Tablet capture, part 1: turn a MEASURED report from the real sign into pass/fail
// checks. Pure (no DOM, no network, no adb), so every rule is unit-tested without a
// tablet — see tabletReport.test.mjs.
//
// Sizes arrive in CSS px. The kiosk viewport fills the panel's lit area, so
//   px per mm = viewport height / lit height (measured with a ruler: 180 mm on the Solo tablet)
// and the same conversion is used for every element, so a wrong lit height scales
// every reading equally and shows up as a viewport-aspect or a whole-sign failure.
//
// Only Lines 2 and 3 carry the 22 mm rule, read as lowercase x-height (the owner's
// stricter reading, not yet confirmed against DfT guidance). Everything else is a
// fixed size from the approved plan (onboard.css / panelSizing.js).

export const TARGETS = Object.freeze({
  lines23Mm: 22.1, // lowercase x-height the sign AIMS at, Lines 2 and 3 (22 mm rule + 0.1 mm margin)
  headerMm: 13.5, // top bar text and Line 1 (font size)
  topbarMm: 22.95, // top bar depth (1.7 x 13.5)
  line1SlotMm: 21.6, // Line 1 slot depth (1.6 x 13.5)
  waitTitleMm: 8.1, // "WAIT HERE" (0.6 x 13.5)
  waitMsgMm: 5.67, // "Running early ..." (0.42 x 13.5)
  sentenceMm: 24, // terminus, diversion, no-comma sentence
  brandMm: 5.5, // brand mark main line
});

export const TOLERANCES = Object.freeze({
  lines23Mm: 0.1, // the x-height itself, either measurement
  headerMm: 0.15,
  topbarMm: 0.3,
  line1SlotMm: 0.3,
  waitMm: 0.15,
  sentenceMm: 0.15,
  brandMm: 0.2,
  canvasVsRasterMm: 0.15, // canvas measureText vs drawn pixels
  aspectPct: 1.5, // viewport aspect vs lit-area aspect
  topbarShareMax: 0.2, // the bar stays under 20% of the panel
});

// The rule itself (PSV(AI)R Reg 14(4), the owner's strict reading): no lowercase letter on Lines 2 and 3
// under 22 mm. No slack: at exactly 22.0 mm by canvas the real tablet's shortest DRAWN letter measured
// 21.92 mm (2026-09-19), which is why the sign aims at 22.1 mm (TARGETS.lines23Mm).
export const RULE_LINES23_MIN_MM = 22;

// The Line 2/3 weight the sizing assumes (onboard.js LINE_2_3_FONT_WEIGHT): the x-height
// ratio is measured at this weight, so Lines 2/3 must actually render at it.
export const SIGN_LINE_2_3_WEIGHT = '700';

// The Solo tablet's lit area (owner's ruler figures, 2026-09-19), the default for the CLI. Kept
// here rather than imported from panelSizing.js, which sits in a package without "type": "module"
// (importing it printed a Node warning on every run); a test checks the two agree.
export const SOLO_LIT_WIDTH_MM = 289;
export const SOLO_LIT_HEIGHT_MM = 180;

const isPositive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a');

/**
 * @param report  what probeSign() measured on the real sign (see tabletProbe.mjs)
 * @param options { litHeightMm (required), litWidthMm }
 * @returns { ok, state, pxPerMm, checks: [{ name, status: 'pass'|'fail', detail }], notes }
 */
export function evaluateTabletReport(report, { litHeightMm, litWidthMm = SOLO_LIT_WIDTH_MM } = {}) {
  if (!isPositive(litHeightMm)) throw new RangeError(`litHeightMm must be a positive number, got ${litHeightMm}`);
  if (!report?.viewport || !isPositive(report.viewport.w) || !isPositive(report.viewport.h)) {
    throw new TypeError('report.viewport { w, h } is required');
  }

  const pxPerMm = report.viewport.h / litHeightMm;
  const mm = (px) => px / pxPerMm;
  const rows = report.rows ?? [];
  const row = (name) => rows.find((r) => r.name === name);
  const rowStartingWith = (prefix) => rows.find((r) => r.name.startsWith(prefix));

  const checks = [];
  const notes = [];
  const add = (name, pass, detail) => checks.push({ name, status: pass ? 'pass' : 'fail', detail });
  const within = (value, target, tol) => Math.abs(value - target) <= tol;

  const shown = report.sign?.shown === true;
  const threeLine = shown && report.sign?.threeLine === true;
  const state = shown ? (report.sign?.dataState ?? 'unknown') : 'idle';

  // -- the measuring setup itself -------------------------------------------------
  const aspect = report.viewport.w / report.viewport.h;
  const litAspect = litWidthMm / litHeightMm;
  const aspectOffPct = (Math.abs(aspect - litAspect) / litAspect) * 100;
  add('viewport fills the lit area (so px to mm is valid)', aspectOffPct <= TOLERANCES.aspectPct,
    `${report.viewport.w} x ${report.viewport.h} CSS px, aspect ${aspect.toFixed(3)} vs ${litAspect.toFixed(3)} for ${litWidthMm} x ${litHeightMm} mm (${aspectOffPct.toFixed(2)}% off)`);
  add('web font loaded (Plus Jakarta Sans), so x-heights can be trusted', report.fontLoaded === true,
    report.fontLoaded === true ? 'loaded' : 'NOT loaded: a fallback font is showing');

  // -- top bar (sign bar or idle bar) ---------------------------------------------
  if (report.topbar && isPositive(report.topbar.heightPx)) {
    const depth = mm(report.topbar.heightPx);
    add(`top bar depth ${TARGETS.topbarMm} mm`, within(depth, TARGETS.topbarMm, TOLERANCES.topbarMm), `${fmt(depth)} mm`);
    const share = report.topbar.heightPx / report.viewport.h;
    add('top bar under 20% of the panel', share < TOLERANCES.topbarShareMax, `${(share * 100).toFixed(1)}% of the panel`);
  }

  const bar = row('Top bar: destination');
  if (bar) {
    add(`top bar text ${TARGETS.headerMm} mm`, within(mm(bar.fontPx), TARGETS.headerMm, TOLERANCES.headerMm), `${fmt(mm(bar.fontPx))} mm`);
  }

  const brand = row('Brand wordmark');
  if (brand) {
    add(`brand mark main line ${TARGETS.brandMm} mm`, within(mm(brand.fontPx), TARGETS.brandMm, TOLERANCES.brandMm), `${fmt(mm(brand.fontPx))} mm`);
  }

  // -- three-line states: Line 1, Lines 2/3, the wait box -------------------------
  if (threeLine) {
    const line1 = rowStartingWith('Line 1');
    if (line1) {
      add(`Line 1 text ${TARGETS.headerMm} mm (same as the top bar text)`, within(mm(line1.fontPx), TARGETS.headerMm, TOLERANCES.headerMm), `${fmt(mm(line1.fontPx))} mm`);
    }
    if (report.line1 && isPositive(report.line1.heightPx)) {
      const slot = mm(report.line1.heightPx);
      add(`Line 1 slot depth ${TARGETS.line1SlotMm} mm`, within(slot, TARGETS.line1SlotMm, TOLERANCES.line1SlotMm), `${fmt(slot)} mm`);
    }

    const waitTitle = row('Wait box title');
    const waitMsg = row('Wait box message');
    if (waitTitle) add(`wait box title ${TARGETS.waitTitleMm} mm`, within(mm(waitTitle.fontPx), TARGETS.waitTitleMm, TOLERANCES.waitMm), `${fmt(mm(waitTitle.fontPx))} mm`);
    if (waitMsg) add(`wait box message ${TARGETS.waitMsgMm} mm`, within(mm(waitMsg.fontPx), TARGETS.waitMsgMm, TOLERANCES.waitMm), `${fmt(mm(waitMsg.fontPx))} mm`);

    const town = row('Line 2 (town)');
    const stop = row('Line 3 (stop)');
    add('Line 2 and Line 3 are on screen', Boolean(town && stop), town && stop ? `"${town.text}" / "${stop.text}"` : 'a three-line state is showing but Line 2 or Line 3 was not found');

    const g = report.glyphs;
    add('glyph measurements taken', Boolean(g && isPositive(g.canvasRatio) && isPositive(g.rasterRatio) && isPositive(g.shortestLowerRatio)),
      g ? 'ok' : 'missing: nothing to judge the 22 mm rule by');

    if (town && stop && g && isPositive(g.canvasRatio) && isPositive(g.rasterRatio) && isPositive(g.shortestLowerRatio)) {
      const lines = [town, stop];
      const worst = (ratio, target) => lines
        .map((l) => mm(l.fontPx * ratio))
        .reduce((a, b) => (Math.abs(b - target) > Math.abs(a - target) ? b : a));

      const canvasMm = worst(g.canvasRatio, TARGETS.lines23Mm);
      const rasterMm = worst(g.rasterRatio, TARGETS.lines23Mm);
      add(`Lines 2/3 lowercase x-height by canvas is the ${TARGETS.lines23Mm} mm aim`, within(canvasMm, TARGETS.lines23Mm, TOLERANCES.lines23Mm), `${fmt(canvasMm)} mm (the sign's own method)`);
      add(`Lines 2/3 lowercase x-height by pixels is the ${TARGETS.lines23Mm} mm aim`, within(rasterMm, TARGETS.lines23Mm, TOLERANCES.lines23Mm), `${fmt(rasterMm)} mm (drawn glyph, independent of measureText)`);
      add('canvas and pixel measurements agree', Math.abs(canvasMm - rasterMm) <= TOLERANCES.canvasVsRasterMm,
        `differ by ${fmt(Math.abs(canvasMm - rasterMm))} mm`);

      const shortestMm = Math.min(...lines.map((l) => mm(l.fontPx * g.shortestLowerRatio)));
      add(`shortest lowercase letter is at least ${RULE_LINES23_MIN_MM} mm (the rule, no slack)`, shortestMm >= RULE_LINES23_MIN_MM,
        `${fmt(shortestMm)} mm (letter "${g.shortestLowerChar ?? '?'}")`);

      const weights = [town.weight, stop.weight, g.weight];
      add(`Lines 2/3 weight is ${SIGN_LINE_2_3_WEIGHT}, the weight the sizing assumes`, weights.every((w) => String(w) === SIGN_LINE_2_3_WEIGHT),
        `Line 2 ${town.weight}, Line 3 ${stop.weight}, glyphs measured at ${g.weight}`);
    }
  }

  // -- sentence states ------------------------------------------------------------
  if (shown && !threeLine) {
    const sentence = row('Sentence headline');
    if (sentence) {
      add(`sentence headline ${TARGETS.sentenceMm} mm`, within(mm(sentence.fontPx), TARGETS.sentenceMm, TOLERANCES.sentenceMm), `${fmt(mm(sentence.fontPx))} mm`);
    }
  }

  if (!shown) {
    notes.push('No journey state on screen (idle or asleep): Lines 1-3, the wait box and the sentence checks were skipped. Run again while the sign is showing a stop.');
  }

  const failures = checks.filter((c) => c.status === 'fail');
  return { ok: failures.length === 0, state, pxPerMm, checks, notes };
}
