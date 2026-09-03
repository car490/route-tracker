import { createHmac } from 'crypto'

function base64url(str) {
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// A 100-year exp, not no exp — unlike the duty-card token, this identifies a
// fixed kiosk installation and must not expire and blank the passenger sign
// daily, but Supabase Realtime's setAuth() hard-rejects any token missing
// `exp` with CHANNEL_ERROR "InvalidJWTToken: Fields `role` and `exp` are
// required in JWT" (confirmed live, 2026-08-28 — this silently broke every
// paired-mode Realtime subscription while plain REST reads kept working,
// since PostgREST doesn't require exp). A 100-year expiry satisfies
// Realtime's requirement without ever practically expiring in this device's
// operational lifetime. Mirrors vite.config.js's localSignAnnounceTokenApi
// exactly.
const ANNOUNCE_TOKEN_LIFETIME_SECONDS = 100 * 365 * 24 * 60 * 60

function signJwt(device_id, company_id, vehicle_id, secret) {
  const header  = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now     = Math.floor(Date.now() / 1000)
  const payload = base64url(JSON.stringify({
    iss:        'supabase',
    role:       'anon',
    device_id,
    company_id,
    vehicle_id,
    iat:        now,
    exp:        now + ANNOUNCE_TOKEN_LIFETIME_SECONDS,
  }))
  const sig = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `${header}.${payload}.${sig}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers['authorization']
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' })

  const { device_id, company_id, vehicle_id } = req.body ?? {}
  if (!device_id || !company_id)
    return res.status(400).json({ error: 'device_id and company_id required' })

  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) return res.status(500).json({ error: 'SUPABASE_JWT_SECRET not configured' })

  return res.json({ token: signJwt(device_id, company_id, vehicle_id, secret) })
}
