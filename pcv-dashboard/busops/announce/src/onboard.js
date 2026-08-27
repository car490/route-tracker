// Fixed passenger-facing onboard sign. Deliberately siloed from main.js —
// no login, no duty card UI, no incident reporting, no stop-time upload.
// This file itself still writes nothing to Supabase directly.
//
// Two tiers, two feeds, mutually exclusive per device (see docs/
// ANNOUNCE-PRODUCT-TIERS.md):
//
// - Standard (Controller-fed): NO reads of its own — no independent
//   get_duty_card polling, no GPS, no schedule_view queries, no Supabase
//   writes. A pure renderer driven entirely by what the Driver device
//   pushes over a local WebSocket (see src/announceLink.js — the sender —
//   and mele-server/announceRelay.mjs — the relay this device connects
//   to). Told nothing about which journey to watch via its own URL beyond
//   ?announce-token=<token> (the relay's shared secret — see
//   mele-server/DEPLOY.md). Sits blank until an authenticated /sign-feed
//   connection receives a {type:'schedule'} message, then wakes on its own
//   as {type:'state'} messages arrive.
//
// - Announce Lite, paired mode (Controller-less): an intentional, scoped
//   exception to "no reads of its own" — see announceLiteFeed.js. Reads its
//   own announce_devices row (anon, scoped by the device_id claim in
//   ?announce-device-token=<token> — a distinct param from Standard's
//   ?announce-token=, never both on the same device) and subscribes to
//   Supabase Realtime for driver-pushed schedule/state updates, calling the
//   exact same onSchedule()/onState() below — the rendering code is shared
//   unchanged between both tiers, only the transport differs.
import { connectAnnounceLiteFeed } from './announceLiteFeed.js';
import { captureAnnounceDeviceSetup, getAnnounceDeviceToken } from './announceLiteSetup.js';

const WIDE_LAYOUT_QUERY = '(min-aspect-ratio: 4/1)'; // 16:3 ultra-wide sign, see docs/onboard-widescreen-layout.md

// Named display profiles — commissioned via ?panel-profile=<key> (same
// URL-param pattern as ?panel-diagonal= below). Lets a specific physical
// target be forced explicitly (which layout, which diagonal for text
// sizing) instead of relying purely on whatever aspect ratio the current
// window/screen happens to report — needed for previewing a layout that
// doesn't match the window you're actually looking at it in (e.g. testing
// the Monitor rendering in an arbitrary browser window), and for kiosk
// deployments where stating the target explicitly is more robust than
// depending on the panel's reported aspect ratio matching WIDE_LAYOUT_QUERY
// exactly. Bar is the original ultra-wide destination-board plan (not yet
// built, kept for later); monitor/monitor-vertical are both the Dell Pro
// P2426H, the confirmed demo/validation unit in use today
// (mele-server/DEPLOY.md §5) — monitor-vertical swaps only the tube-track's
// orientation (top-to-bottom instead of left-to-right), trading Monitor's
// spare vertical headroom (see --min-text's comment below) for longer,
// unclipped stop-name labels; everything else about it is identical to
// monitor (narrow layout, no ETA box, same text sizing).
const PANEL_PROFILES = {
  bar:               { diagonalInches: 28,   wide: true,  trackLayout: 'horizontal' },
  monitor:           { diagonalInches: 23.8, wide: false, trackLayout: 'horizontal' },
  'monitor-vertical': { diagonalInches: 23.8, wide: false, trackLayout: 'vertical'   },
};
const panelProfile = PANEL_PROFILES[new URLSearchParams(window.location.search).get('panel-profile')] ?? null;

const el = (id) => document.getElementById(id);
// No panel-profile: unchanged live aspect-ratio auto-detect. Known profile:
// its wide/narrow choice wins outright, regardless of the actual window
// shape — see PANEL_PROFILES comment above.
const isWideLayout = () => panelProfile ? panelProfile.wide : matchMedia(WIDE_LAYOUT_QUERY).matches;
// No profile (or a horizontal one): unchanged left-to-right tube-track —
// there's no live-detected equivalent of "vertical" the way aspect ratio
// stands in for "wide", so this only ever comes from an explicit profile.
const trackLayout = () => panelProfile?.trackLayout ?? 'horizontal';

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

