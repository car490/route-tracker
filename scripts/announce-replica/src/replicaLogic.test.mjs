// Slice 2 — pure logic behind the replica page. Tests written BEFORE the code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCENARIOS,
  buildScenarioMessages,
  rulerTicks,
  verdictForLowercase,
  layoutFlags,
} from './replicaLogic.mjs';

const NOW = Date.parse('2026-09-18T20:00:00Z');

describe('SCENARIOS — every real sign state, using real message shapes', () => {
  test('cover ROUTE_START, three-line and single-line next stop, approaching, early wait, long names, terminus, diversion, idle', () => {
    const ids = SCENARIOS.map((s) => s.id);
    for (const id of [
      'route-start', 'next-three-line', 'next-single-line', 'this-is-three-line',
      'this-is-early-wait', 'long-stop-line', 'long-town-line', 'terminus', 'diversion', 'idle',
    ]) assert.ok(ids.includes(id), `missing scenario ${id}`);
  });

  test('ids are unique and each has a label and a key 1-9 or 0', () => {
    assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
    const keys = SCENARIOS.map((s) => s.key);
    assert.equal(new Set(keys).size, keys.length, 'duplicate keys');
    for (const s of SCENARIOS) {
      assert.ok(s.label && s.label.length > 0);
      assert.match(s.key, /^[0-9]$/);
    }
  });

  test('state scenarios build a schedule message plus a state message the real sign accepts', () => {
    for (const s of SCENARIOS.filter((x) => x.id !== 'idle')) {
      const m = buildScenarioMessages(s, NOW);
      assert.equal(m.schedule.type, 'schedule');
      assert.ok(m.schedule.serviceCode && m.schedule.destination);
      assert.equal(m.state.type, 'state');
      assert.ok(m.state.stateKey, `${s.id} needs a stateKey`);
      assert.equal(typeof m.state.vars, 'object');
    }
  });

  test('state keys are the real ANNOUNCE_STATES values', () => {
    const valid = new Set(['route_start', 'stop_departure', 'approaching', 'at_stop', 'diversion']);
    for (const s of SCENARIOS.filter((x) => x.id !== 'idle')) {
      assert.ok(valid.has(buildScenarioMessages(s, NOW).state.stateKey), s.id);
    }
  });

  test('three-line scenarios use the "Town,Stop" comma shape; single-line ones do not', () => {
    const three = buildScenarioMessages(SCENARIOS.find((s) => s.id === 'next-three-line'), NOW).state.vars.nextStopName;
    assert.match(three, /^[^,]+,[^,]+$/);
    const single = buildScenarioMessages(SCENARIOS.find((s) => s.id === 'next-single-line'), NOW).state.vars.nextStopName;
    assert.ok(!single.includes(','));
  });

  test('the early-wait scenario carries a future scheduledTime relative to "now"', () => {
    const m = buildScenarioMessages(SCENARIOS.find((s) => s.id === 'this-is-early-wait'), NOW);
    assert.ok(Date.parse(m.state.earlyWait.scheduledTime) > NOW);
  });

  test('idle is a journey-end action with no state message', () => {
    const m = buildScenarioMessages(SCENARIOS.find((s) => s.id === 'idle'), NOW);
    assert.equal(m.journeyEnd, true);
    assert.equal(m.state, undefined);
  });

  test('does not embed secrets or tokens', () => {
    const blob = JSON.stringify(SCENARIOS);
    assert.ok(!/token|secret|jwt|apikey/i.test(blob));
  });
});

describe('rulerTicks — millimetre ruler', () => {
  test('a 100 mm ruler has 101 ticks: cm, half-cm and mm kinds', () => {
    const t = rulerTicks(100);
    assert.equal(t.length, 101);
    assert.equal(t[0].mm, 0);
    assert.equal(t[100].mm, 100);
    assert.equal(t.filter((x) => x.kind === 'cm').length, 11);
    assert.equal(t.filter((x) => x.kind === 'half').length, 10);
    assert.equal(t.filter((x) => x.kind === 'mm').length, 80);
  });

  test('every 10th tick is a cm, every 5th (not 10th) is a half', () => {
    const t = rulerTicks(30);
    assert.equal(t[10].kind, 'cm');
    assert.equal(t[15].kind, 'half');
    assert.equal(t[7].kind, 'mm');
  });

  test('rejects non-positive or fractional lengths', () => {
    assert.throws(() => rulerTicks(0));
    assert.throws(() => rulerTicks(-5));
    assert.throws(() => rulerTicks(12.5));
  });
});

