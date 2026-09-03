// tests/scheduleTimeShift.test.js
//
// Extracted from the driver PWA's DEBUG-only testing toggle (main.js) so
// Announce Solo's autopilot can reuse the same shift logic —
// see announceSoloAutopilot.js's testing_mode fallback.

import { shiftStopTimes } from '../shared/scheduleTimeShift.js';

describe('shiftStopTimes', () => {
  it('adds a positive delta to every stop, wrapping at midnight', () => {
    const stops = [{ time: '23:30' }, { time: '23:50' }];
    const result = shiftStopTimes(stops, 40);
    expect(result.map(s => s.time)).toEqual(['00:10', '00:30']);
  });

  it('subtracts a negative delta, wrapping backwards past midnight', () => {
    const stops = [{ time: '00:10' }];
    const result = shiftStopTimes(stops, -20);
    expect(result.map(s => s.time)).toEqual(['23:50']);
  });

  it('preserves the gap between stops and other stop fields', () => {
    const stops = [{ time: '08:00', name: 'Depot' }, { time: '08:15', name: 'High St' }];
    const result = shiftStopTimes(stops, 360);
    expect(result).toEqual([
      { time: '14:00', name: 'Depot' },
      { time: '14:15', name: 'High St' },
    ]);
  });
});