// display_name() (schema.sql) appends a NaPTAN indicator in parentheses —
// "Weston, The Chequers PH (adj)", "Grantham, Bus Station (Stand 5)" — for
// route-planning precision (which pole/bay/side of the road). Passengers
// don't need that, and every character counts against the 22mm text
// minimum, so it's stripped here for this passenger-facing display only —
// the pushed stops arrive with the full name (the driver PWA and dashboard
// need the indicator), stripped is applied on receipt, in onSchedule below.
function stripIndicator(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, '');
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

// ── Tube-map style progress line ────────────────────────────────────────
// Bar has much more horizontal room per node than Monitor, so it shows more
// stops either side of the current one — see docs/onboard-widescreen-layout.md.
// Monitor-vertical gets the same larger count as Bar despite being a
// "narrow" profile — its extra room comes from stacking down the screen's
// height instead of across its width, but the space budget argument is the
// same one either way.

function renderTubeTrack(allStops, centerIndex, isAtStop) {
  const track = el('tube-track');
  track.innerHTML = '';

  const last = allStops.length - 1;
  // Labels must stay readable from the back of an 11m bus (~22mm min text,
  // see --min-text in onboard.css), which leaves room for only a few stops
  // either side regardless of how much room a given profile has to spend.
  const isWide = isWideLayout();
  // The leading (leftmost/topmost) node is always the current reference
  // stop — the one we're at (green, pulsing) or, once under way, the one
  // we're heading to next (green, not pulsing) — never one already left
  // behind. A fixed shape regardless of isAtStop matters: making the
  // window reshape itself on that flag (showing a past stop only while
  // dwelling) meant a real-world GPS wobble right at the arrival boundary
  // — isAtStop flipping without nextStopIndex itself changing — rearranged
  // the whole strip and desynced it from the (debounced, stable) voice
  // announcements. Keeping the shape constant and using isAtStop only for
  // the pulse animation below avoids that.
  const stopsForward = (isWide || trackLayout() === 'vertical') ? 3 : 2;
  const indices = [];
  for (let i = centerIndex; i <= Math.min(centerIndex + stopsForward, last); i++) indices.push(i);

  indices.forEach((i) => {
    const state = i === centerIndex ? 'current' : 'future';
    const node = document.createElement('div');
    node.className = `tube-node tube-${state}`;
    // "At stop" (geofence-confirmed arrival) gets its own pulsating look,
    // distinct from "current" (an estimated position between stops).
    if (i === centerIndex && isAtStop) node.classList.add('tube-at-stop');
    node.innerHTML = `<div class="tube-dot"></div><div class="tube-label">${allStops[i].name}</div>`;
    track.appendChild(node);
  });
}

// ── Upcoming-stops box — wide sign only ─────────────────────────────────
// gps.js's `timing` is a live estimate for whichever stop it currently has
// as nextStopIndex; the offset between that stop's live ETA and its
// scheduled time is carried forward uniformly onto later stops' scheduled
// times too — an approximation (assumes the same running-late/early delta
// holds all the way to each of them), but a reasonable one for a handful
// of stops ahead.
function etaForStop(stop, timing) {
  const [h, m] = stop.time.split(':').map(Number);
  const scheduled = new Date();
  scheduled.setHours(h, m, 0, 0);
  const offsetMs = timing.eta.getTime() - timing.scheduledTime.getTime();
  return new Date(scheduled.getTime() + offsetMs);
}

const UPCOMING_STOP_COUNT = 4;

