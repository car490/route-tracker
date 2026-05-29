export async function searchPlaces(query) {
  if (!query || query.length < 3) return []
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&countrycodes=gb&addressdetails=0`
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
    if (!res.ok) return []
    const json = await res.json()
    return (json ?? [])
      .map(r => ({
        address: r.display_name ?? '',
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
      }))
      .filter(r => r.address && r.lat && r.lon)
  } catch {
    return []
  }
}
