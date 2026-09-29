// Repeatable end-to-end check of how BusOps Announce Solo comes back after a
// power cut (docs/HARDWARE.md "Power loss and first boot", docs/DECISIONS.md
// "Announce Solo through a power cut"): the real onboard.html and its real
// Solo wiring in headless Chromium, with simulated GPS. Only Supabase is
// stood in for, locally (REST answered here, Realtime refused): no network,
// no dev or production data touched.
//
// A "power cut" is what the tablet's browser sees when it restarts: the
// page is closed and a new one opens at the same start URL (Fully Kiosk's
// startURL), sessionStorage gone, localStorage kept.
//
// Scenarios (each a fresh browser):
//   mid-trip   a trip started online, two stops reached, power cut, restart
//              with no signal: Solo starts from its offline copy, carries
//              the trip on from where GPS puts it ("The next stop is ..."),
//              finishes it, and on reconnect every stop time (before and
//              after the cut) uploads and the journey completes
//   offline    restart with no signal at the first stop: the departure is
//              recognised from the offline copy and starts on a journey id
//              made on the tablet; on reconnect that journey is created
//              and started on the server under the same id
//   revoked    running from the offline copy, signal returns and the server
//              refuses the device: the sign goes dark and the copy is deleted
//
// Usage (from pcv-dashboard/busops/):  npm run verify:solo-power-cut
// Exit 0 all passed, 1 a check failed. ONLY=<scenario> runs one scenario;
// DEBUG_PAGES=1 prints the tablet page's console.

import { createRequire } from 'node:module';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const BUSOPS = fileURLToPath(new URL('../pcv-dashboard/busops/', import.meta.url));
const require = createRequire(BUSOPS + 'package.json');
const { chromium } = require('playwright');
const { handleRequest } = require(BUSOPS + 'server.js');

