// @vitest-environment jsdom
//
// src/main.dutyCard.test.js
//
// Covers renderDutyCard()'s HTML-escaping of database-sourced duty-card
// fields (service code, timetable name/direction, stop names, vehicle
// registration, driver notes) — see shared/escapeHtml.js and main.js's own
// import of it. Real jsdom is required the same way announcements.test.js
// needs it: main.js's module scope reads `window.location` (the DEBUG
// const) and transitively imports config.js, which reads `self.location`.
//
// main.js's own init() runs at module-import time (`init().catch(console.error)`)
// and touches a long list of #ids this test's minimal DOM doesn't have —
// but init() is an async function, so any synchronous throw inside it (e.g.
// initManualSelection() setting .onchange on a missing element) is caught
// into its own rejected promise and swallowed by that top-level .catch(),
// never reaching this test. It's still fire-and-forget background noise, so
// this file only asserts on renderDutyCard() itself, called directly and
// synchronously, not on whatever init() does with the rest of the page.

import { describe, it, expect } from 'vitest';
import { renderDutyCard } from './main.js';

document.body.innerHTML = `
  <div id="duty-card"></div>
  <div id="picker"></div>
  <div id="tracker"></div>
  <span id="dc-greeting-prefix"></span>
  <span id="dc-driver-name"></span>
  <span id="dc-date"></span>
  <div id="dc-routes"></div>
`;

const XSS = '<img src=x onerror=alert(1)>';

function makeDuty(overrides = {}) {
  return {
    journey_id: 'journey-1',
    status: 'scheduled',
    driver_name: 'Jane Doe',
    service_code: XSS,
    timetable_name: XSS,
    direction: XSS,
    vehicle_registration: XSS,
    first_stop_time: '08:00',
    notes: XSS,
    last_stop_name: XSS,
    stops: [{ name: XSS, time: '08:00' }],
    timetable_departure_id: 'dep-1',
    ...overrides,
  };
}

describe('renderDutyCard — HTML escaping', () => {
  it('never renders a live <img> element from database-sourced duty fields', () => {
    renderDutyCard([makeDuty()], ['journey-1']);

    const routes = document.getElementById('dc-routes');
    expect(routes.querySelector('img')).toBeNull();
  });

  it('shows the escaped text in place of the raw markup', () => {
    renderDutyCard([makeDuty()], ['journey-1']);

    const routes = document.getElementById('dc-routes');
    expect(routes.innerHTML).toContain('&lt;img');
    expect(routes.innerHTML).not.toContain('<img src=x');
  });

  it('still renders the duty card normally for safe data', () => {
    renderDutyCard([makeDuty({
      service_code: 'S1',
      timetable_name: 'Outbound',
      direction: 'N',
      vehicle_registration: 'AB12 CDE',
      notes: 'Watch for roadworks',
      last_stop_name: 'Terminus',
      stops: [{ name: 'First Stop', time: '08:00' }],
    })], ['journey-1']);

    const routes = document.getElementById('dc-routes');
    expect(routes.textContent).toContain('S1');
    expect(routes.textContent).toContain('Outbound');
    expect(routes.textContent).toContain('AB12 CDE');
    expect(routes.textContent).toContain('Watch for roadworks');
    expect(document.getElementById('duty-card').hidden).toBe(false);
    expect(document.getElementById('dc-driver-name').textContent).toBe('Jane Doe');
  });
});
