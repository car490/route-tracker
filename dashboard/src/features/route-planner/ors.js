export async function getRouteORS(waypoints, vehicle = null) {
  if (!waypoints || waypoints.length < 2) return null

  const coordinates = waypoints.map(w => [w.lon, w.lat])

  const body = {
    coordinates,
    options: { vehicle_type: 'bus' },
  }

  const restrictions = {}
  if (vehicle?.height_metres) restrictions.height = vehicle.height_metres
  if (vehicle?.width_metres)  restrictions.width  = vehicle.width_metres
  if (vehicle?.length_metres) restrictions.length = vehicle.length_metres

  if (Object.keys(restrictions).length > 0) {
    body.options.profile_params = { restrictions }
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
