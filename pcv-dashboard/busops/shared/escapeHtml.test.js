// src/shared/escapeHtml.test.js
//
// Covers the shared escapeHtml() helper used everywhere driver PWA code
// builds an HTML string via a template literal and assigns it to
// .innerHTML (main.js's duty card, ui.js's stop list/log, directions.js's
// turn-by-turn panel). No DOM needed — plain string assertions.

import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escapeHtml.js';

describe('escapeHtml', () => {
  it('escapes &', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes <', () => {
    expect(escapeHtml('<img')).toBe('&lt;img');
  });

  it('escapes >', () => {
    expect(escapeHtml('a>b')).toBe('a&gt;b');
  });

  it('escapes combinations, in the right order (& first so entities are not double-escaped)', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });

  it('leaves quotes untouched', () => {
    expect(escapeHtml(`it's "quoted"`)).toBe(`it's "quoted"`);
  });

  it('leaves unicode untouched', () => {
    expect(escapeHtml('Café → Böße Straße')).toBe('Café → Böße Straße');
  });

  it('leaves plain text and numbers-as-text untouched', () => {
    expect(escapeHtml('Plain text 12:34')).toBe('Plain text 12:34');
  });

  it('coerces a non-string input via String(...) without throwing', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('null');
    expect(escapeHtml(undefined)).toBe('undefined');
  });
});
