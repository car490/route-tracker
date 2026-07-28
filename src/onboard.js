// Fixed passenger-facing onboard sign. Deliberately siloed from main.js —
// no login, no duty card UI, no incident reporting, no stop-time upload,
// no writes to Supabase at all. It only reads schedule_view/get_duty_card
// and tracks GPS live.
//
// No manual intervention: this device is told which single journey to
// watch via ?journey=<id> in the URL (a Pi-side deployment would inject
// this the same way it already injects a fixed departure into
// sync-schedule.mjs). It sits on a blank screen, polling get_duty_card
// for that journey_id, until status flips to in_progress — i.e. the
// moment the driver hits Start on their own phone — then wakes on its
// own and starts showing/announcing stops.
import { startGpsTracking } from './gps.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { setAnnouncementsEnabled, announceJourneyStart, announceDiversion } from './announcements.js';
import { announceStopEvent } from './announceStopEvent.js';

const DEPOT = { name: 'Phil Haines Coaches Depot', lat: 52.950412, lon: -0.050110 };
const WATCH_JOURNEY_ID = new URLSearchParams(window.location.search).get('journey');
const POLL_INTERVAL_MS = 5000;
const WIDE_LAYOUT_QUERY = '(min-aspect-ratio: 4/1)'; // 16:3 ultra-wide sign, see docs/onboard-widescreen-layout.md

const el = (id) => document.getElementById(id);
const isWideLayout = () => matchMedia(WIDE_LAYOUT_QUERY).matches;

// Set once a schedule fetch resolves — true when this page is being served
// by a Pi's local pi-server (not GitHub Pages / the plain dev server.js),
// so GPS is also read from its /api/position bridge instead of
// navigator.geolocation.
let usingLocalApi = false;

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`RPC ${fn}: ${res.status}`);
  return res.json();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Wait for the driver to start this journey ──────────────────────────────

