// tests/serviceWorkerPrecache.test.js
//
// The Driver must keep working offline mid-shift, so every module in its
// newer slices (theme/, screens/, autostart/) and the shared matcher they
// use has to be in service-worker.js's STATIC_ASSETS. A module left out
// would fail to load the first time the device is offline after an update.
// Also catches a path listed twice (it happened while adding autostart/).

import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const assets = [...sw.match(/const STATIC_ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

function modulesIn(dir) {
  return fs.readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => `./${dir}/${f}`);
}

test('lists no path twice', () => {
  expect(assets.length).toBe(new Set(assets).size);
});

test.each(['driver/src/theme', 'driver/src/screens', 'driver/src/autostart'])('precaches every module in %s', (dir) => {
  for (const mod of modulesIn(dir)) expect(assets).toContain(mod);
});

test('precaches the shared schedule-autopilot matcher', () => {
  expect(assets).toContain('./shared/scheduleAutopilot.js');
});
