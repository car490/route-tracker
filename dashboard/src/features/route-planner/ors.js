const BASE = 'https://api.openrouteservice.org/v2/directions/driving-hgv'

/**
 * Get a bus/coach-aware route from OpenRouteService.
 * Uses the driving-hgv profile with vehicle_type=bus, which respects OSM
 * maxheight / maxwidth / maxlength restriction tags.
 *
 * @param {Array<{lat, lon}>} waypoints  — ordered list of at least 2 points
 * @param {Object|null}       vehicle    — vehicle row with height/width/length_metres
 * @returns {{ geometry, distance, duration, warnings } | { error } | null}
 */
export async function getRouteORS(waypoints, vehicle = null) {
  if (!waypoints || waypoints.length < 2) return null

  const coordinates = waypoints.map(w => [w.lon, w.lat])

  const body = {
    coordinates,
    geometries: 'geojson',
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
    const res = await fetch(BASE, {
      method: 'POST',
      headers: {
        Authorization:   import.meta.env.VITE_ORS_API_KEY,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const payload = await res.json().catch(() => null)
      return { error: payload?.error?.message ?? `ORS error ${res.status}` }
    }

    const json = await res.json()
    if (!json.routes?.length) return null

    const route = json.routes[0]
    return {
      geometry: route.geometry,           // GeoJSON LineString
      distance: route.summary.distance,   // metres
      duration: route.summary.duration,   // seconds
      warnings: route.warnings ?? [],
    }
  } catch (e) {
    return { error: e.message }
  }
}
