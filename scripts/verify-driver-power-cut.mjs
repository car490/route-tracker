// Repeatable end-to-end check of how the Driver PWA comes back after a power
// cut (docs/HARDWARE.md "Power loss and first boot", docs/DECISIONS.md
// "Duty-card link through a power cut" and "Trip in progress through a power
// cut"): the real app and its real main.js wiring in headless Chromium, with
// simulated GPS. Only Supabase is stood in for, locally: no network, no dev
// or production data touched.
//
// A "power cut" here is what the tablet's browser sees when it restarts:
// the page is closed, a new one opens at the bare start URL (Fully Kiosk's
// startURL carries no ?token= or ?duties=), sessionStorage is gone and
// localStorage is kept.
//
// Scenarios (each a fresh browser):
//   mid-trip    duty-card trip, two stops reached, power cut, restart with
//               no signal: the trip is offered back at the right stop,
//               driven to the end, and on reconnect every stop time
//               (before and after the cut) uploads and the journey
//               completes; the finished shift clears the duty link
//   restart     power cut before any trip: the duty card comes back, and
//               the stored token is what reaches the server
//   stale       a trip saved more than 2 hours ago is not offered; its stop
//               times still upload, and the journey is not marked complete
//
// Usage (from pcv-dashboard/busops/):  npm run verify:power-cut
// Exit 0 all passed, 1 a check failed.

import { createRequire } from 'node:module';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const BUSOPS = fileURLToPath(new URL('../pcv-dashboard/busops/', import.meta.url));
const require = createRequire(BUSOPS + 'package.json');
const { chromium } = require('playwright');
const { handleRequest } = require(BUSOPS + 'server.js');

const CHECKPOINT_KEY = 'busops.driver.journeyCheckpoint'; // shared/journeyCheckpoint.js
const DUTY_LINK_KEY = 'busops.driver.dutyLink';           // driver/src/dutyLinkStore.js

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const at = (addMin) => {
  const d = new Date(now.getTime() + addMin * 60000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
};
const STOPS = [
  { seq: 1, name: 'Boston Bus Station (Bay 8)', lat: 52.9776, lon: -0.0253, time: at(0) },
  { seq: 2, name: 'Wyberton, opp Pincushion Inn', lat: 52.9550, lon: -0.0300, time: at(10) },
  { seq: 3, name: 'Donington, Cowley School', lat: 52.9050, lon: -0.2000, time: at(30) },
];
const ROWS = STOPS.map((s) => ({
  departure_id: 'dep-1', service_code: 'S116S', timetable_name: 'Boston – Donington', departure_time: STOPS[0].time,
  journey_type: ['Local Bus'], display_name: s.name, lat: s.lat, lon: s.lon, sequence: s.seq,
  days_of_week: [now.getDay() === 0 ? 7 : now.getDay()], school_term_time: false,
  timetable_stop_id: `ts-${s.seq}`, stop_id: `stop-${s.seq}`, stop_type: 'timing_point', scheduled_time: s.time, psvair_in_scope: false,
}));

// Structurally a JWT; the stand-in never checks the signature.
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const TOKEN = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ role: 'anon', journey_ids: ['jrn-1'], exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(handleRequest).listen(0, 'localhost', () => resolve(server));
  });
}

