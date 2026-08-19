// Fixed passenger-facing onboard sign. Deliberately siloed from main.js —
// no login, no duty card UI, no incident reporting, no stop-time upload, no
// writes to Supabase at all. As of the Controller redesign
// (docs/CONTROLLER-REDESIGN.md §3/§4/§5/§6) it also has NO reads of its
// own: no independent get_duty_card polling, no GPS (neither its own
// hardware nor a local /api/position bridge), no schedule_view queries.
// It is a pure renderer, driven entirely by what the Driver device pushes
// to it over a local WebSocket (see src/announceLink.js — the sender —
// and pi-server/announceRelay.mjs — the relay this device connects to).
//
// No manual intervention: this device is told nothing about which journey
// to watch via its own URL beyond ?announce-token=<token> (the shared
// secret for the relay — see pi-server/DEPLOY.md). It sits blank until an
// authenticated /sign-feed connection receives a {type:'schedule'}
// message — i.e. the moment a Driver device starts tracking a journey —
// then wakes on its own and starts showing stops as {type:'state'}
// messages arrive.
const WIDE_LAYOUT_QUERY = '(min-aspect-ratio: 4/1)'; // 16:3 ultra-wide sign, see docs/onboard-widescreen-layout.md

const el = (id) => document.getElementById(id);
const isWideLayout = () => matchMedia(WIDE_LAYOUT_QUERY).matches;

// ── PSV(AI)R 22mm minimum text height — panel-agnostic sizing ──────────────
// onboard.css's --min-text default (17vh) is a fixed constant calibrated for
// two specific known panels (Fire HD 10 and the 28" wide sign) that happen
// to need near-identical vh values by coincidence — see that variable's own
// comment. It does NOT generalise: a same-density but taller-in-pixels panel
// (e.g. a standard 1920x1080 monitor) needs a much smaller vh fraction for
// the same physical 22mm, because vh is relative to total pixel height, and
// browsers have no reliable API for a screen's physical size (no EDID
// access, by design, for privacy/security — this is a real web platform
// limit, not a workaround-able gap). So the one thing that must be supplied
// per-panel, once, is its physical diagonal size — everything else
// (resolution, aspect ratio) is already known automatically at runtime.
//
// Commissioned via ?panel-diagonal=<inches> on the same fixed kiosk URL that
// already carries ?announce-token= — same per-device-settings-in-the-URL
// pattern this device uses throughout (see the file header: nothing to
// persist across visits, everything comes from its own URL each load).
// Omitted entirely = old behaviour: CSS's own 17vh default applies
// unchanged, so existing deployments that haven't added the param yet
// aren't affected.
export function computeMinTextVh(diagonalInches, viewportWidthPx, viewportHeightPx) {
  if (!diagonalInches || !viewportWidthPx || !viewportHeightPx) return null;
  const diagonalPx = Math.sqrt(viewportWidthPx ** 2 + viewportHeightPx ** 2);
  const panelHeightMm = diagonalInches * 25.4 * (viewportHeightPx / diagonalPx);
  return (22 / panelHeightMm) * 100;
}

