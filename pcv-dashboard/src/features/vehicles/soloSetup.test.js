// src/features/vehicles/soloSetup.test.js
//
// The Dashboard's Announce Solo set-up: which departures a sign runs, how far
// from the first stop and how close to the time it may start one, and the
// warnings that stand in for the "no shared start or end stop" rule
// (docs/ANNOUNCE-PRODUCT-TIERS.md "Hard precondition").

import { describe, it, expect } from 'vitest'
import {
  SOLO_DEFAULTS,
  formatDays,
  toDepartureOption,
  validateSoloSettings,
  findSoloWarnings,
  describeDeviceStatus,
} from './soloSetup.js'

// About 1 km apart in latitude, so stops in different places never come
// within any radius the form allows.
const SPALDING = { id: 's1', name: 'Spalding Bus Station', lat: 52.7860, lon: -0.1530 }
const DEPOT    = { id: 's2', name: 'Pinchbeck Depot',      lat: 52.7950, lon: -0.1530 }
const SCHOOL   = { id: 's3', name: 'Bourne Academy',       lat: 52.7680, lon: -0.3770 }
const NEAR_SPALDING = { id: 's4', name: 'Spalding, Sheep St', lat: 52.7865, lon: -0.1530 } // ~55 m away

function row({ id, routeId = 'r1', service = 'S125S', destination = 'Bourne', time = '07:27:00',
  days = [1, 2, 3, 4, 5], school = false, stops = [SPALDING, SCHOOL] }) {
  return {
    id,
    departure_time: time,
    days_of_week: days,
    school_term_time: school,
    timetable: {
      name: 'Morning',
      route: { id: routeId, service_code: service, destination },
      timetable_stops: stops.map((s, i) => ({ sequence: (i + 1) * 10, stop: s })).reverse(),
    },
  }
}

describe('formatDays', () => {
  it('names the common patterns in words', () => {
    expect(formatDays([1, 2, 3, 4, 5])).toBe('Mon–Fri')
    expect(formatDays([1, 2, 3, 4, 5, 6, 7])).toBe('Every day')
    expect(formatDays([6, 7])).toBe('Sat, Sun')
    expect(formatDays([5, 1, 3])).toBe('Mon, Wed, Fri')
  })

  it('says so when a departure has no days', () => {
    expect(formatDays([])).toBe('No days')
    expect(formatDays(null)).toBe('No days')
  })
})

describe('toDepartureOption', () => {
  it('takes the first and last stop by sequence, whatever order they arrive in', () => {
    const o = toDepartureOption(row({ id: 'd1', stops: [SPALDING, DEPOT, SCHOOL] }))
    expect(o.firstStop.id).toBe('s1')
    expect(o.lastStop.id).toBe('s3')
  })

  it('shows the time as 24-hour HH:MM and says when it runs', () => {
    const o = toDepartureOption(row({ id: 'd1', school: true }))
    expect(o.label).toBe('S125S 07:27 to Bourne · Mon–Fri · school term only')
    expect(o.routeId).toBe('r1')
  })

  it('copes with a departure that has no stops yet', () => {
    const o = toDepartureOption(row({ id: 'd1', stops: [] }))
    expect(o.firstStop).toBeNull()
    expect(o.lastStop).toBeNull()
  })
})

describe('validateSoloSettings', () => {
  it('accepts the defaults', () => {
    expect(validateSoloSettings(SOLO_DEFAULTS)).toEqual([])
  })

  it('refuses numbers outside the allowed range, in plain English', () => {
    const errors = validateSoloSettings({ beforeMin: -1, afterMin: 500, radiusM: 10 })
    expect(errors).toHaveLength(3)
    expect(errors[0]).toMatch(/before/i)
    expect(errors[1]).toMatch(/after/i)
    expect(errors[2]).toMatch(/distance/i)
  })

  it('refuses a blank or fractional number', () => {
    expect(validateSoloSettings({ ...SOLO_DEFAULTS, beforeMin: '' })).toHaveLength(1)
    expect(validateSoloSettings({ ...SOLO_DEFAULTS, radiusM: 150.5 })).toHaveLength(1)
  })

  it('accepts whole numbers typed into a form (strings)', () => {
    expect(validateSoloSettings({ beforeMin: '10', afterMin: '20', radiusM: '200' })).toEqual([])
  })
})

