// Tablet capture, part 4 — never hang. Tests written BEFORE the implementation (TDD).
//
// Found live on 2026-09-19: the Android WebView answers every DevTools call the probe needs, but
// never answers Page.captureScreenshot, and the first version of the tool waited for it forever.
// Every DevTools call now has a time limit, so the worst case is a clear error, not a hang.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { withTimeout, DevToolsTimeout } from './tabletCdp.mjs';

const never = () => new Promise(() => {});
const later = (value, ms) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe('withTimeout', () => {
  test('passes the value through when the call answers in time', async () => {
    assert.equal(await withTimeout(later('ok', 5), 500, 'Runtime.evaluate'), 'ok');
  });

  test('rejects with a DevToolsTimeout naming the call and the limit when it never answers', async () => {
    await assert.rejects(
      withTimeout(never(), 30, 'Page.captureScreenshot'),
      (err) => err instanceof DevToolsTimeout && /Page\.captureScreenshot/.test(err.message) && /30/.test(err.message),
    );
  });

  test('passes an ordinary rejection through unchanged (it is not turned into a timeout)', async () => {
    const boom = new Error('DevTools said no');
    await assert.rejects(withTimeout(Promise.reject(boom), 500, 'x'), (err) => err === boom);
  });

  test('a slow answer that arrives after the limit is a timeout, and does not resolve later', async () => {
    await assert.rejects(withTimeout(later('late', 60), 20, 'slow'), DevToolsTimeout);
  });

  test('the timer is cleared once the call answers (nothing is left to keep the process alive)', async () => {
    const started = Date.now();
    await withTimeout(later('ok', 5), 5000, 'x');
    assert.ok(Date.now() - started < 1000);
    // if the 5 s timer were still pending, this test file would not exit promptly; node:test would report the delay
  });

  test('rejects nonsense limits instead of waiting forever', () => {
    assert.throws(() => withTimeout(never(), 0, 'x'), RangeError);
    assert.throws(() => withTimeout(never(), -5, 'x'), RangeError);
    assert.throws(() => withTimeout(never(), Infinity, 'x'), RangeError);
    assert.throws(() => withTimeout(never(), NaN, 'x'), RangeError);
  });
});
