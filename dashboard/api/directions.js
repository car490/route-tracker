const ORS_BASE = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const key = process.env.ORS_API_KEY
  if (!key) {
    return res.status(500).json({ error: 'ORS_API_KEY not configured on server' })
  }

  let upstream
  try {
    upstream = await fetch(ORS_BASE, {
      method: 'POST',
      headers: {
        Authorization:  key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    return res.status(502).json({ error: `ORS unreachable: ${err.message}` })
  }

  const text = await upstream.text()
  let data
  try { data = JSON.parse(text) } catch { data = null }

  if (!upstream.ok) {
    const msg = data?.error?.message ?? data?.message ?? `ORS error ${upstream.status}: ${text.slice(0, 200)}`
    return res.status(upstream.status).json({ error: msg })
  }

  return res.status(200).json(data)
}
