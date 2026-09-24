import { buildGHBody, normaliseGHResponse } from './_graphhopper.js'
import { authenticate } from './_auth.js'

// Route planner legs are a handful of stops; this caps what one request can make
// GraphHopper compute.
const MAX_COORDINATES = 50

function validCoordinates(coords) {
  return Array.isArray(coords)
    && coords.length >= 2
    && coords.length <= MAX_COORDINATES
    && coords.every(c =>
      Array.isArray(c) && c.length >= 2
      && Number.isFinite(c[0]) && Math.abs(c[0]) <= 180
      && Number.isFinite(c[1]) && Math.abs(c[1]) <= 90)
}

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

  // Signed-in dashboard users only: this proxies a paid/limited routing backend.
  if (!(await authenticate(req))) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!GH_BASE) {
    return res.status(503).json({ error: 'GraphHopper URL is not configured (set GRAPHHOPPER_URL)' })
  }

  const { coordinates, vehicle } = req.body ?? {}
  if (!validCoordinates(coordinates)) {
    return res.status(400).json({ error: `Between 2 and ${MAX_COORDINATES} valid [lon, lat] coordinates required` })
  }

  const ghRequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildGHBody(coordinates, vehicle, GH_PROFILE)),
    signal: AbortSignal.timeout(15000),
  }

  let upstream
  try {
    upstream = await fetch(`${GH_BASE}/route`, ghRequestInit)
  } catch (firstErr) {
    console.error('GraphHopper fetch failed, retrying once', {
      message: firstErr.message,
      cause: firstErr.cause ? String(firstErr.cause) : undefined,
    })
    try {
      upstream = await fetch(`${GH_BASE}/route`, ghRequestInit)
    } catch (err) {
      console.error('GraphHopper fetch failed on retry', {
        message: err.message,
        cause: err.cause ? String(err.cause) : undefined,
      })
      return res.status(502).json({
        error: `GraphHopper unreachable: ${err.message}${err.cause ? ` (${err.cause})` : ''}`,
      })
    }
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
