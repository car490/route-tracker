// src/shared/time/timeFormat.js
//
// The one place the dashboard turns a clock time into text: always 24-hour
// and always UK time, whatever the viewing PC is set to. 'en-GB' fixes the
// layout; hourCycle 'h23' fixes the clock (00:00-23:59 — turning 12-hour off can
// show midnight as "24:05" in some Chrome versions); Europe/London keeps a
// report opened abroad on the times the drivers worked to. Guarded by
// ./twentyFourHourClock.test.js; see docs/DECISIONS.md "Time format".

const UK = { timeZone: 'Europe/London', hourCycle: 'h23' }

const HH_MM = new Intl.DateTimeFormat('en-GB', { ...UK, hour: '2-digit', minute: '2-digit' })
const HH_MM_SS = new Intl.DateTimeFormat('en-GB', { ...UK, hour: '2-digit', minute: '2-digit', second: '2-digit' })
const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  ...UK, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
})
const DATE_TIME_SHORT = new Intl.DateTimeFormat('en-GB', {
  ...UK, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

const NONE = '—'

function toDate(value) {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// 15:30, or 15:30:09 with { seconds: true }.
export function formatTime(value, { seconds = false } = {}) {
  const d = toDate(value)
  return d ? (seconds ? HH_MM_SS : HH_MM).format(d) : NONE
}

// 01/10/2026, 15:30:09, or 1 Oct 2026, 15:30 with { short: true }.
export function formatDateTime(value, { short = false } = {}) {
  const d = toDate(value)
  return d ? (short ? DATE_TIME_SHORT : DATE_TIME).format(d) : NONE
}
