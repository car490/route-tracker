// Fixed passenger-facing onboard sign. Deliberately siloed from main.js —
// no login, no duty card UI, no incident reporting, no stop-time upload.
// This file itself still writes nothing to Supabase directly.
//
// Three tiers, two feeds, mutually exclusive per device (see docs/
// ANNOUNCE-PRODUCT-TIERS.md):
//
// - Announce (base tier, Controller-fed): NO reads of its own — no
//   independent get_duty_card polling, no GPS, no schedule_view queries, no
//   Supabase writes. A pure renderer driven entirely by what the Driver
//   device pushes over a local WebSocket (see src/announceLink.js — the
//   sender — and mele-server/announceRelay.mjs — the relay this device
//   connects to). Told nothing about which journey to watch via its own URL
//   beyond ?announce-token=<token> (the relay's shared secret — see
//   mele-server/DEPLOY.md). Sits blank until an authenticated /sign-feed
//   connection receives a {type:'schedule'} message, then wakes on its own
//   as {type:'state'} messages arrive.
//
// - Announce Lite (paired) and Announce Solo (driverless), both
//   Controller-less: an intentional, scoped exception to "no reads of its
//   own" — see announceDeviceFeed.js. Reads its own announce_devices row
//   (anon, scoped by the device_id claim in ?announce-device-token=<token>
//   — a distinct param from the base tier's ?announce-token=, never both on
//   the same device). Lite subscribes to Supabase Realtime for
//   driver-pushed schedule/state updates, calling the exact same
//   onSchedule()/onState() below — the rendering code is shared unchanged
//   across all three tiers, only the transport differs. Solo also calls
//   these same two functions, resolving its own state locally instead of
//   receiving a push — see announceSoloAutopilot.js.
//
// Renders one headline of text per display state (shared/announceStates.js)
// — the exact same text spoken as audio, wherever the audio happens (the
// Driver device for the base tier or Lite, this device itself for Solo —
// see announceSpeech.js). This device never decides *what* state
// applies; it only ever displays whatever {stateKey, vars} it's told.
import { connectAnnounceDeviceFeed } from './announceDeviceFeed.js';
import { captureAnnounceDeviceSetup, getAnnounceDeviceToken } from './announceDeviceSetup.js';
import { ANNOUNCE_STATES, resolveAnnouncementText } from '../../shared/announceStates.js';
import { PANEL_PROFILES, resolveMinTextVh } from './panelSizing.js';
import { headlineLines, signStateAttribute } from './headlineLines.js';

// Named display profiles (PANEL_PROFILES, panelSizing.js) — commissioned via
// ?panel-profile=<key>, the same URL-param pattern as ?panel-diagonal= below.
// Naming the target is more robust for kiosk deployments than trusting a URL
// param typed once at commissioning time.
const panelProfile = PANEL_PROFILES[new URLSearchParams(window.location.search).get('panel-profile')] ?? null;

const el = (id) => document.getElementById(id);

// ── PSV(AI)R 22mm minimum text height — panel-agnostic sizing ──────────────
// Lines 2 and 3 must have no lowercase letter under 22mm, read strictly as
// x-height. Browsers have no reliable API for a screen's physical size (no
// EDID access, by design — a real web platform limit), so the one thing
// supplied per panel, once, is physical: the profile's measured lit height
// (PANEL_PROFILES.lite.litHeightMm). The other input, the rendered font's
// x-height, is measured here at runtime from the font actually loaded, so
// 22mm still holds if the tablet falls back to another font offline. The
// maths and the precedence between the paths live in panelSizing.js (pure,
// unit-tested).
//
// Precedence (panelSizing.js resolveMinTextVh): ?panel-diagonal=<inches>
// (legacy maths, escape hatch for a panel with no profile) > a profile's
// litHeightMm (physical) > a profile's nominal diagonal (legacy) > nothing,
// where CSS's own --min-text default (17vh, calibrated for Bar alone) stands.
const LINE_2_3_FONT_WEIGHT = 700; // .hl-three-line's font-weight in onboard.css, which Lines 2/3 inherit

