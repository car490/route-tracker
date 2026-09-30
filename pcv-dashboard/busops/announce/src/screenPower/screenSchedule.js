// announce/src/screenPower/screenSchedule.js
//
// When the Announce Solo sign's screen should be on (owner, 2026-09-30).
// The tablet is on a permanent supply so it never goes flat (a flat tablet
// stops at its charging screen until someone presses the power button), and
// the screen is switched off between journeys to save the bus battery.
//
// The on times come from the journeys themselves, not a separate day/time
// table: from SCREEN_LEAD_IN_MIN before each running journey's first stop to
// SCREEN_RUN_OFF_MIN after its last stop. "Running" is the same rule the wake
// window and the Driver's manual picker use (isRunningOn: days of week,
// school term time against the Dashboard's term dates, added/removed dates),
// so a school run follows term time and a bank holiday entered as a removed
// date is dark. Overrides (a trip in progress, data not loaded yet) are
// screenPower.js's job, not this file's.
//
// Pure: works on the tablet's wall clock (setHours on a copy of the day), so
// a clock change needs no special handling.

import { isRunningOn } from '../../../shared/scheduleAutopilot.js';

export const SCREEN_LEAD_IN_MIN = 30;
export const SCREEN_RUN_OFF_MIN = 15;

const MS_PER_MIN = 60 * 1000;

function atTime(day, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

function addDays(day, n) {
  const d = new Date(day);
  d.setDate(d.getDate() + n);
  return d;
}

// One window per journey running on `day`, unmerged. A journey whose last
// stop is earlier in the day than its first finishes after midnight.
function journeyWindows(day, candidates, termDateRanges, leadInMin, runOffMin) {
  const midday = atTime(day, '12:00');
  return candidates
    .filter((c) => c.departureTime && isRunningOn(c, midday, termDateRanges))
    .map((c) => {
      const first = atTime(day, c.departureTime);
      let last = atTime(day, c.lastStopTime ?? c.departureTime);
      if (last < first) last = addDays(last, 1);
      return {
        start: new Date(first.getTime() - leadInMin * MS_PER_MIN),
        end: new Date(last.getTime() + runOffMin * MS_PER_MIN),
      };
    });
}

function merge(windows) {
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const w of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && w.start <= prev.end) {
      if (w.end > prev.end) prev.end = w.end;
    } else {
      merged.push({ start: w.start, end: w.end });
    }
  }
  return merged;
}

/**
 * The screen-on windows for the journeys running on `day`'s calendar date,
 * merged and sorted. A window can start the evening before (lead-in) or end
 * after midnight (a late journey).
 *
 * @param {Date} day
 * @param {Array<{departureTime: string, lastStopTime?: string, daysOfWeek: number[], schoolTermTime?: boolean, removedDates?: string[], addedDates?: string[]}>} candidates
 * @param {Array<{start_date: string, end_date: string}>} [termDateRanges]
 * @returns {Array<{start: Date, end: Date}>}
 */
export function screenOnWindows(day, candidates, termDateRanges = [], {
  leadInMin = SCREEN_LEAD_IN_MIN, runOffMin = SCREEN_RUN_OFF_MIN,
} = {}) {
  return merge(journeyWindows(day, candidates ?? [], termDateRanges, leadInMin, runOffMin));
}

/**
 * Whether the timetable wants the screen on at `now` — start inclusive, end
 * exclusive. Looks at yesterday's and tomorrow's journeys too, for windows
 * that cross midnight.
 *
 * @returns {boolean}
 */
export function isScreenScheduledOn(now, candidates, termDateRanges = [], padding = {}) {
  return [-1, 0, 1].some((offset) => screenOnWindows(addDays(now, offset), candidates, termDateRanges, padding)
    .some(({ start, end }) => now >= start && now < end));
}

const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * One line for the log, so the day's on times can be checked on the bench
 * before trusting them, e.g. "2026-10-05 screen on 06:57–08:55, 14:53–18:00".
 *
 * @returns {string}
 */
export function describeScreenDay(day, candidates, termDateRanges = [], padding = {}) {
  const windows = screenOnWindows(day, candidates, termDateRanges, padding);
  if (!windows.length) return `${ymd(day)} screen off all day`;
  return `${ymd(day)} screen on ${windows.map((w) => `${hhmm(w.start)}–${hhmm(w.end)}`).join(', ')}`;
}
