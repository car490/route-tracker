// Two-window client-pitch demo: the real driver PWA next to the real
// NextStop passenger display, borderless and positioned for a 15" laptop
// (1280x720 logical / window.screen coordinate space — see openWindow()'s
// comment on why that's not the same as the panel's physical pixels).
//
// Unlike demo.html (a scripted, entirely fake simulation), this drives the
// actual app code with mocked Geolocation — same technique as
// scripts/demo-drive.mjs, but two windows instead of three, and two
// selectable starting scenarios instead of one fixed duty-card URL:
//
//   duty    Driver already has an assigned duty card (the PSVAIR demo
//           journey). PWA opens straight to the duty card.
//   manual  No duty card assigned. PWA opens to the "No duty assigned"
//           screen; you click "Select a service manually" and pick it
//           yourself. The NextStop window is already pointed at the
//           journey this will resolve to (get_or_create_manual_journey is
//           keyed on departure + date, so the id is known up front even
//           though the row's status flips to in_progress only once you
//           actually hit Start) — see the printed instructions once the
//           windows open for exactly what to pick.
//
// Both scenarios drive the same physical route (S125S, Weston → Boston
// College) so one set of mocked stop coordinates covers either.
//
// Audio: the NextStop window is the one that talks (real onboard hardware
// only has one speaker — the vehicle's, not the driver's phone); the PWA
// window's own PSVAIR announcements are muted via localStorage so the two
// don't talk over each other.
//
// Usage:
//   node scripts/demo-2up.mjs duty   [secondsPerStop]
//   node scripts/demo-2up.mjs manual [secondsPerStop]
//
// Requires the local dev server running first (node server.js, or
// node scripts/dev-all.mjs) — this only opens browser windows against
// http://localhost:8080, it doesn't start anything itself.

import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODE = process.argv[2];
const SECONDS_PER_STOP = Number(process.argv[3] ?? 7);
const SUB_STEPS = 6; // interpolation points per stop-to-stop leg

if (MODE !== 'duty' && MODE !== 'manual') {
  console.error('Usage: node scripts/demo-2up.mjs <duty|manual> [secondsPerStop]');
  process.exit(1);
}

const BASE_URL = 'http://localhost:8080';

// PSVAIR demo journey (see memory: must be reset — journey_events deleted,
// status back to 'scheduled' — before re-running duty mode the same day,
// same as scripts/demo-drive.mjs).
const DUTY_JOURNEY_ID = '2d2f26b1-31b9-434b-a858-e614a53599b5';

// S125S Morning Outbound (Weston → Boston College) — same route as the duty
// journey above, from src/routeData.js. Manual mode drives this departure.
const MANUAL_DEPARTURE_ID = '338aebc6-8b5e-4a86-acad-a56bcf7a123b';
const MANUAL_SERVICE = 'S125S';
const MANUAL_PERIOD  = 'Morning Outbound';

// Dev Supabase anon/publishable key — safe, RLS-gated (see src/config.js's
// comment). Hardcoded here rather than imported: config.js picks dev vs
// prod off window.location.hostname, which doesn't exist in Node.
const SUPABASE_URL = 'https://cgcbfgceputvdvhzrgio.supabase.co';
const SUPABASE_KEY = 'sb_publishable_LZVX8fASyDG8UtMp3eeRJQ_SBxpCa54';

