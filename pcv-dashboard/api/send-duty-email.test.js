// pcv-dashboard/api/send-duty-email.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authenticateMock = vi.fn()
vi.mock('./_auth.js', () => ({
  authenticate: (...args) => authenticateMock(...args),
}))

const { default: handler } = await import('./send-duty-email.js')

function makeRes() {
  const res = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

function makeReq(body) {
  return { method: 'POST', headers: { authorization: 'Bearer sometoken' }, body }
}

// Chainable mock covering both:
//   .from('employees').select('id, name').eq('id', id).maybeSingle()
//   .from('employee_contacts').select('value').eq(...).eq(...).order(...).limit(...).maybeSingle()
function makeSupabase({ driverRow, contactRow } = {}) {
  const employeesQuery = {
    select: vi.fn(() => employeesQuery),
    eq: vi.fn(() => employeesQuery),
    maybeSingle: vi.fn(() => Promise.resolve({ data: driverRow ?? null })),
  }
  const contactsQuery = {
    select: vi.fn(() => contactsQuery),
    eq: vi.fn(() => contactsQuery),
    order: vi.fn(() => contactsQuery),
    limit: vi.fn(() => contactsQuery),
    maybeSingle: vi.fn(() => Promise.resolve({ data: contactRow ?? null })),
  }
  const from = vi.fn(table => {
    if (table === 'employees') return employeesQuery
    if (table === 'employee_contacts') return contactsQuery
    throw new Error(`unexpected table ${table}`)
  })
  return { from }
}

beforeEach(() => {
  authenticateMock.mockReset()
  process.env.RESEND_API_KEY = 'test-key'
  process.env.RESEND_FROM = 'noreply@example.com'
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ id: 'email-1' }),
  }))
})

describe('POST /api/send-duty-email', () => {
  it('returns 401 when authenticate() fails', async () => {
    authenticateMock.mockResolvedValue(null)
    const req = makeReq({ driver_id: 'd1', date: '2026-09-20', url: 'https://example.com/duty' })
    const res = makeRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns 403 when driver_id lookup is empty', async () => {
    const supabase = makeSupabase({ driverRow: null })
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase })
    const req = makeReq({ driver_id: 'd1', date: '2026-09-20', url: 'https://example.com/duty' })
    const res = makeRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'driver_id is not accessible' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns 400 when the driver has no email address on file', async () => {
    const supabase = makeSupabase({ driverRow: { id: 'd1', name: 'Jo Driver' }, contactRow: null })
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase })
    const req = makeReq({ driver_id: 'd1', date: '2026-09-20', url: 'https://example.com/duty' })
    const res = makeRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'No email address on file for this driver' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('sends the email and returns 200 on the happy path', async () => {
    const supabase = makeSupabase({
      driverRow: { id: 'd1', name: 'Jo Driver' },
      contactRow: { value: 'jo@example.com' },
    })
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase })
    const req = makeReq({ driver_id: 'd1', date: '2026-09-20', url: 'https://example.com/duty', company_name: 'Phil Haines Coaches' })
    const res = makeRes()

    await handler(req, res)

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [, options] = global.fetch.mock.calls[0]
    const sentBody = JSON.parse(options.body)
    expect(sentBody.to).toBe('jo@example.com')
    expect(res.json).toHaveBeenCalledWith({ ok: true })
  })

  it('HTML-escapes driver name and company name in the html field but not the text field', async () => {
    const supabase = makeSupabase({
      driverRow: { id: 'd1', name: '<b>Evil</b>' },
      contactRow: { value: 'jo@example.com' },
    })
    authenticateMock.mockResolvedValue({ user: { id: 'u1' }, supabase })
    const req = makeReq({
      driver_id: 'd1',
      date: '2026-09-20',
      url: 'https://example.com/duty',
      company_name: 'A & B Coaches',
    })
    const res = makeRes()

    await handler(req, res)

    const [, options] = global.fetch.mock.calls[0]
    const sentBody = JSON.parse(options.body)
    expect(sentBody.html).toContain('&lt;b&gt;Evil&lt;/b&gt;')
    expect(sentBody.html).not.toContain('<b>Evil</b>')
    expect(sentBody.html).toContain('A &amp; B Coaches')
    expect(sentBody.text).toContain('<b>Evil</b>')
    expect(sentBody.text).toContain('A & B Coaches')
  })
})
