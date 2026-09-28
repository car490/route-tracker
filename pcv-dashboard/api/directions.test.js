// pcv-dashboard/api/directions.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authenticateMock = vi.fn()
vi.mock('./_auth.js', () => ({
  authenticate: (...args) => authenticateMock(...args),
}))

process.env.GRAPHHOPPER_URL = 'https://gh.example.test'
const { default: directions } = await import('./directions.js')
const { default: diagnostics } = await import('./directions-diagnostics.js')

function makeRes() {
  const res = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

const goodBody = { coordinates: [[-2.9, 51.4], [-2.8, 51.5]] }

beforeEach(() => {
  authenticateMock.mockReset()
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve('{"paths":[]}'),
    json: () => Promise.resolve({}),
  }))
})

describe('POST /api/directions', () => {
  it('returns 401 and never calls GraphHopper without a valid session', async () => {
    authenticateMock.mockResolvedValue(null)
    const res = makeRes()
    await directions({ method: 'POST', headers: {}, body: goodBody }, res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects too many, malformed or out-of-range coordinates', async () => {
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase: {} })
    const tooMany = Array.from({ length: 51 }, () => [-2.9, 51.4])
    for (const coordinates of [
      tooMany,
      [[-2.9, 51.4]],
      [[-2.9, 51.4], ['a', 'b']],
      [[-2.9, 51.4], [500, 51.4]],
      [[-2.9, 51.4], [-2.8, 95]],
      'nope',
    ]) {
      const res = makeRes()
      await directions({ method: 'POST', headers: {}, body: { coordinates } }, res)
      expect(res.status).toHaveBeenCalledWith(400)
    }
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('accepts a valid authenticated request', async () => {
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase: {} })
    const res = makeRes()
    await directions({ method: 'POST', headers: {}, body: goodBody }, res)
    expect(global.fetch).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalledWith(401)
    expect(res.status).not.toHaveBeenCalledWith(400)
  })
})

describe('GET /api/directions-diagnostics', () => {
  it('returns 401 and does not probe GraphHopper without a valid session', async () => {
    authenticateMock.mockResolvedValue(null)
    const res = makeRes()
    await diagnostics({ method: 'GET', headers: {} }, res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
