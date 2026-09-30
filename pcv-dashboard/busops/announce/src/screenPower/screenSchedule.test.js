// announce/src/screenPower/screenSchedule.test.js
//
// When the Solo sign's screen is on (owner, 2026-09-30): from 30 minutes
// before each running journey's first stop to 15 minutes after its last
// stop, off at every other time. "Running" is the same rule the wake window
// and the Driver's manual picker use (days of week, school term time against
// the Dashboard's term dates, added/removed dates) — see
// shared/scheduleAutopilot.js's isRunningOn.
//
// Dates are built with the local-time Date constructor, so these hold in any
// time zone (the logic works on the tablet's wall clock).

import { describe, it, expect } from 'vitest';
import {
  SCREEN_LEAD_IN_MIN, SCREEN_RUN_OFF_MIN, screenOnWindows, isScreenScheduledOn, describeScreenDay,
} from './screenSchedule.js';

const TERM = [{ start_date: '2026-09-03', end_date: '2026-10-23' }];

// Phil Haines' school runs as they are on dev, with the term-time flag set.
const SCHOOL = [
  { departureId: 'am-125', departureTime: '07:27', lastStopTime: '08:40', daysOfWeek: [1, 2, 3, 4, 5], schoolTermTime: true },
  { departureId: 'am-116', departureTime: '07:40', lastStopTime: '08:25', daysOfWeek: [1, 2, 3, 4, 5], schoolTermTime: true },
  { departureId: 'pm-116', departureTime: '15:23', lastStopTime: '16:08', daysOfWeek: [1, 2, 3, 4, 5], schoolTermTime: true },
  { departureId: 'pm-125', departureTime: '16:50', lastStopTime: '17:45', daysOfWeek: [1, 2, 3, 4, 5], schoolTermTime: true },
];

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0);
const MON_IN_TERM = [2026, 10, 5];
const on = (candidates, when, terms = TERM) => isScreenScheduledOn(when, candidates, terms);

describe('padding', () => {
  it('is 30 minutes before the first stop and 15 after the last (owner, 2026-09-30)', () => {
    expect(SCREEN_LEAD_IN_MIN).toBe(30);
    expect(SCREEN_RUN_OFF_MIN).toBe(15);
  });
});

describe('isScreenScheduledOn — school runs, term-time weekday', () => {
  it('comes on 30 minutes before the first morning stop', () => {
    expect(on(SCHOOL, at(...MON_IN_TERM, 6, 56))).toBe(false);
    expect(on(SCHOOL, at(...MON_IN_TERM, 6, 57))).toBe(true);
  });

  it('stays on until 15 minutes after the later of the overlapping morning runs', () => {
    expect(on(SCHOOL, at(...MON_IN_TERM, 8, 54))).toBe(true);
    expect(on(SCHOOL, at(...MON_IN_TERM, 8, 55))).toBe(false);
  });

  it('is off in the middle of the day', () => {
    expect(on(SCHOOL, at(...MON_IN_TERM, 12, 0))).toBe(false);
  });

  it('covers both afternoon runs as one stretch (their windows overlap)', () => {
    expect(on(SCHOOL, at(...MON_IN_TERM, 14, 52))).toBe(false);
    expect(on(SCHOOL, at(...MON_IN_TERM, 14, 53))).toBe(true);
    expect(on(SCHOOL, at(...MON_IN_TERM, 16, 21))).toBe(true);
    expect(on(SCHOOL, at(...MON_IN_TERM, 17, 59))).toBe(true);
    expect(on(SCHOOL, at(...MON_IN_TERM, 18, 0))).toBe(false);
  });

  it('is off overnight', () => {
    expect(on(SCHOOL, at(...MON_IN_TERM, 2, 0))).toBe(false);
    expect(on(SCHOOL, at(...MON_IN_TERM, 23, 0))).toBe(false);
  });
});