function applyPanelSizing() {
  const diagonalInches = Number(new URLSearchParams(window.location.search).get('panel-diagonal'));
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
// The wide 16:3 sign has much more horizontal room per node than the Fire
// HD tablet, so it shows more stops either side of the current one — see
// docs/onboard-widescreen-layout.md.

function renderTubeTrack(allStops, centerIndex, isAtStop) {
  const track = el('tube-track');
  track.innerHTML = '';

  const first = 0, last = allStops.length - 1;
  // Labels must stay readable from the back of an 11m bus (~22mm min text,
  // see --min-text in onboard.css), which leaves room for very few stops
  // either side regardless of the extra width the wide sign has.
  const isWide = isWideLayout();
  const stopsBack = 1;
  const stopsForward = isWide ? 2 : 1;
  const indices = [];
  for (let i = centerIndex - stopsBack; i <= centerIndex + stopsForward; i++) {
    if (i >= first && i <= last) indices.push(i);
  }

  indices.forEach((i) => {
    const state = i < centerIndex ? 'past' : i === centerIndex ? 'current' : 'future';
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
  const rows = [];
  for (let i = centerIndex + 1; i <= Math.min(centerIndex + UPCOMING_STOP_COUNT, last); i++) rows.push(allStops[i]);

  if (!rows.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = rows.map((stop) => {
    const time = etaForStop(stop, timing).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `<div class="upcoming-row"><span class="upcoming-name">${stop.name}</span><span class="upcoming-time">${time}</span></div>`;
  }).join('');
}

// ── Rendering — purely visual: no audio, no Supabase, no GPS — just DOM
// updates off an already-computed state shape pushed from the Driver. ──────

function render(allStops, initialStopIndex, { nextStopIndex, earlyWait, atStop, timing }) {
  const centerIndex = atStop ? atStop.stopIndex : Math.max(nextStopIndex - 1, initialStopIndex);
  const isFinal = centerIndex === allStops.length - 1;

  // One line of text that changes wording rather than a second line
  // appearing/disappearing — a close, not verbatim, echo of the audio
  // announcements (see announcements.js) — and keeps the bottom bar's
  // height constant so the tube-track above it never jumps.
  el('sbl-status').textContent = atStop
    ? `This stop is ${allStops[centerIndex].name}`
    : isFinal
      ? 'End of route'
      : `The next stop will be ${allStops[centerIndex + 1].name}`;
  renderTubeTrack(allStops, centerIndex, !!atStop);
  renderUpcoming(allStops, centerIndex, timing);

  const banner = el('early-wait-banner');
  if (earlyWait) {
    banner.hidden = false;
    el('ewb-time').textContent = earlyWait.scheduledTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } else {
    banner.hidden = true;
  }
}

// "Announcing: X" hint. Audio playback itself stays on the Driver device
// (PSVAIR reliability — it must keep working even if this feed drops; see
// docs/CONTROLLER-REDESIGN.md §8 for the not-yet-built plan to change
// that); this is a display-only echo of the announcing field the Driver
// includes in its push messages. #sign-announcing is optional markup —
// harmless no-op if it's not present.
function renderAnnouncing(name) {
  const box = el('sign-announcing');
  if (!box) return;
  box.hidden = !name;
  if (name) box.textContent = `Announcing: ${name}`;
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
const PLATFORM_DEFAULT_ACCENT = '#00B4D8'; // companies.accent_color's DB default — see comment above

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
// pi-server/announceRelay.mjs (relay). This device reads its own push-feed
// token from its own URL rather than commissioning localStorage the way the
// Driver device does — onboard.html is always opened via one fixed
// per-vehicle URL (see pi-server/DEPLOY.md), so there's nothing to persist
// across visits. Persistent, auto-reconnecting (same flat 3s-retry shape as
// announceLink.js's own connect()) — there is no fallback to give up into
// if the connection can't be established. ──────────────────────────────────
const RECONNECT_DELAY_MS = 3000;

let socket = null;
let allStops = null;
const initialStopIndex = 0; // start of route; geofence catch-up (on the Driver side) handles wherever the vehicle actually is
let signShown = false;

function onSchedule(msg) {
  allStops = (msg.stops ?? []).map((s) => ({ ...s, name: stripIndicator(s.name) }));
  el('sign-service-code').textContent = msg.serviceCode;
  el('sign-destination').textContent = msg.destination;
  applyOperatorBranding({ accentColor: msg.accentColor });
  el('onboard-sign').hidden = false;
  // Brand mark stays visible once active too — repositioned in onboard.css
  // to a corner of the central track band so it no longer sits under the
  // (now left-aligned) purple topbar.
  if (!signShown) {
    signShown = true;
    acquireWakeLock();
  }
}

function onState(msg) {
  if (!allStops) {
    // Shouldn't happen given the relay sends schedule before state on
    // connect (see announceRelay.mjs), but guards a freshly-restarted relay
    // with a stale latestState and no latestSchedule yet.
    console.warn('onboard.js: state message received before any schedule — ignoring');
    return;
  }
  const state = reviveState(msg);
  render(allStops, initialStopIndex, state);
  renderAnnouncing(state.announcing);
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
  startClock();
  connectSignFeed();
}

init();
