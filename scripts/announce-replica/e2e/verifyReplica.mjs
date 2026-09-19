// End-to-end verification of the replica harness in headless Chromium.
// Starts the harness server, emulates the review laptop in fullscreen
// (1920x1080 device px at 150% = 1280x720 CSS px), steps every sign state in
// both sizing modes, asserts the geometry, and writes screenshots + a JSON
// report of measured sizes (mm) and layout flags.
//
//   node e2e/verifyReplica.mjs --busops <path to pcv-dashboard/busops> [--out ./replica-captures]
//
// Read-only against the sign. Needs Playwright (already a busops devDependency).

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startReplicaServer } from '../src/replicaServer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : undefined; };
const busopsDir = resolve(arg('busops') ?? join(here, '../../../pcv-dashboard/busops'));
const outDir = resolve(arg('out') ?? join(here, '..', 'replica-captures'));
mkdirSync(outDir, { recursive: true });

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  // The sign's own package (pcv-dashboard/busops) lists Playwright as a devDependency.
  try { return createRequire(join(busopsDir, 'package.json'))('playwright'); } catch { /* fall through */ }
  const require = createRequire(import.meta.url);
  return require(join(execSync('npm root -g').toString().trim(), 'playwright'));
}
const { chromium } = await loadPlaywright();

