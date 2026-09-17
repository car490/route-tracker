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

function makeSupabase({ companyRow, deviceRow } = {}) {
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
  const from = vi.fn(table => {
    if (table === 'companies') return companiesQuery
    if (table === 'announce_devices') return devicesQuery
    throw new Error(`unexpected table ${table}`)
  })
  return { from }
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

  it('returns 200 with a token when company_id and device_id are both accessible', async () => {
    const supabase = makeSupabase({ companyRow: { id: 'c1' }, deviceRow: { id: 'dev1' } })
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase })
    const req = makeReq({ device_id: 'dev1', company_id: 'c1', vehicle_id: 'v1' })
    const res = makeRes()

    await handler(req, res)

    expect(res.status).not.toHaveBeenCalledWith(401)
    expect(res.status).not.toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }))
  })
})