// x-height / font-size of the font Lines 2/3 render in. Measured on a canvas
// with #sign-headline's own computed family (its .hl-town/.hl-stop children
// inherit it). Throws if no canvas — resolveMinTextVh treats that as unusable.
function measureXHeightRatio() {
  const family = getComputedStyle(el('sign-headline')).fontFamily;
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${LINE_2_3_FONT_WEIGHT} 200px ${family}`;
  return ctx.measureText('x').actualBoundingBoxAscent / 200;
}

let appliedMinTextVh = null;
const appliedSizeVh = {}; // token -> last vh written, for the physical sizes besides --min-text
let warnedRatioFallback = false;

// Sets --min-text (Lines 2/3, the 22mm rule) and, on a panel with a measured
// lit height, the other physical sizes: --header-text (top bar and Line 1,
// 13.5mm — onboard.css hangs the bar depth, the Line 1 slot and the wait box
// text off it), --sentence-text (24mm) and --logo-text (5.5mm). Returns true if
// any changed, so the caller knows to re-measure anything laid out against the
// old sizes (marquees, brand position).
function applyPanelSizing() {
  const explicitDiagonal = Number(new URLSearchParams(window.location.search).get('panel-diagonal'));
  const {
    vh, headerTextVh, sentenceTextVh, brandTextVh, ratioFellBack,
  } = resolveMinTextVh({
    explicitDiagonalInches: explicitDiagonal,
    profile: panelProfile,
    viewportWidthPx: window.innerWidth,
    viewportHeightPx: window.innerHeight,
    measureXHeightRatio,
  });
  if (ratioFellBack && !warnedRatioFallback) {
    warnedRatioFallback = true;
    console.warn('[onboard] could not measure the font x-height; sizing Lines 2/3 with the default ratio');
  }
  let changed = false;
  if (vh && vh !== appliedMinTextVh) {
    appliedMinTextVh = vh;
    document.documentElement.style.setProperty('--min-text', `${vh}vh`);
    changed = true;
  }
  // The physical sizes onboard.css hangs everything else off (null = no measured
  // lit height, so the CSS default for that token stands).
  for (const [token, sizeVh] of [
    ['--header-text', headerTextVh], // top bar + Line 1, 13.5mm
    ['--sentence-text', sentenceTextVh], // terminus, diversion, no-comma sentence, 24mm
    ['--logo-text', brandTextVh], // brand mark main line, 5.5mm
  ]) {
    if (sizeVh && sizeVh !== appliedSizeVh[token]) {
      appliedSizeVh[token] = sizeVh;
      document.documentElement.style.setProperty(token, `${sizeVh}vh`);
      changed = true;
    }
  }
  return changed;
}

// The x-height ratio is only right once the real font has loaded; until then
// a fallback font's ratio is measured. document.fonts.load() nudges the
// browser to fetch the face (it may never start for text in a hidden
// section), and 'loadingdone' re-applies whenever any font finishes later.
// applyPanelSizing() is idempotent, so extra calls are harmless.
function resizeWhenFontsLoad() {
  if (!document.fonts) return;
  const reapply = () => {
    if (!applyPanelSizing()) return;
    applyTopbarMarquee();
    applyHeadlineMarquees();
    positionBrand();
  };
  document.fonts.addEventListener('loadingdone', reapply);
  const family = getComputedStyle(el('sign-headline')).fontFamily;
  document.fonts.load(`${LINE_2_3_FONT_WEIGHT} 200px ${family}`, 'x').then(reapply, () => {});
}

// ── Wake lock — keep the mounted screen on ─────────────────────────────────
// shouldStayAwake tracks *intent*, separate from wakeLock itself (whether
// the API actually granted one). Needed because releaseWakeLock() below is
// now a real, deliberate action (Solo's screen-power design — see
// showSleepScreen()) rather than something that only ever happened as an
// OS-driven side effect: without this flag, the sentinel's own 'release'
// event listener would immediately re-acquire it (document is still
// visible on a kiosk device that never backgrounds), fighting the
// deliberate sleep. Base tier and Lite never call releaseWakeLock() at
// all, so shouldStayAwake simply stays true forever for them, same as
// today.
let wakeLock = null;
let shouldStayAwake = false;
async function acquireWakeLock() {
  shouldStayAwake = true;
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      if (shouldStayAwake && document.visibilityState === 'visible') acquireWakeLock();
    });
  } catch (_) { /* best-effort */ }
}
// Solo only (see showSleepScreen()) — lets the OS actually blank the panel
// once released, rather than leaving it lit-but-blank. Provisioning must
// cooperate for this to matter physically: the kiosk profile's own
// keepScreenOn setting has to be off, and the OS screen-timeout short
// enough to blank promptly — see announce/cab-device/fully-auto-settings.json
// and setup-solo-device.sh.
async function releaseWakeLock() {
  shouldStayAwake = false;
  if (!wakeLock) return;
  try {
    await wakeLock.release();
  } catch (_) { /* best-effort */ }
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && shouldStayAwake && wakeLock === null) acquireWakeLock();
});

// ── Brand mark position — pinned to the actual bottom-left corner of the
// middle band (#sign-main once active, #idle-main before that), measured
// live rather than guessed as a fixed vh offset — see positionBrand's
// original design rationale: a fixed-vh guess only holds by accident across
// panels whose --min-text (and so bottom-bar height) genuinely differ (Bar
// ~16.8vh vs Monitor ~7.42vh). Re-run on every render() since the
// early-wait caption toggling can change the topbar's rendered height.
function positionBrand() {
  const mainBand = !el('onboard-sign').hidden ? el('sign-main')
    : !el('onboard-idle').hidden ? el('idle-main')
    : null;
  if (!mainBand) return; // neither screen shown yet (uncommissioned device) — CSS's own fixed default applies
  const trackRect = mainBand.getBoundingClientRect();
  const marginPx = window.innerHeight * 0.015;
  const brand = el('onboard-brand');
  brand.style.left = `${trackRect.left + marginPx}px`;
  brand.style.bottom = `${window.innerHeight - trackRect.bottom + marginPx}px`;
}
window.addEventListener('resize', positionBrand);

// ── Marquee — character height is a hard floor (PSVAIR's 22mm minimum,
// --min-text), never traded down for a long line of text, so a line too
// wide for the panel scrolls instead of truncating or wrapping. Generic:
// used by the topbar's service+destination line (#sign-route-line/-track,
// the original use, 2026-09-04) and, since 2026-09-08, the three-line
// headline's town/stop lines (a bold two-word stop name at full 22mm size
// can be too wide for the Solo tablet's narrower panel — found live,
// wrapping onto an unwanted extra line). Only ever active when the text
// genuinely doesn't fit — a track has no .marquee class, and no animation,
// until this measures a real overflow.
const MARQUEE_SPEED_PX_PER_S = 220; // fast, deliberately brisk per user feedback 2026-09-04 — tune here if it reads too fast/slow live
const MARQUEE_MIN_DURATION_S = 2.5; // floor so a barely-overflowing line doesn't scroll imperceptibly fast

function applyMarquee(viewport, track) {
  track.classList.remove('marquee');
  track.style.removeProperty('--marquee-start');
  track.style.removeProperty('--marquee-end');
  track.style.removeProperty('--marquee-duration');
  // scrollWidth reflects the text just set only once the browser has laid
  // it out — reading it straight after a class/text change in the same
  // tick is reliable in practice here (no animation/transition on the
  // track itself to race), so no extra rAF/reflow trick is needed.
  const viewportWidthPx = viewport.clientWidth;
  const trackWidthPx = track.scrollWidth;
  if (trackWidthPx <= viewportWidthPx) return; // fits — stays static, the common case

  // Single copy, travelling from fully off-screen right to fully off-screen
  // left — not "already visible" to "fully exited" — so every loop enters
  // by sliding in from the right rather than popping into view already
  // readable. User feedback 2026-09-04, three rounds: pause-then-snap-back
  // read as "jumping to the start"; a two-copy seamless-ticker version with
  // a scroll-twice-then-rest cycle added an unwanted delay; a single-copy
  // version starting already on-screen (translateX(0)) scrolled smoothly
  // but still popped in abruptly at the top of each loop. Both endpoints
  // here are off-screen, so the infinite loop's reset is invisible and the
  // whole visible motion — enter right, cross, exit left — reads as one
  // continuous, uninterrupted scroll with no JS timer needed to drive it.
  const startPx = viewportWidthPx; // fully off-screen right
  const endPx = -trackWidthPx; // fully off-screen left
  const durationS = Math.max((startPx - endPx) / MARQUEE_SPEED_PX_PER_S, MARQUEE_MIN_DURATION_S);
  track.style.setProperty('--marquee-start', `${startPx}px`);
  track.style.setProperty('--marquee-end', `${endPx}px`);
  track.style.setProperty('--marquee-duration', `${durationS}s`);
  track.classList.add('marquee');
}

function applyTopbarMarquee() {
  applyMarquee(el('sign-route-line'), el('sign-route-track'));
}

// Terminus hides the topbar outright (onboard.css) — this actively stops
// the animation underneath rather than leaving it scrolling behind a
// display:none element, per user feedback 2026-09-08. Not just tidiness:
// it's also what a later applyTopbarMarquee() re-measures from cleanly the
// next time a schedule sets new route text (e.g. the return journey).
function stopTopbarMarquee() {
  const track = el('sign-route-track');
  track.classList.remove('marquee');
  track.style.removeProperty('--marquee-start');
  track.style.removeProperty('--marquee-end');
  track.style.removeProperty('--marquee-duration');
}

// Re-measures every currently-rendered headline town/stop line — plural
// because a two-sentence sequence briefly holds none, and a resize can hit
// while either line is showing.
function applyHeadlineMarquees() {
  el('sign-headline').querySelectorAll('.hl-marquee-viewport').forEach((viewport) => {
    applyMarquee(viewport, viewport.querySelector('.hl-marquee-track'));
  });
}

window.addEventListener('resize', () => {
  applyTopbarMarquee();
  applyHeadlineMarquees();
});

// ── Rendering — purely visual: no audio, no Supabase, no GPS — just DOM
// updates off an already-resolved {stateKey, vars} pushed from whichever
// device is driving this journey (Driver, or this device's own Solo
// autopilot — see announceSoloAutopilot.js). Never recomputes which
// state applies itself. ──────────────────────────────────────────────────

// A handful of states resolve to two sentences (e.g. STOP_DEPARTURE: "This
// is a X to Y. The next stop will be Z.") — spoken as one flowing sentence,
// but showing both at once on screen reads messily, especially on the
// Lite/Solo tablet's more square 3:2 aspect (less horizontal room than Monitor/Bar to
// wrap into before things get cramped). Instead: the first sentence shows
// alone, clears briefly, then the second sentence takes over and stays up
// until the next real state change. Fixed durations, not scaled to text
// length — simple and predictable to tune by eye. Purely a display-timing
// choice — the underlying text (and so the spoken audio, which plays
// wherever this journey's audio actually lives — see the file header) is
// unchanged throughout.
const FIRST_SENTENCE_MS = 3000;
const CLEAR_GAP_MS = 300;

let sequenceTimers = [];
// Fingerprints the last {stateKey, vars} this actually started a sequence
// for — pushSignState (main.js) resends the current state on every GPS
// tick so earlyWait stays live (see its own comment), not just on real
// transitions, so this guards against restarting the reveal sequence (and
// visibly flickering) on a tick that didn't actually change anything.
let lastSequenceSignature = null;

function clearSequenceTimers() {
  sequenceTimers.forEach(clearTimeout);
  sequenceTimers = [];
}

// APPROACHING ("This is X."), STOP_DEPARTURE ("The next stop is X.") and
// ROUTE_START ("This is an S116T to X.") each name a place whose text is shaped
// "Town,Specific stop" — shown as three stacked lines (verb phrase / town /
// stop) instead of one running sentence, per user feedback 2026-09-07/08, and
// for route start since 2026-09-19. headlineLines() (headlineLines.js, pure and
// unit-tested) decides the split from stateKey/vars; null means no comma to
// split on, so the sentence is shown as before. Display-only — the spoken text
// is unchanged.
function renderHeadlineText(stateKey, vars, text) {
  const headline = el('sign-headline');
  const lines = headlineLines(stateKey, vars);

  headline.textContent = '';
  headline.classList.toggle('hl-three-line', lines !== null);
  if (!lines) {
    headline.textContent = text;
    return;
  }

  const verbLine = document.createElement('div');
  verbLine.className = 'hl-verb';
  verbLine.textContent = lines.verb;
  // Stashed so updateEarlyWaitDisplay() can restore the plain verb text
  // after overlaying (and later clearing) the "wait here" box on it.
  verbLine.dataset.verbText = lines.verb;
  headline.appendChild(verbLine);

  // Town/stop each get a marquee viewport+track (see applyMarquee) rather
  // than a plain div — a bold two-word stop name at the full 22mm-minimum
  // size can be too wide for the Solo tablet's panel, and PSVAIR's minimum
  // character height is never traded down for length (same reasoning as
  // the topbar's own marquee) — found live 2026-09-08 wrapping onto an
  // unwanted extra line. Static (no scroll) whenever the text actually
  // fits — applyMarquee only adds .marquee on a real overflow.
  [
    ['hl-town', lines.town],
    ['hl-stop', lines.stop],
  ].forEach(([className, lineText]) => {
    const viewport = document.createElement('div');
    viewport.className = `${className} hl-marquee-viewport`;
    const track = document.createElement('div');
    track.className = 'hl-marquee-track';
    track.textContent = lineText;
    viewport.appendChild(track);
    headline.appendChild(viewport);
  });
  applyHeadlineMarquees();
}

function showHeadline(stateKey, vars) {
  const text = resolveAnnouncementText(stateKey, vars) ?? '';
  const sentences = text.split(/(?<=\.)\s+/);
  const headline = el('sign-headline');

  clearSequenceTimers();
  // Three lines are built from vars, not the sentence text, so they never go
  // through the sentence reveal below (which splits on ". " and would cut a
  // name like "St. Mary's" in two).
  if (headlineLines(stateKey, vars)) {
    renderHeadlineText(stateKey, vars, text);
    return;
  }
  if (sentences.length < 2) {
    renderHeadlineText(stateKey, vars, text);
    return;
  }

  renderHeadlineText(stateKey, vars, sentences[0]);
  sequenceTimers.push(setTimeout(() => {
    headline.textContent = '';
    headline.classList.remove('hl-three-line');
    sequenceTimers.push(setTimeout(() => {
      renderHeadlineText(stateKey, vars, sentences[1]);
    }, CLEAR_GAP_MS));
  }, FIRST_SENTENCE_MS));
}

function fmtEarlyWaitTime(earlyWait) {
  return new Date(earlyWait.scheduledTime)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Renders the "wait here, running early" indicator as an amber box — same
// treatment as the Driver PWA's own #early-wait-banner (busops/driver/
// style.css) — directly over the three-line headline's verb line, instead
// of a separate block below the headline. That separate block used to roll
// off the bottom of the Solo tablet's squarer panel once the headline grew
// to three lines; overlaying the verb line keeps the sign's total headline
// height constant whether or not the bus is running early. Per user
// feedback 2026-09-08: only ever shown during APPROACHING (i.e. while
// dwelling at the stop the headline is currently naming — see
// shared/gps.js's computeEarlyWait, only ever non-null mid-dwell) —
// clears the instant STOP_DEPARTURE fires, since the bus is then moving and
// "wait here" no longer applies.
function updateEarlyWaitDisplay(stateKey, earlyWait) {
  const headline = el('sign-headline');
  const verbLine = headline.querySelector('.hl-verb');
  const banner = el('early-wait-banner');

  if (verbLine) {
    banner.hidden = true;
    const showEarly = !!earlyWait && stateKey === ANNOUNCE_STATES.APPROACHING;
    verbLine.classList.toggle('hl-verb--early', showEarly);
    if (showEarly) {
      verbLine.replaceChildren(
        Object.assign(document.createElement('div'), { className: 'ewb-title', textContent: 'WAIT HERE' }),
        Object.assign(document.createElement('div'), {
          className: 'ewb-msg',
          textContent: `Running early — depart at ${fmtEarlyWaitTime(earlyWait)}`,
        }),
      );
    } else {
      verbLine.textContent = verbLine.dataset.verbText ?? verbLine.textContent;
    }
    return;
  }

  // Fallback for a single-line headline (resolved stop name has no comma) —
  // the original below-headline banner, same terminus suppression as
  // before this change: "running early, depart at X" doesn't mean anything
  // once the bus has actually reached its final stop and passengers are
  // being told to get off (found live 2026-09-02).
  if (earlyWait && stateKey !== ANNOUNCE_STATES.AT_STOP) {
    banner.hidden = false;
    el('ewb-time').textContent = fmtEarlyWaitTime(earlyWait);
  } else {
    banner.hidden = true;
  }
}

function render(stateKey, vars, earlyWait) {
  const signature = `${stateKey}|${JSON.stringify(vars)}`;
  if (signature !== lastSequenceSignature) {
    lastSequenceSignature = signature;
    showHeadline(stateKey, vars);
  }
  // Never colour alone (docs/ACCESSIBILITY_BRAND_PLAYBOOK.md) — the
  // headline text and, on tiers with audio, the spoken announcement both
  // also change for a diversion; this is a supplementary visual emphasis,
  // not the only signal.
  // Recorded for every state so CSS can key off the state itself, never off the
  // wording (headlineLines.js signStateAttribute).
  el('onboard-sign').dataset.state = signStateAttribute(stateKey);
  el('onboard-sign').classList.toggle('diversion', stateKey === ANNOUNCE_STATES.DIVERSION);
  // Terminus — AT_STOP only ever fires for the final stop now (see
  // shared/announceStates.js), so no extra isFinal check needed here.
  // Same "never colour alone" reasoning as diversion above: the headline
  // text ("This service terminates here, all change please.") and, on
  // tiers with audio, the spoken announcement both already carry the
  // message — this full-page colour is a supplementary "notice me" cue on
  // top, per user feedback 2026-09-02, not the only signal.
  const isTerminus = stateKey === ANNOUNCE_STATES.AT_STOP;
  el('onboard-sign').classList.toggle('terminus', isTerminus);
  if (isTerminus) stopTopbarMarquee();

  updateEarlyWaitDisplay(stateKey, earlyWait);
  positionBrand(); // banner/verb-line toggling above can change layout height
}

// ── Operator branding ─────────────────────────────────────────────────────
// Mirrors the ThemeProvider pattern used in the dashboard: inject
// --operator-accent as a CSS var on <html>, consumed by onboard.css for the
// top bar — see onboard.css's --operator-accent comment. Falls back to
// CoachMate's default dark purple unless the operator's accent_color clears
// WCAG AA for large text/UI components (>= 3:1 contrast) against the white
// paper it's used on/with.
//
// companies.accent_color is `not null default '#00B4D8'` (schema.sql), and
// the Driver's schedule push carries it through as-is (get_duty_card()
// returns it unchanged) — so there is no way to tell "operator genuinely
// picked this colour" apart from "column was never customised" once it
// reaches this function; both look identical. '#00B4D8' itself also fails
// the 3:1-against-white check (~2.5:1), so treating it like any other
// accent would permanently blank out the bars for every company that has
// never touched Branding settings. Special-cased below: that exact default
// value is treated as "no customisation" and skipped entirely, same as a
// missing accentColor would be. The one edge case this can't distinguish:
// an operator who deliberately sets their own accent_color to that same
// teal — they'd get the onboard sign's purple default instead. Acceptable
// today; a real fix needs a separate nullable column or a "customised"
// flag if it ever matters.
//
// Manual-selection journeys never fetch company branding at all (no
// accentColor on that path — see src/main.js's runTracker), so they show
// the platform default here too — same code path, no special-casing needed.

function _sRGBToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function _relativeLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * _sRGBToLinear(r) + 0.7152 * _sRGBToLinear(g) + 0.0722 * _sRGBToLinear(b);
}

function wcagContrastRatio(hex1, hex2) {
  const l1 = _relativeLuminance(hex1);
  const l2 = _relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Read from the CSS token rather than duplicated as a literal here — this
// used to be a hardcoded '#FFFFFF' and silently drifted out of sync when
// --ep-paper changed to the approved-palette off-white (#F9FAF4), found
// 2026-09-08.
const EP_PAPER = getComputedStyle(document.documentElement)
  .getPropertyValue('--ep-paper').trim();
// companies.accent_color's DB default — see comment above. Read from brand-tokens.css
// (imported via onboard.css) rather than duplicated as a literal here.
const PLATFORM_DEFAULT_ACCENT = getComputedStyle(document.documentElement)
  .getPropertyValue('--pcv-color-primary-action').trim();

function applyOperatorBranding({ accentColor }) {
  if (!accentColor || accentColor.toLowerCase() === PLATFORM_DEFAULT_ACCENT.toLowerCase()) return;

  const ratio = wcagContrastRatio(accentColor, EP_PAPER);
  if (ratio >= 3) {
    document.documentElement.style.setProperty('--operator-accent', accentColor);
  } else {
    console.warn(
      `onboard: operator accent colour ${accentColor} rejected — contrast ratio ${ratio.toFixed(2)}:1 ` +
      `against ${EP_PAPER} is below the required 3:1 (WCAG AA large text/UI component). ` +
      `Falling back to default. Update accent_color in the dashboard Branding settings.`
    );
  }
}

// ── Idle/default screen — operator branding shown before any journey
// exists (docs/HARDWARE.md §5). Company identity can't come
// from get_duty_card (journey-scoped, nothing exists yet at idle), so it's
// commissioned directly onto this device instead, same URL-param pattern
// as ?panel-profile=/?panel-diagonal=: ?operator-name=<name>. The logo
// image is a local file (branding-logo.png, placed at commissioning time —
// see mele-server/DEPLOY.md) rather than a URL param, since the Controller
// has no WAN path to fetch it live (§5/§6) — cached once, not per-boot.
// Omit ?operator-name= entirely and this stays hidden, unchanged from the
// old blank-background-plus-corner-mark idle look. ──────────────────────

function initIdleScreen() {
  const operatorName = new URLSearchParams(window.location.search).get('operator-name');
  if (!operatorName) return;

  const logo = el('idle-logo');
  logo.alt = `${operatorName} logo`; // not rendered visually — accessibility label only, see onboard.html
  // Listeners attached before src is set (not a static attribute in
  // onboard.html) — otherwise a fast same-origin load can fire 'load'
  // before this function ever runs, leaving the image stuck hidden.
  logo.addEventListener('load', () => { logo.hidden = false; });
  logo.addEventListener('error', () => { logo.hidden = true; }); // not commissioned with a logo yet, or a dev/demo environment
  logo.src = 'branding-logo.png';

  el('onboard-idle').hidden = false;
  positionBrand(); // idle screen's topbar/main/bottom band now exists to measure — pins the mark above the bottom bar here too
}

// Lite/Solo only — a *live* company logo, superseding the static
// branding-logo.png file above (which only ever made sense for the base
// tier's per-Controller-box local file placed at commissioning time; a
// Lite/Solo device is just this one shared web app, so it can't have a
// different local file per company the way a physical Controller can).
// Called once from announceDeviceFeed.js's start(), right after it reads
// this device's own row (so it knows which company to fetch) — same
// "company identity can't come from get_duty_card, so read it another way"
// reasoning as initIdleScreen() above, just Supabase-backed instead of a
// URL param. { name, logoUrl, accentColor } — logoUrl is already resolved
// to a public Storage URL by the caller (getPublicUrl()), null if the
// company has no logo set (BrandingPage.jsx never requires one). Found
// 2026-09-02: without this, every Lite/Solo device across every company
// showed the same single placeholder file (or nothing), never the actual
// customer's logo the user expected centred in the idle screen.
export function applyIdleBranding({ name, logoUrl, accentColor }) {
  if (accentColor) applyOperatorBranding({ accentColor }); // idle topbar now matches the company's own accent too, not just the active sign's

  if (logoUrl) {
    const logo = el('idle-logo');
    logo.alt = name ? `${name} logo` : 'Company logo';
    logo.addEventListener('load', () => { logo.hidden = false; }, { once: true });
    logo.addEventListener('error', () => { logo.hidden = true; }, { once: true });
    logo.src = logoUrl;
  }

  el('onboard-idle').hidden = false;
  el('onboard-brand').hidden = false; // undo showSleepScreen()'s hide, if it ran before this branding fetch resolved
  positionBrand();
}

// Solo (driverless) schedule-autopilot only (see
// announceSoloAutopilot.js) — always unhides the idle screen, even
// without ?operator-name= and even with no candidate yet (a device freshly
// registered with no candidate_departure_ids configured), so the kiosk
// visibly confirms it booted into Solo mode rather than looking
// identical to a broken/not-yet-connected device. Only the next-departure
// caption itself is conditional. nextDepartures is one entry per distinct
// service this device carries candidates for — [{ serviceCode, departureTime }]
// (announceSoloAutopilot.js's reportNextDeparture) — or null once nothing is
// cached yet / commissioned. One line per service, not a single merged
// soonest-overall time (found live 2026-09-06: a device with two services'
// worth of candidates showed one ambiguous time, telling a waiting
// passenger/driver nothing concrete about either actual service).
export function showNextDeparture(nextDepartures) {
  const box = el('idle-next-departure');
  const hasEntries = Array.isArray(nextDepartures) && nextDepartures.length > 0;
  box.hidden = !hasEntries;
  box.replaceChildren();
  if (hasEntries) {
    for (const { serviceCode, departureTime } of nextDepartures) {
      const line = document.createElement('div');
      line.textContent = `${serviceCode} next departure ${departureTime}`;
      box.appendChild(line);
    }
  }
  el('onboard-idle').hidden = false;
  el('onboard-brand').hidden = false; // undo showSleepScreen()'s hide, if it ran
  // Solo's wake-window transition into "awake" reaches here (see
  // announceSoloAutopilot.js's reportNextDeparture) — the screen must
  // actually be on for any of this to be visible. Idempotent to call
  // again while already awake (candidates refreshing, etc.) and a no-op
  // for tiers that never sleep (base/Lite) beyond the one real acquire.
  acquireWakeLock();
  positionBrand();
}

// Solo only — fully blank screen (no branding, no logo, no next-departure
// caption, not even the small corner brand mark) outside the wake window
// around this device's own candidate departures, AND releases the wake
// lock so the OS can actually blank the physical panel (see
// releaseWakeLock's own comment) — not just the on-screen content.
// Previously only GPS *polling* was gated by the window
// (announceSoloAutopilot.js's idleTimer) — the idle screen itself, and the
// screen's actual power state, stayed lit around the clock regardless,
// which made no sense for a device that only runs a school-run twice a
// day. Never called while a journey is actually active —
// announceSoloAutopilot.js's applyWakeState() guards that, a window ending
// mid-route must not blank the sign (or the screen) out from under real
// passengers.
export function showSleepScreen() {
  el('onboard-idle').hidden = true;
  el('onboard-sign').hidden = true;
  el('onboard-brand').hidden = true;
  releaseWakeLock();
}

// ── Pushed feed (Driver -> Controller -> this sign) — the only source of
// truth this device has. See src/announceLink.js (sender) and
// mele-server/announceRelay.mjs (relay this device connects to). This
// device reads its own push-feed token from its own URL rather than
// commissioning localStorage the way the Driver device does — onboard.html
// is always opened via one fixed per-vehicle URL (see mele-server/DEPLOY.md),
// so there's nothing to persist across visits. Persistent, auto-reconnecting
// (same flat 3s-retry shape as announceLink.js's own connect()) — there is
// no fallback to give up into if the connection can't be established. ─────
const RECONNECT_DELAY_MS = 3000;

let socket = null;
let signShown = false;

// Exported for announceDeviceFeed.js/announceSoloAutopilot.js — the
// Lite/Solo tiers' alternative to this section's WebSocket feed calls these
// with the exact same message shape, so the rendering code below is shared
// unchanged across every transport/tier.
export function onSchedule(msg) {
  el('sign-service-code').textContent = msg.serviceCode;
  el('sign-destination').textContent = msg.destination;
  applyOperatorBranding({ accentColor: msg.accentColor });
  el('onboard-idle').hidden = true;
  el('onboard-sign').hidden = false;
  el('onboard-brand').hidden = false; // undo showSleepScreen()'s hide, if a Solo journey matched right as its window opened
  // Measured after unhiding #onboard-sign, not before — #sign-route-track's
  // scrollWidth/clientWidth are both 0 while its ancestor is display:none.
  applyTopbarMarquee();
  // Forces the first state of this journey to always start a fresh reveal
  // sequence, even in the unlikely case its {stateKey, vars} happens to
  // match whatever the sign was last showing at the end of a prior journey
  // (e.g. the same service starting again from the same first stop).
  lastSequenceSignature = null;
  // Brand mark stays visible once active too — positionBrand() (above) pins
  // it to the track band's actual bottom-left corner now that the track
  // band exists to measure; it wasn't there a line ago.
  positionBrand();
  if (!signShown) {
    signShown = true;
    acquireWakeLock();
  }
}

export function onState(msg) {
  render(msg.stateKey, msg.vars, msg.earlyWait);
}

// Journey ended — base tier via {type:'complete'} over the WebSocket
// (announceLink.js's disconnectAnnounceLink, relayed by announceRelay.mjs),
// Lite/Solo via announce_devices' latest_schedule/latest_state being cleared
// (end_announce_device_journey, see announceDeviceFeed.js). Reuses
// showNextDeparture(null)'s "unhide idle, no candidate caption" behaviour
// rather than a new idle-rendering path.
export function onJourneyEnd() {
  clearSequenceTimers();
  el('onboard-sign').hidden = true;
  el('onboard-sign').dataset.state = signStateAttribute(ANNOUNCE_STATES.IDLE);
  showNextDeparture(null);
}

function connect(token) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try {
    socket = new WebSocket(`${proto}//${location.host}/sign-feed?token=${encodeURIComponent(token)}`);
  } catch (_) {
    scheduleReconnect(token);
    return;
  }
  socket.addEventListener('message', (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch (_) {
      return; // malformed — ignore
    }
    if (msg.type === 'schedule') onSchedule(msg);
    else if (msg.type === 'state') onState(msg);
    else if (msg.type === 'complete') onJourneyEnd();
  });
  socket.addEventListener('close', () => scheduleReconnect(token));
  socket.addEventListener('error', () => {}); // 'close' always follows 'error' on WebSocket, no separate handling needed
}

