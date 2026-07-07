import { Fragment, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../shared/supabase'
import { getCompanyLocation } from '../../shared/company'
import { useJourneyTypes } from '../../shared/hooks/useJourneyTypes'
import { TYPE_DEFAULTS, S } from './constants'
import { fmtDist, fmtDur, stopColor, getScheduledMin, timeToMinutes, minutesToTime } from './utils'
import { useStopsBuilder } from './useStopsBuilder'
import { saveRouteTimetableStops } from './saveRouteTimetableStops'
import PlannerMap from './PlannerMap'
import ReviewModal from './ReviewModal'
import DeparturesCard from './DeparturesCard'
import RouteDetailsForm from './RouteDetailsForm'

function SegChip({ seg, scheduledMin }) {
  if (!seg || seg.error) return null
  const durationLabel = scheduledMin != null ? `${scheduledMin} min` : fmtDur(seg.duration)
  return (
    <div style={{
      paddingLeft: 22, marginBottom: 2,
      fontSize: 11, fontWeight: 700,
      color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5,
    }}>
      <span>↓</span>
      <span>{durationLabel}</span>
      <span style={{ fontWeight: 400, fontSize: 10 }}>·</span>
      <span style={{ fontWeight: 400 }}>{fmtDist(seg.distance)}</span>
    </div>
  )
}

export default function RoutePlannerPage() {
  const [searchParams] = useSearchParams()
  const pendingTtId       = useRef(null)
  const pendingInvertFrom = useRef(null)
  const pendingFromDir    = useRef(null)
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

  // Inline new-timetable fields (name/direction collected in the Review modal)
  const [newTtName,    setNewTtName]    = useState('')
  const [newDirection, setNewDirection] = useState('Outbound')

  const [departures, setDepartures] = useState([])

  const {
    stops, setStops,
    routing, routeResult, vehicle, warnings, segAfterStop, totalDurationSec,
    pinDropMode, setPinDropMode,
    showSearch, setShowSearch, searchQuery, setSearchQuery, searchResults, searching,
    naptanPending, setNaptanPending, checkingNaptan,
    editStopId, editStopName, setEditStopName,
    fitKey, setFitKey,
    commitStop, handleAddStop, handleMapPinDrop, closeSearch,
    moveStop, removeStop, removeStopById, updateStop,
    startEditName, commitEditName,
  } = useStopsBuilder(vehicleType)

  const [hqLocation, setHqLocation] = useState(null)

  // Confirmation / review modal
  const [showConfirm, setShowConfirm] = useState(false)
  const [modalStops,  setModalStops]  = useState([])

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
    getCompanyLocation().then(setHqLocation)
    const onCompanyUpdated = () => getCompanyLocation().then(setHqLocation)
    window.addEventListener('company:updated', onCompanyUpdated)
    return () => window.removeEventListener('company:updated', onCompanyUpdated)
  }, [])

  useEffect(() => {
    loadRoutes()
    const r   = searchParams.get('route')
    const t   = searchParams.get('timetable')
    const inv = searchParams.get('invertFrom')
    const dir = searchParams.get('fromDir')
    if (r) {
      pendingTtId.current       = t
      pendingInvertFrom.current = inv
      pendingFromDir.current    = dir
      setRouteId(r)
    }
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
    if (!timetableId || timetableId === '__new__') {
      setStops([]); setDepartures([])
      if (timetableId === '__new__' && pendingInvertFrom.current) {
        handleInvertFrom(pendingInvertFrom.current, pendingFromDir.current)
        pendingInvertFrom.current = null
        pendingFromDir.current    = null
      }
      return
    }
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
    const ttOk = !!timetableId
    if (routeOk && ttOk) setShowSetup(false)
  }, [routeId, timetableId, newRouteCollapsed, newCode, newJourneyTypes])

  useEffect(() => { setShowSetup(true) }, [routeId])

  useEffect(() => {
    setNewDirection(singleJourney ? 'Morning' : 'Outbound')
  }, [singleJourney])

  useEffect(() => {
    if (routeId === '__new__' && !newRouteCollapsed) {
      confirmRouteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [routeId, newRouteCollapsed, newJourneyTypes])

  const FLIP_DIRECTION = { Outbound: 'Inbound', Inbound: 'Outbound', Morning: 'Afternoon', Afternoon: 'Morning' }

  async function handleInvertFrom(sourceTtId, fromDir) {
    const { data } = await supabase
      .from('timetable_stops').select('*, stops(*)')
      .eq('timetable_id', sourceTtId).order('sequence')
    if (!data?.length) return
    const inverted = [...data].reverse().map(ts => ({
      _id:       crypto.randomUUID(),
      stop_id:   ts.stop_id,
      name:      ts.stops.name,
      lat:       ts.stops.lat,
      lon:       ts.stops.lon,
      stop_type: ts.stop_type,
      time_std:  '',
    }))
    setStops(inverted)
    setFitKey(k => (k ?? 0) + 1)
    if (fromDir) setNewDirection(FLIP_DIRECTION[fromDir] ?? 'Outbound')
  }

  // ── Save ─────────────────────────────────────────────────────────────────────

  function openModal() {
    setModalStops([...stops])
    if (timetableId === '__new__' && stops.length >= 2)
      setNewTtName(`${stops[0].name} to ${stops[stops.length - 1].name}`)
    setSaveError('')
    setShowConfirm(true)
  }

  async function handleSave(stopsToSave = stops) {
    if (stopsToSave.length < 2) return
    setSaving(true); setSaveError(''); setSaveSuccess(false)

    const { routeId: savedRouteId, timetableId: savedTimetableId, error } = await saveRouteTimetableStops({
      routeId, timetableId,
      newRouteFields: {
        code: newCode, name: newName, journeyTypes: newJourneyTypes,
        singleJourney, isBodsRoute,
        origin: newOrigin, destination: newDestination, serviceReg: newServiceReg,
      },
      newTtName, newDirection,
      stopsToSave,
      departures,
    })
    if (error) { setSaveError(error); setSaving(false); return }

    const wasNew = routeId === '__new__'
    await loadRoutes()
    if (wasNew) {
      setNewCode(''); setNewName(''); setNewJourneyTypes([])
      setNewOrigin(''); setNewDestination(''); setNewServiceReg('')
      setNewTtName(''); setNewDirection('Outbound')
      setRouteId(''); setTimetableId(''); setStops([])
    } else {
      setStops(stopsToSave)
      // A brand-new timetable on an existing route (e.g. the "Return" invert flow) must
      // move off '__new__' once saved — otherwise a second save creates a duplicate
      // timetable with the same stops instead of updating the one just created.
      if (timetableId === '__new__') {
        const { data } = await supabase.from('timetables').select('*').eq('route_id', savedRouteId).order('name')
        setTimetables(data ?? [])
        setTimetableId(savedTimetableId)
      }
    }
    setSaving(false)
    setShowConfirm(false)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

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
    ? ''
    : selTt ? `${selTt.name} · ${selTt.direction}` : ''

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)', overflow: 'hidden' }}>

      {/* Header */}
      <div className="page-header" style={{ flexShrink: 0, marginBottom: 12 }}>
        <h1 className="page-title">Route Planner</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saveSuccess && (
            <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>
              {routeId === '__new__' ? 'Route created ✓ — select from list to continue' : 'Saved ✓'}
            </span>
          )}
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
                    setNewRouteCollapsed(false)
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
                    <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--navy-brand)', flexShrink: 0 }}>{newCode}</span>
                    {newJourneyTypes.map(jt => (
                      <span key={jt} style={{ fontSize: 10, fontWeight: 700, background: 'var(--navy-brand)', color: '#fff', borderRadius: 8, padding: '1px 6px', letterSpacing: '0.04em', textTransform: 'uppercase', flexShrink: 0 }}>{jt}</span>
                    ))}
                    {newName && <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{newName}</span>}
                    <button type="button" onClick={() => setNewRouteCollapsed(false)}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: 0, flexShrink: 0, lineHeight: 1 }}
                      title="Edit route details">✎</button>
                  </div>
                ) : (
                  <>
                    <RouteDetailsForm
                      journeyTypes={journeyTypes}
                      isBodsRoute={isBodsRoute}
                      newCode={newCode} setNewCode={setNewCode}
                      newJourneyTypes={newJourneyTypes} setNewJourneyTypes={setNewJourneyTypes}
                      vehicleType={vehicleType} setVehicleType={setVehicleType}
                      singleJourney={singleJourney} setSingleJourney={setSingleJourney}
                      newName={newName} setNewName={setNewName}
                      newOrigin={newOrigin} setNewOrigin={setNewOrigin}
                      newDestination={newDestination} setNewDestination={setNewDestination}
                      newServiceReg={newServiceReg} setNewServiceReg={setNewServiceReg}
                    />
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
            <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Timetable</div>
            <select name="timetable_id" className="form-select" style={{ fontSize: 12 }}
              value={timetableId}
              onChange={e => setTimetableId(e.target.value)}
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

          </>)}
          </>)}

          {/* Card 3: Stops */}
          <div className="card" style={{ padding: 10, display: 'flex', flexDirection: 'column', flex: '1 1 0', minHeight: 0 }}>

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
                      <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--navy-brand)', flexShrink: 0 }}>{code}</span>
                      {name && <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{name}</span>}
                      {jtypes.map(jt => (
                        <span key={jt} style={{ fontSize: 10, fontWeight: 700, background: 'var(--navy-brand)', color: '#fff', borderRadius: 8, padding: '1px 6px', letterSpacing: '0.04em', textTransform: 'uppercase', flexShrink: 0 }}>{jt}</span>
                      ))}
                      <button type="button"
                        onClick={() => { setShowSetup(true); setNewRouteCollapsed(false) }}
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

            <div style={{ flex: '1 1 0', overflowY: 'auto', minHeight: 0 }}>
            {stops.map((s, i) => {
              const color = stopColor(i, stops.length)
              const isEditing = editStopId === s._id
              const segAfter  = segAfterStop[s._id]
              const scheduledMin = getScheduledMin(s, stops[i + 1])
              return (
                <Fragment key={s._id}>
                  <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 8, marginBottom: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 3 }}>
                      <span style={{ fontWeight: 700, fontSize: 10, color, width: 14, flexShrink: 0, textAlign: 'right' }}>
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
                        <div>
                          <input type="time" className="form-input"
                            style={{ fontSize: 11, height: 24, padding: '1px 3px', width: '100%' }}
                            value={s.time_std} onChange={e => updateStop(i, 'time_std', e.target.value)} />
                        </div>
                      )}
                    </div>
                  </div>
                  {i < stops.length - 1 && <SegChip seg={segAfter} scheduledMin={scheduledMin} />}
                </Fragment>
              )
            })}
            </div>

            {/* Add stop row */}
            <div style={{ marginTop: stops.length ? 8 : 0 }}>

              {/* NAPTAN proximity suggestion */}
              {checkingNaptan && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0 4px' }}>
                  Checking for nearby bus stops…
                </div>
              )}
              {naptanPending && (
                <div style={{
                  background: 'var(--bg)', border: '1px solid var(--navy-brand)',
                  borderRadius: 6, padding: 8, marginBottom: 8,
                }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700,
                    color: 'var(--navy-brand)', textTransform: 'uppercase',
                    letterSpacing: '0.06em', marginBottom: 4,
                  }}>
                    Bus stop {Math.round(naptanPending.naptan.distance_m)}m away
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, marginBottom: 2 }}>
                    {naptanPending.naptan.common_name}
                  </div>
                  {(naptanPending.naptan.indicator || naptanPending.naptan.locality_name) && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                      {[naptanPending.naptan.indicator, naptanPending.naptan.locality_name].filter(Boolean).join(', ')}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary btn-sm" style={{ flex: 1 }}
                      onClick={() => {
                        const { naptan } = naptanPending
                        const stopName = naptan.indicator
                          ? `${naptan.common_name} (${naptan.indicator})`
                          : naptan.common_name
                        commitStop(stopName, naptan.lat, naptan.lon, null, naptan.atco_code)
                        setNaptanPending(null)
                      }}
                    >Use bus stop</button>
                    <button className="btn btn-ghost btn-sm" style={{ flex: 1 }}
                      onClick={() => {
                        const { original } = naptanPending
                        commitStop(original.name, original.lat, original.lon)
                        setNaptanPending(null)
                      }}
                    >Use location</button>
                  </div>
                </div>
              )}

              {!showSearch && !naptanPending && !checkingNaptan && (
                <>
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
                  {(() => {
                    const sources = timetables.filter(t => t.id !== timetableId)
                    if (!sources.length) return null
                    return (
                      <div style={{ marginTop: 6 }}>
                        {sources.map(t => (
                          <button key={t.id} className="btn btn-ghost btn-sm"
                            style={{ width: '100%', marginBottom: 4 }}
                            title="Copy stops from this timetable in reverse order"
                            onClick={() => handleInvertFrom(t.id)}
                          >
                            ↕ Invert from {t.name}
                          </button>
                        ))}
                      </div>
                    )
                  })()}
                </>
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
                      <span style={{ fontSize: 10, fontWeight: 700, color: r.source === 'stop' ? 'var(--green)' : 'var(--navy-brand)', textTransform: 'uppercase', minWidth: 28 }}>
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
                <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy-brand)' }}>
                  {fmtDist(routeResult.distance)}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 10 }}>
                  {fmtDur(totalDurationSec)}
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
            hqLocation={hqLocation}
          />
        </div>
      </div>

      {showConfirm && (
        <ReviewModal
          modalStops={modalStops}
          setModalStops={setModalStops}
          routeResult={routeResult}
          confirmCode={confirmCode}
          confirmName={confirmName}
          confirmJTypes={confirmJTypes}
          confirmTt={confirmTt}
          vehicleType={vehicleType}
          vehicle={vehicle}
          warnings={warnings}
          isNewTimetable={timetableId === '__new__'}
          newTtName={newTtName}
          setNewTtName={setNewTtName}
          saving={saving}
          saveError={saveError}
          onClose={() => setShowConfirm(false)}
          onSave={stopsToSave => { setStops(stopsToSave); handleSave(stopsToSave) }}
        />
      )}

    </div>
  )
}
