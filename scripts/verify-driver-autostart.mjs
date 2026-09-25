// Repeatable end-to-end check of the Driver PWA's automatic mode
// (pcv-dashboard/busops/driver/src/autostart/, docs/DECISIONS.md "Driver
// automatic mode"): the real app and its real main.js wiring in headless
// Chromium, with simulated GPS. Only Supabase is stood in for, locally: no
// network, no dev or production data touched, no journey created anywhere.
//
// Scenarios (each a fresh browser):
//   auto-start  waiting screen -> offer -> 10 s countdown -> journey starts,
//               then a simulated drive through every stop to trip complete,
//               and the waiting screen comes back without re-offering it
//   not-now     the offer closes and is not offered again
//   change      the manual picker opens with the matched service selected,
//               and no offer appears over it
//   refused     the server refuses (cancelled today): nothing starts, nothing queued
//   duty-card   with a ?duties= link automatic mode never offers
//
// Usage (from pcv-dashboard/busops/):  npm run verify:autostart
// Exit 0 all passed, 1 a check failed. Takes about 2 minutes (it waits the
// real 5 s GPS check and 10 s countdown).

import { createRequire } from 'node:module';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const BUSOPS = fileURLToPath(new URL('../pcv-dashboard/busops/', import.meta.url));
const require = createRequire(BUSOPS + 'package.json');
const { chromium } = require('playwright');
const { handleRequest } = require(BUSOPS + 'server.js');

const PENDING_STARTS_KEY = 'busops.queue.pendingJourneyStarts'; // driver/src/localStore.js

// Test timetable: one Local Bus departure, due 5 minutes from now, running today.
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const at = (addMin) => {
  const d = new Date(now.getTime() + addMin * 60000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
};
const STOPS = [
  { seq: 1, name: 'Boston Bus Station (Bay 8)', lat: 52.9776, lon: -0.0253, time: at(5) },
  { seq: 2, name: 'Wyberton, opp Pincushion Inn', lat: 52.9550, lon: -0.0300, time: at(18) },
  { seq: 3, name: 'Donington, Cowley School', lat: 52.9050, lon: -0.2000, time: at(45) },
];
const ROWS = STOPS.map((s) => ({
  departure_id: 'dep-1', service_code: 'S116S', timetable_name: 'Boston – Donington', departure_time: STOPS[0].time,
  journey_type: ['Local Bus'], display_name: s.name, lat: s.lat, lon: s.lon, sequence: s.seq,
  days_of_week: [now.getDay() === 0 ? 7 : now.getDay()], school_term_time: false,
  timetable_stop_id: `ts-${s.seq}`, stop_id: `stop-${s.seq}`, stop_type: 'timing_point', scheduled_time: s.time, psvair_in_scope: false,
}));

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(handleRequest).listen(0, 'localhost', () => resolve(server));
  });
}

async function openApp(browser, base, { query = '', refuse = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    geolocation: { latitude: STOPS[0].lat, longitude: STOPS[0].lon },
    permissions: ['geolocation'],
  });
  await context.addInitScript(() => {
    localStorage.setItem('vehicleId', 'veh-1');
    localStorage.setItem('vehicleLabel', 'PH19 BUS');
  });
  const page = await context.newPage();
  const rpcs = [];
  await page.route((url) => !url.href.startsWith(base), async (route) => {
    const url = route.request().url();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/rpc/')) {
      const fn = url.split('/rpc/')[1].split('?')[0];
      rpcs.push({ fn, body: route.request().postDataJSON() });
      if (fn === 'get_or_create_manual_journey') {
        return refuse ? json({ message: 'service does not run on today' }, 400) : json([{ journey_id: 'jrn-1' }]);
      }
      if (fn === 'start_journey' || fn === 'complete_journey') return json(true);
      return json([]);
    }
    if (url.includes('/rest/v1/schedule_view')) {
      if (url.includes('departure_id=eq.dep-1')) return json(ROWS);
      return json(url.includes('offset=') && !url.includes('offset=0') ? [] : ROWS);
    }
    if (url.includes('/rest/v1/companies')) return json([{ name: 'Test Coaches' }]);
    if (url.includes('/rest/v1/')) return json(route.request().method() === 'GET' ? [] : {});
    return route.abort(); // nothing leaves the machine
  });
  await page.goto(`${base}/driver/index.html${query}`);
  return { context, page, rpcs };
}

