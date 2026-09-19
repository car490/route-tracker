// Pure logic behind the replica harness page (slice 2). No DOM, no network.
//
// Scenarios use the REAL message shapes the sign consumes
// ({type:'schedule',...} then {type:'state', stateKey, vars, earlyWait}) and the
// real ANNOUNCE_STATES key values, so the harness exercises the unmodified
// sign code paths (onSchedule/onState/onJourneyEnd exported by onboard.js).
// Stop names use the sign's "Town,Stop" comma convention (see onboard.js
// renderHeadlineText) and include the two names from the 2026-09-18 tablet
// photos so screenshots can be compared like for like.

import { splitLikeSign } from './stopNames.mjs';

const SCHEDULE = Object.freeze({
  type: 'schedule',
  serviceCode: 'S116T',
  destination: 'Boston, Bus Station',
});

export const SCENARIOS = Object.freeze([
  { id: 'route-start', key: '1', label: 'Route start ("This is an S116T to Boston...")',
    stateKey: 'route_start', vars: { serviceCode: 'S116T', destination: 'Boston, Bus Station' } },
  { id: 'next-three-line', key: '2', label: 'Next stop, three-line (Donington,Market Place) - photo 2',
    stateKey: 'stop_departure', vars: { nextStopName: 'Donington,Market Place' } },
  { id: 'next-single-line', key: '3', label: 'Next stop, single-line sentence (Bicker Bar Hotel) - photo 1',
    stateKey: 'stop_departure', vars: { nextStopName: 'Bicker Bar Hotel' } },
  { id: 'this-is-three-line', key: '4', label: 'Approaching, three-line ("This is" Donington,Market Place)',
    stateKey: 'approaching', vars: { stopName: 'Donington,Market Place', isFinal: false } },
  { id: 'this-is-early-wait', key: '5', label: 'Approaching + running early ("WAIT HERE" box)',
    stateKey: 'approaching', vars: { stopName: 'Donington,Market Place', isFinal: false }, earlyWaitMinutes: 4 },
  { id: 'long-stop-line', key: '6', label: 'Long stop line (Wyberton,Fen Road Sainsbury Local)',
    stateKey: 'stop_departure', vars: { nextStopName: 'Wyberton,Fen Road Sainsbury Local' } },
  { id: 'long-town-line', key: '7', label: 'Long town line (Frampton Marsh Village,Church)',
    stateKey: 'stop_departure', vars: { nextStopName: 'Frampton Marsh Village,Church' } },
  { id: 'terminus', key: '8', label: 'Terminus ("This service terminates here")',
    stateKey: 'at_stop', vars: { stopName: 'Boston, Bus Station', isFinal: true } },
  { id: 'diversion', key: '9', label: 'Diversion ("Attention, this bus is on diversion")',
    stateKey: 'diversion', vars: {} },
  { id: 'idle', key: '0', label: 'Idle screen (journey ended)', journeyEnd: true },
]);

/** Messages to feed the sign for a scenario. `nowMs` anchors the early-wait time. */
export function buildScenarioMessages(scenario, nowMs = Date.now()) {
  if (scenario.journeyEnd) return { journeyEnd: true };
  const state = {
    type: 'state',
    stateKey: scenario.stateKey,
    vars: { ...scenario.vars },
    earlyWait: scenario.earlyWaitMinutes
      ? { scheduledTime: new Date(nowMs + scenario.earlyWaitMinutes * 60_000).toISOString() }
      : null,
  };
  return { schedule: { ...SCHEDULE }, state };
}

/** Ticks for a millimetre ruler of a whole number of mm: cm, half-cm and mm kinds. */
export function rulerTicks(lengthMm) {
  if (!Number.isInteger(lengthMm) || lengthMm <= 0) {
    throw new RangeError(`lengthMm must be a positive integer, got ${lengthMm}`);
  }
  const ticks = [];
  for (let mm = 0; mm <= lengthMm; mm++) {
    ticks.push({ mm, kind: mm % 10 === 0 ? 'cm' : mm % 5 === 0 ? 'half' : 'mm' });
  }
  return ticks;
}

/**
 * The PSV(AI)R rule as the owner stated it: no lowercase character in Lines
 * 2 and 3 may be under 22 mm. A 0.05 mm tolerance absorbs sub-pixel rounding
 * in the browser's glyph measurement, and no more.
 */
export function verdictForLowercase({ xHeightMm, requiredMm = 22, toleranceMm = 0.05 } = {}) {
  if (typeof xHeightMm !== 'number' || !Number.isFinite(xHeightMm)) {
    throw new RangeError(`xHeightMm must be a finite number, got ${xHeightMm}`);
  }
  return {
    pass: xHeightMm >= requiredMm - toleranceMm,
    shortfallMm: Math.max(0, requiredMm - xHeightMm),
  };
}

/**
 * Clipping and collision flags from measured element rectangles (CSS px in the
 * sign's own viewport). null rects (element not shown) are ignored.
 */
export function layoutFlags({ viewport, rects, overlapPairs = null, noBounds = [] }) {
  const flags = [];
  const shown = Object.entries(rects).filter(([, r]) => r);
  const skipBounds = new Set(noBounds);
  const wanted = overlapPairs
    ? new Set(overlapPairs.flatMap(([x, y]) => [`${x}|${y}`, `${y}|${x}`]))
    : null;

  for (const [name, r] of shown) {
    if (skipBounds.has(name)) continue;
    if (r.bottom > viewport.h) flags.push({ type: 'below-panel', name, overshootPx: r.bottom - viewport.h });
    if (r.top < 0) flags.push({ type: 'above-panel', name, overshootPx: -r.top });
    if (r.right > viewport.w) flags.push({ type: 'right-of-panel', name, overshootPx: r.right - viewport.w });
    if (r.left < 0) flags.push({ type: 'left-of-panel', name, overshootPx: -r.left });
  }
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const [an, a] = shown[i];
      const [bn, b] = shown[j];
      if (wanted && !wanted.has(`${an}|${bn}`)) continue;
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        flags.push({ type: 'overlap', names: [an, bn] });
      }
    }
  }
  return flags;
}

/**
 * The proposed three-line route-start (owner, 2026-09-19):
 *   Line 1  "This is a/an <service> to"
 *   Line 2/3  the destination, split at its first comma exactly like every other stop.
 * `article` comes from the sign's own articleFor() so it is judged by how it is spoken.
 * Returns null when the destination has no comma (the sign then keeps the sentence).
 */
export function routeStartLines({ serviceCode, destination, article } = {}) {
  for (const [k, v] of Object.entries({ serviceCode, destination, article })) {
    if (typeof v !== 'string' || v.trim() === '') throw new TypeError(`${k} is required`);
  }
  const split = splitLikeSign(destination);
  if (!split.threeLine) return null;
  return { verb: `This is ${article} ${serviceCode} to`, town: split.town, stop: split.stop };
}
