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

function rowsToStops(rows) {
  return rows
    .sort((a, b) => a.sequence - b.sequence)
    .map((r) => ({ name: r.display_name, lat: r.lat, lon: r.lon, time: r.scheduled_time.substring(0, 5), stop_type: r.stop_type }));
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
// Shows up to 2 stops back, the current one, and up to 2 ahead — clipped
// naturally at the ends of the route.

function renderTubeTrack(allStops, centerIndex, isAtStop) {
  const track = el('tube-track');
  track.innerHTML = '';

  const first = 1, last = allStops.length - 2; // real stops only; 0/length-1 are depot padding
  // Wide 16:3 sign shows 1 past stop instead of 2 (less vertical room per
  // node than the horizontal strip has) — see docs/onboard-widescreen-layout.md.
  const stopsBack = matchMedia(WIDE_LAYOUT_QUERY).matches ? 1 : 2;
  const indices = [];
  for (let i = centerIndex - stopsBack; i <= centerIndex + 2; i++) {
    if (i >= first && i <= last) indices.push(i);
  }

  indices.forEach((i) => {
    const state = i < centerIndex ? 'past' : i === centerIndex ? 'current' : 'future';
    const node = document.createElement('div');
    node.className = `tube-node tube-${state}`;
    // "At stop" (geofence-confirmed arrival) gets its own pulsating-green
    // look, distinct from "current" (an estimated position between stops).
    if (i === centerIndex && isAtStop) node.classList.add('tube-at-stop');
    node.innerHTML = `<div class="tube-dot"></div><div class="tube-label">${allStops[i].name}</div>`;
    track.appendChild(node);
  });
}

// ── Sign ─────────────────────────────────────────────────────────────────

async function runSign(duty) {
  const stops = await fetchStops(duty.timetable_departure_id);
  if (!stops.length) { console.error('No stops for departure', duty.timetable_departure_id); return; }
  const allStops = withDepotStops(stops);
  const initialStopIndex = 1; // start of route; geofence catch-up handles wherever the vehicle actually is

  el('sign-service-code').textContent = duty.service_code;
  el('sign-destination').textContent = duty.last_stop_name;
  el('onboard-sign').hidden = false;

  setAnnouncementsEnabled(true);
  announceJourneyStart({ serviceCode: duty.service_code, destination: duty.last_stop_name });

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
    onUpdate: ({ nextStopIndex, earlyWait, atStop }) => {
      const centerIndex = atStop ? atStop.stopIndex : Math.max(nextStopIndex - 1, initialStopIndex);
      const isFinal = centerIndex === allStops.length - 2;

      el('sign-current-stop').textContent = allStops[centerIndex].name;
      el('sign-next-stop').textContent = isFinal ? 'End of route' : allStops[centerIndex + 1].name;
      renderTubeTrack(allStops, centerIndex, !!atStop);

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
