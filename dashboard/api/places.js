const OS_BASE = 'https://api.os.uk/search/places/v1/find'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const key = process.env.OS_PLACES_API_KEY
  if (!key) {
    return res.status(500).json({ error: 'OS_PLACES_API_KEY not configured on server' })
  }

  const { query } = req.query
  if (!query) return res.status(400).json({ error: 'query required' })

  try {
    const url = `${OS_BASE}?query=${encodeURIComponent(query)}&maxresults=8&dataset=DPA&key=${key}`
    const origin = req.headers['origin'] ?? req.headers['referer'] ?? 'https://route-tracker-iota.vercel.app'
    const upstream = await fetch(url, {
      headers: { Referer: origin, Origin: origin },
    })
    const data = await upstream.json().catch(() => null)
    return res.status(upstream.status).json(data ?? { results: [] })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