const shown = (page, selector, ms) => page.waitForSelector(`${selector}:not([hidden])`, { timeout: ms }).then(() => true, () => false);
const offer = (page, ms = 9000) => shown(page, '#autostart-overlay', ms);

const SCENARIOS = {
  async 'auto-start'(browser, base) {
    const { context, page, rpcs } = await openApp(browser, base);
    const checks = {};
    checks['waiting screen says automatic start is on'] = await page.isVisible('#ndc-auto-note');
    checks['offer appears at the first stop'] = await offer(page);
    checks['offer names the service'] = (await page.textContent('#as-service')) === 'S116S · Boston – Donington';
    checks['journey starts by itself after the countdown'] = await shown(page, '#tracker', 15000);
    const start = rpcs.find((r) => r.fn === 'get_or_create_manual_journey');
    checks['started the matched departure for this vehicle'] = start?.body.p_timetable_departure_id === 'dep-1' && start?.body.p_vehicle_id === 'veh-1';
    checks['journey marked in progress'] = rpcs.some((r) => r.fn === 'start_journey');
    // Simulated drive through the remaining stops. gps.js takes one step
    // per GPS reading (arrive inside 50 m, dwell, depart beyond 75 m, next
    // stop), and an unchanged position produces no new reading, so the
    // drive sends a point between stops and a few slightly different
    // readings at each stop, like a real receiver.
    const readings = [];
    for (let i = 1; i < STOPS.length; i++) {
      const [a, b] = [STOPS[i - 1], STOPS[i]];
      readings.push({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 });
      for (const j of [0, 1, 2]) readings.push({ lat: b.lat + j * 0.00003, lon: b.lon });
    }
    for (const r of readings) {
      await context.setGeolocation({ latitude: r.lat, longitude: r.lon });
      await page.waitForTimeout(1200);
    }
    checks['trip completes at the last stop'] = await shown(page, '#trip-complete-overlay', 15000);
    checks['journey completed on the server'] = rpcs.some((r) => r.fn === 'complete_journey');
    await page.click('#trip-complete-ok-btn').catch(() => {});
    checks['waiting screen comes back'] = await shown(page, '#no-duty-card', 10000);
    await context.setGeolocation({ latitude: STOPS[0].lat, longitude: STOPS[0].lon });
    checks['the finished departure is not offered again'] = !(await offer(page, 8000));
    await context.close();
    return checks;
  },

  async 'not-now'(browser, base) {
    const { context, page, rpcs } = await openApp(browser, base);
    await offer(page);
    await page.click('#as-cancel');
    const checks = {
      'offer closes': await page.isHidden('#autostart-overlay'),
      'not offered again': !(await offer(page, 12000)),
      'nothing started': !rpcs.some((r) => r.fn === 'get_or_create_manual_journey'),
    };
    await context.close();
    return checks;
  },

  async change(browser, base) {
    const { context, page } = await openApp(browser, base);
    await offer(page);
    await page.click('#as-change');
    const checks = { 'manual picker opens': await shown(page, '#manual-picker', 5000) };
    checks['matched service preselected'] = await page
      .waitForFunction(() => document.getElementById('manual-service-select').value === 'S116S', null, { timeout: 5000 })
      .then(() => true, () => false);
    checks['matched period preselected'] = (await page.inputValue('#manual-period-select')) === `Boston – Donington (${STOPS[0].time.slice(0, 5)})`;
    checks['no offer over the picker'] = !(await offer(page, 7000));
    await context.close();
    return checks;
  },

  async refused(browser, base) {
    const { context, page } = await openApp(browser, base, { refuse: true });
    await offer(page);
    await page.click('#as-start-now');
    const checks = { 'plain message shown': await shown(page, '#as-message', 5000) };
    checks['message says to choose the service'] = /Choose the service yourself/.test(await page.textContent('#as-message'));
    checks['no journey started'] = !(await page.isVisible('#tracker'));
    checks['nothing queued'] = (await page.evaluate((k) => localStorage.getItem(k), PENDING_STARTS_KEY)) === null;
    await context.close();
    return checks;
  },

  async 'duty-card'(browser, base) {
    const { context, page } = await openApp(browser, base, { query: '?duties=jrn-9' });
    const checks = { 'never offers with a duty card': !(await offer(page, 9000)) };
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
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(10)}  ${label}`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll automatic-mode checks passed');
process.exitCode = failed ? 1 : 0;
