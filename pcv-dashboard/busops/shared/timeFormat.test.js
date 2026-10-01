// shared/timeFormat.test.js
//
// Every clock time the Driver PWA and Announce show goes through formatTime():
// always 24-hour HH:MM, whatever language the phone or tablet is set to (a
// device set to US English used to show "03:15 PM" on the Driver's stop list).
// See docs/DECISIONS.md "Time format".

import { describe, it, expect } from 'vitest';
import { formatTime } from './timeFormat.js';

const at = (h, m, s = 0) => new Date(2026, 9, 1, h, m, s);

describe('formatTime', () => {
  it('shows an afternoon time in 24-hour form', () => {
    expect(formatTime(at(15, 30))).toBe('15:30');
  });

  it('shows the minutes after midnight as 00, never 24', () => {
    expect(formatTime(at(0, 5))).toBe('00:05');
  });

  it('pads a morning hour to two digits', () => {
    expect(formatTime(at(7, 45))).toBe('07:45');
  });

  it('is always HH:MM with no AM/PM, every hour of the day', () => {
    for (let h = 0; h < 24; h++) {
      const text = formatTime(at(h, 0));
      expect(text).toMatch(/^\d{2}:\d{2}$/);
      expect(text).toBe(`${String(h).padStart(2, '0')}:00`);
    }
  });

  it('adds seconds when asked', () => {
    expect(formatTime(at(23, 59, 7), { seconds: true })).toBe('23:59:07');
  });

  it('accepts an ISO string or a timestamp as well as a Date', () => {
    const d = at(13, 4);
    expect(formatTime(d.toISOString())).toBe('13:04');
    expect(formatTime(d.getTime())).toBe('13:04');
  });

  it('shows --:-- for a missing or invalid time', () => {
    expect(formatTime(null)).toBe('--:--');
    expect(formatTime(undefined)).toBe('--:--');
    expect(formatTime(new Date('nonsense'))).toBe('--:--');
  });

  it('lets the caller choose the placeholder', () => {
    expect(formatTime(null, { fallback: '—' })).toBe('—');
  });
});
