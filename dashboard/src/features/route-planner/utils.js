import { getRoute } from './directions'

export function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

export function fmtDur(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m} min`
}

export function stopColor(i, total) {
  if (i === 0) return '#4db848'
  if (i === total - 1) return '#e53935'
  return '#1e3d72'
}

export function timeToMinutes(t) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function minutesToTime(mins) {
  if (mins == null) return ''
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export async function fetchSegments(pts, vehicle) {
  if (!pts || pts.length < 2) return []
  return Promise.all(
    pts.slice(0, -1).map((from, i) => getRoute([from, pts[i + 1]], vehicle))
  )
}

export function combineGeometries(segments) {
  const coords = []
  for (const seg of segments) {
    const c = seg?.geometry?.coordinates
    if (!c) continue
    coords.push(...(coords.length ? c.slice(1) : c))
  }
  return coords.length >= 2 ? { type: 'LineString', coordinates: coords } : null
}

export function buildSegAfterMap(stops, segments) {
  const map = {}
  const valid = stops.filter(s => s.lat != null && s.lon != null)
  valid.forEach((s, i) => {
    if (i < valid.length - 1 && segments?.[i]) map[s._id] = segments[i]
  })
  return map
}