function renderUpcoming(allStops, centerIndex, timing) {
  const box = el('sign-upcoming');
  if (!isWideLayout()) { box.hidden = true; return; }

  const last = allStops.length - 1;
  // Strictly after the highlighted stop — same fixed-shape reasoning as
  // renderTubeTrack above, and it avoids listing the highlighted stop's
  // own ETA a second time as if it were "upcoming".
  const rows = [];
  for (let i = centerIndex + 1; i <= Math.min(centerIndex + UPCOMING_STOP_COUNT, last); i++) rows.push(allStops[i]);

  if (!rows.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = rows.map((stop) => {
    const time = etaForStop(stop, timing).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `<div class="upcoming-row"><span class="upcoming-name">${stop.name}</span><span class="upcoming-time">${time}</span></div>`;
  }).join('');
}

// ── Brand mark position — pinned to the actual bottom-left corner of the
// middle band (#sign-main once active, #idle-main before that), measured
// live rather than guessed as a fixed vh offset. A fixed-vh guess (the old
// approach) only worked by accident: it was calibrated once against a
// bottom bar height that happened to be near-identical across every
// profile that existed at the time. That stopped holding the moment
// profiles with genuinely different --min-text values (Bar ~16.8vh vs
// Monitor ~7.42vh, see onboard.css) coexisted — the bottom (and top) bar's
// rendered height scales with --min-text, so the same fixed offset
// overshoots on a short-bar profile and undershoots on a tall-bar one.
// Measuring the real box is correct for any profile, present or future,
// with no per-panel number to maintain. Also re-run on every render() — the
// early-wait banner (#early-wait-banner) replaces the bottom bar with a
// taller two-line block while it's shown, which shifts the track band's
// own bottom edge for as long as it's up. Idle and active share this same
// logic (both use the same topbar/main/bottom grid shape, see onboard.css)
// so the brand mark sits directly above the lower bar on every screen, not
// just once a journey is live. ──────────────────────────────────────────
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

// ── Rendering — purely visual: no audio, no Supabase, no GPS — just DOM
// updates off an already-computed state shape pushed from the Driver. ──────

function render(allStops, initialStopIndex, { nextStopIndex, earlyWait, atStop, timing }) {
  const last = allStops.length - 1;
  // atStop.stopIndex and nextStopIndex are the same index while dwelling —
  // gps.js only advances nextStopIndex on departure — so nextStopIndex is
  // always the right "where the track is centred" answer either way.
  const centerIndex = Math.min(Math.max(nextStopIndex, initialStopIndex), last);
  const isFinal = !atStop && nextStopIndex > last;

  // One clause only, not "This stop is X. The next stop will be Y." — the
  // tube-track above already shows what's next visually. Changes wording
  // rather than adding/stacking a second line, so the bottom bar's height
  // stays constant and the tube-track above it never jumps. Static text —
  // ellipsis-truncates (see onboard.css) rather than scrolling if a name
  // is too long to fit.
  el('sbl-status').textContent = atStop
    ? `This stop is ${allStops[centerIndex].name}`
    : isFinal
      ? 'End of route'
      : `The next stop will be ${allStops[centerIndex].name}`;
  renderTubeTrack(allStops, centerIndex, !!atStop);
  renderUpcoming(allStops, centerIndex, timing);

  const banner = el('early-wait-banner');
  if (earlyWait) {
    banner.hidden = false;
    el('ewb-time').textContent = earlyWait.scheduledTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } else {
    banner.hidden = true;
  }
  positionBrand(); // banner toggling above can change the bottom row's height
}

// Dates cross JSON as ISO strings — revive them back into Date objects the
// same render()/renderUpcoming() code expects. stopStates isn't consumed by
// anything yet, but its arrivedAt/departedAt are revived too so it's not a
// trap for whatever reads it next.
function reviveState(msg) {
  return {
    ...msg,
    timing: msg.timing && {
      ...msg.timing,
      eta: new Date(msg.timing.eta),
      scheduledTime: new Date(msg.timing.scheduledTime),
    },
    earlyWait: msg.earlyWait && { ...msg.earlyWait, scheduledTime: new Date(msg.earlyWait.scheduledTime) },
    stopStates: msg.stopStates && msg.stopStates.map((s) => ({
      ...s,
      arrivedAt: s.arrivedAt ? new Date(s.arrivedAt) : null,
      departedAt: s.departedAt ? new Date(s.departedAt) : null,
    })),
  };
}

// ── Operator branding ─────────────────────────────────────────────────────
// Mirrors the ThemeProvider pattern used in the dashboard: inject
// --operator-accent as a CSS var on <html>, consumed by onboard.css for the
// top/bottom bars and tube-track (background behind white text, and
// line/dot/label colour on the white paper background) — see onboard.css's
// --operator-accent comment. Falls back to CoachMate's default dark purple
// unless the operator's accent_color clears WCAG AA for large text/UI
// components (>= 3:1 contrast) against the white paper it's used on/with.
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

// Standalone (driverless) schedule-autopilot only (see
// announceStandaloneAutopilot.js) — always unhides the idle screen, even
// without ?operator-name= and even with no candidate yet (a device freshly
// registered with no candidate_departure_ids configured), so the kiosk
// visibly confirms it booted into standalone mode rather than looking
// identical to a broken/not-yet-connected device. Only the next-departure
// caption itself is conditional. candidate is
// { departureId, firstStopLat, firstStopLon, departureTime } (scheduleAutopilot.js's
// shape) or null once nothing is cached yet / commissioned.
export function showNextDeparture(candidate) {
  const box = el('idle-next-departure');
  box.hidden = !candidate;
  box.textContent = candidate ? `Next departure ${candidate.departureTime}` : '';
  el('onboard-idle').hidden = false;
  positionBrand();
}

// ── Clock — wide-layout top bar only, but harmless to keep updating while
// the sign is hidden/in the default layout since #sign-clock just sits
// unused there. ──────────────────────────────────────────────────────────

function startClock() {
  const clock = el('sign-clock');
  const tick = () => {
    clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  };
  tick();
  setInterval(tick, 1000);
}

// ── Pushed feed (Driver -> Controller -> this sign) — the only source of
// truth this device has. See src/announceLink.js (sender) and
// mele-server/announceRelay.mjs (relay). This device reads its own push-feed
// token from its own URL rather than commissioning localStorage the way the
// Driver device does — onboard.html is always opened via one fixed
// per-vehicle URL (see mele-server/DEPLOY.md), so there's nothing to persist
// across visits. Persistent, auto-reconnecting (same flat 3s-retry shape as
// announceLink.js's own connect()) — there is no fallback to give up into
// if the connection can't be established. ──────────────────────────────────
const RECONNECT_DELAY_MS = 3000;

let socket = null;
let allStops = null;
const initialStopIndex = 0; // start of route; geofence catch-up (on the Driver side) handles wherever the vehicle actually is
let signShown = false;

// Exported for announceLiteFeed.js — the Lite tier's Supabase-driven
// alternative to this section's WebSocket feed calls these with the exact
// same message shape (see that file's header comment), so the rendering
// code below is shared unchanged between both tiers.
export function onSchedule(msg) {
  allStops = (msg.stops ?? []).map((s) => ({ ...s, name: stripIndicator(s.name) }));
  el('sign-service-code').textContent = msg.serviceCode;
  el('sign-destination').textContent = msg.destination;
  applyOperatorBranding({ accentColor: msg.accentColor });
  el('onboard-idle').hidden = true;
  el('onboard-sign').hidden = false;
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
  if (!allStops) {
    // Shouldn't happen given the relay sends schedule before state on
    // connect (see announceRelay.mjs), but guards a freshly-restarted relay
    // with a stale latestState and no latestSchedule yet.
    console.warn('onboard.js: state message received before any schedule — ignoring');
    return;
  }
  const state = reviveState(msg);
  render(allStops, initialStopIndex, state);
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
  // Only set when non-default so onboard.css's base (horizontal) rules stay
  // the ones in effect for every profile/URL that doesn't ask for vertical.
  if (trackLayout() === 'vertical') document.documentElement.dataset.trackLayout = 'vertical';
  startClock();
  initIdleScreen();

  // Mutually exclusive per device: ?announce-device-token= (Lite, Supabase
  // Realtime — see announceLiteFeed.js) vs the Standard /sign-feed
  // WebSocket. A device is provisioned with exactly one of the two URL
  // params, never both. The Lite token is captured once and persisted (see
  // announceLiteSetup.js) rather than re-read from the URL every load — a
  // kiosk isn't guaranteed to reopen with its original query string.
  captureAnnounceDeviceSetup(new URLSearchParams(window.location.search));
  const liteDeviceToken = getAnnounceDeviceToken();
  if (liteDeviceToken) {
    connectAnnounceLiteFeed(liteDeviceToken, { onSchedule, onState, onIdleNextDeparture: showNextDeparture });
  } else {
    connectSignFeed();
  }
}

init();
