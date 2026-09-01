// Single source of truth for the onboard sign's display states — each state
// carries exactly one headline of text used verbatim for both the on-screen
// display (announce/src/onboard.js) and the spoken PSVAIR announcement
// (driver/src/announcements.js). This is what makes Regulation 12(1) of the
// Public Service Vehicles (Accessible Information) Regulations 2023 ("the
// audio and visual forms... are consistent with one another") structural
// rather than something two independently hand-written strings have to be
// kept in sync by hand.
//
// Lives in busops/shared/, not driver/, because it has three independent
// consumers, not two: the Driver device (driver/src/announcements.js,
// driver/src/main.js), the onboard sign itself (announce/src/onboard.js),
// and announce/src/announceStandaloneAutopilot.js — the Lite standalone/
// driverless tier, which resolves state itself with no Driver device in the
// loop at all.

export const ANNOUNCE_STATES = Object.freeze({
  IDLE: 'idle',
  ROUTE_START: 'route_start',
  STOP_DEPARTURE: 'stop_departure',
  APPROACHING: 'approaching',
  AT_STOP: 'at_stop',
  DIVERSION: 'diversion',
});

// "a"/"an" for a service code, judged by how it's actually spoken — not by
// its literal first character. A leading letter is read as its letter name
// ("S125S" -> "Ess...", vowel sound -> "an"); a leading digit run is read as
// the number it spells ("44" -> "forty-four", consonant -> "a"; "8" ->
// "eight", vowel -> "an"). Scoped to realistic route-number lengths (up to
// 3 digits) — no operator in this system runs 4+ digit service codes.
const LETTER_VOWEL_SOUND = new Set(['A', 'E', 'F', 'H', 'I', 'L', 'M', 'N', 'O', 'R', 'S', 'X']);
const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numberToWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${numberToWords(n % 100)}` : ''}`;
}

// The one common exception in this range where spelling and spoken sound
// disagree: "one" is spelled with a vowel but spoken "won" (consonant).
const VOWEL_SOUND_EXCEPTIONS = new Set(['one']);

function startsWithVowelSound(word) {
  const firstWord = word.toLowerCase().split(/[\s-]/)[0];
  if (VOWEL_SOUND_EXCEPTIONS.has(firstWord)) return false;
  return /^[aeiou]/.test(firstWord);
}

export function articleFor(serviceCode) {
  const first = (serviceCode ?? '').trim()[0];
  if (!first) return 'a';
  if (/[a-zA-Z]/.test(first)) return LETTER_VOWEL_SOUND.has(first.toUpperCase()) ? 'an' : 'a';
  if (/[0-9]/.test(first)) {
    const digits = serviceCode.match(/^\d+/)[0].slice(0, 3);
    return startsWithVowelSound(numberToWords(Number(digits))) ? 'an' : 'a';
  }
  return 'a';
}

// Pure text resolver — vars per state:
//   ROUTE_START:    { serviceCode, destination }
//   STOP_DEPARTURE: { serviceCode, destination, nextStopName }
//   APPROACHING:    { stopName, isFinal }
//   AT_STOP:        { stopName, isFinal }
//   DIVERSION:      none — fixed text, deliberately takes no free-text
//                    parameters (matches the driver-triggered alert's
//                    existing zero-argument contract — see diversionAlert.js)
//
// Trailing periods on every template are deliberate: they let the
// pre-rendered audio clip sequence and the on-screen text stay
// byte-identical (driver/src/announcements.js splices clips together at
// sentence boundaries) without changing the wording itself.
export function resolveAnnouncementText(stateKey, vars) {
  switch (stateKey) {
    case ANNOUNCE_STATES.IDLE:
      return null;
    case ANNOUNCE_STATES.ROUTE_START:
      return `This is ${articleFor(vars.serviceCode)} ${vars.serviceCode} to ${vars.destination}.`;
    case ANNOUNCE_STATES.STOP_DEPARTURE:
      return `This is ${articleFor(vars.serviceCode)} ${vars.serviceCode} to ${vars.destination}. The next stop will be ${vars.nextStopName}.`;
    case ANNOUNCE_STATES.APPROACHING:
      return vars.isFinal
        ? `The next stop is ${vars.stopName}. This bus terminates here, all change please.`
        : `The next stop will be ${vars.stopName}.`;
    case ANNOUNCE_STATES.AT_STOP:
      return vars.isFinal
        ? `This is ${vars.stopName}. This bus terminates here, all change please.`
        : `This stop is ${vars.stopName}.`;
    case ANNOUNCE_STATES.DIVERSION:
      return 'Attention, this bus is on diversion.';
    default:
      return null;
  }
}

// NaPTAN display names carry a trailing parenthetical indicator —
// "Weston, The Chequers PH (adj)", "Grantham, Bus Station (Stand 5)" — for
// route-planning precision (which pole/bay/side of the road). Not meant for
// passengers: awkward read aloud, and one more thing eating into the 22mm
// minimum on screen. Every caller of resolveApproachOrArrivalState passes
// its own allStops verbatim (as fetched, indicator intact), so stripping
// happens once, here, rather than duplicated at each call site — matches
// stripIndicator()'s existing per-file convention elsewhere in this codebase
// (main.js, announceStandaloneAutopilot.js), just centralised for this one
// shared entry point.
function stripIndicator(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, '');
}

// Resolves gps.js's approaching/atStop signals (see shared/gps.js) into one
// of the two GPS-driven states, with the isFinal branch pre-computed —
// centralised here so driver/src/main.js and
// announce/src/announceStandaloneAutopilot.js (the two independent state
// producers that watch live GPS) don't each reimplement "which signal wins,
// and is this stop the last one" separately. approaching/atStop are each
// either null or { stopIndex }; approaching takes priority when (in theory)
// both are present, since gps.js never actually sets both at once.
export function resolveApproachOrArrivalState({ approaching, atStop, allStops }) {
  const lastIndex = allStops.length - 1;

  if (approaching) {
    const stop = allStops[approaching.stopIndex];
    return {
      stateKey: ANNOUNCE_STATES.APPROACHING,
      vars: { stopName: stripIndicator(stop.name), isFinal: approaching.stopIndex === lastIndex },
    };
  }
  if (atStop) {
    const stop = allStops[atStop.stopIndex];
    return {
      stateKey: ANNOUNCE_STATES.AT_STOP,
      vars: { stopName: stripIndicator(stop.name), isFinal: atStop.stopIndex === lastIndex },
    };
  }
  return null;
}

// Reused by shared/geofence.js's classifier output — a per-stop status of
// 'skipped_detour' (more than SKIPPED_SIGNAL_MAX_TIMING_POINTS timing-point
// stops bypassed before rejoining) is treated as "strayed significantly from
// the planned route" for the standalone-Lite auto-detect diversion trigger
// (see announce/src/announceStandaloneAutopilot.js). Centralised here so
// that call site doesn't hardcode geofence.js's status string.
export const DEVIATION_STOP_STATUS = 'skipped_detour';
