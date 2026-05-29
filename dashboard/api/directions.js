const ORS_BASE = 'https://api.openrouteservice.org/v2/directions/driving-hgv/geojson'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const key = process.env.ORS_API_KEY
  if (!key) {
    return res.status(500).json({ error: 'ORS_API_KEY not configured on server' })
  }

  try {
    const upstream = await fetch(ORS_BASE, {
      method: 'POST',
      headers: {
        Authorization:  key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    })

    const data = await upstream.json().catch(() => null)
    return res.status(upstream.status).json(data ?? { error: `ORS error ${upstream.status}` })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