describe('verdictForLowercase — the 22 mm rule for Lines 2 and 3', () => {
  test('22.0 mm passes, 21.9 mm fails by 0.1 mm', () => {
    assert.equal(verdictForLowercase({ xHeightMm: 22.0 }).pass, true);
    const v = verdictForLowercase({ xHeightMm: 21.9 });
    assert.equal(v.pass, false);
    assert.ok(Math.abs(v.shortfallMm - 0.1) < 1e-9);
  });

  test('a 0.05 mm measurement tolerance is applied, not more', () => {
    assert.equal(verdictForLowercase({ xHeightMm: 21.96 }).pass, true);
    assert.equal(verdictForLowercase({ xHeightMm: 21.9 }).pass, false);
  });

  test('today\'s roughly 11 mm x-height fails by about half', () => {
    const v = verdictForLowercase({ xHeightMm: 10.9 });
    assert.equal(v.pass, false);
    assert.ok(v.shortfallMm > 10 && v.shortfallMm < 12);
  });

  test('a custom requirement is honoured', () => {
    assert.equal(verdictForLowercase({ xHeightMm: 8, requiredMm: 8 }).pass, true);
  });

  test('non-numeric input throws instead of silently passing', () => {
    assert.throws(() => verdictForLowercase({ xHeightMm: NaN }));
    assert.throws(() => verdictForLowercase({}));
  });
});

describe('layoutFlags — collisions and clipping the harness must surface', () => {
  const viewport = { w: 1442, h: 901 };
  const box = (top, bottom, left = 0, right = 1442) => ({ top, bottom, left, right });

  test('clean layout has no flags', () => {
    const f = layoutFlags({ viewport, rects: { headline: box(150, 600), brand: box(830, 890, 10, 300) } });
    assert.deepEqual(f, []);
  });

  test('flags anything that extends below the panel', () => {
    const f = layoutFlags({ viewport, rects: { headline: box(150, 960) } });
    assert.deepEqual(f, [{ type: 'below-panel', name: 'headline', overshootPx: 59 }]);
  });

  test('flags anything that extends past the right or left edge', () => {
    const f = layoutFlags({ viewport, rects: { topbar: box(0, 100, -20, 1500) } });
    assert.deepEqual(f.map((x) => x.type).sort(), ['left-of-panel', 'right-of-panel']);
  });

  test('flags the headline overlapping the brand mark', () => {
    const f = layoutFlags({ viewport, rects: { headline: box(500, 860, 0, 1442), brand: box(830, 890, 10, 300) } });
    assert.ok(f.some((x) => x.type === 'overlap' && x.names.join() === 'headline,brand'));
  });

  test('touching edges is not an overlap', () => {
    const f = layoutFlags({ viewport, rects: { headline: box(500, 830), brand: box(830, 890, 10, 300) } });
    assert.ok(!f.some((x) => x.type === 'overlap'));
  });

  test('overlapPairs limits which pairs are compared', () => {
    const rects = { topbar: box(0, 300), headline: box(250, 700), brand: box(830, 890, 10, 300) };
    const all = layoutFlags({ viewport, rects });
    assert.ok(all.some((x) => x.type === 'overlap'));
    const only = layoutFlags({ viewport, rects, overlapPairs: [['headline', 'brand']] });
    assert.ok(!only.some((x) => x.type === 'overlap'));
  });

  test('noBounds skips the panel-edge checks for named rects but still allows overlap checks', () => {
    const rects = { 'headline-text': box(500, 960, 0, 1600), brand: box(830, 890, 10, 300) };
    const f = layoutFlags({ viewport, rects, noBounds: ['headline-text'] });
    assert.ok(!f.some((x) => x.type === 'below-panel' || x.type === 'right-of-panel'));
    assert.ok(f.some((x) => x.type === 'overlap'));
  });

  test('ignores elements that are not shown (null rect)', () => {
    const f = layoutFlags({ viewport, rects: { headline: null, brand: box(830, 890, 10, 300) } });
    assert.deepEqual(f, []);
  });
});