// Everything the stand-in received, and a switch for "no signal".
async function openContext(browser, base, { seed = null } = {}) {
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    geolocation: { latitude: STOPS[0].lat, longitude: STOPS[0].lon },
    permissions: ['geolocation'],
    serviceWorkers: 'block', // every Supabase request must reach the stand-in below
  });
  if (seed) await context.addInitScript(seed);
  const net = { down: false, dutyStatus: 'scheduled' };
  const seen = { rpcs: [], stopTimes: [], auth: [] };
  await context.route((url) => !url.href.startsWith(base), async (route) => {
    if (net.down) return route.abort('internetdisconnected');
    const req = route.request();
    const url = req.url();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    seen.auth.push(req.headers().authorization || '');
    if (url.includes('/rpc/')) {
      const fn = url.split('/rpc/')[1].split('?')[0];
      seen.rpcs.push({ fn, body: req.postDataJSON() });
      if (fn === 'get_duty_card') {
        return json([{
          journey_id: 'jrn-1', status: net.dutyStatus, driver_name: 'Test Driver', service_code: 'S116S',
          timetable_name: 'Boston – Donington', direction: 'Outbound', vehicle_registration: 'PH19 BUS',
          first_stop_time: STOPS[0].time.slice(0, 5), timetable_departure_id: 'dep-1',
          vehicle_id: 'veh-1', driver_id: 'drv-1',
        }]);
      }
      if (fn === 'start_journey') { net.dutyStatus = 'in_progress'; return json(true); }
      if (fn === 'complete_journey') { net.dutyStatus = 'completed'; return json(true); }
      if (fn === 'record_journey_stop_times') { const { p_rows } = req.postDataJSON(); seen.stopTimes.push(...p_rows); return json(p_rows.length); }
      return json([]);
    }
    if (url.includes('/rest/v1/schedule_view')) {
      if (url.includes('departure_id=eq.dep-1')) return json(ROWS);
      return json(url.includes('offset=') && !url.includes('offset=0') ? [] : ROWS);
    }
    if (url.includes('/rest/v1/companies')) return json([{ name: 'Test Coaches' }]);
    if (url.includes('/rest/v1/')) return json(req.method() === 'GET' ? [] : {});
    return route.abort(); // nothing leaves the machine
  });
  return { context, net, seen };
}

const shown = (page, selector, ms) => page.waitForSelector(`${selector}:not([hidden])`, { timeout: ms }).then(() => true, () => false);
const until = (fn, ms = 10000) => new Promise((resolve) => {
  const t0 = Date.now();
  const tick = () => (fn() ? resolve(true) : Date.now() - t0 > ms ? resolve(false) : setTimeout(tick, 200));
  tick();
});

// gps.js takes one step per GPS reading, and an unchanged position produces
// no new reading, so each stop gets a few slightly different readings, like
// a real receiver (same approach as verify-driver-autostart.mjs).
async function driveTo(context, page, from, to) {
  const readings = [];
  if (from) readings.push({ lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 });
  for (const j of [0, 1, 2]) readings.push({ lat: to.lat + j * 0.00003, lon: to.lon });
  for (const r of readings) {
    await context.setGeolocation({ latitude: r.lat, longitude: r.lon });
    await page.waitForTimeout(1200);
  }
}

const readStorage = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);

