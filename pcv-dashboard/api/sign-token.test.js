// pcv-dashboard/api/sign-token.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authenticateMock = vi.fn()
vi.mock('./_auth.js', () => ({
  authenticate: (...args) => authenticateMock(...args),
}))

const { default: handler } = await import('./sign-token.js')

function makeRes() {
  const res = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

function makeReq(body) {
  return { method: 'POST', headers: { authorization: 'Bearer sometoken' }, body }
}

// Builds a chainable query mock: .from(table).select(...).in/eq(...).maybeSingle()
// Each call records which table/method was used so the test can steer the result.
function makeSupabase({ journeysRows, employeeRow } = {}) {
  const journeysQuery = {
    select: vi.fn(() => journeysQuery),
    in: vi.fn(() => Promise.resolve({ data: journeysRows ?? [] })),
  }
  const employeesQuery = {
    select: vi.fn(() => employeesQuery),
    eq: vi.fn(() => employeesQuery),
    maybeSingle: vi.fn(() => Promise.resolve({ data: employeeRow ?? null })),
  }
  const from = vi.fn(table => {
    if (table === 'journeys') return journeysQuery
    if (table === 'employees') return employeesQuery
    throw new Error(`unexpected table ${table}`)
  })
  return { from, _journeysQuery: journeysQuery, _employeesQuery: employeesQuery }
}

beforeEach(() => {
  authenticateMock.mockReset()
  process.env.SUPABASE_JWT_SECRET = 'test-secret'
})

describe('POST /api/sign-token', () => {
  it('returns 401 and never touches SUPABASE_JWT_SECRET when authenticate() fails', async () => {
    authenticateMock.mockResolvedValue(null)
    const req = makeReq({ journey_ids: ['j1'] })
    const res = makeRes()

    delete process.env.SUPABASE_JWT_SECRET
    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
  })

  it('returns 403 when fewer journeys come back than requested', async () => {
    const supabase = makeSupabase({ journeysRows: [{ id: 'j1' }] })
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase })
    const req = makeReq({ journey_ids: ['j1', 'j2'] })
    const res = makeRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'One or more journeys are not accessible' })
    const jsonCalls = res.json.mock.calls.map(c => c[0])
    expect(jsonCalls.every(body => !('token' in body))).toBe(true)
  })

  it('returns 403 when driver_id is given but not found among accessible employees', async () => {
    const supabase = makeSupabase({ journeysRows: [{ id: 'j1' }], employeeRow: null })
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase })
    const req = makeReq({ journey_ids: ['j1'], driver_id: 'nope' })
    const res = makeRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'driver_id is not accessible' })
  })

  it('returns 200 with a token when all journeys (and driver_id, if given) are accessible', async () => {
    const supabase = makeSupabase({ journeysRows: [{ id: 'j1' }, { id: 'j2' }], employeeRow: { id: 'd1' } })
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase })
    const req = makeReq({ journey_ids: ['j1', 'j2'], driver_name: 'Jo', driver_id: 'd1' })
    const res = makeRes()

    await handler(req, res)

    expect(res.status).not.toHaveBeenCalledWith(401)
    expect(res.status).not.toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }))
  })
})
