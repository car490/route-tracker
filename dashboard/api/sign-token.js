import { createHmac } from 'crypto'

function base64url(str) {
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function signJwt(journey_ids, driver_name, driver_id, secret) {
  const header  = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now     = Math.floor(Date.now() / 1000)
  const payload = base64url(JSON.stringify({
    iss:         'supabase',
    role:        'anon',
    driver_name: driver_name ?? 'Driver',
    driver_id,
    journey_ids,
    iat:         now,
    exp:         now + 86400,
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

  const { journey_ids, driver_name, driver_id } = req.body ?? {}
  if (!Array.isArray(journey_ids) || journey_ids.length === 0)
    return res.status(400).json({ error: 'journey_ids required' })

  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) return res.status(500).json({ error: 'SUPABASE_JWT_SECRET not configured' })

  return res.json({ token: signJwt(journey_ids, driver_name, driver_id, secret) })
}