const srv = await startReplicaServer({ busopsDir, replicaDir: join(here, '..', 'replica'), libDir: join(here, '..', 'src'), port: 0 });
const browser = await chromium.launch();
const failures = [];
const check = (name, fn) => { try { fn(); console.log(`  ok   ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}: ${e.message}`); } };
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `expected ${b} +/- ${tol}, got ${a}`);

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  const problems = [];
  // Known, expected noise: the service worker is deliberately not served, the
  // Google font may be unreachable from a sandbox, and the sign warns that no
  // feed token is present (it is driven by mock messages here).
  const expected = /ServiceWorker|service-worker|bad HTTP response code \(404\)|fonts\.g|ERR_TUNNEL|no \?announce-token|Failed to load resource|supabase\.min\.js|MIME type/;
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (['error'].includes(m.type()) && !expected.test(m.text())) problems.push(`console: ${m.text()}`); });

  await page.goto(`http://127.0.0.1:${srv.port}/?hud=${arg('hud') === '1' ? 1 : 0}`);
  await page.waitForFunction(() => window.__replicaReady === true, null, { timeout: 30000 });

  console.log('Geometry');
  const geo = await page.evaluate(() => {
    const w = document.getElementById('wrap').getBoundingClientRect();
    const f = window.__replica.frame();
    return { wDev: w.width * devicePixelRatio, hDev: w.height * devicePixelRatio, fits: f.fits, scale: f.cssScale };
  });
  check('frame is 289 mm wide on the laptop (about 1661 device px)', () => near(geo.wDev, 1661.3, 1));
  check('frame fits the 1920x1080 screen at true size', () => assert.equal(geo.fits, true));

  const report = {};
  const MODES = ['deployed', 'x22', 'compact', 'proposed', 'large'];
  for (const sizing of MODES) {
    await page.evaluate((s) => window.__replica.setSizing(s), sizing);
    const list = await page.evaluate(() => window.__replica.scenarios.map((s) => s.id));
    for (let i = 0; i < list.length; i++) {
      await page.evaluate((n) => window.__replica.applyScenario(n), i);
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => window.__replica.measure());
      (report[sizing] ??= {})[m.scenario] = m;
      await page.screenshot({ path: join(outDir, `${sizing}-${String(i).padStart(2, '0')}-${m.scenario}.png`) });
    }
  }

  console.log('Sign fidelity (the harness must reproduce the tablet exactly)');
  check('sign viewport is exactly 1442x901 in every state', () => {
    for (const mode of Object.values(report)) for (const m of Object.values(mode)) assert.deepEqual(m.viewport, { w: 1442, h: 901 });
  });
  check('deployed --min-text is 11.675vh (the live tablet capture)', () => {
    near(parseFloat(report.deployed['next-three-line'].minText), 11.675, 0.005);
  });
  check('deployed Line 2/3 font is 105.2 px', () => {
    for (const r of report.deployed['next-three-line'].rows.filter((r) => r.verdict)) near(r.fontPx, 105.2, 0.2);
  });
  check('three-line scenarios expose Line 2 and Line 3; sentence scenarios expose the sentence', () => {
    const rows = (id) => report.deployed[id].rows.map((r) => r.name);
    assert.ok(rows('next-three-line').includes('Line 2 (town)') && rows('next-three-line').includes('Line 3 (stop)'));
    assert.ok(rows('next-single-line').includes('Sentence headline'));
  });

  console.log('22 mm lowercase mode');
  check('Line 2/3 lowercase x-height is 22 mm in every three-line state', () => {
    for (const id of ['next-three-line', 'this-is-three-line', 'this-is-early-wait', 'long-stop-line', 'long-town-line']) {
      for (const r of report.x22[id].rows.filter((r) => r.verdict)) { near(r.xHeightMm, 22, 0.1); assert.equal(r.verdict.pass, true); }
    }
  });

  console.log('Candidate layouts (compact / proposed / large)');
  const THREE = ['route-start', 'next-three-line', 'this-is-three-line', 'this-is-early-wait', 'long-stop-line', 'long-town-line'];
  for (const tier of ['compact', 'proposed', 'large']) {
    check(`${tier}: Line 2/3 lowercase x-height is 22 mm in every three-line state`, () => {
      for (const id of THREE) {
        const rows = report[tier][id].rows.filter((r) => r.verdict);
        assert.equal(rows.length, 2, `${id} should expose Line 2 and 3`);
        for (const r of rows) { near(r.xHeightMm, 22, 0.1); assert.equal(r.verdict.pass, true); }
      }
    });
    check(`${tier}: no collisions or clipping in the plain three-line states`, () => {
      for (const id of ['route-start', 'next-three-line', 'this-is-three-line']) {
        const bad = report[tier][id].flags.filter((f) => f.type !== 'scrolling');
        assert.deepEqual(bad, [], `${id}: ${JSON.stringify(bad)}`);
      }
    });
    if (tier !== 'large') {
      check(`${tier}: every one of the 10 states is free of collisions and clipping`, () => {
        for (const [id, m] of Object.entries(report[tier])) {
          const bad = m.flags.filter((f) => f.type !== 'scrolling');
          assert.deepEqual(bad, [], `${id}: ${JSON.stringify(bad)}`);
        }
      });
    }
    check(`${tier}: top bar text is well above today's 29 px`, () => {
      const r = report[tier]['next-three-line'].rows.find((x) => x.name === 'Top bar: destination');
      assert.ok(r.fontMm >= 10, `${r.fontMm} mm`);
    });
  }
  console.log('Line 1 is fixed (owner, 2026-09-19)');
  for (const tier of ['compact', 'proposed', 'large']) {
    check(`${tier}: Line 1 depth is identical in every three-line state, including the wait box`, () => {
      const depths = THREE.map((id) => report[tier][id].line1?.heightPx);
      assert.ok(depths.every((d) => typeof d === 'number'), JSON.stringify(depths));
      near(Math.max(...depths) - Math.min(...depths), 0, 0.5);
    });
    check(`${tier}: Line 1 text is the same size as the top bar text`, () => {
      const rows = report[tier]['next-three-line'].rows;
      const bar = rows.find((r) => r.name === 'Top bar: destination').fontPx;
      const l1 = rows.find((r) => r.name.startsWith('Line 1')).fontPx;
      near(l1, bar, 0.2);
    });
    check(`${tier}: route start is three lines: "This is an S116T to" / Boston / Bus Station`, () => {
      const rows = report[tier]['route-start'].rows;
      assert.equal(rows.find((r) => r.name.startsWith('Line 1'))?.text, 'This is an S116T to');
      assert.equal(rows.find((r) => r.name === 'Line 2 (town)')?.text, 'Boston');
      assert.equal(rows.find((r) => r.name === 'Line 3 (stop)')?.text, 'Bus Station');
      assert.ok(!rows.some((r) => r.name === 'Sentence headline'));
    });
    check(`${tier}: terminus and diversion keep the larger sentence size`, () => {
      for (const id of ['terminus', 'diversion']) {
        const rows = report[tier][id].rows;
        const top = rows.find((r) => r.name === 'Top bar: destination')?.fontPx ?? 0;
        assert.ok(rows.find((r) => r.name === 'Sentence headline').fontPx > top * 1.4, id);
      }
    });
  }
  console.log('  (information, not asserted) layout flags per candidate and state:');
  for (const tier of ['deployed', 'compact', 'proposed', 'large']) {
    for (const [id, m] of Object.entries(report[tier])) {
      if (m.flags.length) console.log(`    ${tier.padEnd(9)} ${id.padEnd(20)} ${m.flags.map((f) => `${f.type}:${f.name ?? f.names.join('/')}`).join(', ')}`);
    }
  }

  console.log('Stop-name measuring (the canvas measurement must match what the sign really renders)');
  const probe = await page.evaluate(async () => {
    const r = window.__replica;
    const m = await r.measureLines(['Market Place', 'Donington']);
    const d = document.getElementById('sign').contentDocument;
    const track = d.querySelector('.hl-stop .hl-marquee-track');
    const real = track.getBoundingClientRect().width;
    return { canvas: m.widths['Market Place'], real, text: track.textContent, avail: m.availablePx, x: m.xHeightMm };
  });
  check('canvas width of "Market Place" matches the rendered line within 1 px', () => { assert.equal(probe.text, 'Market Place'); near(probe.canvas, probe.real, 1); });
  check('the line a stop name must fit in is about 1370 px (1442 less 2.5vw padding each side)', () => near(probe.avail, 1370, 4));
  check('measuring happens at 22 mm x-height', () => near(probe.x, 22, 0.1));

  console.log('Ruler check');
  await page.keyboard.press('k');
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(outDir, 'ruler-check.png') });
  const bars = await page.evaluate(() => {
    const ls = [...document.querySelectorAll('#calib svg line')].filter((l) => l.getAttribute('stroke-width') === '3');
    const d = (l, a, b) => (l.getAttribute(b) - l.getAttribute(a)) * devicePixelRatio;
    return { h: d(ls[0], 'x1', 'x2'), v: d(ls[1], 'y1', 'y2') };
  });
  check('both ruler bars are 100 mm (574.85 device px at 5.7485 px/mm)', () => { near(bars.h, 574.85, 0.5); near(bars.v, 574.85, 0.5); });

  console.log('Hygiene');
  check('no unexpected page errors', () => assert.deepEqual(problems, []));

  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nScreenshots and report.json written to ${outDir}`);
} finally {
  await browser.close();
  await srv.close();
}
if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log('\nAll checks passed');
