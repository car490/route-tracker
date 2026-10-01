// shared/timeFormat.js
//
// The one place Driver and Announce turn a clock time into text: always
// 24-hour HH:MM, whatever language the device is set to. 'en-GB' fixes the
// layout; hourCycle 'h23' fixes the clock (00:00-23:59 — turning 12-hour off can
// show midnight as "24:05" in some Chrome versions). Device time zone, like
// the schedule matching it sits beside (scheduleTimeShift.js). Guarded by
// tests/twentyFourHourClock.test.js; see docs/DECISIONS.md "Time format".

const HH_MM = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const HH_MM_SS = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function formatTime(value, { seconds = false, fallback = '--:--' } = {}) {
  if (value === null || value === undefined || value === '') return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return (seconds ? HH_MM_SS : HH_MM).format(d);
}