function scheduleReconnect(token) {
  socket = null;
  setTimeout(() => connect(token), RECONNECT_DELAY_MS);
}

function connectSignFeed() {
  const token = new URLSearchParams(window.location.search).get('announce-token');
  if (!token) {
    console.warn('onboard.js: no ?announce-token=<token> in the URL — nothing to watch, staying blank.');
    return;
  }
  connect(token);
}

// ── Entry point ──────────────────────────────────────────────────────────

function init() {
  el('onboard-sign').dataset.state = signStateAttribute(ANNOUNCE_STATES.IDLE); // nothing shown yet
  applyPanelSizing();
  resizeWhenFontsLoad();
  initIdleScreen();

  // Mutually exclusive per device: ?announce-device-token= (Lite/Solo,
  // Supabase Realtime — see announceDeviceFeed.js) vs the base tier's
  // /sign-feed WebSocket. A device is provisioned with exactly one of the
  // two URL params, never both. The Lite/Solo token is captured once and
  // persisted (see announceDeviceSetup.js) rather than re-read from the URL
  // every load — a kiosk isn't guaranteed to reopen with its original query
  // string.
  captureAnnounceDeviceSetup(new URLSearchParams(window.location.search));
  const announceDeviceToken = getAnnounceDeviceToken();
  if (announceDeviceToken) {
    connectAnnounceDeviceFeed(announceDeviceToken, {
      onSchedule, onState, onJourneyEnd,
      onIdleNextDeparture: showNextDeparture,
      onIdleBranding: applyIdleBranding,
      onSleep: showSleepScreen,
    });
  } else {
    connectSignFeed();
  }
}

init();