const DEVICE_KEY = 'busops.announce.solo.device';           // announce/src/soloOfflineCache.js
const QUEUE_KEY = 'busops.announce.solo.queue';             // announce/src/soloTripQueue.js
const CHECKPOINT_KEY = 'busops.announce.solo.journeyCheckpoint'; // announce/src/announceSoloAutopilot.js

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const at = (addMin) => {
  const d = new Date(now.getTime() + addMin * 60000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
};
// Four stops on a straight road, ~1.1 km apart.
const STOPS = [
  { seq: 1, name: 'Depot', lat: 52.90, lon: -0.60, time: at(0) },
  { seq: 2, name: 'Market Place', lat: 52.91, lon: -0.60, time: at(5) },
  { seq: 3, name: 'High Street', lat: 52.92, lon: -0.60, time: at(10) },
  { seq: 4, name: 'College', lat: 52.93, lon: -0.60, time: at(15) },
];
const isoDow = now.getDay() === 0 ? 7 : now.getDay();
const ROWS = STOPS.map((s) => ({
  departure_id: 'dep-1', service_code: 'S125S', display_name: s.name, lat: s.lat, lon: s.lon,
  scheduled_time: s.time, sequence: s.seq, stop_type: 'timing_point',
  timetable_stop_id: `ts-${s.seq}`, stop_id: `stop-${s.seq}`,
  days_of_week: [isoDow], school_term_time: false,
}));
const DEVICE_ROW = {
  id: 'device-1', company_id: 'co-1', vehicle_id: null, label: 'Solo test', link_state: 'unlinked',
  gps_source: 'internal', latest_schedule: null, latest_state: null, state_updated_at: null,
  candidate_departure_ids: ['dep-1'], match_window_before_min: 15, match_window_after_min: 30,
  terminus_radius_m: 150, testing_mode: false, config_version: 1, pairing_secret: 'not-for-the-tablet',
  revoked_at: null,
};

// Structurally a JWT; the stand-in never checks the signature.
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const TOKEN = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ role: 'anon', device_id: 'device-1', company_id: 'co-1' })}.sig`;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(handleRequest).listen(0, 'localhost', () => resolve(server));
  });
}

async function openContext(browser, base) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    geolocation: { latitude: STOPS[0].lat, longitude: STOPS[0].lon, accuracy: 10 },
    permissions: ['geolocation'],
    serviceWorkers: 'block',
  });
  if (process.env.DEBUG_PAGES) context.on('console', (m) => console.log('  [page]', m.type(), m.text().slice(0, 200)));
  const net = { down: false, revoked: false, journeyId: 'jrn-1' };
  const seen = { rpcs: [], stopTimes: [] };
  await context.routeWebSocket(() => true, (ws) => ws.close()); // no Realtime: nothing leaves the machine
  await context.route((url) => !url.href.startsWith(base), async (route) => {
    if (net.down) return route.abort('internetdisconnected');
    const req = route.request();
    const url = req.url();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/rpc/')) {
      const fn = url.split('/rpc/')[1].split('?')[0];
      const body = req.postDataJSON();
      seen.rpcs.push({ fn, body });
      if (fn === 'record_journey_stop_times') { seen.stopTimes.push(...body.p_rows); return json(body.p_rows.length); }
      if (fn === 'get_or_create_manual_journey') return json([{ journey_id: net.journeyId ?? body.p_journey_id }]);
      return json(null);
    }
    if (url.includes('/rest/v1/announce_devices')) {
      if (net.revoked) return json({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' }, 406);
      return json(DEVICE_ROW);
    }
    if (url.includes('/rest/v1/schedule_view')) return json(ROWS);
    if (url.includes('/rest/v1/companies')) return json({ name: 'Test Coaches', logo_path: null, accent_color: null });
    if (url.includes('/rest/v1/')) return json(req.method() === 'GET' ? [] : {});
    return route.fulfill({ status: 404, body: '' }); // audio clips etc.: never leaves the machine
  });
  return { context, net, seen };
}

const startUrl = (base) => `${base}/announce/onboard.html?announce-device-token=${TOKEN}&panel-profile=lite`;
const shown = (page, selector, ms) => page.waitForSelector(`${selector}:not([hidden])`, { timeout: ms }).then(() => true, () => false);
const hidden = (page, selector, ms) => page.waitForSelector(`${selector}[hidden]`, { state: 'attached', timeout: ms }).then(() => true, () => false);
const headlineSays = (page, text, ms = 15000) => page
  .waitForFunction((t) => document.getElementById('sign-headline')?.textContent.includes(t), text, { timeout: ms })
  .then(() => true, () => false);
const storageItem = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const until = (fn, ms = 15000) => new Promise((resolve) => {
  const t0 = Date.now();
  const tick = () => (fn() ? resolve(true) : Date.now() - t0 > ms ? resolve(false) : setTimeout(tick, 250));
  tick();
});

// One step per GPS reading (see verify-driver-power-cut.mjs): a point
// between stops, then a few slightly different readings at the stop.
async function driveTo(context, page, from, to) {
  const readings = [];
  if (from) readings.push({ lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 });
  for (const j of [0, 1, 2]) readings.push({ lat: to.lat + j * 0.00003, lon: to.lon });
  for (const r of readings) {
    await context.setGeolocation({ latitude: r.lat, longitude: r.lon, accuracy: 10 });
    await page.waitForTimeout(1200);
  }
}

const ONLY = process.env.ONLY;
const SCENARIOS = {
  async 'mid-trip'(browser, base) {
    const { context, net, seen } = await openContext(browser, base);
    const checks = {};
    let page = await context.newPage();
    await page.goto(startUrl(base));
    checks['trip starts at the first stop'] = await shown(page, '#onboard-sign', 20000);
    checks['journey created on the server'] = seen.rpcs.some((r) => r.fn === 'start_journey' && r.body.p_journey_id === 'jrn-1');
    checks['offline copy kept, without the pairing secret'] = !JSON.stringify(await storageItem(page, DEVICE_KEY) ?? 'missing').includes('not-for-the-tablet')
      && (await storageItem(page, DEVICE_KEY)) !== null;

    await driveTo(context, page, null, STOPS[0]);
    await driveTo(context, page, STOPS[0], STOPS[1]);
    const saved = await storageItem(page, CHECKPOINT_KEY);
    const ids = (saved?.stopRows ?? []).map((r) => r.timetable_stop_id);
    checks['stops 1 and 2 saved on the tablet before the cut'] = ids.includes('ts-1') && ids.includes('ts-2');
    const stop2Time = saved?.stopRows?.find((r) => r.timetable_stop_id === 'ts-2')?.arrived_at;

    // Power cut; the vehicle carries on towards High Street while the tablet restarts with no signal.
    await page.close();
    net.down = true;
    await context.setGeolocation({ latitude: 52.915, longitude: -0.60, accuracy: 10 });
    page = await context.newPage();
    await page.goto(startUrl(base));
    checks['the trip is carried on with no signal'] = await shown(page, '#onboard-sign', 20000);
    checks['sign says the next stop is High Street'] = await headlineSays(page, 'High Street');

    await driveTo(context, page, { lat: 52.915, lon: -0.60 }, STOPS[2]);
    await driveTo(context, page, STOPS[2], STOPS[3]);
    checks['trip finishes, upload kept on the tablet'] = await page
      .waitForFunction((k) => (JSON.parse(localStorage.getItem(k)) ?? []).some((op) => op.type === 'trip'), QUEUE_KEY, { timeout: 15000 })
      .then(() => true, () => false);
    checks['nothing reached the server while offline'] = seen.stopTimes.length === 0;

    net.down = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    checks['every stop time uploads on reconnect'] = await until(() => ['ts-1', 'ts-2', 'ts-3', 'ts-4']
      .every((id) => seen.stopTimes.some((r) => r.timetable_stop_id === id)));
    const stop2Rows = seen.stopTimes.filter((r) => r.timetable_stop_id === 'ts-2');
    checks['stop 2 keeps its real (pre-cut) arrival time'] = stop2Rows.length === 1 && stop2Rows[0].arrived_at === stop2Time;
    checks['journey completed on the server'] = await until(() => seen.rpcs.some((r) => r.fn === 'complete_journey' && r.body.p_journey_id === 'jrn-1'));
    await context.close();
    return checks;
  },

  async offline(browser, base) {
    const { context, net, seen } = await openContext(browser, base);
    net.journeyId = null; // the server keeps whatever id the tablet sends
    let page = await context.newPage();
    // First boot online, away from the route, so the copy is kept but nothing starts.
    await context.setGeolocation({ latitude: 53.5, longitude: -1.5, accuracy: 10 });
    await page.goto(startUrl(base));
    await shown(page, '#onboard-idle', 20000);
    await page.waitForTimeout(2000); // let the departure copies be written
    await page.close();

    net.down = true;
    await context.setGeolocation({ latitude: STOPS[0].lat, longitude: STOPS[0].lon, accuracy: 10 });
    page = await context.newPage();
    await page.goto(startUrl(base));
    const checks = {
      // Within one idle tick (5 s) plus start-up: not after the client's
      // retries of a failed read have run out.
      'departure recognised and started with no signal': await shown(page, '#onboard-sign', 12000),
    };
    const queued = await storageItem(page, QUEUE_KEY) ?? [];
    const tabletId = queued[0]?.journeyId;
    checks['start queued on a tablet-made journey id'] = queued[0]?.type === 'start' && !!tabletId;

    net.down = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    checks['on reconnect the journey is created under that id'] = await until(() => seen.rpcs.some((r) => r.fn === 'get_or_create_manual_journey' && r.body.p_journey_id === tabletId));
    checks['and started'] = await until(() => seen.rpcs.some((r) => r.fn === 'start_journey' && r.body.p_journey_id === tabletId));
    await context.close();
    return checks;
  },

  async revoked(browser, base) {
    const { context, net } = await openContext(browser, base);
    let page = await context.newPage();
    await context.setGeolocation({ latitude: 53.5, longitude: -1.5, accuracy: 10 });
    await page.goto(startUrl(base));
    await shown(page, '#onboard-idle', 20000);
    await page.close();

    net.down = true;
    page = await context.newPage();
    await page.goto(startUrl(base));
    const checks = { 'runs from the offline copy with no signal': await shown(page, '#onboard-idle', 20000) };

    net.down = false;
    net.revoked = true;
    checks['sign goes dark once the server refuses the device'] = await hidden(page, '#onboard-idle', 15000);
    checks['offline copy deleted'] = await page
      .waitForFunction((k) => localStorage.getItem(k) === null, DEVICE_KEY, { timeout: 5000 })
      .then(() => true, () => false);
    await context.close();
    return checks;
  },
};

const server = await startServer();
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
  .catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
let failed = 0;
try {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    if (ONLY && name !== ONLY) continue;
    const checks = await scenario(browser, base);
    for (const [label, ok] of Object.entries(checks)) {
      if (!ok) failed += 1;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(8)}  ${label}`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll Solo power-cut checks passed');
process.exitCode = failed ? 1 : 0;
