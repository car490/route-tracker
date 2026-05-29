export async function searchPlaces(query) {
  if (!query || query.length < 3) return []
  try {
    const res = await fetch(`/api/places?query=${encodeURIComponent(query)}`)
    if (!res.ok) return []
    const json = await res.json()
    return (json.results ?? [])
      .map(r => ({
        address: r.DPA?.ADDRESS ?? '',
        lat: parseFloat(r.DPA?.LAT ?? 0),
        lon: parseFloat(r.DPA?.LNG ?? 0),
      }))
      .filter(r => r.address && r.lat && r.lon)
  } catch {
    return []
  }
}
