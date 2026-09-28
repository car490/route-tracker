import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDailyCap, fitsDailyCap, DEFAULT_DAILY_CHAR_CAP } from './dailyCap.mjs';

test('the daily cap comes from app_config, falling back to the default for a missing or bad value', () => {
  assert.equal(parseDailyCap('8000'), 8000);
  assert.equal(parseDailyCap(null), DEFAULT_DAILY_CHAR_CAP);
  assert.equal(parseDailyCap(''), DEFAULT_DAILY_CHAR_CAP);
  assert.equal(parseDailyCap('lots'), DEFAULT_DAILY_CHAR_CAP);
  assert.equal(parseDailyCap('-5'), DEFAULT_DAILY_CHAR_CAP);
  assert.equal(parseDailyCap('0'), 0); // 0 = pause all Ben rendering
});

test('a render fits only if it keeps the day within the cap', () => {
  assert.equal(fitsDailyCap({ usedToday: 5900, chars: 100, cap: 6000 }), true);
  assert.equal(fitsDailyCap({ usedToday: 5901, chars: 100, cap: 6000 }), false);
  assert.equal(fitsDailyCap({ usedToday: 0, chars: 1, cap: 0 }), false);
});

test('the default fits a full first production run (about 4,900 characters) in one day', () => {
  assert.ok(DEFAULT_DAILY_CHAR_CAP >= 5000);
  assert.ok(DEFAULT_DAILY_CHAR_CAP <= 10000); // a third of Starter's 30,000 a month at most
});
