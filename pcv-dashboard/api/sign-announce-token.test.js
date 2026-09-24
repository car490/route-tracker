// pcv-dashboard/api/sign-announce-token.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authenticateMock = vi.fn()
vi.mock('./_auth.js', () => ({
  authenticate: (...args) => authenticateMock(...args),
}))

const { default: handler } = await import('./sign-announce-token.js')

function makeRes() {
  const res = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

function makeReq(body) {
  return { method: 'POST', headers: { authorization: 'Bearer sometoken' }, body }
}

function makeSupabase({ companyRow, deviceRow, vehicleRow } = {}) {
  const companiesQuery = {
    select: vi.fn(() => companiesQuery),
    eq: vi.fn(() => companiesQuery),
    maybeSingle: vi.fn(() => Promise.resolve({ data: companyRow ?? null })),
  }
  const devicesQuery = {
    select: vi.fn(() => devicesQuery),
    eq: vi.fn(() => devicesQuery),
    maybeSingle: vi.fn(() => Promise.resolve({ data: deviceRow ?? null })),
  }
  const vehiclesQuery = {
    select: vi.fn(() => vehiclesQuery),
    eq: vi.fn(() => vehiclesQuery),
    maybeSingle: vi.fn(() => Promise.resolve({ data: vehicleRow ?? null })),
  }
  const from = vi.fn(table => {
    if (table === 'companies') return companiesQuery
    if (table === 'announce_devices') return devicesQuery
    if (table === 'vehicles') return vehiclesQuery
    throw new Error(`unexpected table ${table}`)
  })
  return { from, devicesQuery, vehiclesQuery }
}

beforeEach(() => {
  authenticateMock.mockReset()
  process.env.SUPABASE_JWT_SECRET = 'test-secret'
})

describe('POST /api/sign-announce-token', () => {
  it('returns 401 when authenticate() fails', async () => {
    authenticateMock.mockResolvedValue(null)
    const req = makeReq({ device_id: 'dev1', company_id: 'c1' })
    const res = makeRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
  })

  it('returns 403 when company_id is not accessible', async () => {
    const supabase = makeSupabase({ companyRow: null })
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase })
    const req = makeReq({ device_id: 'dev1', company_id: 'c1' })
    const res = makeRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'company_id is not accessible' })
  })

  it('returns 403 when device_id is given but not accessible', async () => {
    const supabase = makeSupabase({ companyRow: { id: 'c1' }, deviceRow: null })
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase })
    const req = makeReq({ device_id: 'dev1', company_id: 'c1' })
    const res = makeRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'device_id is not accessible' })
  })

  it('returns 403 when vehicle_id is not in the company', async () => {
    const supabase = makeSupabase({ companyRow: { id: 'c1' }, deviceRow: { id: 'dev1' }, vehicleRow: null })
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase })
    const req = makeReq({ device_id: 'dev1', company_id: 'c1', vehicle_id: 'other-company-vehicle' })
    const res = makeRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'vehicle_id is not accessible' })
    expect(supabase.vehiclesQuery.eq).toHaveBeenCalledWith('company_id', 'c1')
  })

  it('checks the device belongs to company_id, not just that RLS can see it', async () => {
    const supabase = makeSupabase({ companyRow: { id: 'c1' }, deviceRow: { id: 'dev1' } })
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase })
    await handler(makeReq({ device_id: 'dev1', company_id: 'c1' }), makeRes())
    expect(supabase.devicesQuery.eq).toHaveBeenCalledWith('company_id', 'c1')
  })

  it('returns 200 with a token when company_id, device_id and vehicle_id are all accessible', async () => {
    const supabase = makeSupabase({ companyRow: { id: 'c1' }, deviceRow: { id: 'dev1' }, vehicleRow: { id: 'v1' } })
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase })
    const req = makeReq({ device_id: 'dev1', company_id: 'c1', vehicle_id: 'v1' })
    const res = makeRes()

    await handler(req, res)

    expect(res.status).not.toHaveBeenCalledWith(401)
    expect(res.status).not.toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }))
  })
})
