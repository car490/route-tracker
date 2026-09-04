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

// Named display profiles — commissioned via ?panel-profile=<key> (same
// URL-param pattern as ?panel-diagonal= below). Lets a specific physical
// target's diagonal be forced explicitly instead of relying purely on
// ?panel-diagonal= being passed directly — needed for kiosk deployments
// where naming the target is more robust than trusting a URL param typed
// once at commissioning time. Bar is the original ultra-wide
// destination-board plan (not yet built, kept for later); monitor is the
// Dell Pro P2426H, the confirmed demo/validation unit in use today
// (mele-server/DEPLOY.md §5); lite is the Announce Lite/Solo tablet
// candidate, DOOGEE Tab E3 Max, 14.6", 2160x1440 — 3:2, not 16:9, a deliberate
// compromise (see docs/HARDWARE.md §14) — the layout itself doesn't care
// about aspect ratio (no wide/narrow branching any more, see the file
// header), only this diagonal figure for --min-text sizing.
const PANEL_PROFILES = {
  bar:     { diagonalInches: 28 },
  monitor: { diagonalInches: 23.8 },
  lite:    { diagonalInches: 14.6 },
};
const panelProfile = PANEL_PROFILES[new URLSearchParams(window.location.search).get('panel-profile')] ?? null;

const el = (id) => document.getElementById(id);

// ── PSV(AI)R 22mm minimum text height — panel-agnostic sizing ──────────────
// onboard.css's --min-text default (17vh) is a fixed constant calibrated
// for the Bar panel alone (28" ultra-wide, ~16.8vh) — see that variable's
// own comment. It does NOT generalise: a same-density but taller-in-pixels
// panel (e.g. the Monitor profile's 1920x1080 Dell P2426H) needs a much
// smaller vh fraction for the same physical 22mm — 7.42vh, not 17vh —
// because vh is relative to total pixel height, and browsers have no
// reliable API for a screen's physical size (no EDID access, by design,
// for privacy/security — this is a real web platform limit, not a
// workaround-able gap). So the one thing that must be supplied per-panel,
// once, is its physical diagonal size — everything else (resolution,
// aspect ratio) is already known automatically at runtime.
//
// Commissioned via ?panel-diagonal=<inches> on the same fixed kiosk URL that
// already carries ?announce-token= — same per-device-settings-in-the-URL
// pattern this device uses throughout (see the file header: nothing to
// persist across visits, everything comes from its own URL each load).
// A known ?panel-profile= (see PANEL_PROFILES above) supplies this
// automatically — ?panel-diagonal=, if also present, still wins, as an
// escape hatch for any future panel that doesn't have a named profile yet.
// Omitted entirely = old behaviour: CSS's own 17vh default applies
// unchanged (correct for Bar, wrong for anything Monitor-class).
export function computeMinTextVh(diagonalInches, viewportWidthPx, viewportHeightPx) {
  if (!diagonalInches || !viewportWidthPx || !viewportHeightPx) return null;
  const diagonalPx = Math.sqrt(viewportWidthPx ** 2 + viewportHeightPx ** 2);
  const panelHeightMm = diagonalInches * 25.4 * (viewportHeightPx / diagonalPx);
  return (22 / panelHeightMm) * 100;
}

function applyPanelSizing() {
  const explicitDiagonal = Number(new URLSearchParams(window.location.search).get('panel-diagonal'));
  const diagonalInches = explicitDiagonal || panelProfile?.diagonalInches;
  const minTextVh = computeMinTextVh(diagonalInches, window.innerWidth, window.innerHeight);
  if (minTextVh) document.documentElement.style.setProperty('--min-text', `${minTextVh}vh`);
}

// ── Wake lock — keep the mounted screen on ─────────────────────────────────
let wakeLock = null;
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      if (document.visibilityState === 'visible') acquireWakeLock();
    });
  } catch (_) { /* best-effort */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock === null) acquireWakeLock();
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

// ── Topbar marquee — character height is a hard floor (PSVAIR's 22mm
// minimum, --min-text), never traded down for a long service+destination
// combination, so a line too wide for the panel scrolls instead of
// truncating. Only ever active when the text genuinely doesn't fit —
// #sign-route-track (see onboard.css) has no .marquee class, and no
// animation, until this measures a real overflow. Re-run whenever
// onSchedule() sets new text (below) and on resize, mirroring
// positionBrand's own pattern above.
const MARQUEE_SPEED_PX_PER_S = 220; // fast, deliberately brisk per user feedback 2026-09-04 — tune here if it reads too fast/slow live
const MARQUEE_MIN_DURATION_S = 2.5; // floor so a barely-overflowing line doesn't scroll imperceptibly fast

