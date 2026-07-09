import { getRoute } from './directions'

export function fmtDist(m) {
  return m < 1000 ? `${Math.round(m * 1.09361)} yd` : `${(m / 1609.344).toFixed(1)} mi`
}

export function fmtDur(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m} min`
}

export function stopColor(i, total, stopType) {
  if (i === 0) return '#10B981'
  if (i === total - 1) return '#EF4444'
  if (stopType === 'routing_point') return '#94A3B8'
  return 'var(--operator-accent)'
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

export function getScheduledMin(a, b) {
  if (a?.stop_type !== 'timing_point' || b?.stop_type !== 'timing_point') return null
  if (!a.time_std || !b.time_std) return null
  const diff = timeToMinutes(b.time_std) - timeToMinutes(a.time_std)
  return diff > 0 ? diff : null
}

export function totalScheduledDuration(stops, segAfterStop) {
  return stops.reduce((sum, s, i) => {
    const seg = segAfterStop[s._id]
    if (!seg || seg.error) return sum
    const sched = getScheduledMin(s, stops[i + 1])
    return sum + (sched != null ? sched * 60 : seg.duration)
  }, 0)
}