// Real stops, Weston to Boston College (S125S Outbound) — pulled from dev
// Supabase timetable_stops/stops for timetable_departure_id above.
const STOPS = [
  { name: "Weston, adj The Chequers PH",        lat: 52.808106507, lon: -0.084034973 },
  { name: "Weston, opp Delgate Bank",             lat: 52.807162,    lon: -0.074017 },
  { name: "Moulton, opp Bell Lane",               lat: 52.805379,    lon: -0.065016 },
  { name: "Moulton, adj River Lane",              lat: 52.804524,    lon: -0.057221 },
  { name: "Whaplode, opp St Mary's Gardens",      lat: 52.800272,    lon: -0.041953 },
  { name: "Whaplode, adj Darjeeling Restaurant",  lat: 52.800214,    lon: -0.036289 },
  { name: "Whaplode, opp Middle Road",            lat: 52.800127,    lon: -0.032125 },
  { name: "Whaplode, adj Stockwell Gate",         lat: 52.80104,     lon: -0.026476 },
  { name: "Holbeach, opp Wignals Gate",           lat: 52.803429,    lon: -0.01177 },
  { name: "Holbeach, opp Netherfield",            lat: 52.804283,    lon: -0.001034 },
  { name: "Holbeach, adj Fairfields",             lat: 52.804876,    lon: 0.005373 },
  { name: "Holbeach, opp Stukeley Hall Drive",    lat: 52.80472,     lon: 0.009816 },
  { name: "Holbeach, opp Interchange Shelter",    lat: 52.803419,    lon: 0.018658 },
  { name: "Holbeach, opp Damgate",                lat: 52.803826,    lon: 0.023765 },
  { name: "Holbeach, adj Rowan Close",            lat: 52.803854,    lon: 0.031629 },
  { name: "Fleet Road (opp)",                     lat: 52.805217,    lon: 0.052731 },
  { name: "Fleet Hargate, adj Winslow Gate",      lat: 52.804581,    lon: 0.058324 },
  { name: "Fleet Hargate, opp Proctors Close",    lat: 52.804406,    lon: 0.062188 },
  { name: "Holbeach Cackle Hill, opp 188 Boston Road", lat: 52.81834, lon: 0.002431 },
  { name: "New Saracen's Head PH (adj)",          lat: 52.824392,    lon: -0.012074 },
  { name: "Fosdyke, adj Village Hall",            lat: 52.880265,    lon: -0.045871 },
  { name: "Fosdyke, opp All Saint's Church",      lat: 52.880896,    lon: -0.047091 },
  { name: "Boston College (adj)",                 lat: 52.972156,    lon: -0.018524 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lerp = (a, b, t) => a + (b - a) * t;

// Resolves (creating if needed) today's journey row for the manual-mode
// departure, so the NextStop window can be pointed at its journey_id before
// the driver has actually clicked Start. Idempotent — keyed on
// (timetable_departure_id, journey_date) — see schema.sql. This does NOT
// flip status to in_progress; that only happens once you click Start in the
// browser (src/manualSelection.js calls start_journey itself).
async function resolveManualJourneyId() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_or_create_manual_journey`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_timetable_departure_id: MANUAL_DEPARTURE_ID }),
  });
  if (!res.ok) throw new Error(`get_or_create_manual_journey failed: ${res.status} ${await res.text()}`);
  const [{ journey_id }] = await res.json();
  return journey_id;
}

// context.pages()[0] can race the --app= window's real navigation and grab
// a transient about:blank page instead — poll for a page whose origin
// actually matches instead of trusting whichever page shows up first.
async function waitForRealPage(context, expectedUrl) {
  const targetOrigin = new URL(expectedUrl).origin;
  for (let i = 0; i < 30; i++) {
    const found = context.pages().find((p) => {
      try { return new URL(p.url()).origin === targetOrigin; } catch { return false; }
    });
    if (found) return found;
    await sleep(100);
  }
  return context.pages()[0] ?? await context.waitForEvent('page');
}

async function openWindow({ url, windowPosition, windowSize, mute }) {
  // launchPersistentContext + --app=<url> gives a bare window: no tabs, no
  // address bar, just the page content and a thin native title bar.
  // viewport: null means "no emulation, use the real window" — plain
  // chromium.launch()+newContext() emulates a *virtual* viewport on top of
  // the real window, and under Windows display scaling those two sizes can
  // diverge.
  // --window-size/-position are in the same logical coordinate space as
  // window.screen (NOT physical pixels — a 1920x1080 panel at 150% Windows
  // scaling reports as 1280x720 here, which is this laptop's actual
  // logical resolution). Re-tune the LAYOUT constants below if you run
  // this on a different display.
  const userDataDir = mkdtempSync(join(tmpdir(), 'demo-2up-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    args: [`--window-size=${windowSize}`, `--window-position=${windowPosition}`, `--app=${url}`],
    geolocation: { latitude: STOPS[0].lat, longitude: STOPS[0].lon },
    permissions: ['geolocation'],
  });
  const page = await waitForRealPage(context, url);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  if (mute) {
    // Set before the app's own init reads it, so no announcement gets
    // spoken even for the very first stop.
    await page.evaluate(() => localStorage.setItem('psvair-muted', '1')).catch(() => {});
  }
  // --app=<url> starts navigating the instant Chromium's process starts,
  // racing ahead of the geolocation permission grant and (if set) the mute
  // flag above. Reload so this window's real first paint happens after
  // both are already in place.
  await page.reload({ waitUntil: 'domcontentloaded' });
  return { context, page };
}

// ── Layout — tuned for this laptop's 1280x720 logical screen ───────────────
const SCREEN_W = 1280, SCREEN_H = 720;
const MARGIN = 20;

const PWA_W = 340, PWA_H = 650; // real phone proportions
const PWA_X = MARGIN;
const PWA_Y = Math.round((SCREEN_H - PWA_H) / 2); // vertically centred, left edge

const NS_X = PWA_X + PWA_W + MARGIN;
const NS_W = SCREEN_W - NS_X - MARGIN; // fills remaining width
const NS_H = 200; // 880x200 = 4.4:1, safely past onboard.js's 4:1 wide-layout breakpoint
const NS_Y = Math.round((SCREEN_H - NS_H) / 2); // vertically centred, right of the PWA

(async () => {
  let pwaUrl, journeyId;

  if (MODE === 'duty') {
    pwaUrl = `${BASE_URL}/?duties=${DUTY_JOURNEY_ID}`;
    journeyId = DUTY_JOURNEY_ID;
  } else {
    pwaUrl = BASE_URL;
    console.log('Resolving today\'s manual-mode journey row…');
    journeyId = await resolveManualJourneyId();
  }

  const onboardUrl = new URL('/onboard.html', BASE_URL);
  onboardUrl.searchParams.set('journey', journeyId);

  const [driver, nextstop] = await Promise.all([
    openWindow({
      url: pwaUrl, mute: true,
      windowPosition: `${PWA_X},${PWA_Y}`, windowSize: `${PWA_W},${PWA_H}`,
    }),
    openWindow({
      url: onboardUrl.toString(), mute: false,
      windowPosition: `${NS_X},${NS_Y}`, windowSize: `${NS_W},${NS_H}`,
    }),
  ]);

  console.log('\nTwo windows are open.');
  if (MODE === 'duty') {
    console.log('LEFT  (driver PWA):  click through the duty card, pick the first stop');
    console.log('                     ("Weston, adj The Chequers PH") as the starting point,');
    console.log('                     and hit Start.');
  } else {
    console.log('LEFT  (driver PWA):  click "Select a service manually", choose');
    console.log(`                     Service: ${MANUAL_SERVICE}, Period: ${MANUAL_PERIOD}, then hit Start.`);
    console.log('                     (Must be that exact service/period — the NextStop window');
    console.log('                     is already watching the journey it resolves to.)');
  }
  console.log('RIGHT (NextStop):    nothing to click — it polls for the journey to start and');
  console.log('                     wakes on its own within a few seconds of you hitting Start.');
  console.log('                     It has voice; the driver PWA is muted so they don\'t overlap.');
  console.log('\nWaiting for both to start…');

  await Promise.all([
    driver.page.waitForSelector('#tracker:not([hidden])', { timeout: 10 * 60 * 1000 }),
    nextstop.page.waitForSelector('#onboard-sign:not([hidden])', { timeout: 10 * 60 * 1000 }),
  ]);
  console.log('Both started — driving the route now.\n');

  for (let i = 1; i < STOPS.length; i++) {
    const from = STOPS[i - 1];
    const to = STOPS[i];
    for (let s = 1; s <= SUB_STEPS; s++) {
      const t = s / SUB_STEPS;
      const pos = { latitude: lerp(from.lat, to.lat, t), longitude: lerp(from.lon, to.lon, t) };
      await Promise.all([
        driver.context.setGeolocation(pos),
        nextstop.context.setGeolocation(pos),
      ]);
      await sleep((SECONDS_PER_STOP * 1000) / SUB_STEPS);
    }
    console.log(`→ ${to.name}`);
  }

  console.log('\nRoute complete — arrived at Boston College. Windows stay open;');
  console.log('close them manually (or Ctrl+C this script) when the demo is done.');
})().catch((err) => {
  console.error('\n=== demo-2up.mjs failed ===');
  console.error(err);
  process.exitCode = 1;
});