function applyTopbarMarquee() {
  const viewport = el('sign-route-line');
  const track = el('sign-route-track');
  // A previous call may have appended a second (looping) copy of the
  // segment — strip back down to the one real one before measuring.
  track.querySelectorAll('.route-segment').forEach((seg, i) => { if (i > 0) seg.remove(); });
  track.classList.remove('marquee');
  track.style.removeProperty('--topbar-marquee-distance');
  track.style.removeProperty('--topbar-marquee-duration');
  // scrollWidth reflects the text just set by onSchedule() only once the
  // browser has laid it out — reading it straight after a class/text change
  // in the same tick is reliable in practice here (no animation/transition
  // on the track itself to race), so no extra rAF/reflow trick is needed.
  const segmentWidthPx = track.scrollWidth; // exactly one segment at this point
  if (segmentWidthPx <= viewport.clientWidth) return; // fits — stays static, the common case

  // Seamless circular loop: clone the segment, append it after the real one
  // (separated by the track's own `gap`, read back from computed style so
  // CSS stays the one source of truth for that spacing), then animate
  // exactly that combined width to the left. At that point the clone sits
  // precisely where the original started, so looping back to translateX(0)
  // lands on identical content — reads as continuous scrolling, not a jump.
  const clone = track.querySelector('.route-segment').cloneNode(true);
  clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  track.appendChild(clone);

  const loopGapPx = parseFloat(getComputedStyle(track).columnGap) || 0;
  const distancePx = segmentWidthPx + loopGapPx;
  const durationS = Math.max(distancePx / MARQUEE_SPEED_PX_PER_S, MARQUEE_MIN_DURATION_S);
  track.style.setProperty('--topbar-marquee-distance', `-${distancePx}px`);
  track.style.setProperty('--topbar-marquee-duration', `${durationS}s`);
  track.classList.add('marquee');
}
window.addEventListener('resize', applyTopbarMarquee);

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

function showHeadline(stateKey, vars) {
  const text = resolveAnnouncementText(stateKey, vars) ?? '';
  const sentences = text.split(/(?<=\.)\s+/);
  const headline = el('sign-headline');

  clearSequenceTimers();
  if (sentences.length < 2) {
    headline.textContent = text;
    return;
  }

  headline.textContent = sentences[0];
  sequenceTimers.push(setTimeout(() => {
    headline.textContent = '';
    sequenceTimers.push(setTimeout(() => {
      headline.textContent = sentences[1];
    }, CLEAR_GAP_MS));
  }, FIRST_SENTENCE_MS));
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
  el('onboard-sign').classList.toggle('diversion', stateKey === ANNOUNCE_STATES.DIVERSION);
  // Terminus — AT_STOP only ever fires for the final stop now (see
  // shared/announceStates.js), so no extra isFinal check needed here.
  // Same "never colour alone" reasoning as diversion above: the headline
  // text ("This service terminates here, all change please.") and, on
  // tiers with audio, the spoken announcement both already carry the
  // message — this full-page colour is a supplementary "notice me" cue on
  // top, per user feedback 2026-09-02, not the only signal.
  el('onboard-sign').classList.toggle('terminus', stateKey === ANNOUNCE_STATES.AT_STOP);

  // Suppressed at terminus — "running early, depart at X" doesn't mean
  // anything once the bus has actually reached its final stop and
  // passengers are being told to get off; found live, 2026-09-02, showing
  // confusingly on top of the new terminus colour (pre-existing gap, not
  // something this change introduced — earlyWait and stateKey were always
  // independent — just made newly obvious by that background).
  const banner = el('early-wait-banner');
  if (earlyWait && stateKey !== ANNOUNCE_STATES.AT_STOP) {
    banner.hidden = false;
    el('ewb-time').textContent = new Date(earlyWait.scheduledTime)
      .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } else {
    banner.hidden = true;
  }
  positionBrand(); // banner toggling above can change the topbar's own height
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

const EP_PAPER = '#FFFFFF'; // white paper the accent sits on/against — accent is tested against this
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
  positionBrand();
}

// Solo (driverless) schedule-autopilot only (see
// announceSoloAutopilot.js) — always unhides the idle screen, even
// without ?operator-name= and even with no candidate yet (a device freshly
// registered with no candidate_departure_ids configured), so the kiosk
// visibly confirms it booted into Solo mode rather than looking
// identical to a broken/not-yet-connected device. Only the next-departure
// caption itself is conditional. candidate is
// { departureId, firstStopLat, firstStopLon, departureTime } (scheduleAutopilot.js's
// shape) or null once nothing is cached yet / commissioned.
export function showNextDeparture(candidate) {
  const box = el('idle-next-departure');
  box.hidden = !candidate;
  box.textContent = candidate ? `Next departure ${candidate.departureTime}` : '';
  el('onboard-idle').hidden = false;
  el('onboard-brand').hidden = false; // undo showSleepScreen()'s hide, if it ran
  positionBrand();
}

// Solo only — fully blank screen (no branding, no logo, no next-departure
// caption, not even the small corner brand mark) outside this device's
// configured active windows. Previously only GPS *polling* was gated by
// the window (announceSoloAutopilot.js's idleTimer) — the idle screen
// itself stayed lit and branded around the clock regardless, which made
// no sense for a device that only runs a school-run twice a day. Never
// called while a journey is actually active — announceSoloAutopilot.js's
// applyWakeState() guards that, a window ending mid-route must not blank
// the sign out from under real passengers.
export function showSleepScreen() {
  el('onboard-idle').hidden = true;
  el('onboard-sign').hidden = true;
  el('onboard-brand').hidden = true;
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
  applyPanelSizing();
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
