import { describe, it, expect, vi } from 'vitest'
import {
  todayStr, depLabel, journeyActionsFor, routeOptionsFor, timetableOptionsFor,
  friendlySaveError, resetJourney, deleteJourney, driverLink, signedDriverLink,
} from './journeyActions.js'

const route116 = { id: 'r1', service_code: 'S116S' }
const route125 = { id: 'r2', service_code: 'S125S' }
const departures = [
  { id: 'd1', timetable_id: 't2', departure_time: '07:30:00', timetable: { id: 't2', name: 'Morning', direction: 'Outbound', route: route125 } },
  { id: 'd2', timetable_id: 't1', departure_time: '08:00:00', timetable: { id: 't1', name: 'Morning', direction: 'Outbound', route: route116 } },
  { id: 'd3', timetable_id: 't1', departure_time: '09:00:00', timetable: { id: 't1', name: 'Morning', direction: 'Outbound', route: route116 } },
  { id: 'd4', timetable_id: 't3', departure_time: '15:00:00', timetable: { id: 't3', name: 'Afternoon', direction: 'Inbound', route: route116 } },
]

describe('todayStr', () => {
  it('uses the local date, not UTC', () => {
    // 00:30 local on 25 Sept — toISOString() would say the 24th in BST.
    expect(todayStr(new Date(2026, 8, 25, 0, 30))).toBe('2026-09-25')
  })
})

describe('depLabel', () => {
  it('labels a journey by service, run and time', () => {
    expect(depLabel({ departure: departures[1] })).toBe('S116S Morning Outbound @ 08:00')
  })
  it('falls back to a dash with no departure', () => {
    expect(depLabel({ departure: null })).toBe('—')
  })
})

describe('journeyActionsFor', () => {
  it('scheduled: can run and delete, nothing to reset', () => {
    expect(journeyActionsFor('scheduled')).toEqual({ run: true, reset: false, complete: false, remove: true })
  })
  it('in progress: can run, reset, complete and delete', () => {
    expect(journeyActionsFor('in_progress')).toEqual({ run: true, reset: true, complete: true, remove: true })
  })
  it('completed: must reset before it can run again', () => {
    expect(journeyActionsFor('completed')).toEqual({ run: false, reset: true, complete: false, remove: true })
  })
  it('cancelled: delete only', () => {
    expect(journeyActionsFor('cancelled')).toEqual({ run: false, reset: false, complete: false, remove: true })
  })
})

describe('route and timetable options', () => {
  it('lists each route once, sorted by service code', () => {
    expect(routeOptionsFor(departures).map(r => r.service_code)).toEqual(['S116S', 'S125S'])
  })
  it('lists each run on a route once', () => {
    expect(timetableOptionsFor(departures, 'r1').map(t => t.id)).toEqual(['t1', 't3'])
  })
})

describe('friendlySaveError', () => {
  it('explains a double booking in plain English', () => {
    expect(friendlySaveError('duplicate key value violates unique constraint "journeys_no_double_booking"'))
      .toMatch(/already has a journey on this date/)
  })
  it('passes other errors through', () => {
    expect(friendlySaveError('boom')).toBe('boom')
  })
})

describe('resetJourney', () => {
  it('calls the one-transaction reset_journey RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    expect(await resetJourney({ rpc }, 'j1')).toEqual({ error: null })
    expect(rpc).toHaveBeenCalledWith('reset_journey', { p_journey_id: 'j1' })
  })
  it('reports a journey the user can no longer see', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null })
    expect((await resetJourney({ rpc }, 'j1')).error).toMatch(/not found/)
  })
  it('reports a database error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'offline' } })
    expect(await resetJourney({ rpc }, 'j1')).toEqual({ error: 'offline' })
  })
})

describe('deleteJourney', () => {
  function client(result) {
    const eq = vi.fn().mockResolvedValue(result)
    const del = vi.fn(() => ({ eq }))
    return { client: { from: vi.fn(() => ({ delete: del })) }, del, eq }
  }
  it('deletes by id', async () => {
    const { client: c, eq } = client({ error: null, count: 1 })
    expect(await deleteJourney(c, 'j1')).toEqual({ error: null })
    expect(eq).toHaveBeenCalledWith('id', 'j1')
  })
  it('reports when nothing was deleted', async () => {
    const { client: c } = client({ error: null, count: 0 })
    expect((await deleteJourney(c, 'j1')).error).toMatch(/not found/)
  })
})

describe('driver links', () => {
  it('builds the duty link with and without a token', () => {
    expect(driverLink('https://d.example', 'j1')).toBe('https://d.example/?duties=j1')
    expect(driverLink('https://d.example', 'j1', 'tok')).toBe('https://d.example/?duties=j1&token=tok')
  })

  const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: 'at' } } }) } }
  const journey = { id: 'j1', driver_id: 'e1', driver: { name: 'Sam' } }

  it('signs a token for just this journey and returns the link', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'tok' }) })
    const result = await signedDriverLink({ supabase, fetchImpl, pwaBase: 'https://d.example', journey })
    expect(result).toEqual({ url: 'https://d.example/?duties=j1&token=tok', error: null })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/sign-token')
    expect(init.headers.Authorization).toBe('Bearer at')
    expect(JSON.parse(init.body)).toEqual({ journey_ids: ['j1'], driver_name: 'Sam', driver_id: 'e1' })
  })
  it('reports a signing failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) })
    expect(await signedDriverLink({ supabase, fetchImpl, pwaBase: 'x', journey })).toEqual({ error: 'Unauthorized' })
  })
})
