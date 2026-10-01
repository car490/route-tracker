// src/shared/time/timeEntry.js
//
// The logic behind <TimeInput>: what a typed time means. Pure, so it is
// tested without a browser (./timeEntry.test.js). Only "HH:MM" (00:00-23:59)
// or '' ever leaves parseTime(), so nothing else can reach a form or the
// database. AM/PM is refused outright rather than guessed at — letters are
// never stripped silently, as "5pm" would then read as 05:00.

export const TIME_ERROR = 'Enter a 24-hour time, for example 17:30'

const pad = (n) => String(n).padStart(2, '0')

// "8:15", "815", "0815", "08:15" → "08:15"; "8" or "17" → whole hours.
// '' for an empty box; null for anything that is not a 24-hour time.
export function parseTime(typed) {
  const text = String(typed ?? '').trim()
  if (text === '') return ''
  const m = /^(\d{1,2}):(\d{2})$/.exec(text)
    ?? /^(\d{1,2})(\d{2})$/.exec(text)
    ?? /^(\d{1,2})()$/.exec(text)
  if (!m) return null
  const h = Number(m[1])
  const min = m[2] === '' ? 0 : Number(m[2])
  if (h > 23 || min > 59) return null
  return `${pad(h)}:${pad(min)}`
}

// What the form holds while the box is typed in: the typed time when it is a
// valid 24-hour time, otherwise the value from before editing began — so a
// half-typed "2" (of "25:00") or the "5" of "5pm" never sticks.
export function valueFor(typed, original) {
  const parsed = parseTime(typed)
  return parsed === null ? original : parsed
}

// A stored value ("08:15:00" from Postgres, or "08:15") as the box shows it.
export function toDisplay(value) {
  const m = /^(\d{2}):(\d{2})/.exec(String(value ?? ''))
  return m ? `${m[1]}:${m[2]}` : ''
}