describe('isScreenScheduledOn — days the school runs do not run', () => {
  it('is off all day on a weekend', () => {
    expect(on(SCHOOL, at(2026, 10, 3, 7, 30))).toBe(false); // Saturday
    expect(on(SCHOOL, at(2026, 10, 4, 15, 30))).toBe(false); // Sunday
  });

  it('is off all day on a weekday outside term (half term)', () => {
    expect(on(SCHOOL, at(2026, 10, 26, 7, 30))).toBe(false);
    expect(on(SCHOOL, at(2026, 10, 26, 15, 30))).toBe(false);
  });

  it('is off on a date removed from every run (a bank holiday entered in the Dashboard)', () => {
    const removed = SCHOOL.map((c) => ({ ...c, removedDates: ['2026-10-05'] }));
    expect(on(removed, at(...MON_IN_TERM, 7, 30))).toBe(false);
    expect(on(removed, at(...MON_IN_TERM, 15, 30))).toBe(false);
  });

  it('is on for a run added on a day it would not normally run', () => {
    const added = [{ ...SCHOOL[0], addedDates: ['2026-10-03'] }];
    expect(on(added, at(2026, 10, 3, 7, 30))).toBe(true);
  });

  it('follows a journey that is not term-time only through the holidays', () => {
    const rail = [{ departureId: 'rail', departureTime: '10:00', lastStopTime: '11:00', daysOfWeek: [1, 2, 3, 4, 5], schoolTermTime: false }];
    expect(on(rail, at(2026, 10, 26, 10, 30))).toBe(true);
    expect(on(rail, at(2026, 10, 26, 9, 29))).toBe(false);
    expect(on(rail, at(2026, 10, 26, 9, 30))).toBe(true);
  });

  it('is off with no journeys at all', () => {
    expect(on([], at(...MON_IN_TERM, 7, 30))).toBe(false);
  });
});

describe('isScreenScheduledOn — around midnight', () => {
  const late = [{ departureId: 'late', departureTime: '23:50', lastStopTime: '00:40', daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }];

  it('keeps a journey that finishes after midnight on until its run-off ends', () => {
    expect(on(late, at(2026, 10, 6, 0, 54))).toBe(true);
    expect(on(late, at(2026, 10, 6, 0, 55))).toBe(false);
  });

  it('counts a journey after midnight on the day it started', () => {
    const monOnly = [{ ...late[0], daysOfWeek: [1] }];
    expect(on(monOnly, at(2026, 10, 6, 0, 30))).toBe(true); // Tuesday 00:30, from Monday's 23:50
    expect(on(monOnly, at(2026, 10, 5, 0, 30))).toBe(false); // Monday 00:30 — Sunday had none
  });

  it('starts the lead-in the evening before for a departure just after midnight', () => {
    const early = [{ departureId: 'early', departureTime: '00:10', lastStopTime: '00:50', daysOfWeek: [2] }];
    expect(on(early, at(2026, 10, 5, 23, 40))).toBe(true); // Monday 23:40, for Tuesday's 00:10
    expect(on(early, at(2026, 10, 5, 23, 39))).toBe(false);
  });
});

describe('isScreenScheduledOn — older offline copies', () => {
  it('treats a departure with no last-stop time as ending at its first stop', () => {
    const noLast = [{ departureId: 'x', departureTime: '07:30', daysOfWeek: [1] }];
    expect(on(noLast, at(...MON_IN_TERM, 7, 44))).toBe(true);
    expect(on(noLast, at(...MON_IN_TERM, 7, 45))).toBe(false);
  });
});

describe('screenOnWindows', () => {
  it('merges overlapping windows and sorts them', () => {
    const windows = screenOnWindows(at(...MON_IN_TERM, 12, 0), [...SCHOOL].reverse(), TERM);
    expect(windows.map(({ start, end }) => [start.getHours(), start.getMinutes(), end.getHours(), end.getMinutes()])).toEqual([
      [6, 57, 8, 55],
      [14, 53, 18, 0],
    ]);
  });
});

describe('describeScreenDay — the line the sign logs at start-up', () => {
  it('lists the day\'s on times', () => {
    expect(describeScreenDay(at(...MON_IN_TERM, 12, 0), SCHOOL, TERM)).toBe('2026-10-05 screen on 06:57–08:55, 14:53–18:00');
  });

  it('says so when the screen stays off all day', () => {
    expect(describeScreenDay(at(2026, 10, 3, 12, 0), SCHOOL, TERM)).toBe('2026-10-03 screen off all day');
  });
});
