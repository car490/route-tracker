// tests/brandTokens.test.js
//
// brand-tokens.css is the single source of truth for PCV Technologies'
// brand colours and typeface (see docs/BRAND.md). onboard.html's Google
// Fonts <link> is static, with no build step, so it can't import the CSS
// token — this guards it from drifting out of sync with it instead.
//
// The Driver PWA is a recorded exception (docs/DECISIONS.md "Driver PWA
// display theme"): system font, no brand cyan, its own light/dark palette.
// Its manifest/theme-color/font rules are guarded by driverPalette.test.js.

import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');

function readToken(name) {
  const css = fs.readFileSync(path.join(root, 'shared', 'brand-tokens.css'), 'utf8');
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`brand-tokens.css: token ${name} not found`);
  return match[1].trim();
}

// --pcv-font-sans's first (quoted) font name, Google-Fonts-URL-encoded, e.g.
// "'Plus Jakarta Sans', ..." → "Plus+Jakarta+Sans".
const pcvFontUrlName = readToken('--pcv-font-sans')
  .match(/'([^']+)'/)[1]
  .replace(/ /g, '+');

describe.each([
  ['announce/onboard.html', 'onboard.html'],
])('%s Google Fonts link matches brand-tokens.css', (relPath) => {
  const html = fs.readFileSync(path.join(root, relPath), 'utf8');

  test('font <link> href names the same family as --pcv-font-sans', () => {
    const match = html.match(/<link href="(https:\/\/fonts\.googleapis\.com\/css2\?family=[^"]+)"/);
    expect(match).not.toBeNull();
    expect(match[1]).toContain(pcvFontUrlName);
  });
});

// --ep-bg (the e-paper sign's background) isn't a brand-tokens.css role —
// it's onboard-specific, not reused elsewhere — but onboard.html's meta and
// onboard.css's var are still two independent copies of the same literal,
// same anti-pattern as the brand colours above, just scoped to one app.
describe('onboard.html theme-color meta matches onboard.css --ep-bg', () => {
  const html = fs.readFileSync(path.join(root, 'announce', 'onboard.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'announce', 'onboard.css'), 'utf8');

  test('meta theme-color matches --ep-bg', () => {
    const epBg = css.match(/--ep-bg:\s*([^;]+);/)[1].trim();
    const match = html.match(/<meta name="theme-color" content="([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match[1].toUpperCase()).toBe(epBg.toUpperCase());
  });
});
