// tests/brandTokens.test.js
//
// brand-tokens.css is the single source of truth for PCV Technologies'
// brand colours and typeface (see docs/BRAND.md). manifest.json and the two
// root HTML files' <meta name="theme-color"> / Google Fonts <link> are
// static, with no build step, so they can't import the CSS token — this
// guards them from drifting out of sync with it instead.

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

// --pcv-font-sans's first (quoted) font name, Google-Fonts-URL-encoded, e.g.
// "'Plus Jakarta Sans', ..." → "Plus+Jakarta+Sans".
const pcvFontUrlName = readToken('--pcv-font-sans')
  .match(/'([^']+)'/)[1]
  .replace(/ /g, '+');

describe.each(['index.html', 'onboard.html'])('%s Google Fonts link matches brand-tokens.css', (file) => {
  const html = fs.readFileSync(path.join(root, file), 'utf8');

  test('font <link> href names the same family as --pcv-font-sans', () => {
    const match = html.match(/<link href="(https:\/\/fonts\.googleapis\.com\/css2\?family=[^"]+)"/);
    expect(match).not.toBeNull();
    expect(match[1]).toContain(pcvFontUrlName);
  });
});

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
