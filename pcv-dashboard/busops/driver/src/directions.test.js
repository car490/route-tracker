// @vitest-environment jsdom
//
// src/directions.test.js
//
// Covers HTML-escaping of database-sourced stop/step names in
// directions.js's turn-by-turn panel: the "Directions unavailable"
// fallback, the "To: <stop>" destination header, and each step's road
// name — all built via setStepsHtml()'s innerHTML assignment on
// #dir-steps-area. The module's own OSRM fetch (fetchSteps) is stubbed via
// vi.stubGlobal('fetch', ...) so these tests never hit the network.
//
// directions.js keeps its "from stop" index and last-fetch bookkeeping in
// module-scope variables (not reset by initDirections alone), so each test
// re-imports a fresh module instance via vi.resetModules() — otherwise the
// second test's fetchAndRender() would see the same _fromIndex it already
// "fetched" in the first test (within REFRESH_MS) and skip the network call
// entirely, rendering nothing.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const XSS = '<img src=x onerror=alert(1)>';

beforeEach(() => {
  document.body.innerHTML = `<div id="directions-view"></div>`;
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function schedule() {
  return [
    { name: 'First Stop', time: '08:00', lat: 51.5, lon: -0.1 },
    { name: XSS, time: '08:10', lat: 51.6, lon: -0.2 },
  ];
}

describe('directions.js — escaping when OSRM is unreachable', () => {
  it('escapes the destination stop name in the "Directions unavailable" fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { initDirections, updateDirections } = await import('./directions.js');

    initDirections(schedule(), 0);
    await updateDirections();
    // fetchAndRender is async internally (awaits fetchSteps) — flush microtasks.
    await new Promise(r => setTimeout(r, 0));

    const area = document.getElementById('dir-steps-area');
    expect(area.querySelector('img')).toBeNull();
    expect(area.innerHTML).toContain('&lt;img');
  });
});

describe('directions.js — escaping in the rendered turn-by-turn panel', () => {
  it('escapes the destination header and each step\'s road name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ legs: [{ steps: [
          { maneuver: { type: 'depart', modifier: null }, name: XSS, distance: 50 },
        ] }] }],
      }),
    }));
    const { initDirections, updateDirections } = await import('./directions.js');

    initDirections(schedule(), 0);
    await updateDirections();
    await new Promise(r => setTimeout(r, 0));

    const area = document.getElementById('dir-steps-area');
    expect(area.querySelector('img')).toBeNull();
    expect(area.innerHTML).toContain('&lt;img');
  });
});
