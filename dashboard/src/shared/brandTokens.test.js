// dashboard/src/shared/brandTokens.test.js
//
// brand-tokens.css is the single source of truth for PCV Technologies'
// typeface and colours (see docs/BRAND.md). dashboard/index.html's Google
// Fonts <link> and <meta name="theme-color"> are static — Vite doesn't
// template index.html's <head> — so they can't import the CSS token; this
// guards them from drifting out of sync instead.

import { describe, test, expect } from 'vitest';
import fs from 'fs';

function readToken(name) {
  const css = fs.readFileSync(new URL('../../../brand-tokens.css', import.meta.url), 'utf8');
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`brand-tokens.css: token ${name} not found`);
  return match[1].trim();
}

// --pcv-font-sans's first (quoted) font name, Google-Fonts-URL-encoded, e.g.
// "'Plus Jakarta Sans', ..." → "Plus+Jakarta+Sans".
const pcvFontUrlName = readToken('--pcv-font-sans')
  .match(/'([^']+)'/)[1]
  .replace(/ /g, '+');

const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

describe('dashboard/index.html Google Fonts link matches brand-tokens.css', () => {
  test('font <link> href names the same family as --pcv-font-sans', () => {
    const match = html.match(/<link href="(https:\/\/fonts\.googleapis\.com\/css2\?family=[^"]+)"/);
    expect(match).not.toBeNull();
    expect(match[1]).toContain(pcvFontUrlName);
  });
});

describe('dashboard/index.html theme-color meta matches brand-tokens.css', () => {
  test('meta theme-color matches --pcv-color-charcoal', () => {
    const pcvCharcoal = readToken('--pcv-color-charcoal');
    const match = html.match(/<meta name="theme-color" content="([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match[1].toUpperCase()).toBe(pcvCharcoal.toUpperCase());
  });
});
