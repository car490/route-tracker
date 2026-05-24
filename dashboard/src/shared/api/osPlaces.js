const BASE = 'https://api.os.uk/search/places/v1'

export async function searchPlaces(query) {
  if (!query || query.length < 3) return []
  const key = import.meta.env.VITE_OS_PLACES_API_KEY
  if (!key) {
    console.warn('VITE_OS_PLACES_API_KEY is not set')
    return []
  }
  try {
    const url = `${BASE}/find?query=${encodeURIComponent(query)}&maxresults=8&dataset=DPA&key=${key}`
    const res = await fetch(url)
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