const SCENARIOS = {
  async 'mid-trip'(browser, base) {
    const { context, net, seen } = await openContext(browser, base);
    const checks = {};
    let page = await context.newPage();
    await page.goto(`${base}/driver/index.html?token=${TOKEN}&duties=jrn-1`);
    checks['duty card shows'] = await shown(page, '#duty-card', 10000);
    await page.click('.dc-action-btn');
    await shown(page, '#picker', 5000);
    await page.click('#start-btn');
    checks['trip starts'] = await shown(page, '#tracker', 5000);

    await driveTo(context, page, null, STOPS[0]);
    await driveTo(context, page, STOPS[0], STOPS[1]);
    const before = await readStorage(page, CHECKPOINT_KEY);
    const ids = (before?.stopRows ?? []).map((r) => r.timetable_stop_id);
    checks['stops 1 and 2 saved on the device before the cut'] = ids.includes('ts-1') && ids.includes('ts-2');
    const stop2Time = before?.stopRows?.find((r) => r.timetable_stop_id === 'ts-2')?.arrived_at;

    // Power cut, then the ignition comes back with no signal.
    await page.close();
    net.down = true;
    page = await context.newPage();
    await page.goto(`${base}/driver/index.html`);
    checks['the saved trip is offered back with no signal'] = await shown(page, '#picker', 10000);
    checks['screen says carry on your trip'] = (await page.textContent('#picker .picker-subtitle')) === 'Carry on your trip';
    checks['the stop it was at is pre-selected'] = (await page.inputValue('#stop-select')) === '1';
    await page.click('#start-btn', { timeout: 5000 }).catch(() => {});
    checks['trip carries on'] = await shown(page, '#tracker', 5000);

    await driveTo(context, page, STOPS[1], STOPS[2]);
    checks['trip ends at the last stop, saved for later'] = await shown(page, '#trip-complete-overlay', 15000)
      && /saved on this device/.test(await page.textContent('#trip-complete-modal .tc-body'));
    checks['nothing reached the server while offline'] = seen.stopTimes.length === 0;
    checks['saved trip removed once handed to the upload queue'] = (await readStorage(page, CHECKPOINT_KEY)) === null;

    // Signal returns.
    net.down = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    checks['every stop time uploads on reconnect'] = await until(() => ['ts-1', 'ts-2', 'ts-3']
      .every((id) => seen.stopTimes.some((r) => r.timetable_stop_id === id)));
    const stop2Rows = seen.stopTimes.filter((r) => r.timetable_stop_id === 'ts-2');
    checks['stop 2 keeps its real (pre-cut) arrival time'] = stop2Rows.length === 1 && stop2Rows[0].arrived_at === stop2Time;
    checks['journey completed on the server'] = seen.rpcs.some((r) => r.fn === 'complete_journey' && r.body.p_journey_id === 'jrn-1');

    await page.click('#trip-complete-ok-btn').catch(() => {});
    checks['duty card comes back, all done'] = await shown(page, '#duty-card', 10000);
    checks['end of shift clears the duty link'] = await page
      .waitForFunction((k) => localStorage.getItem(k) === null, DUTY_LINK_KEY, { timeout: 5000 })
      .then(() => true, () => false);
    await context.close();
    return checks;
  },

  async restart(browser, base) {
    const { context, seen } = await openContext(browser, base);
    let page = await context.newPage();
    await page.goto(`${base}/driver/index.html?token=${TOKEN}&duties=jrn-1`);
    await shown(page, '#duty-card', 10000);
    await page.close();
    seen.auth.length = 0;
    page = await context.newPage();
    await page.goto(`${base}/driver/index.html`);
    const checks = {
      'duty card comes back after a restart': await shown(page, '#duty-card', 10000),
      'the stored token is sent to the server': seen.auth.some((a) => a === `Bearer ${TOKEN}`),
      'token is not in the address bar': !page.url().includes('token='),
    };
    await context.close();
    return checks;
  },

  async stale(browser, base) {
    const savedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const checkpoint = {
      journeyId: 'jrn-old',
      launch: { allStops: ROWS.map((r) => ({ name: r.display_name, time: r.scheduled_time.slice(0, 5), timetable_stop_id: r.timetable_stop_id, lat: r.lat, lon: r.lon })), serviceCode: 'S116S' },
      stopRows: [{ journey_id: 'jrn-old', timetable_stop_id: 'ts-1', arrived_at: savedAt, visit_status: 'visited' }],
      nextStopIndex: 1,
      savedAt,
    };
    const { context, seen } = await openContext(browser, base, {
      seed: `if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('vehicleId', 'veh-1');
        localStorage.setItem('vehicleLabel', 'PH19 BUS');
        localStorage.setItem(${JSON.stringify(CHECKPOINT_KEY)}, ${JSON.stringify(JSON.stringify(checkpoint))});
      }`,
    });
    const page = await context.newPage();
    await page.goto(`${base}/driver/index.html`);
    const checks = {
      'an old saved trip is not offered': await shown(page, '#no-duty-card', 10000) && await page.isHidden('#picker'),
      'its stop times still upload': await until(() => seen.stopTimes.some((r) => r.journey_id === 'jrn-old')),
      'it is not marked complete': !seen.rpcs.some((r) => r.fn === 'complete_journey'),
      'it is removed from the device': (await readStorage(page, CHECKPOINT_KEY)) === null,
    };
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
console.log(failed ? `\n${failed} check(s) failed` : '\nAll power-cut checks passed');
process.exitCode = failed ? 1 : 0;
