// @vitest-environment jsdom
//
// src/ui.test.js
//
// Covers HTML-escaping of database-sourced text in ui.js's two innerHTML
// builders: updateStopList's stop-name row (only reachable via the exported
// updateUi()) and renderLog's log-message row.

import { describe, it, expect, beforeEach } from 'vitest';
import { updateUi, renderLog } from './ui.js';

const XSS = '<img src=x onerror=alert(1)>';

beforeEach(() => {
  document.body.innerHTML = `
    <div id="early-wait-banner"></div>
    <span id="ewb-time"></span>
    <div id="status-card"></div>
    <span id="status-label"></span>
    <span id="sched-time"></span>
    <span id="eta-time"></span>
    <span id="delta"></span>
    <span id="distance"></span>
    <span id="speed"></span>
    <span id="next-stop"></span>
    <span id="next-stop-label"></span>
    <div id="progress-fill"></div>
    <div id="stop-list"></div>
    <div id="log-view"></div>
  `;
});

describe('updateUi / updateStopList — stop name escaping', () => {
  it('never renders a live <img> element from a database-sourced stop name', () => {
    const schedule = [
      { name: XSS, time: '08:00' },
      { name: 'Second Stop', time: '08:10' },
    ];
    updateUi({
      timing: { status: 'on-time', scheduledTime: new Date(), eta: new Date(), minutesDifference: 0 },
      nextStopIndex: 0,
      schedule,
      speedMps: 0,
      distanceToNextM: 100,
      stopStates: [{ status: 'upcoming', arrivedAt: null }, { status: 'upcoming', arrivedAt: null }],
      earlyWait: null,
      atStop: null,
    });

    const stopList = document.getElementById('stop-list');
    expect(stopList.querySelector('img')).toBeNull();
    expect(stopList.innerHTML).toContain('&lt;img');
  });
});

describe('renderLog — message escaping', () => {
  it('never renders a live <img> element from a database-sourced log message', () => {
    renderLog([{ t: '12:00', category: 'info', message: XSS }]);

    const logView = document.getElementById('log-view');
    expect(logView.querySelector('img')).toBeNull();
    expect(logView.innerHTML).toContain('&lt;img');
  });
});
