/**
 * @jest-environment jsdom
 */
// tests/driverScreens.test.js
//
// Guards the Driver PWA's "every screen opens scrolled to the top" rule
// (driver/src/screens/scrollOnShow.js): a top-level screen added to
// index.html must be added to SCREEN_IDS too, or it would silently keep
// whatever scroll position the previous screen left behind.

import fs from 'fs';
import path from 'path';
import { SCREEN_IDS } from '../driver/src/screens/scrollOnShow.js';

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'driver', 'index.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(root, 'driver', 'src', 'main.js'), 'utf8');

// Body-level elements that start hidden but are not screens: a warning
// banner and two modal overlays drawn over whichever screen is showing.
const NOT_SCREENS = ['wakelock-warning', 'incident-overlay', 'trip-complete-overlay'];

// Top-level = a direct child of <body> (parsed, not guessed from indentation:
// #tracker's own children are not indented in index.html).
const body = new DOMParser().parseFromString(html, 'text/html').body;
const topLevelHidden = [...body.children].filter((el) => el.id && el.hidden).map((el) => el.id);

test('finds the top-level hidden elements in index.html', () => {
  expect(topLevelHidden.length).toBeGreaterThanOrEqual(SCREEN_IDS.length);
});

test('every top-level screen in index.html is watched by scrollOnShow', () => {
  const screens = topLevelHidden.filter((id) => !NOT_SCREENS.includes(id));
  expect([...screens].sort()).toEqual([...SCREEN_IDS].sort());
});

test('main.js wires the slice up and no longer relies on scrollIntoView', () => {
  expect(mainJs).toMatch(/import \{ initScrollOnShow \} from '\.\/screens\/scrollOnShow\.js';/);
  expect(mainJs).toMatch(/initScrollOnShow\(\)/);
  expect(mainJs).not.toMatch(/route-header'\)\.scrollIntoView/);
});
