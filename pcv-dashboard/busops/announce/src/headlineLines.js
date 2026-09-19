// BusOps Announce sign — how a state's headline is laid out. Pure: no DOM, no
// network, so it can be unit-tested (tests/headlineLines.test.js) and so
// onboard.js (which touches window at module scope) doesn't have to be
// importable in a test.
//
// Three states name a place, and the sign shows each as three stacked lines
// instead of one running sentence:
//   Line 1  the verb phrase ("This is", "The next stop is", "This is an S116T to")
//   Line 2  the locale (the text before the first comma)
//   Line 3  the actual stop (everything after it)
// Lines 2 and 3 carry the 22 mm lowercase x-height rule (see panelSizing.js).
//
// Keyed off stateKey and vars, deliberately NOT by pattern-matching the
// resolved sentence text: ROUTE_START's "This is a X to Y." also starts with
// "This is" and can itself contain a comma (whenever Y is "Town,Stop"-shaped),
// which a text-only regex once mismatched into three nonsense lines (found live
// 2026-09-08). Display only — the spoken text (shared/announceStates.js
// resolveAnnouncementText, and the pre-rendered clips) stays the one unchanged
// flowing sentence; PSVAIR Reg 12(1) governs audio/visual consistency, not
// identical line-breaking.
import { ANNOUNCE_STATES, articleFor } from '../../shared/announceStates.js';

const isText = (value) => typeof value === 'string' && value.trim() !== '';

// stateKey -> { verb, name } from that state's vars, or null when the vars
// can't support it. A Map, not an object, so a stateKey like 'constructor'
// from a bad feed message can never resolve to something inherited.
const LINE_SPECS = new Map([
  [ANNOUNCE_STATES.APPROACHING, (vars) => ({ verb: 'This is', name: vars.stopName })],
  [ANNOUNCE_STATES.STOP_DEPARTURE, (vars) => ({ verb: 'The next stop is', name: vars.nextStopName })],
  [ANNOUNCE_STATES.ROUTE_START, (vars) => (isText(vars.serviceCode)
    // articleFor() is the sign's own a/an rule, judged by how the code is spoken
    // ("an S116T", "a 44"), the same one the spoken sentence uses.
    ? { verb: `This is ${articleFor(vars.serviceCode)} ${vars.serviceCode} to`, name: vars.destination }
    : null)],
]);

/**
 * { verb, town, stop } for a state that shows three lines, or null when the
 * sign should show the plain sentence instead: a state that is never three-line
 * (idle, terminus, diversion, anything unknown), missing or non-text vars, a
 * name with no comma, or a comma with nothing on one side (which would leave
 * Line 2 or 3 blank). Never throws: a bad feed message must not crash the sign.
 * Text is returned as-is; the caller writes it with textContent only.
 */
export function headlineLines(stateKey, vars) {
  const spec = LINE_SPECS.get(stateKey)?.(vars ?? {});
  if (!spec || typeof spec.name !== 'string') return null;

  const commaIndex = spec.name.indexOf(',');
  if (commaIndex === -1) return null;
  const town = spec.name.slice(0, commaIndex).trim();
  const stop = spec.name.slice(commaIndex + 1).trim();
  return town && stop ? { verb: spec.verb, town, stop } : null;
}

const KNOWN_STATES = new Set(Object.values(ANNOUNCE_STATES));

/**
 * The value recorded as data-state on #onboard-sign, so CSS can key off the
 * state itself and never has to guess from the wording. Only ever a known state
 * name: no state is "idle", and anything unrecognised is "unknown" rather than
 * being echoed from a feed message into the page.
 */
export function signStateAttribute(stateKey) {
  if (stateKey === undefined || stateKey === null) return ANNOUNCE_STATES.IDLE;
  return KNOWN_STATES.has(stateKey) ? stateKey : 'unknown';
}
