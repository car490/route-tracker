// tests/brandTokens.test.js
//
// brand-tokens.css is the single source of truth for PCV Technologies'
// brand colours (see docs/BRAND.md). manifest.json and index.html's
// <meta name="theme-color"> are static files with no build step, so they
// can't import the CSS token — this guards them from drifting out of sync
// with it instead.

import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');

function readToken(name) {
  const css = fs.readFileSync(path.join(root, 'brand-tokens.css'), 'utf8');
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`brand-tokens.css: token ${name} not found`);
  return match[1].trim();
}

const pcvCharcoal = readToken('--pcv-color-charcoal');

describe('manifest.json colours match brand-tokens.css', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

  test('theme_color matches --pcv-color-charcoal', () => {
    expect(manifest.theme_color.toUpperCase()).toBe(pcvCharcoal.toUpperCase());
  });

  test('background_color matches --pcv-color-charcoal', () => {
    expect(manifest.background_color.toUpperCase()).toBe(pcvCharcoal.toUpperCase());
  });
});

describe('index.html theme-color meta matches brand-tokens.css', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  test('meta theme-color matches --pcv-color-charcoal', () => {
    const match = html.match(/<meta name="theme-color" content="([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match[1].toUpperCase()).toBe(pcvCharcoal.toUpperCase());
  });
});