describe('findSoloWarnings', () => {
  const options = [
    toDepartureOption(row({ id: 'am', time: '07:27:00' })),
    toDepartureOption(row({ id: 'pm', time: '15:20:00', stops: [SCHOOL, SPALDING] })),
  ]

  it('has nothing to say about one route whose stops no other service uses', () => {
    expect(findSoloWarnings(['am', 'pm'], options, SOLO_DEFAULTS)).toEqual([])
  })

  it('says when nothing is chosen, because the sign will never start', () => {
    const w = findSoloWarnings([], options, SOLO_DEFAULTS)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/no departures/i)
  })

  it('warns when another service starts or ends near a chosen first or last stop', () => {
    const other = toDepartureOption(row({ id: 'x', routeId: 'r2', service: '42', destination: 'Holbeach', stops: [NEAR_SPALDING, DEPOT] }))
    const w = findSoloWarnings(['am'], [...options, other], SOLO_DEFAULTS)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/S125S 07:27/)
    expect(w[0]).toMatch(/42/)
    expect(w[0]).toMatch(/Spalding Bus Station/)
  })

  it('does not warn about the other service once the distance is smaller than the gap', () => {
    const other = toDepartureOption(row({ id: 'x', routeId: 'r2', service: '42', stops: [NEAR_SPALDING, DEPOT] }))
    expect(findSoloWarnings(['am'], [...options, other], { ...SOLO_DEFAULTS, radiusM: 50 })).toEqual([])
  })

  it('names each other service once per chosen departure, however many of its runs share the stop', () => {
    const runs = ['x1', 'x2', 'x3'].map((id, i) =>
      toDepartureOption(row({ id, routeId: 'r2', service: '42', time: `0${7 + i}:00:00`, stops: [SPALDING, DEPOT] })))
    expect(findSoloWarnings(['am'], [...options, ...runs], SOLO_DEFAULTS)).toHaveLength(1)
  })

  it('does not count other runs of the same route as another service', () => {
    const later = toDepartureOption(row({ id: 'later', time: '09:27:00' }))
    expect(findSoloWarnings(['am'], [...options, later], SOLO_DEFAULTS)).toEqual([])
  })

  // These three leave out the unchosen afternoon run: S126 shares its stops,
  // which is the other-service warning above, not the one under test.
  it('warns when two chosen departures start at the same place too close in time to tell apart', () => {
    const close = toDepartureOption(row({ id: 'close', routeId: 'r3', service: 'S126', time: '07:50:00' }))
    const w = findSoloWarnings(['am', 'close'], [options[0], close], SOLO_DEFAULTS)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/S125S 07:27/)
    expect(w[0]).toMatch(/S126 07:50/)
  })

  it('does not warn about two chosen departures at the same place on different days', () => {
    const saturday = toDepartureOption(row({ id: 'sat', routeId: 'r3', service: 'S126', time: '07:50:00', days: [6] }))
    expect(findSoloWarnings(['am', 'sat'], [options[0], saturday], SOLO_DEFAULTS)).toEqual([])
  })

  it('does not warn about two chosen departures at the same place far enough apart in time', () => {
    const later = toDepartureOption(row({ id: 'later', routeId: 'r3', service: 'S126', time: '08:30:00' }))
    expect(findSoloWarnings(['am', 'later'], [options[0], later], SOLO_DEFAULTS)).toEqual([])
  })

  it('ignores a chosen id that is no longer one of the company departures', () => {
    const w = findSoloWarnings(['am', 'gone'], options, SOLO_DEFAULTS)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/no longer/i)
  })
})

describe('describeDeviceStatus', () => {
  it('says Revoked first, whatever else the row says', () => {
    expect(describeDeviceStatus({ revoked_at: '2026-10-03T10:00:00Z', link_state: 'linked' })).toBe('Revoked')
  })

  it('says Lite when linked to a Driver device', () => {
    expect(describeDeviceStatus({ link_state: 'linked', candidate_departure_ids: ['a'] })).toBe('Linked to driver device (Lite)')
  })

  it('counts the departures of a Solo sign, and says when it has none', () => {
    expect(describeDeviceStatus({ link_state: 'unlinked', candidate_departure_ids: ['a', 'b'] })).toBe('Solo · 2 departures')
    expect(describeDeviceStatus({ link_state: 'unlinked', candidate_departure_ids: ['a'] })).toBe('Solo · 1 departure')
    expect(describeDeviceStatus({ link_state: 'unlinked', candidate_departure_ids: [] })).toBe('Solo · no departures chosen')
  })
})
