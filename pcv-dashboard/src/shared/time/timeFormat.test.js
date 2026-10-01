// src/shared/time/timeFormat.test.js
//
// Every clock time the dashboard shows goes through these helpers: always
// 24-hour, and always UK time (Europe/London) whatever the viewing PC is set
// to. See docs/DECISIONS.md "Time format".

import { describe, it, expect } from 'vitest'
import { formatTime, formatDateTime } from './timeFormat.js'

// 2026-10-01 is British Summer Time (UTC+1); 2026-01-15 is GMT (UTC+0).
const SUMMER_EVENING = '2026-10-01T14:30:09Z' // 15:30:09 in the UK
const WINTER_MIDNIGHT = '2026-01-15T00:05:00Z' // 00:05:00 in the UK
const SUMMER_JUST_AFTER_MIDNIGHT = '2026-10-01T23:05:09Z' // 00:05 on 2 Oct in the UK

describe('formatTime', () => {
  it('shows UK time in 24-hour form', () => {
    expect(formatTime(SUMMER_EVENING)).toBe('15:30')
  })

  it('follows British Summer Time and GMT', () => {
    expect(formatTime('2026-07-01T12:00:00Z')).toBe('13:00')
    expect(formatTime('2026-12-01T12:00:00Z')).toBe('12:00')
  })

  it('shows the minutes after midnight as 00, never 24', () => {
    expect(formatTime(WINTER_MIDNIGHT)).toBe('00:05')
    expect(formatTime(SUMMER_JUST_AFTER_MIDNIGHT)).toBe('00:05')
  })

  it('is always HH:MM with no AM/PM, every hour of the day', () => {
    for (let h = 0; h < 24; h++) {
      const iso = `2026-01-15T${String(h).padStart(2, '0')}:00:00Z`
      expect(formatTime(iso)).toBe(`${String(h).padStart(2, '0')}:00`)
    }
  })

  it('adds seconds when asked', () => {
    expect(formatTime(SUMMER_EVENING, { seconds: true })).toBe('15:30:09')
  })

  it('accepts a Date or a timestamp as well as an ISO string', () => {
    expect(formatTime(new Date(SUMMER_EVENING))).toBe('15:30')
    expect(formatTime(Date.parse(SUMMER_EVENING))).toBe('15:30')
  })

  it('shows — for a missing or invalid time', () => {
    expect(formatTime(null)).toBe('—')
    expect(formatTime('')).toBe('—')
    expect(formatTime('nonsense')).toBe('—')
  })
})

describe('formatDateTime', () => {
  it('shows a numeric UK date and 24-hour time with seconds', () => {
    expect(formatDateTime(SUMMER_EVENING)).toBe('01/10/2026, 15:30:09')
  })

  it('rolls the date over at UK midnight, not the PC\'s', () => {
    expect(formatDateTime(SUMMER_JUST_AFTER_MIDNIGHT)).toBe('02/10/2026, 00:05:09')
  })

  it('has a short form with the month name and no seconds', () => {
    expect(formatDateTime(SUMMER_EVENING, { short: true })).toBe('1 Oct 2026, 15:30')
  })

  it('never contains AM or PM', () => {
    for (let h = 0; h < 24; h++) {
      const iso = `2026-01-15T${String(h).padStart(2, '0')}:00:00Z`
      expect(formatDateTime(iso)).not.toMatch(/am|pm/i)
      expect(formatDateTime(iso, { short: true })).not.toMatch(/am|pm/i)
    }
  })

  it('shows — for a missing or invalid time', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('nonsense', { short: true })).toBe('—')
  })
})
