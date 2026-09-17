// pcv-dashboard/api/_auth.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUserMock = vi.fn()
const createClientMock = vi.fn(() => ({ auth: { getUser: getUserMock } }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args) => createClientMock(...args),
}))

const { authenticate } = await import('./_auth.js')

function makeReq(headers) {
  return { headers: headers ?? {} }
}

beforeEach(() => {
  getUserMock.mockReset()
  createClientMock.mockClear()
})

describe('authenticate', () => {
  it('returns null when the Authorization header is missing', async () => {
    const result = await authenticate(makeReq())
    expect(result).toBeNull()
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('returns null when the Authorization header does not match Bearer <token>', async () => {
    const result = await authenticate(makeReq({ authorization: 'Basic abc123' }))
    expect(result).toBeNull()
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('returns null when auth.getUser returns an error', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: new Error('invalid token') })
    const result = await authenticate(makeReq({ authorization: 'Bearer sometoken' }))
    expect(result).toBeNull()
  })

  it('returns null when auth.getUser resolves no user', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const result = await authenticate(makeReq({ authorization: 'Bearer sometoken' }))
    expect(result).toBeNull()
  })

  it('returns { user, supabase } when auth.getUser resolves a user', async () => {
    const user = { id: 'user-1' }
    getUserMock.mockResolvedValue({ data: { user }, error: null })
    const result = await authenticate(makeReq({ authorization: 'Bearer sometoken' }))
    expect(result).not.toBeNull()
    expect(result.user).toEqual(user)
    expect(result.supabase).toBeDefined()
    // second createClient call carries the caller's token through
    const lastCallArgs = createClientMock.mock.calls.at(-1)
    expect(lastCallArgs[2]).toEqual({ global: { headers: { Authorization: 'Bearer sometoken' } } })
  })
})
