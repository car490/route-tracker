const BASE = 'https://router.project-osrm.org/route/v1/driving'

export async function getRoute(waypoints) {
  if (!waypoints || waypoints.length < 2) return null
  const coords = waypoints.map(w => `${w.lon},${w.lat}`).join(';')
  try {
    const res = await fetch(`${BASE}/${coords}?overview=full&geometries=geojson`)
    if (!res.ok) return null
    const json = await res.json()
    if (json.code !== 'Ok' || !json.routes?.length) return null
    return {
      geometry: json.routes[0].geometry,
      distance: json.routes[0].distance,   // metres
      duration: json.routes[0].duration,   // seconds
    }
  } catch {
    return null
  }
}
