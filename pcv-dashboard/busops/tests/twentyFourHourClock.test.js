// tests/twentyFourHourClock.test.js
//
// Times are always 24-hour HH:MM (docs/DECISIONS.md "Time format"). Every
// clock time Driver and Announce show goes through shared/timeFormat.js's
// formatTime(); anything that hands the format to the device's language
// setting can show "03:15 PM" on a phone set to US English, which is how the
// Driver's stop list used to behave. This walks the app source and fails on
// any way back to that. The dashboard has the same guard
// (pcv-dashboard/src/shared/time/twentyFourHourClock.test.js).

import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const SCANNED = ['driver', 'announce', 'shared', 'service-worker.js', 'server.js'];
const SKIP_DIRS = new Set(['node_modules', 'lib', 'audio', 'icons']);
const HELPER = path.join('shared', 'timeFormat.js');

const RULES = [
  [/\.toLocaleTimeString\(/, 'use formatTime() from shared/timeFormat.js'],
  [/\bhour12\b/, 'use formatTime(); hour12:false can show midnight as 24:xx'],
  [/hourCycle\s*:\s*['"]h1[12]['"]/, '12-hour clock'],
  [/\.toLocale\w*String\(\s*(\)|\[\]|undefined\b)/, 'leaves the format to the device\'s language; pass \'en-GB\' or use formatTime()'],
  [/\bDate\([^)]*\)\.toLocaleString\(/, 'date and time together: use formatTime()'],
  [/\bhour\s*:\s*['"](2-digit|numeric)['"]/, 'formats a clock time by hand: use formatTime()'],
];

function sourceFiles(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const child = path.join(rel, e.name);
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : sourceFiles(child);
    return /\.(m?js|html)$/.test(e.name) && !/\.test\.m?js$/.test(e.name) ? [child] : [];
  });
}

const files = SCANNED.flatMap(sourceFiles).filter((f) => f !== HELPER);

describe('24-hour clock', () => {
  test('finds the app source to check', () => {
    expect(files).toEqual(expect.arrayContaining([
      path.join('driver', 'src', 'ui.js'),
      path.join('announce', 'src', 'onboard.js'),
      path.join('shared', 'gps.js'),
    ]));
  });

  test('no time is formatted outside shared/timeFormat.js or in 12-hour form', () => {
    const found = [];
    for (const file of files) {
      fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, i) => {
        for (const [pattern, why] of RULES) {
          if (pattern.test(line)) found.push(`${file}:${i + 1} ${why}\n    ${line.trim()}`);
        }
      });
    }
    expect(found).toEqual([]);
  });

  test('the helper itself pins the 24-hour cycle', () => {
    const helper = fs.readFileSync(path.join(root, HELPER), 'utf8');
    expect(helper).toMatch(/hourCycle:\s*'h23'/);
    expect(helper).not.toMatch(/hour12/);
  });

  test.each(['driver/index.html', 'announce/onboard.html'])('%s declares British English', (rel) => {
    expect(fs.readFileSync(path.join(root, rel), 'utf8')).toMatch(/<html lang="en-GB"/);
  });
});
