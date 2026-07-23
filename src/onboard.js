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
  const isWide = matchMedia(WIDE_LAYOUT_QUERY).matches;
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

// ── ETA — next stop only, en route only ─────────────────────────────────
// Not called while atStop (see call site) — gps.js's `timing` is a live
// estimate for whichever stop it currently has as nextStopIndex, which
// while dwelling at a stop is the stop we're already at, not the "next
// stop" this computes an ETA for.
function nextStopEta(allStops, centerIndex, timing) {
  const next = allStops[centerIndex + 1];
  if (!next) return null;
  const [h, m] = next.time.split(':').map(Number);
  const scheduled = new Date();
  scheduled.setHours(h, m, 0, 0);
  const offsetMs = timing.eta.getTime() - timing.scheduledTime.getTime();
  return new Date(scheduled.getTime() + offsetMs);
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

  setAnnouncementsEnabled(true);
  announceJourneyStart({ serviceCode: duty.service_code, destination });

  let lastAnnouncedStopIdx = null;

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

      el('sbl-this').hidden = !atStop;
      el('sbl-this-name').textContent = allStops[centerIndex].name;
      el('sbl-next-name').textContent = isFinal ? 'End of route' : allStops[centerIndex + 1].name;
      renderTubeTrack(allStops, centerIndex, !!atStop);

      // ETA isn't PSVAIR-regulated (This Stop/Next Stop are) — hidden while
      // atStop so those two get the full row's width to themselves instead
      // of a third, unregulated item squeezing them down to nothing.
      const eta = (isFinal || atStop) ? null : nextStopEta(allStops, centerIndex, timing);
      el('sbl-eta').hidden = !eta;
      if (eta) el('sbl-eta-time').textContent = eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const banner = el('early-wait-banner');
      if (earlyWait) {
        banner.hidden = false;
        el('ewb-time').textContent = earlyWait.scheduledTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
          stopName: allStops[atStop.stopIndex].name,
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
    clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 1000);
}

// ── Entry point ──────────────────────────────────────────────────────────

async function init() {
  startClock();
  if (!WATCH_JOURNEY_ID) {
    console.warn('onboard.js: no ?journey=<id> in the URL — nothing to watch, staying blank.');
    return;
  }
  const duty = await waitForJourneyStart(WATCH_JOURNEY_ID);
  await runSign(duty);
}

init().catch(console.error);
