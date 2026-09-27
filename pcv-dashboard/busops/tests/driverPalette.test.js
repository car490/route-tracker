// tests/driverPalette.test.js
//
// Guards the Driver PWA's two display themes (light and dark, see
// docs/DECISIONS.md "Driver PWA display theme") against
// docs/ACCESSIBILITY_BRAND_PLAYBOOK.md:
//   - every text/background pair the stylesheet actually uses clears
//     WCAG 2.2 AA 4.5:1 in BOTH themes, and the on-time/early/late status
//     colours clear 7:1 on the status card, the thing a driver reads at a
//     glance;
//   - controls and state borders clear 3:1 (WCAG 1.4.11);
//   - colours live only in the two token blocks, so neither theme can drift
//     from what is measured here;
//   - brand cyan is gone from the Driver PWA (it fails on light surfaces,
//     playbook §3.4) and the system font replaces Plus Jakarta Sans, with no
//     Google Fonts request;
//   - no text is set below 12px (playbook §4 floor is 11px).

import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'driver', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'driver', 'index.html'), 'utf8');
const mapJs = fs.readFileSync(path.join(root, 'driver', 'src', 'map.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'driver', 'manifest.json'), 'utf8'));

const LIGHT_SELECTOR = ':root,\n:root[data-theme="light"] {';
const DARK_SELECTOR = ':root[data-theme="dark"] {';

function block(selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`style.css: token block "${selector}" not found`);
  const end = css.indexOf('}', start);
  return { start, end, body: css.slice(start + selector.length, end) };
}

function tokens(body) {
  const out = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

const light = tokens(block(LIGHT_SELECTOR).body);
const dark = tokens(block(DARK_SELECTOR).body);
const THEMES = { light, dark };

function luminance(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const STATUSES = ['on-time', 'early', 'late'];
const SURFACES = ['bg', 'surface', 'surface-2'];

// [foreground, background, minimum ratio]
const PAIRS = [
  ...SURFACES.flatMap((s) => ['text', 'text-muted', ...STATUSES].map((f) => [f, s, 4.5])),
  ...STATUSES.flatMap((st) => [
    [st, 'surface', 7],
    [st, `${st}-tint`, 7], // the status card's own background
    ['text', `${st}-tint`, 4.5],
    ['text-muted', `${st}-tint`, 4.5],
    ['on-status', st, 4.5],
  ]),
  ['on-accent', 'accent', 4.5],
  ['on-accent', 'accent-pressed', 4.5],
  ['accent', 'surface', 4.5],
  ...['bg', 'surface'].flatMap((s) => [
    ['border-strong', s, 3],
    ['focus', s, 3],
    ['accent', s, 3],
  ]),
  ['accent', 'progress-bg', 3],
];

describe.each(Object.keys(THEMES))('%s theme', (name) => {
  const t = THEMES[name];

  test.each(PAIRS)('%s on %s clears %s:1', (fg, bg, min) => {
    expect(t[fg]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(t[bg]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
  });
});

test('both themes define exactly the same tokens', () => {
  expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
});

test('no colour literals outside the two token blocks', () => {
  const lightBlock = block(LIGHT_SELECTOR);
  const darkBlock = block(DARK_SELECTOR);
  const outside = (css.slice(0, lightBlock.start) + css.slice(lightBlock.end, darkBlock.start) + css.slice(darkBlock.end))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  expect(outside.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(/g)).toBeNull();
});

test('brand cyan and the shared brand token file are not used by the Driver PWA', () => {
  expect(css).not.toMatch(/brand-cyan|pcv-color|brand-tokens\.css|#00B4D8/i);
});

test('the Driver PWA uses the system font and makes no Google Fonts request', () => {
  expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  expect(css).not.toMatch(/Plus Jakarta/);
  expect(light['font-sans']).toMatch(/^-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto/);
});

test('no text is set below 12px', () => {
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)(rem|px)/g)].map(([, n, unit]) =>
    unit === 'rem' ? Number(n) * 16 : Number(n)
  );
  expect(sizes.length).toBeGreaterThan(0);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
});

test('manifest colours come from the palette: ink toolbar, dark splash', () => {
  expect(manifest.theme_color.toUpperCase()).toBe(light.text.toUpperCase());
  expect(manifest.background_color.toUpperCase()).toBe(dark.bg.toUpperCase());
});

test('index.html starts with the ink toolbar colour until the theme script runs', () => {
  const match = html.match(/<meta name="theme-color" content="([^"]+)"/);
  expect(match).not.toBeNull();
  expect(match[1].toUpperCase()).toBe(light.text.toUpperCase());
});

test('the pre-paint theme script only ever sets light or dark', () => {
  const script = html.match(/<script>\s*\/\/ Theme before first paint[\s\S]*?<\/script>/);
  expect(script).not.toBeNull();
  expect(script[0]).toMatch(/busops\.driver\.theme/);
  expect(script[0]).toMatch(/=== 'light' \|\| \w+ === 'dark'/);
  expect(script[0]).not.toMatch(/innerHTML|location\.|document\.write/);
});

test('every page shows the BusOps Driver / From PCV Technologies mark and the theme button', () => {
  expect(html).toMatch(/<div id="app-brand"[^>]*>\s*<div class="bo-wordmark">BusOps <span class="bo-app">Driver<\/span><\/div>/);
  expect(html).toMatch(/<span class="cm-powered-by">From<\/span>\s*<span class="cm-wordmark">PCV Technologies<\/span>/);
  expect(html).toMatch(/<button id="theme-toggle"[^>]*type="button"/);
});

test('map marker colours are all light-palette values (the map tiles are light in both themes)', () => {
  const lightValues = new Set(Object.values(light).map((v) => v.toUpperCase()));
  const used = mapJs.match(/#[0-9A-Fa-f]{6}\b/g);
  expect(used.length).toBeGreaterThan(0);
  for (const hex of used) expect(lightValues).toContain(hex.toUpperCase());
});

test('past stops and completed duties are de-emphasised by colour, not opacity', () => {
  // Opacity silently takes text under 4.5:1 where the pair tests above can't see it.
  for (const selector of ['.stop-past', '.dc-route-completed']) {
    const rules = [...css.matchAll(new RegExp(`\\${selector}[^{]*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
    expect(rules.length).toBeGreaterThan(0);
    for (const body of rules) expect(body).not.toMatch(/opacity/);
  }
});

describe('version label', () => {
  test('is a styled element, not an inline-styled paragraph under the brand mark', () => {
    expect(html).toMatch(/<p id="app-version">v[\d.]+<\/p>/);
    expect(html).not.toMatch(/<p style=[^>]*>v[\d.]+<\/p>/);
  });

  test('sits fixed above the theme button, clear of the brand mark in the opposite corner', () => {
    const rule = css.match(/#app-version\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/position:\s*fixed/);
    expect(rule[1]).toMatch(/right:\s*1rem/);
    expect(rule[1]).not.toMatch(/left:/);
    expect(rule[1]).not.toMatch(/opacity/);
  });

  test("scripts/release.mjs's footer regex still finds exactly one version string", () => {
    // Mirrors the replace() in scripts/release.mjs; a second match would be
    // silently skipped and a zero match would leave the version stale.
    expect(html.match(/>v[^<]*?<\/p>/g)).toHaveLength(1);
  });
});
