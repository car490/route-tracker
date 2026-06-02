export async function getRoute(waypoints, vehicle = null) {
  if (!waypoints || waypoints.length < 2) return null

  const coordinates = waypoints.map(w => [w.lon, w.lat])

  const body = { coordinates }
  if (vehicle) {
    body.vehicle = {
      height: vehicle.height_metres,
      width:  vehicle.width_metres,
      length: vehicle.length_metres,
    }
  }

  try {
    const res = await fetch('/api/directions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const payload = await res.json().catch(() => null)
      return { error: payload?.error ?? payload?.message ?? `Routing error ${res.status}` }
    }

    const json = await res.json()
    if (!json.features?.length) return null

    const feature = json.features[0]
    return {
      geometry: feature.geometry,
      distance: feature.properties.summary.distance,
      duration: feature.properties.summary.duration,
      warnings: feature.properties.warnings ?? [],
    }
  } catch (e) {
    return { error: e.message }
  }
}
