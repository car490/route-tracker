// src/shared/time/timeEntry.test.js
//
// The logic behind <TimeInput>, the dashboard's 24-hour time box. It replaces
// the browser's own <input type="time">, which shows AM/PM on a PC set to US
// English. Only a valid 24-hour time (or an empty box) ever reaches the form.

import { describe, it, expect } from 'vitest'
import { parseTime, toDisplay, valueFor, TIME_ERROR } from './timeEntry.js'

describe('parseTime', () => {
  it.each([
    ['08:15', '08:15'],
    ['8:15', '08:15'],
    ['0815', '08:15'],
    ['815', '08:15'],
    ['8', '08:00'],
    ['17', '17:00'],
    ['00:00', '00:00'],
    ['23:59', '23:59'],
    ['2359', '23:59'],
    [' 14:05 ', '14:05'],
  ])('reads %j as %j', (typed, expected) => {
    expect(parseTime(typed)).toBe(expected)
  })

  it('reads an empty box as empty', () => {
    expect(parseTime('')).toBe('')
    expect(parseTime('   ')).toBe('')
  })

  it.each([
    '24:00', '2400', '25', '12:60', '1260', '99:99', '1:5', '12:5',
    '3pm', '3:00 PM', '12:00am', '08.15', '08-15', '12345', ':15', '15:', 'abc',
  ])('refuses %j', (typed) => {
    expect(parseTime(typed)).toBeNull()
  })
})

describe('valueFor', () => {
  // What the form holds while the box is being typed in: the typed time when
  // it is a valid 24-hour time, otherwise the value from before editing began.
  it('passes a valid typed time to the form', () => {
    expect(valueFor('1730', '08:15:00')).toBe('17:30')
  })

  it('passes an emptied box to the form as empty', () => {
    expect(valueFor('', '08:15:00')).toBe('')
  })

  it('keeps the earlier value while the box holds something invalid', () => {
    expect(valueFor('25:00', '08:15:00')).toBe('08:15:00')
  })

  it('never turns AM/PM into a time: "5pm" is not 05:00', () => {
    expect(valueFor('5pm', '08:15:00')).toBe('08:15:00')
    expect(valueFor('3:00 PM', '')).toBe('')
  })
})

describe('toDisplay', () => {
  it('shows a stored time with seconds as HH:MM', () => {
    expect(toDisplay('08:15:00')).toBe('08:15')
  })

  it('shows HH:MM unchanged', () => {
    expect(toDisplay('17:45')).toBe('17:45')
  })

  it('shows nothing for an empty or missing value', () => {
    expect(toDisplay('')).toBe('')
    expect(toDisplay(null)).toBe('')
    expect(toDisplay(undefined)).toBe('')
  })
})

describe('TIME_ERROR', () => {
  it('tells the user what to type, in plain English', () => {
    expect(TIME_ERROR).toMatch(/24-hour/)
    expect(TIME_ERROR).toMatch(/17:30/)
  })
})
