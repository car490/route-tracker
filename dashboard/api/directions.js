import { buildGHBody, normaliseGHResponse } from './_graphhopper.js'

function firstNonEmpty(...values) {
  return values.find(v => typeof v === 'string' && v.trim().length > 0)
}

const GH_BASE = firstNonEmpty(
  process.env.GRAPHHOPPER_URL,
  process.env.GH_URL,
  process.env.GRAPHHOPPER_API_URL,
  process.env.VITE_GRAPHHOPPER_URL,
  process.env.VITE_GH_URL,
)

const GH_PROFILE = firstNonEmpty(
  process.env.GRAPHHOPPER_PROFILE,
  process.env.GH_PROFILE,
  process.env.VITE_GRAPHHOPPER_PROFILE,
  process.env.VITE_GH_PROFILE,
) ?? 'pcv'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!GH_BASE) {
    return res.status(503).json({ error: 'GraphHopper URL is not configured (set GRAPHHOPPER_URL)' })
  }

  const { coordinates, vehicle } = req.body ?? {}
  if (!coordinates || coordinates.length < 2) {
    return res.status(400).json({ error: 'At least 2 coordinates required' })
  }

  let upstream
  try {
    upstream = await fetch(`${GH_BASE}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGHBody(coordinates, vehicle, GH_PROFILE)),
      signal: AbortSignal.timeout(15000),
    })
  } catch (err) {
    return res.status(502).json({ error: `GraphHopper unreachable: ${err.message}` })
  }

  const text = await upstream.text()
  let data
  try { data = JSON.parse(text) } catch { data = null }

  if (!upstream.ok) {
    const msg = data?.message ?? `Routing error ${upstream.status}: ${text.slice(0, 200)}`
    return res.status(upstream.status).json({ error: msg })
  }

  return res.status(200).json(normaliseGHResponse(data))
}
