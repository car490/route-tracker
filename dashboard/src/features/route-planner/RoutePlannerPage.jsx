import { Fragment, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../shared/supabase'
import { getCompanyId } from '../../shared/company'
import { searchPlaces } from '../../shared/api/osPlaces'
import { useJourneyTypes } from '../../shared/hooks/useJourneyTypes'
import { TYPE_DEFAULTS, DIRECTIONS, SINGLE_JOURNEY_DIRECTIONS, S } from './constants'
import { fmtDist, fmtDur, stopColor, timeToMinutes, minutesToTime, fetchSegments, combineGeometries, buildSegAfterMap } from './utils'
import PlannerMap from './PlannerMap'
import ReviewModal from './ReviewModal'
import DeparturesCard from './DeparturesCard'

function SegChip({ seg }) {
  if (!seg || seg.error) return null
  return (
    <div style={{
      paddingLeft: 22, marginBottom: 2,
      fontSize: 11, fontFamily: 'Oswald', fontWeight: 700,
      color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5,
    }}>
      <span>↓</span>
      <span>{fmtDur(seg.duration)}</span>
      <span style={{ fontWeight: 400, fontSize: 10 }}>·</span>
      <span style={{ fontWeight: 400 }}>{fmtDist(seg.distance)}</span>
    </div>
  )
}

export default function RoutePlannerPage() {
  const [searchParams] = useSearchParams()
  const pendingTtId = useRef(null)
  const { journeyTypes, bodsTypes } = useJourneyTypes()
  const [routeId,     setRouteId]     = useState('')
  const [timetableId, setTimetableId] = useState('')
  const [vehicleType, setVehicleType] = useState([])

  const [routes,     setRoutes]     = useState([])
  const [timetables, setTimetables] = useState([])

  // Inline new-route fields
  const [newCode,           setNewCode]           = useState('')
  const [newName,           setNewName]           = useState('')
  const [newJourneyTypes,   setNewJourneyTypes]   = useState([])
  const [newRouteCollapsed, setNewRouteCollapsed] = useState(false)
  const confirmRouteRef = useRef(null)
  // BODS-specific fields (only relevant when journey type requires_bods = true)
  const [newOrigin,      setNewOrigin]      = useState('')
  const [newDestination, setNewDestination] = useState('')
  const [newServiceReg,  setNewServiceReg]  = useState('')

  // Inline new-timetable fields
  const [newTtName,      setNewTtName]      = useState('')
  const [newDirection,   setNewDirection]   = useState('Outbound')
  const [newTtCollapsed, setNewTtCollapsed] = useState(false)

  const [departures, setDepartures] = useState([])

  const [stops,       setStops]       = useState([])
  const [routing,     setRouting]     = useState(false)
  const [routeResult, setRouteResult] = useState(null)
  const [pinDropMode, setPinDropMode] = useState(false)

  const [showSearch,    setShowSearch]    = useState(false)
  const [searchQuery,   setSearchQuery]   = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching,     setSearching]     = useState(false)

  // Stop name inline editing
  const [editStopId,   setEditStopId]   = useState(null)
  const [editStopName, setEditStopName] = useState('')

  // Confirmation / review modal
  const [showConfirm, setShowConfirm] = useState(false)
  const [modalStops,  setModalStops]  = useState([])
  const [autoDepTime, setAutoDepTime] = useState('')

  const [fitKey,        setFitKey]        = useState(null)
  const [singleJourney, setSingleJourney] = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [saveError,   setSaveError]   = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [showSetup,   setShowSetup]   = useState(true)

  // ── Load lookups ─────────────────────────────────────────────────────────────

  async function loadRoutes() {
    const { data } = await supabase.from('routes').select('*').order('service_code')
    setRoutes(data ?? [])
  }

  useEffect(() => {
    loadRoutes()
    const r = searchParams.get('route')
    const t = searchParams.get('timetable')
    if (r) { pendingTtId.current = t; setRouteId(r) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!routeId || routeId === '__new__') {
      setTimetables([]); setTimetableId('')
      setStops([]); setDepartures([])
      return
    }
    supabase.from('timetables').select('*').eq('route_id', routeId).order('name')
      .then(({ data }) => {
        setTimetables(data ?? [])
        if (pendingTtId.current) {
          setTimetableId(pendingTtId.current)
          pendingTtId.current = null
        }
      })
    setTimetableId('')
    setStops([])
    setDepartures([])
  }, [routeId])

  useEffect(() => {
    if (!timetableId || timetableId === '__new__') { setStops([]); setDepartures([]); return }
    Promise.all([
      supabase.from('timetable_stops').select('*, stops(*)').eq('timetable_id', timetableId).order('sequence'),
      supabase.from('timetable_departures').select('*').eq('timetable_id', timetableId).order('departure_time'),
    ]).then(([{ data: tsData }, { data: depData }]) => {
      const deps = depData ?? []
      setDepartures(deps)
      const baseStr = deps[0]?.departure_time ?? '07:00:00'
      const base    = timeToMinutes(baseStr.slice(0, 5))
      const loaded  = (tsData ?? []).map(ts => ({
        _id:        ts.id,
        stop_id:    ts.stop_id,
        name:       ts.stops.name,
        lat:        ts.stops.lat,
        lon:        ts.stops.lon,
        stop_type:  ts.stop_type,
        time_std:   ts.stop_type === 'timing_point' && ts.offset_standard != null ? minutesToTime(base + ts.offset_standard) : '',
        time_delay: ts.stop_type === 'timing_point' && ts.offset_delay    != null ? minutesToTime(base + ts.offset_delay)    : '',
        time_early: ts.stop_type === 'timing_point' && ts.offset_early    != null ? minutesToTime(base + ts.offset_early)    : '',
      }))
      setStops(loaded)
      if (loaded.length > 0) setFitKey(k => (k ?? 0) + 1)
    })
  }, [timetableId])

  // ── Auto-hide setup cards ─────────────────────────────────────────────────────

  useEffect(() => {
    const routeOk = routeId === '__new__'
      ? newCode.trim().length > 0 && newJourneyTypes.length > 0 && newRouteCollapsed
      : !!routeId
    const ttOk = timetableId === '__new__'
      ? newTtName.trim().length > 0 && newTtCollapsed
      : !!timetableId
    if (routeOk && ttOk) setShowSetup(false)
  }, [routeId, timetableId, newRouteCollapsed, newTtCollapsed, newCode, newJourneyTypes, newTtName])

  useEffect(() => { setShowSetup(true) }, [routeId])

  useEffect(() => {
    setNewDirection(singleJourney ? 'Morning' : 'Outbound')
  }, [singleJourney])

  useEffect(() => {
    if (routeId === '__new__' && !newRouteCollapsed) {
      confirmRouteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [routeId, newRouteCollapsed, newJourneyTypes])

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
  }, [routeResult]) // eslint-disable-line react-hooks/exhaustive-deps

  function resolvedVehicle() {
    if (!vehicleType.length) return null
    const dims = vehicleType.map(vt => TYPE_DEFAULTS[vt]).filter(Boolean)
    if (!dims.length) return null
    return {
      height_metres: Math.max(...dims.map(d => d.height_metres)),
      width_metres:  Math.max(...dims.map(d => d.width_metres)),
      length_metres: Math.max(...dims.map(d => d.length_metres)),
    }
  }

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

  function handleAddStop(result) {
    setStops(prev => [...prev, {
      _id: crypto.randomUUID(),
      stop_id: result.stop_id ?? null,
      name: result.name, lat: result.lat, lon: result.lon,
      stop_type: 'timing_point', time_std: '', time_delay: '', time_early: '',
    }])
    setShowSearch(false); setSearchQuery(''); setSearchResults([])
  }

  function handleMapPinDrop({ name, lat, lon }) {
    setStops(prev => [...prev, {
      _id: crypto.randomUUID(), stop_id: null,
      name, lat, lon, stop_type: 'timing_point', time_std: '', time_delay: '', time_early: '',
    }])
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
    for (let i = changedIdx; i < stopsArr.length - 1; i++) {
      const seg = segsMap[stopsArr[i]._id]
      if (seg && !seg.error) cumSecs += seg.duration
      const next = stopsArr[i + 1]
      if (next.stop_type === 'timing_point') {
        return stopsArr.map((s, idx) =>
          idx === i + 1 ? { ...s, time_std: minutesToTime(baseMins + Math.round(cumSecs / 60)) } : s
        )
      }
    }
    return stopsArr
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

  // ── Save ─────────────────────────────────────────────────────────────────────

  function openModal() {
    setModalStops([...stops])
    setAutoDepTime('')
    setSaveError('')
    setShowConfirm(true)
  }

  async function handleSave(stopsToSave = stops) {
    if (stopsToSave.length < 2) return
    setSaving(true); setSaveError(''); setSaveSuccess(false)

    let resolvedRouteId     = routeId
    let resolvedTimetableId = timetableId

    if (routeId === '__new__') {
      const company_id = await getCompanyId()
      if (!company_id) { setSaveError('Could not determine company — please reload and try again.'); setSaving(false); return }
      const code = newCode.toUpperCase()
      const { data: existing } = await supabase.from('routes')
        .select('id').eq('company_id', company_id).eq('service_code', code).maybeSingle()
      if (existing) {
        resolvedRouteId = existing.id
      } else {
        const { data, error } = await supabase.from('routes')
          .insert({
            company_id,
            service_code:   code,
            name:           newName || null,
            journey_type:   newJourneyTypes,
            single_journey: singleJourney,
            ...(isBodsRoute && {
              origin:                      newOrigin.trim()      || null,
              destination:                 newDestination.trim() || null,
              service_registration_number: newServiceReg.trim()  || null,
            }),
          })
          .select('id').single()
        if (error) { setSaveError(error.message); setSaving(false); return }
        resolvedRouteId = data.id
      }
    }

    if (timetableId === '__new__') {
      const { data, error } = await supabase.from('timetables')
        .insert({ route_id: resolvedRouteId, name: newTtName, direction: newDirection })
        .select('id').single()
      if (error) { setSaveError(error.message); setSaving(false); return }
      resolvedTimetableId = data.id
    }

    const { error: delErr } = await supabase
      .from('timetable_stops').delete().eq('timetable_id', resolvedTimetableId)
    if (delErr) { setSaveError(delErr.message); setSaving(false); return }

    const firstTiming = stopsToSave.find(s => s.stop_type === 'timing_point' && s.time_std)
    const base        = firstTiming ? timeToMinutes(firstTiming.time_std) : null

    const stopRows = []
    for (let i = 0; i < stopsToSave.length; i++) {
      const s = stopsToSave[i]
      let stopId = s.stop_id
      if (!stopId) {
        const { data, error } = await supabase
          .from('stops').insert({ name: s.name, lat: s.lat, lon: s.lon }).select('id').single()
        if (error) { setSaveError(`Stop "${s.name}": ${error.message}`); setSaving(false); return }
        stopId = data.id
      }
      const isTiming = s.stop_type === 'timing_point'
      stopRows.push({
        timetable_id:    resolvedTimetableId,
        stop_id:         stopId,
        sequence:        i + 1,
        stop_type:       s.stop_type,
        offset_standard: isTiming && s.time_std   && base != null ? timeToMinutes(s.time_std)   - base : null,
        offset_delay:    isTiming && s.time_delay  && base != null ? timeToMinutes(s.time_delay)  - base : null,
        offset_early:    isTiming && s.time_early  && base != null ? timeToMinutes(s.time_early)  - base : null,
      })
    }

    const { error: insErr } = await supabase.from('timetable_stops').insert(stopRows)
    if (insErr) { setSaveError(insErr.message); setSaving(false); return }

    const wasNew = routeId === '__new__'
    await loadRoutes()
    if (wasNew) {
      setNewCode(''); setNewName(''); setNewJourneyTypes([])
      setNewOrigin(''); setNewDestination(''); setNewServiceReg('')
      setNewTtName(''); setNewDirection('Outbound')
      setRouteId(''); setTimetableId(''); setStops([])
    } else {
      setStops(stopsToSave)
    }
    setSaving(false)
    setShowConfirm(false)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const vehicle  = resolvedVehicle()
  const warnings = routeResult?.warnings ?? []

  const selRoute = routeId && routeId !== '__new__' ? routes.find(r => r.id === routeId) : null
  const selTt    = timetableId && timetableId !== '__new__' ? timetables.find(t => t.id === timetableId) : null

  const activeJTypes  = routeId === '__new__' ? newJourneyTypes : (selRoute?.journey_type ?? [])
  const isBodsRoute   = activeJTypes.some(jt => bodsTypes.has(jt))

  const routeConfirmed = routeId === '__new__' ? newRouteCollapsed : !!routeId
  const routeReady = routeId === '__new__' ? newCode.trim().length > 0 && newJourneyTypes.length > 0 : !!routeId
  const ttReady    = !!timetableId
  const canSave    = routeReady && ttReady && stops.length >= 2 && !saving
  const confirmCode   = routeId === '__new__' ? newCode : selRoute?.service_code
  const confirmName   = routeId === '__new__' ? newName : selRoute?.name
  const confirmJTypes = routeId === '__new__' ? newJourneyTypes : (selRoute?.journey_types ?? [])
  const confirmTt     = timetableId === '__new__'
    ? [newTtName, newDirection].filter(Boolean).join(' · ')
    : selTt ? `${selTt.name} · ${selTt.direction}` : ''

  const segAfterStop = buildSegAfterMap(stops, routeResult?.segments)

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Header */}
      <div className="page-header" style={{ flexShrink: 0, marginBottom: 12 }}>
        <h1 className="page-title">Route Planner</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saveSuccess && (
            <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>
              {routeId === '__new__' ? 'Route created ✓ — select from list to continue' : 'Saved ✓'}
            </span>
          )}
          <button className="btn btn-primary btn-sm" onClick={openModal} disabled={!canSave}>
            Review &amp; Save
          </button>
        </div>
      </div>

      {/* Two-panel body */}
      <div style={{ flex: 1, display: 'flex', gap: 12, overflow: 'hidden', minHeight: 0 }}>

        {/* ── Sidebar ── */}
        <div style={{
          width: 280, minWidth: 280, flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 8,
          overflowY: 'auto', paddingBottom: 8,
        }}>

          {showSetup && (<>

          {/* Card 1: Route */}
          <div className="card" style={{ padding: 10 }}>
            <div style={{ marginBottom: 6 }}>
              <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Route</div>
              <select
                name="route_id" className="form-select" style={{ fontSize: 12 }}
                value={routeId}
                onChange={e => {
                  const val = e.target.value
                  setRouteId(val)
                  if (val === '__new__') {
                    setNewRouteCollapsed(false); setNewTtCollapsed(false)
                    setSingleJourney(false)
                  } else {
                    setSingleJourney(routes.find(r => r.id === val)?.single_journey ?? false)
                  }
                }}
              >
                <option value="">— Select route —</option>
                <option value="__new__">＋ New route…</option>
                {routes.length > 0 && <option disabled>──────────</option>}
                {routes.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.service_code}{r.name ? ` — ${r.name}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {routeId === '__new__' && (
              <div style={{ background: 'var(--bg)', borderRadius: 6, padding: 8, marginBottom: 6, border: '1px solid var(--border)' }}>
                {newRouteCollapsed ? (
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'Oswald', fontWeight: 700, fontSize: 12, color: 'var(--navy-brand)', flexShrink: 0 }}>{newCode}</span>
                    {newJourneyTypes.map(jt => (
                      <span key={jt} style={{ fontSize: 10, fontFamily: 'Oswald', fontWeight: 700, background: 'var(--navy-brand)', color: '#fff', borderRadius: 8, padding: '1px 6px', letterSpacing: '0.04em', textTransform: 'uppercase', flexShrink: 0 }}>{jt}</span>
                    ))}
                    {newName && <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{newName}</span>}
                    <button type="button" onClick={() => setNewRouteCollapsed(false)}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: 0, flexShrink: 0, lineHeight: 1 }}
                      title="Edit route details">✎</button>
                  </div>
                ) : (
                  <>
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Code</div>
                      <input name="service_code" className="form-input" style={{ textTransform: 'uppercase', fontSize: 12 }}
                        placeholder="S125S" autoFocus value={newCode}
                        onChange={e => setNewCode(e.target.value.toUpperCase())} />
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ ...S.sectionLabel, marginBottom: 4 }}>Journey Types</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {journeyTypes.map(jt => {
                          const on = newJourneyTypes.includes(jt)
                          return (
                            <button key={jt} type="button" onClick={() => setNewJourneyTypes(on ? [] : [jt])}
                              style={{
                                padding: '3px 9px', fontSize: 11, borderRadius: 10, cursor: 'pointer',
                                fontFamily: 'inherit', lineHeight: 1.5,
                                border: `1px solid ${on ? 'var(--navy-brand)' : 'var(--border)'}`,
                                background: on ? 'var(--navy-brand)' : 'transparent',
                                color: on ? '#fff' : 'var(--text-muted)',
                              }}
                            >{jt}</button>
                          )
                        })}
                      </div>
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ ...S.sectionLabel, marginBottom: 4 }}>Vehicle Type</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {Object.keys(TYPE_DEFAULTS).map(vt => {
                          const on = vehicleType.includes(vt)
                          return (
                            <button key={vt} type="button"
                              onClick={() => setVehicleType(prev => on ? prev.filter(x => x !== vt) : [...prev, vt])}
                              style={{
                                padding: '3px 9px', fontSize: 11, borderRadius: 10, cursor: 'pointer',
                                fontFamily: 'inherit', lineHeight: 1.5,
                                border: `1px solid ${on ? 'var(--navy-brand)' : 'var(--border)'}`,
                                background: on ? 'var(--navy-brand)' : 'transparent',
                                color: on ? '#fff' : 'var(--text-muted)',
                              }}
                            >{vt}</button>
                          )
                        })}
                      </div>
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                        <input type="checkbox" checked={singleJourney} onChange={e => setSingleJourney(e.target.checked)} />
                        <span style={{ fontSize: 12, color: 'var(--text)' }}>One journey each way</span>
                      </label>
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ ...S.sectionLabel, marginBottom: 3 }}>
                        Name <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                      </div>
                      <input name="route_name" className="form-input" style={{ fontSize: 12 }} placeholder="e.g. Sleaford – Cranwell"
                        value={newName} onChange={e => setNewName(e.target.value)} />
                    </div>
                    {isBodsRoute && (<>
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Origin</div>
                        <input className="form-input" style={{ fontSize: 12 }} placeholder="e.g. Spalding"
                          value={newOrigin} onChange={e => setNewOrigin(e.target.value)} />
                      </div>
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Destination</div>
                        <input className="form-input" style={{ fontSize: 12 }} placeholder="e.g. Boston"
                          value={newDestination} onChange={e => setNewDestination(e.target.value)} />
                      </div>
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Registration No.
                          <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 4 }}>(optional)</span>
                        </div>
                        <input className="form-input" style={{ fontSize: 12 }} placeholder="e.g. PC0006014:1"
                          value={newServiceReg} onChange={e => setNewServiceReg(e.target.value)} />
                      </div>
                    </>)}
                    <div ref={confirmRouteRef} style={{ display: 'flex', justifyContent: 'flex-end', scrollMarginBottom: 24 }}>
                      <button type="button" className="btn btn-primary btn-sm"
                        disabled={!newCode.trim() || newJourneyTypes.length === 0}
                        onClick={() => setNewRouteCollapsed(true)}
                      >Confirm route</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {routeId && routeId !== '__new__' && (
              <div style={{ marginTop: 8 }}>
                <div style={{ ...S.sectionLabel, marginBottom: 4 }}>Vehicle Type</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {Object.keys(TYPE_DEFAULTS).map(vt => {
                    const on = vehicleType.includes(vt)
                    return (
                      <button key={vt} type="button"
                        onClick={() => setVehicleType(prev => on ? prev.filter(x => x !== vt) : [...prev, vt])}
                        style={{
                          padding: '3px 9px', fontSize: 11, borderRadius: 10, cursor: 'pointer',
                          fontFamily: 'inherit', lineHeight: 1.5,
                          border: `1px solid ${on ? 'var(--navy-brand)' : 'var(--border)'}`,
                          background: on ? 'var(--navy-brand)' : 'transparent',
                          color: on ? '#fff' : 'var(--text-muted)',
                        }}
                      >{vt}</button>
                    )
                  })}
                </div>
                {vehicle && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    H {vehicle.height_metres}m · W {vehicle.width_metres}m · L {vehicle.length_metres}m
                  </div>
                )}
              </div>
            )}
          </div>

          {routeConfirmed && (<>

          {/* Card 2: Timetable */}
          <div className="card" style={{ padding: 10 }}>
            <div style={{ marginBottom: timetableId === '__new__' ? 6 : 0 }}>
              <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Timetable</div>
              <select name="timetable_id" className="form-select" style={{ fontSize: 12 }}
                value={timetableId}
                onChange={e => { setTimetableId(e.target.value); if (e.target.value === '__new__') setNewTtCollapsed(false) }}
                disabled={!routeId}
              >
                <option value="">— Select timetable —</option>
                <option value="__new__">＋ New timetable…</option>
                {timetables.length > 0 && <option disabled>──────────</option>}
                {timetables.map(t => (
                  <option key={t.id} value={t.id}>{t.name} · {t.direction}</option>
                ))}
              </select>
            </div>

            {timetableId === '__new__' && (
              <div style={{ background: 'var(--bg)', borderRadius: 6, padding: 8, border: '1px solid var(--border)' }}>
                {newTtCollapsed ? (
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[newTtName, newDirection].filter(Boolean).join(' · ')}
                    </span>
                    <button type="button" onClick={() => setNewTtCollapsed(false)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: 0, flexShrink: 0, lineHeight: 1 }}
                      title="Edit timetable details">✎</button>
                  </div>
                ) : (
                  <>
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Name</div>
                      <input name="tt_name" className="form-input" style={{ fontSize: 12 }}
                        placeholder="e.g. Standard Outbound" value={newTtName}
                        onChange={e => setNewTtName(e.target.value)} />
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Direction</div>
                      <select name="direction" className="form-select" style={{ fontSize: 12 }} value={newDirection}
                        onChange={e => setNewDirection(e.target.value)}>
                        {(singleJourney ? SINGLE_JOURNEY_DIRECTIONS : DIRECTIONS).map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-primary btn-sm"
                        disabled={!newTtName.trim()}
                        onClick={() => setNewTtCollapsed(true)}
                      >Confirm timetable</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          </>)}
          </>)}

          {/* Card 3: Stops */}
          <div className="card" style={{ padding: 10 }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={S.sectionLabel}>Stops{stops.length > 0 ? ` · ${stops.length}` : ''}</span>
              {routing && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Routing…</span>}
            </div>

            {/* Route/timetable summary chip */}
            {(() => {
              const code   = routeId === '__new__' ? newCode : selRoute?.service_code
              const name   = routeId === '__new__' ? newName : selRoute?.name
              const jtypes = routeId === '__new__' ? newJourneyTypes : (selRoute?.journey_types ?? [])
              if (!code && !confirmTt && !vehicleType.length) return null
              return (
                <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', marginBottom: 10, fontSize: 12 }}>
                  {code && (
                    <div style={{ display: 'flex', gap: 5, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 3 }}>
                      <span style={{ fontFamily: 'Oswald', fontWeight: 700, fontSize: 13, color: 'var(--navy-brand)', flexShrink: 0 }}>{code}</span>
                      {name && <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{name}</span>}
                      {jtypes.map(jt => (
                        <span key={jt} style={{ fontSize: 10, fontFamily: 'Oswald', fontWeight: 700, background: 'var(--navy-brand)', color: '#fff', borderRadius: 8, padding: '1px 6px', letterSpacing: '0.04em', textTransform: 'uppercase', flexShrink: 0 }}>{jt}</span>
                      ))}
                      <button type="button"
                        onClick={() => { setShowSetup(true); setNewRouteCollapsed(false); setNewTtCollapsed(false) }}
                        style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--navy-brand)', cursor: 'pointer', fontSize: 11, padding: 0, flexShrink: 0, textDecoration: 'underline', fontFamily: 'inherit' }}
                      >Edit</button>
                    </div>
                  )}
                  {confirmTt && <div style={{ color: 'var(--text-muted)', marginBottom: vehicleType.length ? 3 : 0 }}>{confirmTt}</div>}
                  {vehicleType.length > 0 && <div style={{ color: 'var(--text-muted)' }}>{vehicleType.join(', ')}</div>}
                </div>
              )
            })()}

            {stops.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px' }}>
                Drop a pin on the map or search for a stop or address below.
              </p>
            )}

            {stops.map((s, i) => {
              const color = stopColor(i, stops.length)
              const isEditing = editStopId === s._id
              const segAfter  = segAfterStop[s._id]
              return (
                <Fragment key={s._id}>
                  <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 8, marginBottom: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 3 }}>
                      <span style={{ fontFamily: 'Oswald', fontWeight: 700, fontSize: 10, color, width: 14, flexShrink: 0, textAlign: 'right' }}>
                        {i + 1}
                      </span>
                      {isEditing ? (
                        <input autoFocus className="form-input"
                          style={{ flex: 1, fontSize: 12, height: 24, padding: '1px 5px', marginLeft: 3, marginRight: 2 }}
                          value={editStopName}
                          onChange={e => setEditStopName(e.target.value)}
                          onBlur={() => commitEditName(i)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); commitEditName(i) }
                            if (e.key === 'Escape') setEditStopId(null)
                          }}
                        />
                      ) : (
                        <span
                          style={{ flex: 1, fontSize: 13, fontWeight: 600, lineHeight: 1.3, paddingLeft: 5, paddingRight: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}
                          title={`${s.name} — click to rename`}
                          onClick={() => startEditName(s)}
                        >{s.name}</span>
                      )}
                      <button className="btn btn-ghost btn-sm" style={{ padding: '1px 4px', minWidth: 0, lineHeight: 1 }}
                        onClick={() => moveStop(i, -1)} disabled={i === 0} title="Move up">↑</button>
                      <button className="btn btn-ghost btn-sm" style={{ padding: '1px 4px', minWidth: 0, lineHeight: 1 }}
                        onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1} title="Move down">↓</button>
                      <button className="btn btn-danger btn-sm" style={{ padding: '1px 5px', minWidth: 0, lineHeight: 1 }}
                        onClick={() => removeStop(i)} title="Remove">×</button>
                    </div>
                    <div style={{ paddingLeft: 19 }}>
                      <select name="stop_type" className="form-select"
                        style={{ fontSize: 12, height: 26, padding: '2px 6px', width: '100%', marginBottom: 3 }}
                        value={s.stop_type} onChange={e => updateStop(i, 'stop_type', e.target.value)}>
                        <option value="timing_point">Timing point</option>
                        <option value="routing_point">Routing point</option>
                      </select>
                      {s.stop_type === 'timing_point' && (
                        <div style={{ display: 'flex', gap: 3 }}>
                          {(singleJourney
                            ? [['time_std', 'Std']]
                            : [['time_std','Std'],['time_delay','Delay'],['time_early','Early']]
                          ).map(([field, label]) => (
                            <div key={field} style={{ flex: 1 }}>
                              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Oswald', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 1 }}>{label}</div>
                              <input type="time" className="form-input"
                                style={{ fontSize: 11, height: 24, padding: '1px 3px', width: '100%' }}
                                value={s[field]} onChange={e => updateStop(i, field, e.target.value)} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {i < stops.length - 1 && <SegChip seg={segAfter} />}
                </Fragment>
              )
            })}

            {/* Add stop row */}
            <div style={{ marginTop: stops.length ? 8 : 0 }}>
              {!showSearch && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className={`btn btn-sm ${pinDropMode ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ flex: 1 }}
                    onClick={() => setPinDropMode(p => !p)}
                  >
                    {pinDropMode ? 'Pinning…' : 'Drop pin'}
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1 }}
                    onClick={() => { setShowSearch(true); setPinDropMode(false) }}>
                    Search
                  </button>
                </div>
              )}

              {showSearch && (
                <div>
                  <input name="stop_search" autoFocus className="form-input" style={{ marginBottom: 5 }}
                    placeholder="Search stops or address…" value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)} />
                  {searching && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '2px 0 4px' }}>Searching…</div>}
                  {searchResults.map((r, idx) => (
                    <div key={idx} onMouseDown={e => { e.preventDefault(); handleAddStop(r) }} style={{
                      padding: '5px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 13,
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: 'var(--bg)', marginBottom: 2,
                    }}>
                      <span style={{ fontSize: 10, fontFamily: 'Oswald', fontWeight: 700, color: r.source === 'stop' ? 'var(--green)' : 'var(--navy-brand)', textTransform: 'uppercase', minWidth: 28 }}>
                        {r.source === 'stop' ? 'Stop' : 'Addr'}
                      </span>
                      <span style={{ flex: 1, lineHeight: 1.3 }}>{r.name}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: 5 }}>
                    <button className="btn btn-ghost btn-sm" onClick={closeSearch}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            {/* Route totals */}
            {routeResult && !routeResult.error && (
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 10 }}>
                <span style={{ fontFamily: 'Oswald', fontWeight: 700, fontSize: 16, color: 'var(--navy-brand)' }}>
                  {fmtDist(routeResult.distance)}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 10 }}>
                  {fmtDur(routeResult.duration)}
                </span>
                {warnings.map((w, idx) => (
                  <div key={idx} style={{ fontSize: 12, color: '#d69e2e', display: 'flex', gap: 4, marginTop: 4 }}>
                    <span>⚠</span><span>{w.message ?? `Routing warning (code ${w.code})`}</span>
                  </div>
                ))}
              </div>
            )}

            {routeResult?.error && (
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--danger)' }}>Routing error: {routeResult.error}</div>
              </div>
            )}

            {saveError && <div className="error-msg" style={{ marginTop: 10 }}>{saveError}</div>}

            {canSave && (
              <button className="btn btn-primary btn-sm" style={{ marginTop: 14, width: '100%' }} onClick={openModal}>
                Finish &amp; Review
              </button>
            )}
          </div>

          {/* Card 4: Departures */}
          {timetableId && timetableId !== '__new__' && (
            <DeparturesCard
              timetableId={timetableId}
              timetables={timetables}
              departures={departures}
              setDepartures={setDepartures}
              isBodsRoute={isBodsRoute}
            />
          )}

        </div>

        {/* ── Map panel ── */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
          {pinDropMode && (
            <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(30,61,114,0.88)', color: '#fff', padding: '6px 18px', borderRadius: 20, fontSize: 13, fontWeight: 500, pointerEvents: 'none', zIndex: 1000, whiteSpace: 'nowrap' }}>
              Click the map to place a stop
            </div>
          )}
          <PlannerMap
            stops={stops}
            routeGeometry={routeResult?.geometry ?? null}
            pinDropMode={pinDropMode}
            onMapClick={handleMapPinDrop}
            onRemoveStop={removeStopById}
            fitKey={fitKey}
          />
        </div>
      </div>

      {showConfirm && (
        <ReviewModal
          modalStops={modalStops}
          setModalStops={setModalStops}
          routeResult={routeResult}
          singleJourney={singleJourney}
          confirmCode={confirmCode}
          confirmName={confirmName}
          confirmJTypes={confirmJTypes}
          confirmTt={confirmTt}
          vehicleType={vehicleType}
          vehicle={vehicle}
          warnings={warnings}
          autoDepTime={autoDepTime}
          setAutoDepTime={setAutoDepTime}
          saving={saving}
          saveError={saveError}
          onClose={() => setShowConfirm(false)}
          onSave={stopsToSave => { setStops(stopsToSave); handleSave(stopsToSave) }}
        />
      )}

    </div>
  )
}
