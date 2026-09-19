// End-to-end proof of the tablet capture tool, in headless Chromium at the tablet's own
// viewport (1442 x 901 CSS px = 289 x 180 mm). It drives the REAL sign through every state,
// probes it exactly as the tool probes the tablet, and judges the result with the same
// evaluator. Then it runs the actual CLI over a real DevTools connection, so the CDP
// path is exercised end to end. Written BEFORE the probe and the CLI (TDD).
//
//   node e2e/verifyTabletProbe.mjs [--busops <path to pcv-dashboard/busops>]
//
// The adb half (finding the tablet, forwarding its DevTools socket) cannot run without a
// device; its parsers are unit-tested (src/tabletAdb.test.mjs) and it was checked live
// against the real tablet.

import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startReplicaServer } from '../src/replicaServer.mjs';
import { SCENARIOS, buildScenarioMessages } from '../src/replicaLogic.mjs';
import { evaluateTabletReport } from '../src/tabletReport.mjs';
import { probeSign } from '../src/tabletProbe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : undefined; };
const busopsDir = resolve(arg('busops') ?? join(here, '../../../pcv-dashboard/busops'));
const cli = resolve(here, '../../measure-announce-solo.mjs');
const { chromium } = createRequire(join(busopsDir, 'package.json'))('playwright');

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});

const failures = [];
const check = (name, fn) => { try { fn(); console.log(`  ok   ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}: ${e.message}`); } };

const srv = await startReplicaServer({ busopsDir, replicaDir: join(here, '..', 'replica'), libDir: join(here, '..', 'src'), port: 0 });
const cdpPort = await freePort();
const browser = await chromium.launch({ args: [`--remote-debugging-port=${cdpPort}`] });

