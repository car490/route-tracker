const VALHALLA_BASE = 'https://valhalla.openstreetmap.de/route'

// Decode Valhalla's precision-6 encoded polyline → [lon, lat] pairs
function decodePolyline(encoded, precision = 6) {
  const factor = Math.pow(10, precision)
  const coords = []
  let index = 0, lat = 0, lon = 0
  while (index < encoded.length) {
    let shift = 0, val = 0, b
    do { b = encoded.charCodeAt(index++) - 63; val |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += (val & 1) ? ~(val >> 1) : (val >> 1)
    shift = 0; val = 0
    do { b = encoded.charCodeAt(index++) - 63; val |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lon += (val & 1) ? ~(val >> 1) : (val >> 1)
    coords.push([lon / factor, lat / factor])
  }
  return coords
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const coordinates = req.body?.coordinates ?? []
  if (coordinates.length < 2) {
    return res.status(400).json({ error: 'At least 2 coordinates required' })
  }

  // Valhalla expects { lon, lat } objects
  const locations = coordinates.map(([lon, lat]) => ({ lon, lat }))

  let upstream
  try {
    upstream = await fetch(VALHALLA_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations,
        costing: 'truck',
        costing_options: {
          truck: { height: 4.0, width: 2.6, length: 14.0, weight: 21.77, axle_load: 9.07 },
        },
      }),
      signal: AbortSignal.timeout(10000),
    })
  } catch (err) {
    return res.status(502).json({ error: `Routing unreachable: ${err.message}` })
  }

  const text = await upstream.text()
  let data
  try { data = JSON.parse(text) } catch { data = null }

  if (!upstream.ok) {
    const msg = data?.error ?? `Routing error ${upstream.status}: ${text.slice(0, 200)}`
    return res.status(upstream.status).json({ error: msg })
  }

  const leg = data.trip?.legs?.[0]
  if (!leg) return res.status(200).json({ features: [] })

  // Normalise to ORS FeatureCollection shape so ors.js client needs no changes
  return res.status(200).json({
    features: [{
      geometry: {
        type: 'LineString',
        coordinates: decodePolyline(leg.shape),
      },
      properties: {
        summary: {
          distance: data.trip.summary.length * 1000,  // km → metres
          duration: data.trip.summary.time,            // seconds
        },
        warnings: [],
      },
    }],
  })
}
