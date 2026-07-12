// Live-demo GPS simulator for the PSVAIR next-stop announcements feature.
//
// Not part of the app — this drives two real, visible Chromium windows with
// mocked Geolocation so a presenter can show the driver PWA (with audio)
// and the onboard passenger e-paper display (silent, text-only mirror of
// the same announcements) updating together, while the ops dashboard's
// Live Tracking map updates in parallel in a normal browser tab, all
// without a real moving vehicle.
//
// Usage:
//   node scripts/demo-drive.mjs <duty-url> [secondsPerStop]
//
// Example:
//   node scripts/demo-drive.mjs "http://localhost:8080/?duties=2d2f26b1-31b9-434b-a858-e614a53599b5" 7
//
// Two windows open, both already positioned at the first stop:
//   - LEFT:  the driver PWA duty-card link you pass in. Click through the
//            duty card, pick the FIRST stop as the starting point, hit Start.
//   - RIGHT: the onboard passenger sign (onboard.html?journey=<id>, landscape,
//            Fire-HD proportions). No interaction needed — it polls
//            get_duty_card for that journey and wakes on its own within a
//            few seconds of the driver hitting Start on the left.
// The simulator waits for both, then drives the route in lockstep. Only the
// left (driver PWA) window produces audio — the right window is muted via
// localStorage before it loads, so the two don't talk over each other; its
// on-screen text still updates from the same simulated GPS feed.

import { chromium } from 'playwright';

const DUTY_URL = process.argv[2];
const SECONDS_PER_STOP = Number(process.argv[3] ?? 7);
const SUB_STEPS = 6; // interpolation points per stop-to-stop leg

if (!DUTY_URL) {
  console.error('Usage: node scripts/demo-drive.mjs <duty-url> [secondsPerStop]');
  process.exit(1);
}

const JOURNEY_ID = new URL(DUTY_URL).searchParams.get('duties')?.split(',')[0];
if (!JOURNEY_ID) {
  console.error('Could not find a journey id (?duties=...) in the URL you passed.');
  process.exit(1);
}
const onboardUrl = new URL('/onboard.html', DUTY_URL);
onboardUrl.searchParams.set('journey', JOURNEY_ID);
const ONBOARD_URL = onboardUrl.toString();

// Real stops, Weston to Boston College (S125S Outbound) — pulled from
// dev Supabase timetable_stops/stops for timetable 00000000-0000-0000-0000-000000000020.
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

async function openWindow({ url, windowPosition, windowSize, viewport, mute }) {
  const browser = await chromium.launch({
    headless: false,
    args: [`--window-size=${windowSize}`, `--window-position=${windowPosition}`],
  });
  const context = await browser.newContext({
    viewport,
    geolocation: { latitude: STOPS[0].lat, longitude: STOPS[0].lon },
    permissions: ['geolocation'],
  });
  if (mute) {
    // Set before first load so the mute button already reflects it and no
    // announcement gets spoken here — this window is a silent text mirror.
    await context.addInitScript(() => localStorage.setItem('psvair-muted', '1'));
  }
  const page = await context.newPage();

  // The dev server's first response can race the browser's own initial
  // request and get aborted (net::ERR_ABORTED) — harmless, just retry.
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.log(`Navigation attempt ${attempt} failed (${err.message.split('\n')[0]}), retrying…`);
      await sleep(500);
    }
  }
  return { browser, context, page };
}

(async () => {
  const [driver, onboard] = await Promise.all([
    openWindow({
      url: DUTY_URL, mute: false,
      windowPosition: '40,60', windowSize: '430,900', viewport: { width: 414, height: 812 },
    }),
    openWindow({
      url: ONBOARD_URL, mute: true,
      // Landscape, ~16:10 — same proportions as the real Fire HD 10 target device.
      windowPosition: '490,60', windowSize: '960,620', viewport: { width: 944, height: 560 },
    }),
  ]);

  console.log('Two windows are open, side by side.');
  console.log(`LEFT  (driver PWA): click through the duty card, pick "${STOPS[0].name}"`);
  console.log('       as the starting stop, and hit Start.');
  console.log('RIGHT (onboard sign): nothing to click — it polls for the journey to start');
  console.log('       and wakes on its own within a few seconds of you hitting Start.');
  console.log('Waiting for both to start…');

  await Promise.all([
    driver.page.waitForSelector('#tracker:not([hidden])', { timeout: 10 * 60 * 1000 }),
    onboard.page.waitForSelector('#onboard-sign:not([hidden])', { timeout: 10 * 60 * 1000 }),
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
        onboard.context.setGeolocation(pos),
      ]);
      await sleep((SECONDS_PER_STOP * 1000) / SUB_STEPS);
    }
    console.log(`→ ${to.name}`);
  }

  console.log('\nRoute complete — arrived at Boston College. Windows stay open;');
  console.log('close them manually (or Ctrl+C this script) when the demo is done.');
})().catch((err) => {
  console.error('\n=== demo-drive.mjs failed ===');
  console.error(err);
  process.exitCode = 1;
});