try {
  const ctx = await browser.newContext({ viewport: { width: 1442, height: 901 } });
  const page = await ctx.newPage();
  const problems = [];
  // Known, expected noise: no service worker or relay is served here (the sign tries its /sign-feed
  // WebSocket because the test URL carries a fake token), and the Google font may be unreachable.
  const expected = /ServiceWorker|service-worker|bad HTTP response code \(404\)|fonts\.g|ERR_TUNNEL|no \?announce-token|Failed to load resource|supabase\.min\.js|MIME type|WebSocket connection to .*\/sign-feed/;
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !expected.test(m.text())) problems.push(`console: ${m.text()}`); });

  // The real sign, opened directly (no harness wrapper), with the Solo tablet's profile.
  await page.goto(`http://127.0.0.1:${srv.port}/announce/onboard.html?panel-profile=lite&announce-token=SECRET-TOKEN-MUST-NOT-APPEAR`);
  await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 30000 });
  await page.waitForTimeout(800); // the sign re-applies its sizing when the web font finishes loading

  const show = async (scenario) => {
    const m = buildScenarioMessages(scenario, Date.now());
    await page.evaluate(async (m) => {
      const api = await import('/announce/src/onboard.js'); // same module instance the page already loaded
      if (m.journeyEnd) api.onJourneyEnd();
      else { api.onSchedule(m.schedule); api.onState(m.state); }
    }, m);
    await page.waitForTimeout(500);
  };

  console.log('Probe + evaluate the real sign in every state (tablet viewport, 180 mm lit height)');
  const reports = {};
  for (const scenario of SCENARIOS) {
    await show(scenario);
    const report = await page.evaluate(probeSign);
    const result = evaluateTabletReport(report, { litHeightMm: 180 });
    reports[scenario.id] = { report, result };
    check(`${scenario.id}: every check passes`, () => {
      const bad = result.checks.filter((c) => c.status === 'fail').map((c) => `${c.name} [${c.detail}]`);
      assert.deepEqual(bad, []);
    });
  }

  console.log('  (information) Line 1 centring, mm on the letters, per three-line state:');
  for (const [id, { result }] of Object.entries(reports)) {
    const c = result.checks.find((x) => x.name.includes('centred'));
    if (c) console.log(`    ${id.padEnd(20)} ${c.detail}`);
  }
  console.log('What the probe measured');
  const three = reports['next-three-line'];
  check('three-line: the drawn "x" is at least 22.0 mm by pixels, near the 22.1 aim', () => {
    const c = three.result.checks.find((x) => x.name.includes('by pixels'));
    assert.ok(c, 'no pixel check made');
    const mmValue = parseFloat(c.detail);
    assert.ok(mmValue >= 22.0 && Math.abs(mmValue - 22.1) <= 0.15, c.detail);
  });
  check('three-line: the shortest lowercase letter is at least 22.0 mm (no slack)', () => {
    const c = three.result.checks.find((x) => x.name.includes('shortest lowercase'));
    assert.ok(c && c.status === 'pass', c?.detail);
  });
  check('state and shape are reported: stop_departure, three-line, sign shown', () => {
    assert.deepEqual(three.report.sign, { shown: true, dataState: 'stop_departure', threeLine: true });
  });
  check('idle is reported as idle with no glyph section', () => {
    assert.equal(reports.idle.result.state, 'idle');
    assert.equal(reports.idle.report.glyphs, null);
  });
  check('the wait box scenario reports the wait box rows', () => {
    const names = reports['this-is-early-wait'].report.rows.map((r) => r.name);
    assert.ok(names.includes('Wait box title') && names.includes('Wait box message'), names.join(', '));
  });

  console.log('A tablet that could not load the web font (offline): the fallback font must be detected and failed');
  {
    const offCtx = await browser.newContext({ viewport: { width: 1442, height: 901 } });
    const offPage = await offCtx.newPage();
    await offPage.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await offPage.goto(`http://127.0.0.1:${srv.port}/announce/onboard.html?panel-profile=lite`);
    await offPage.waitForTimeout(1500);
    const m = buildScenarioMessages(SCENARIOS.find((s) => s.id === 'next-three-line'), Date.now());
    await offPage.evaluate(async (m) => {
      const api = await import('/announce/src/onboard.js');
      api.onSchedule(m.schedule); api.onState(m.state);
    }, m);
    await offPage.waitForTimeout(500);
    const offReport = await offPage.evaluate(probeSign);
    const offResult = evaluateTabletReport(offReport, { litHeightMm: 180 });
    check('the probe reports the web font as NOT loaded', () => assert.equal(offReport.fontLoaded, false));
    check('the evaluator fails the run because a fallback font is showing', () => {
      const c = offResult.checks.find((x) => x.name.includes('web font loaded'));
      assert.equal(c?.status, 'fail');
      assert.equal(offResult.ok, false);
    });
    await offCtx.close();
  }

  console.log('Security and read-only behaviour');
  check('the report never contains the URL query (it carries the device token)', () => {
    const text = JSON.stringify(three.report);
    assert.ok(!text.includes('SECRET-TOKEN-MUST-NOT-APPEAR'), 'token leaked into the report');
    assert.ok(!three.report.url.includes('?'), three.report.url);
  });
  await show(SCENARIOS.find((s) => s.id === 'next-three-line'));
  const before = await page.evaluate(() => ({ html: document.documentElement.outerHTML.length, canvases: document.querySelectorAll('canvas').length, style: document.documentElement.getAttribute('style') }));
  await page.evaluate(probeSign);
  const after = await page.evaluate(() => ({ html: document.documentElement.outerHTML.length, canvases: document.querySelectorAll('canvas').length, style: document.documentElement.getAttribute('style') }));
  check('probing changes nothing in the page (no elements added, no styles touched)', () => assert.deepEqual(after, before));

  console.log('The CLI over a real DevTools connection (the same path the tablet uses after adb forwards it)');
  const beforeCli = await page.evaluate(() => ({ url: location.href, html: document.documentElement.outerHTML.length }));
  const out = mkdtempSync(join(tmpdir(), 'tablet-capture-'));
  const run = (extra) => spawnSync(process.execPath, [cli, '--cdp-port', String(cdpPort), '--out', out, ...extra], { encoding: 'utf8' });

  const ok = run(['--lit-height-mm', '180']);
  check('exit code 0 and a PASS summary for the correct lit height', () => {
    assert.equal(ok.status, 0, `${ok.stdout}\n${ok.stderr}`);
    assert.match(ok.stdout, /PASS/);
    assert.match(ok.stdout, /22\.\d\d mm/);
  });
  check('it wrote a report.json and a screenshot.png, and the report has no token', () => {
    const dirs = readdirSync(out);
    assert.equal(dirs.length, 1, dirs.join(','));
    const files = readdirSync(join(out, dirs[0]));
    assert.ok(files.includes('report.json') && files.includes('screenshot.png'), files.join(','));
    assert.ok(!readFileSync(join(out, dirs[0], 'report.json'), 'utf8').includes('SECRET-TOKEN-MUST-NOT-APPEAR'));
  });
  check('the lit height defaults to the Solo tablet profile (180 mm) when not given', () => {
    const r = run([]);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  });

  const wrong = run(['--lit-height-mm', '250']);
  check('a wrong lit height FAILS (exit 1): the tool can say no', () => {
    assert.equal(wrong.status, 1, `${wrong.stdout}\n${wrong.stderr}`);
    assert.match(wrong.stdout, /FAIL/);
  });

  const refused = spawnSync(process.execPath, [cli, '--cdp-port', '1', '--out', out], { encoding: 'utf8' });
  check('no DevTools endpoint gives a clear error and a non-zero exit, never a crash trace', () => {
    assert.notEqual(refused.status, 0);
    assert.doesNotMatch(refused.stderr + refused.stdout, /at .*\.mjs:\d+/);
  });

  console.log('Hygiene');
  check('no unexpected page errors', () => assert.deepEqual(problems, []));
  const afterCli = await page.evaluate(() => ({ url: location.href, html: document.documentElement.outerHTML.length, canvases: document.querySelectorAll('canvas').length }));
  check('the CLI never navigated or changed the page: same URL, same DOM size, no canvas left behind', () => {
    assert.equal(afterCli.url, beforeCli.url);
    assert.equal(afterCli.html, beforeCli.html);
    assert.equal(afterCli.canvases, 0);
  });
} finally {
  await browser.close();
  await srv.close();
}

if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log('\nAll checks passed');
