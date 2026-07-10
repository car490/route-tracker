import { useEffect, useState } from 'react'
import { supabase } from '../../shared/supabase'
import { searchPlaces } from '../../shared/api/osPlaces'
import { TYPE_DEFAULTS } from './constants'
import { timeToMinutes, minutesToTime, fetchSegments, combineGeometries, buildSegAfterMap, totalScheduledDuration } from './utils'

// Stop-building logic shared by RoutePlannerPage (existing routes/timetables) and
// RouteWizard (brand-new routes) — drop-pin/search/NAPTAN, reordering, auto-routing,
// and scheduled-time auto-fill all live here so neither consumer duplicates it.
export function useStopsBuilder(vehicleType) {
  const [stops,       setStops]       = useState([])
  const [routing,     setRouting]     = useState(false)
  const [routeResult, setRouteResult] = useState(null)
  const [pinDropMode, setPinDropMode] = useState(false)

  const [showSearch,    setShowSearch]    = useState(false)
  const [searchQuery,   setSearchQuery]   = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching,     setSearching]     = useState(false)

  // NAPTAN proximity suggestion — set when a pin drop or address result lands near a known bus stop
  const [naptanPending,  setNaptanPending]  = useState(null) // { original, naptan }
  const [checkingNaptan, setCheckingNaptan] = useState(false)

  // Stop name inline editing
  const [editStopId,   setEditStopId]   = useState(null)
  const [editStopName, setEditStopName] = useState('')

  const [fitKey, setFitKey] = useState(null)

  function resolvedVehicle() {
    if (!vehicleType?.length) return null
    const dims = vehicleType.map(vt => TYPE_DEFAULTS[vt]).filter(Boolean)
    if (!dims.length) return null
    return {
      height_metres: Math.max(...dims.map(d => d.height_metres)),
      width_metres:  Math.max(...dims.map(d => d.width_metres)),
      length_metres: Math.max(...dims.map(d => d.length_metres)),
    }
  }

  // ── Auto-routing (N-1 parallel segment calls) ─────────────────────────────────

  useEffect(() => {
    const pts = stops.filter(s => s.lat != null && s.lon != null)
    if (pts.length < 2) { setRouteResult(null); return }

    const vehicle = resolvedVehicle()
    let cancelled = false
    setRouting(true)

    fetchSegments(pts, vehicle).then(segs => {
      if (cancelled) return
      const valid = segs.filter(s => s && !s.error)
      setRouteResult({
        segments: segs,
        geometry: combineGeometries(valid),
        distance: valid.reduce((sum, s) => sum + s.distance, 0),
        duration: valid.reduce((sum, s) => sum + s.duration, 0),
        warnings: valid.flatMap(s => s.warnings ?? []),
        error:    valid.length === 0 ? (segs.find(s => s?.error)?.error ?? 'Could not find a route') : null,
      })
      setRouting(false)
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, vehicleType])

  // Catch-up fill: routing resolved after the user already typed a time
  useEffect(() => {
    if (!routeResult?.segments) return
    setStops(prev => {
      const firstSetIdx = prev.findIndex(s => s.stop_type === 'timing_point' && s.time_std)
      if (firstSetIdx === -1) return prev
      const hasEmptyAfter = prev.slice(firstSetIdx + 1).some(s => s.stop_type === 'timing_point' && !s.time_std)
      if (!hasEmptyAfter) return prev
      const segsMap = buildSegAfterMap(prev, routeResult.segments)
      const baseMins = timeToMinutes(prev[firstSetIdx].time_std)
      let cumSecs = 0
      const updated = [...prev]
      for (let i = firstSetIdx; i < prev.length - 1; i++) {
        const seg = segsMap[prev[i]._id]
        if (seg && !seg.error) cumSecs += seg.duration
        const next = prev[i + 1]
        if (next.stop_type === 'timing_point' && !next.time_std) {
          updated[i + 1] = { ...next, time_std: minutesToTime(baseMins + Math.round(cumSecs / 60)) }
        }
      }
      return updated
    })
  }, [routeResult])  

  // ── Stop search ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearching(true)
      const { data: dbStops } = await supabase
        .from('stops').select('id, name, lat, lon').ilike('name', `%${searchQuery}%`).limit(6)
      if (cancelled) return
      const dbResults = (dbStops ?? []).map(s => ({
        source: 'stop', stop_id: s.id, name: s.name, lat: s.lat, lon: s.lon,
      }))
      setSearchResults(dbResults)

      const places = await searchPlaces(searchQuery).catch(() => [])
      if (cancelled) return
      const combined = [...dbResults]
      for (const p of places ?? []) {
        if (!combined.find(r => r.name === p.address)) {
          combined.push({ source: 'addr', name: p.address, lat: p.lat, lon: p.lon })
        }
      }
      setSearchResults(combined)
      setSearching(false)
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [searchQuery])

  function commitStop(name, lat, lon, stopId = null, naptanCode = null) {
    setStops(prev => [...prev, {
      _id: crypto.randomUUID(),
      stop_id:     stopId,
      naptan_code: naptanCode,
      name, lat, lon,
      stop_type: 'timing_point', time_std: '',
    }])
  }

  async function checkNaptanThenCommit(name, lat, lon) {
    setCheckingNaptan(true)
    try {
      const { data } = await supabase.rpc('naptan_near_point', { p_lat: lat, p_lon: lon, p_radius_m: 25 })
      const nearest = data?.[0] ?? null
      if (nearest) {
        setNaptanPending({ original: { name, lat, lon }, naptan: nearest })
      } else {
        commitStop(name, lat, lon)
      }
    } catch {
      commitStop(name, lat, lon)
    } finally {
      setCheckingNaptan(false)
    }
  }

  function handleAddStop(result) {
    setShowSearch(false); setSearchQuery(''); setSearchResults([])
    if (result.stop_id) {
      // Already a known DB stop — skip NAPTAN check
      commitStop(result.name, result.lat, result.lon, result.stop_id)
    } else {
      // Address result — check for a nearby NAPTAN bus stop
      checkNaptanThenCommit(result.name, result.lat, result.lon)
    }
  }

  function handleMapPinDrop({ name, lat, lon }) {
    checkNaptanThenCommit(name, lat, lon)
  }

  function closeSearch() {
    setShowSearch(false); setSearchQuery(''); setSearchResults([])
  }

  // ── Stop mutations ────────────────────────────────────────────────────────────

  function moveStop(i, dir) {
    setStops(prev => {
      const arr = [...prev]
      const j = i + dir
      if (j < 0 || j >= arr.length) return arr
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return arr
    })
  }

  function removeStop(i) { setStops(prev => prev.filter((_, idx) => idx !== i)) }
  function removeStopById(id) { setStops(prev => prev.filter(s => s._id !== id)) }

  function autoFillNextTiming(stopsArr, changedIdx, newTime) {
    const baseMins = timeToMinutes(newTime)
    if (baseMins == null) return stopsArr
    const segsMap = buildSegAfterMap(stopsArr, routeResult?.segments)
    let cumSecs = 0
    const updated = [...stopsArr]
    for (let i = changedIdx; i < stopsArr.length - 1; i++) {
      const seg = segsMap[stopsArr[i]._id]
      if (seg && !seg.error) cumSecs += seg.duration
      const next = stopsArr[i + 1]
      if (next.stop_type === 'timing_point') {
        updated[i + 1] = { ...next, time_std: minutesToTime(baseMins + Math.round(cumSecs / 60)) }
      }
    }
    return updated
  }

  function updateStop(i, field, value) {
    const updated = stops.map((s, idx) => idx === i ? { ...s, [field]: value } : s)
    if (field === 'time_std' && stops[i]?.stop_type === 'timing_point' && value) {
      setStops(autoFillNextTiming(updated, i, value))
    } else {
      setStops(updated)
    }
  }

  function startEditName(stop) { setEditStopId(stop._id); setEditStopName(stop.name) }
  function commitEditName(i) {
    const name = editStopName.trim()
    if (name) updateStop(i, 'name', name)
    setEditStopId(null)
  }

  const vehicle       = resolvedVehicle()
  const warnings      = routeResult?.warnings ?? []
  const segAfterStop  = buildSegAfterMap(stops, routeResult?.segments)
  const totalDurationSec = totalScheduledDuration(stops, segAfterStop)

  return {
    stops, setStops,
    routing, routeResult, vehicle, warnings, segAfterStop, totalDurationSec,
    pinDropMode, setPinDropMode,
    showSearch, setShowSearch, searchQuery, setSearchQuery, searchResults, searching,
    naptanPending, setNaptanPending, checkingNaptan,
    editStopId, setEditStopId, editStopName, setEditStopName,
    fitKey, setFitKey,
    commitStop, checkNaptanThenCommit, handleAddStop, handleMapPinDrop, closeSearch,
    moveStop, removeStop, removeStopById, updateStop,
    startEditName, commitEditName,
  }
}
