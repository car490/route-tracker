// Stop-name review: reads a saved copy of the stops table, measures every Line 2 / Line 3
// at the real 22 mm size in the real sign (headless Chromium via the harness), and writes
// a CSV to review in Excel plus a short summary.
//
//   node src/reviewStops.mjs --in data/stops-prod.pipe --busops <pcv-dashboard/busops> [--out ./stop-review]
//
// READ-ONLY: no database access (the input is a file you or Claude exported with a SELECT),
// nothing is written back anywhere except the output folder.

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startReplicaServer } from './replicaServer.mjs';
import { parsePipeRows, reviewStop, splitLikeSign, summarise, toCsv } from './stopNames.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : undefined; };
const inFile = arg('in');
if (!inFile) { console.error('usage: node src/reviewStops.mjs --in <stops.pipe> [--busops <dir>] [--out <dir>]'); process.exit(2); }
const busopsDir = resolve(arg('busops') ?? join(here, '../../../pcv-dashboard/busops'));
const outDir = resolve(arg('out') ?? join(here, '..', 'stop-review'));
mkdirSync(outDir, { recursive: true });

const rows = parsePipeRows(readFileSync(resolve(inFile), 'utf8'));

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  // The sign's own package (pcv-dashboard/busops) lists Playwright as a devDependency.
  try { return createRequire(join(busopsDir, 'package.json'))('playwright'); } catch { /* fall through */ }
  const require = createRequire(import.meta.url);
  return require(join(execSync('npm root -g').toString().trim(), 'playwright'));
}
const { chromium } = await loadPlaywright();
const srv = await startReplicaServer({ busopsDir, replicaDir: join(here, '..', 'replica'), libDir: here, port: 0 });
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 })).newPage();
  await page.goto(`http://127.0.0.1:${srv.port}/`);
  await page.waitForFunction(() => window.__replicaReady === true, null, { timeout: 30000 });

  const halves = new Set();
  for (const r of rows) {
    const s = splitLikeSign(r.announcementName ?? r.name);
    if (s.threeLine) { halves.add(s.town); halves.add(s.stop); }
  }
  const m = await page.evaluate((t) => window.__replica.measureLines(t), [...halves]);

  const reviews = rows.map((r) => {
    const s = splitLikeSign(r.announcementName ?? r.name);
    const widthsPx = s.threeLine ? { town: m.widths[s.town], stop: m.widths[s.stop] } : undefined;
    return reviewStop(r, { availablePx: m.availablePx, widthsPx });
  });
  const order = { error: 0, warn: 1, info: 2, ok: 3 };
  reviews.sort((a, b) => order[a.severity] - order[b.severity] || (a.effective ?? '').localeCompare(b.effective ?? ''));

  const stem = basename(inFile).replace(/\.[^.]+$/, '');
  writeFileSync(join(outDir, `${stem}-review.csv`), toCsv(reviews));
  const sum = summarise(reviews);
  const notes = {
    source: basename(inFile),
    measured: { availablePx: m.availablePx, fontPx: m.fontPx, xHeightMm: m.xHeightMm, fontLoaded: m.fontLoaded, family: m.family },
    ...sum,
  };
  writeFileSync(join(outDir, `${stem}-summary.json`), JSON.stringify(notes, null, 2));
  console.log(JSON.stringify(notes, null, 2));
  if (!m.fontLoaded) console.log('\nWARNING: Plus Jakarta Sans did not load here, so the widths use a fallback font. Re-run on the laptop for real widths.');
  console.log(`\nWrote ${join(outDir, `${stem}-review.csv`)}`);
} finally {
  await browser.close();
  await srv.close();
}
