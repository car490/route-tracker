const GH_BASE = 'https://graphhopper.com/api/1/route'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const key = process.env.GH_API_KEY
  if (!key) {
    return res.status(500).json({ error: 'GH_API_KEY not configured on server' })
  }

  // req.body has { coordinates: [[lon,lat],...], options: {...} } from ors.js
  const coordinates = req.body?.coordinates ?? []
  if (coordinates.length < 2) {
    return res.status(400).json({ error: 'At least 2 coordinates required' })
  }

  const ghBody = {
    profile: 'truck',
    points: coordinates,   // GraphHopper uses [lon, lat] — same order as ORS
    points_encoded: false,
  }

  let upstream
  try {
    upstream = await fetch(`${GH_BASE}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ghBody),
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    return res.status(502).json({ error: `Routing unreachable: ${err.message}` })
  }

  const text = await upstream.text()
  let data
  try { data = JSON.parse(text) } catch { data = null }

  if (!upstream.ok) {
    const msg = data?.message ?? `Routing error ${upstream.status}: ${text.slice(0, 200)}`
    return res.status(upstream.status).json({ error: msg })
  }

  // Normalise GraphHopper response to ORS FeatureCollection shape so ors.js needs no changes
  const path = data.paths?.[0]
  if (!path) return res.status(200).json({ features: [] })

  return res.status(200).json({
    features: [{
      geometry: path.points,
      properties: {
        summary: {
          distance: path.distance,
          duration: path.time / 1000,
        },
        warnings: (path.warnings ?? []).map(w => ({ message: w.message ?? String(w) })),
      },
    }],
  })
}
