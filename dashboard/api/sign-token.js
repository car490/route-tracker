export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers['authorization']
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { journey_ids, driver_name, driver_id } = req.body ?? {}
  if (!Array.isArray(journey_ids) || journey_ids.length === 0) {
    return res.status(400).json({ error: 'journey_ids required' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({ error: 'Server env vars missing (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)' })
  }

  try {
    const upstream = await fetch(
      `${supabaseUrl}/functions/v1/generate-duty-token`,
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': authHeader,
          'apikey':        anonKey,
        },
        body: JSON.stringify({ journey_ids, driver_name, driver_id }),
      }
    )
    const text = await upstream.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      // Edge Function returned non-JSON — surface the raw body for diagnosis
      return res.status(upstream.status).json({
        error: `Edge Function returned non-JSON (HTTP ${upstream.status}): ${text.slice(0, 200)}`,
      })
    }
    return res.status(upstream.status).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