async function waitForJourneyStart(journeyId) {
  for (;;) {
    try {
      const [duty] = await rpc('get_duty_card', { journey_ids: [journeyId] });
      if (duty && duty.status === 'in_progress') return duty;
    } catch (err) {
      console.error('get_duty_card poll failed:', err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// ── Stops for the watched journey's departure ──────────────────────────────

async function fetchStops(departureId) {
  // Try a Pi's local pi-server first (relative URL — only present when this
  // page is actually being served by one; 404s harmlessly on GitHub Pages
  // or the plain dev server.js, which don't have an /api/* route at all).
  try {
    const res = await fetch('/api/schedule');
    if (res.ok) {
      usingLocalApi = true;
      const rows = (await res.json()).filter((r) => r.departure_id === departureId);
      return rowsToStops(rows);
    }
  } catch (_) { /* no local server reachable — fall through to Supabase */ }

  usingLocalApi = false;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/schedule_view` +
    `?departure_id=eq.${departureId}` +
    `&select=timetable_stop_id,stop_type,scheduled_time,display_name,lat,lon,sequence` +
    `&order=sequence`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) throw new Error(`schedule_view ${res.status}`);
  return rowsToStops(await res.json());
}

// display_name() (schema.sql) appends a NaPTAN indicator in parentheses —
// "Weston, The Chequers PH (adj)", "Grantham, Bus Station (Stand 5)" — for
// route-planning precision (which pole/bay/side of the road). Passengers
// don't need that, and every character counts against the 22mm text
// minimum, so it's stripped here for this passenger-facing display only —
// the driver PWA and dashboard still get the full name with indicator.
function stripIndicator(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, '');
}

function rowsToStops(rows) {
  return rows
    .sort((a, b) => a.sequence - b.sequence)
    .map((r) => ({ name: stripIndicator(r.display_name), lat: r.lat, lon: r.lon, time: r.scheduled_time.substring(0, 5), stop_type: r.stop_type }));
}

// Polls a Pi's local GPS bridge (pi-server/server.mjs's /api/position,
// itself fed by gpsd) instead of navigator.geolocation. Matches the
// (onFix, onError) => {stop()} shape gps.js expects from any positionSource.
function localPiPositionSource(onFix, onError) {
  let stopped = false;
  let consecutiveMisses = 0;

  async function poll() {
    if (stopped) return;
    try {
      const res = await fetch('/api/position');
      if (res.ok) {
        consecutiveMisses = 0;
        const fix = await res.json();
        onFix({ coords: { latitude: fix.lat, longitude: fix.lon, speed: fix.speed ?? 0, accuracy: fix.accuracy ?? null } });
      } else if (res.status !== 503) {
        // 503 = pi-server is up but gpsd has no fix yet (e.g. cold start) — not an error, just wait.
        consecutiveMisses++;
      }
    } catch (_) {
      consecutiveMisses++;
    }
    if (consecutiveMisses === 5) onError(new Error('Lost contact with onboard GPS unit'));
    if (!stopped) setTimeout(poll, 2000);
  }

  poll();
  return { stop: () => { stopped = true; } };
}

function shiftTime(timeStr, deltaMinutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = ((h * 60 + m + deltaMinutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function withDepotStops(stops) {
  return [
    { ...DEPOT, time: shiftTime(stops[0].time, -30) },
    ...stops,
    { ...DEPOT, time: shiftTime(stops[stops.length - 1].time, +30) },
  ];
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

  const first = 1, last = allStops.length - 2; // real stops only; 0/length-1 are depot padding
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

  const last = allStops.length - 2; // real stops only; length-1 is depot padding
  const rows = [];
  for (let i = centerIndex + 1; i <= Math.min(centerIndex + UPCOMING_STOP_COUNT, last); i++) rows.push(allStops[i]);

  if (!rows.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = rows.map((stop) => {
    const time = etaForStop(stop, timing).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `<div class="upcoming-row"><span class="upcoming-name">${stop.name}</span><span class="upcoming-time">${time}</span></div>`;
  }).join('');
}

// ── Sign ─────────────────────────────────────────────────────────────────

async function runSign(duty) {
  const stops = await fetchStops(duty.timetable_departure_id);
  if (!stops.length) { console.error('No stops for departure', duty.timetable_departure_id); return; }
  const allStops = withDepotStops(stops);
  const initialStopIndex = 1; // start of route; geofence catch-up handles wherever the vehicle actually is

  const destination = stripIndicator(duty.last_stop_name);
  el('sign-service-code').textContent = duty.service_code;
  el('sign-destination').textContent = destination;
  el('onboard-sign').hidden = false;
  // Brand mark stays visible once active too — repositioned in
  // onboard.css to a corner of the central track band so it no longer
  // sits under the (now left-aligned) purple topbar.

  setAnnouncementsEnabled(true);
  announceJourneyStart({ serviceCode: duty.service_code, destination });

  // See main.js's runTracker for why this starts at initialStopIndex, not
  // null — otherwise a vehicle already at the starting stop when NextStop
  // wakes gets that arrival (re-)announced on top of announceJourneyStart.
  let lastAnnouncedStopIdx = initialStopIndex;

  // ── Diversion status polling ────────────────────────────────────────────
  // This device has no driver identity of its own (see file header), so it
  // can't use diversion_alert_event's ownership-scoped RLS directly — it
  // polls the anon-safe is_diversion_active() boolean instead. Announces
  // immediately on the false→true transition (not just suppressing the next
  // stop call) so passengers hear it promptly rather than waiting for the
  // next scheduled stop.
  let diversionActive = false;
  (async function pollDiversionStatus() {
    for (;;) {
      try {
        const active = await rpc('is_diversion_active', { p_journey_id: duty.journey_id });
        if (active && !diversionActive) announceDiversion();
        diversionActive = active;
      } catch (err) {
        console.error('is_diversion_active poll failed:', err);
      }
      await sleep(POLL_INTERVAL_MS);
    }
  })();

  await acquireWakeLock();

  startGpsTracking({
    schedule: allStops,
    lateAllowanceMin: 2,
    initialStopIndex,
    positionSource: usingLocalApi ? localPiPositionSource : undefined,
    onUpdate: ({ nextStopIndex, earlyWait, atStop, timing }) => {
      const centerIndex = atStop ? atStop.stopIndex : Math.max(nextStopIndex - 1, initialStopIndex);
      const isFinal = centerIndex === allStops.length - 2;

      // One line of text that changes wording rather than a second line
      // appearing/disappearing — matches the audio announcements exactly
      // ("This stop is X" / "The next stop is Y", see announcements.js) and
      // keeps the bottom bar's height constant so the tube-track above it
      // never jumps.
      el('sbl-status').textContent = atStop
        ? `This stop is ${allStops[centerIndex].name}`
        : isFinal
          ? 'End of route'
          : `The next stop is ${allStops[centerIndex + 1].name}`;
      renderTubeTrack(allStops, centerIndex, !!atStop);
      renderUpcoming(allStops, centerIndex, timing);

      const banner = el('early-wait-banner');
      if (earlyWait) {
        banner.hidden = false;
        el('ewb-time').textContent = earlyWait.scheduledTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      } else {
        banner.hidden = true;
      }

      // Real passenger-facing stops are indices [1, length-2]; 0 and length-1
      // are the depot padding stops and are never announced. Announce on
      // arrival (atStop set), not departure, so "this stop" is true when said.
      if (atStop && atStop.stopIndex !== lastAnnouncedStopIdx
          && atStop.stopIndex > 0 && atStop.stopIndex < allStops.length - 1) {
        lastAnnouncedStopIdx = atStop.stopIndex;
        const stopIsFinal = atStop.stopIndex === allStops.length - 2;
        announceStopEvent({
          stopId: allStops[atStop.stopIndex].stop_id,
          stopName: allStops[atStop.stopIndex].name,
          nextStopId: stopIsFinal ? null : allStops[atStop.stopIndex + 1].stop_id,
          nextStopName: stopIsFinal ? null : allStops[atStop.stopIndex + 1].name,
          isFinal: stopIsFinal,
          diversionActive,
        });
      }
    },
  });
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
// get_duty_card() returns it as-is — so there is no way to tell "operator
// genuinely picked this colour" apart from "column was never customised"
// once it reaches this function; both look identical. '#00B4D8' itself also
// fails the 3:1-against-white check (~2.5:1), so treating it like any other
// accent would permanently blank out the bars for every company that has
// never touched Branding settings. Special-cased below: that exact default
// value is treated as "no customisation" and skipped entirely, same as a
// missing accent_color would be. The one edge case this can't distinguish:
// an operator who deliberately sets their own accent_color to that same
// teal — they'd get the onboard sign's purple default instead. Acceptable
// today; a real fix needs a separate nullable column or a "customised"
// flag if it ever matters.

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

function applyOperatorBranding(duty) {
  const accent = duty.accent_color;
  if (!accent || accent.toLowerCase() === PLATFORM_DEFAULT_ACCENT.toLowerCase()) return;

  const ratio = wcagContrastRatio(accent, EP_PAPER);
  if (ratio >= 3) {
    document.documentElement.style.setProperty('--operator-accent', accent);
  } else {
    console.warn(
      `onboard: operator accent colour ${accent} rejected — contrast ratio ${ratio.toFixed(2)}:1 ` +
      `against ${EP_PAPER} is below the required 3:1 (WCAG AA large text/UI component). ` +
      `Falling back to default. Update accent_color in the dashboard Branding settings.`
    );
  }
}

// ── Entry point ──────────────────────────────────────────────────────────

async function init() {
  startClock();
  if (!WATCH_JOURNEY_ID) {
    console.warn('onboard.js: no ?journey=<id> in the URL — nothing to watch, staying blank.');
    return;
  }
  const duty = await waitForJourneyStart(WATCH_JOURNEY_ID);
  applyOperatorBranding(duty);
  await runSign(duty);
}

init().catch(console.error);
