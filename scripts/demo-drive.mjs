// Live-demo GPS simulator for the PSVAIR next-stop announcements feature.
//
// Not part of the app — this drives three real, visible Chromium windows
// with mocked Geolocation so a presenter can show the driver PWA (with
// audio), the Fire HD 10 onboard passenger sign, and the 16:3 ultra-wide
// onboard sign (both silent, text-only mirrors of the same announcements)
// all updating together, while the ops dashboard's Live Tracking map
// updates in parallel in a normal browser tab, all without a real moving
// vehicle.
//
// Usage:
//   node scripts/demo-drive.mjs <duty-url> [secondsPerStop]
//
// Example:
//   node scripts/demo-drive.mjs "http://localhost:8080/?duties=2d2f26b1-31b9-434b-a858-e614a53599b5" 7
//
// Three windows open, all already positioned at the first stop:
//   - TOP LEFT:  the driver PWA duty-card link you pass in. Click through
//                the duty card, pick the FIRST stop as the starting point,
//                hit Start.
//   - TOP RIGHT: the onboard passenger sign (onboard.html?journey=<id>),
//                Fire HD 10 landscape proportions (~16:10).
//   - BOTTOM:    the same onboard sign in a 16:3 ultra-wide window spanning
//                underneath both, so its CSS media-query breakpoint flips
//                it into the three-column zone layout — see
//                docs/onboard-widescreen-layout.md.
// Neither onboard window needs interaction — both poll get_duty_card for
// that journey and wake on their own within a few seconds of the driver
// hitting Start on the left. The simulator waits for all three, then
// drives the route in lockstep. Only the driver PWA window produces
// audio — both onboard windows are muted via localStorage before they
// load, so they don't talk over each other or the driver; their on-screen
// text still updates from the same simulated GPS feed.

import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

// context.pages()[0] can race the --app= window's real navigation and grab
// a transient about:blank page instead — when that happens the actual app
// window is left undiscovered/uncontrolled by this script (and shows up on
// screen still wearing normal Chrome UI, since Playwright never applied
// permissions/geolocation/mute to it). Poll for a page whose origin
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
  // address bar, just the page content and a thin native title bar. Plain
  // chromium.launch()+newContext() (the old approach) always shows full
  // browser chrome in headed mode and also emulates a *virtual* viewport
  // on top of the real window — under Windows display scaling those two
  // sizes can diverge, which is why content rendered at the wrong size
  // before. viewport: null here means "no emulation, use the real window."
  const userDataDir = mkdtempSync(join(tmpdir(), 'demo-drive-'));
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
    // Silent text mirror — set before the sign starts polling so no
    // announcement gets spoken here.
    await page.evaluate(() => localStorage.setItem('psvair-muted', '1')).catch(() => {});
  }
  // --app=<url> starts navigating the instant Chromium's process starts,
  // racing ahead of the geolocation permission grant and (if set) the mute
  // flag above. Reload so this window's real first paint happens after
  // both are already in place.
  await page.reload({ waitUntil: 'domcontentloaded' });
  return { context, page };
}

(async () => {
  const [driver, onboardTablet, onboardWide] = await Promise.all([
    openWindow({
      url: DUTY_URL, mute: false,
      // --window-size/-position are in the same logical coordinate space as
      // window.screen (confirmed empirically — NOT physical pixels; a
      // 1920x1080 panel at 150% Windows scaling reports as 1280x720 here).
      // Adjust these three windows if your primary display's logical
      // resolution differs — check with (Get-CimInstance
      // Win32_VideoController) vs a quick Playwright window.screen probe.
      // Left, full-height, real phone proportions (~326x613 viewport) —
      // the driver PWA's fixed-size #app-brand mark (style.css) is
      // deliberately NOT viewport-scaled, since it's meant to look
      // consistent across real phones of any size, not one fixed kiosk
      // resolution like the onboard sign. It needs real phone-scale room
      // to sit clear of duty-card content without overlapping.
      windowPosition: '20,20', windowSize: '340,650',
    }),
    openWindow({
      url: ONBOARD_URL, mute: true,
      // Top-right, landscape — same proportions as the Fire HD 10 target device.
      windowPosition: '380,20', windowSize: '880,340',
    }),
    openWindow({
      url: ONBOARD_URL, mute: true,
      // Bottom-right, under the Fire HD window only (not under the taller
      // driver column) — ~4.3:1 clears the onboard.css
      // `min-aspect-ratio: 4/1` breakpoint so this window shows the
      // ultra-wide three-column layout instead of the default vertical one
      // above it. Narrower than an ideal destination-board strip since it's
      // sharing the screen with a realistically-sized driver phone.
      windowPosition: '380,380', windowSize: '880,237',
    }),
  ]);

  console.log('Three windows are open.');
  console.log(`TOP LEFT  (driver PWA):     click through the duty card, pick "${STOPS[0].name}"`);
  console.log('           as the starting stop, and hit Start.');
  console.log('TOP RIGHT (Fire HD sign):   nothing to click.');
  console.log('BOTTOM    (16:3 wide sign): nothing to click.');
  console.log('Both onboard windows poll for the journey to start and wake on their own');
  console.log('within a few seconds of you hitting Start.');
  console.log('Waiting for all three to start…');

  await Promise.all([
    driver.page.waitForSelector('#tracker:not([hidden])', { timeout: 10 * 60 * 1000 }),
    onboardTablet.page.waitForSelector('#onboard-sign:not([hidden])', { timeout: 10 * 60 * 1000 }),
    onboardWide.page.waitForSelector('#onboard-sign:not([hidden])', { timeout: 10 * 60 * 1000 }),
  ]);
  console.log('All three started — driving the route now.\n');

  for (let i = 1; i < STOPS.length; i++) {
    const from = STOPS[i - 1];
    const to = STOPS[i];
    for (let s = 1; s <= SUB_STEPS; s++) {
      const t = s / SUB_STEPS;
      const pos = { latitude: lerp(from.lat, to.lat, t), longitude: lerp(from.lon, to.lon, t) };
      await Promise.all([
        driver.context.setGeolocation(pos),
        onboardTablet.context.setGeolocation(pos),
        onboardWide.context.setGeolocation(pos),
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
