function firstNonEmptyEntry(candidates) {
  for (const [key, value] of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return { key, value: value.trim() }
    }
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const urlEntry = firstNonEmptyEntry([
    ['GRAPHHOPPER_URL', process.env.GRAPHHOPPER_URL],
    ['GH_URL', process.env.GH_URL],
    ['GRAPHHOPPER_API_URL', process.env.GRAPHHOPPER_API_URL],
    ['VITE_GRAPHHOPPER_URL', process.env.VITE_GRAPHHOPPER_URL],
    ['VITE_GH_URL', process.env.VITE_GH_URL],
  ])

  const profileEntry = firstNonEmptyEntry([
    ['GRAPHHOPPER_PROFILE', process.env.GRAPHHOPPER_PROFILE],
    ['GH_PROFILE', process.env.GH_PROFILE],
    ['VITE_GRAPHHOPPER_PROFILE', process.env.VITE_GRAPHHOPPER_PROFILE],
    ['VITE_GH_PROFILE', process.env.VITE_GH_PROFILE],
  ])

  const profile = profileEntry?.value ?? 'pcv'

  let urlHost = null
  if (urlEntry?.value) {
    try {
      urlHost = new URL(urlEntry.value).host
    } catch {
      urlHost = '(invalid URL)'
    }
  }

  let health = {
    attempted: false,
    ok: false,
    status: null,
    error: null,
  }

  // Lightweight upstream probe: minimal valid route request, short timeout, no secret leakage.
  if (urlEntry?.value) {
    health.attempted = true
    try {
      const upstream = await fetch(`${urlEntry.value}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points: [[-0.1, 51.5], [-0.12, 51.51]],
          profile,
          points_encoded: false,
          instructions: false,
        }),
        signal: AbortSignal.timeout(5000),
      })
      health.ok = upstream.ok
      health.status = upstream.status
    } catch (err) {
      health.error = err?.message ?? 'Unknown probe error'
    }
  }

  return res.status(200).json({
    graphhopper: {
      urlConfigured: Boolean(urlEntry),
      urlSource: urlEntry?.key ?? null,
      // Only expose hostname/port for troubleshooting; never return full env values.
      urlHost,
      profile,
      profileSource: profileEntry?.key ?? 'default',
      health,
    },
  })
}