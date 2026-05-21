import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../shared/supabase'
import { getCompanyId } from '../../shared/company'
import { searchPlaces } from '../excursions/osPlaces'
import { getRouteORS } from './ors'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const TYPE_DEFAULTS = {
  'Minibus':           { height_metres: 2.85, width_metres: 2.20, length_metres:  8.00 },
  'Midi Coach':        { height_metres: 3.20, width_metres: 2.40, length_metres: 10.00 },
  'Full Size Coach':   { height_metres: 3.70, width_metres: 2.55, length_metres: 13.75 },
  'Single Decker Bus': { height_metres: 3.15, width_metres: 2.55, length_metres: 12.00 },
  'Double Decker':     { height_metres: 4.35, width_metres: 2.55, length_metres: 11.00 },
}

const JOURNEY_TYPES = [
  'Local Bus', 'Open Door Schools', 'Contract Schools',
  'Private Hire', 'Excursion', 'Tour', 'Other Contract',
]
const PERIODS    = ['Early Morning', 'Morning', 'Midday', 'Afternoon', 'Evening', 'Night', 'All Day']
const DIRECTIONS = ['Outbound', 'Inbound', 'Circular']

const NEW_ROUTE_EMPTY = {
  service_code: '',
  name: '',
  journey_type: 'Local Bus',
  period: 'Morning',
  direction: 'Outbound',
  valid_from: '',
  valid_to: '',
}

function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}
function fmtDur(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m} min`
}
function stopColor(i, total) {
  if (i === 0) return '#4db848'
  if (i === total - 1) return '#e53935'
  return '#1e3d72'
}

// ── Leaflet map ───────────────────────────────────────────────────────────────

function PlannerMap({ stops, routeGeometry, pinDropMode, onMapClick }) {
  const divRef     = useRef(null)
  const mapRef     = useRef(null)
  const markersRef = useRef([])
  const lineRef    = useRef(null)
  const clickRef   = useRef(null)

  useEffect(() => {
    if (!divRef.current || mapRef.current) return
    const map = L.map(divRef.current).setView([52.97, -0.02], 9)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Pin-drop mode: crosshair cursor + click-to-name popup
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (clickRef.current) {
      map.off('click', clickRef.current)
      clickRef.current = null
      map.getContainer().style.cursor = ''
    }

    if (!pinDropMode || !onMapClick) return

    map.getContainer().style.cursor = 'crosshair'
    let popupOpen = false

    const handler = (e) => {
      if (popupOpen) return
      popupOpen = true
      const { lat, lng } = e.latlng

      const wrap = document.createElement('div')
      wrap.style.cssText = 'padding:8px;min-width:210px'

      const input = document.createElement('input')
      input.type = 'text'
      input.placeholder = 'Stop name…'
      input.style.cssText = [
        'width:100%', 'padding:4px 8px', 'font-size:13px',
        'border:1px solid #cbd5e1', 'border-radius:4px',
        'margin-bottom:8px', 'box-sizing:border-box', 'font-family:inherit',
      ].join(';')

      const btnRow = document.createElement('div')
      btnRow.style.cssText = 'display:flex;gap:6px;justify-content:flex-end'

      const cancelBtn = document.createElement('button')
      cancelBtn.textContent = 'Cancel'
      cancelBtn.style.cssText = 'padding:3px 10px;font-size:12px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;font-family:inherit'

      const addBtn = document.createElement('button')
      addBtn.textContent = 'Add Stop'
      addBtn.style.cssText = 'padding:3px 10px;font-size:12px;background:#1e3d72;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:inherit'

      btnRow.appendChild(cancelBtn)
      btnRow.appendChild(addBtn)
      wrap.appendChild(input)
      wrap.appendChild(btnRow)

      const popup = L.popup({ closeButton: false, maxWidth: 260 })
        .setLatLng([lat, lng])
        .setContent(wrap)
        .openOn(map)

      popup.on('remove', () => { popupOpen = false })
      setTimeout(() => input.focus(), 50)

      const confirm = () => {
        const name = input.value.trim()
        if (!name) return
        onMapClick({ name, lat, lon: lng })
        map.closePopup()
      }

      addBtn.addEventListener('click', confirm)
      cancelBtn.addEventListener('click', () => map.closePopup())
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') confirm()
        if (ev.key === 'Escape') map.closePopup()
      })
    }

    map.on('click', handler)
    clickRef.current = handler
  }, [pinDropMode, onMapClick])

  // Markers + route line
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    if (lineRef.current) { lineRef.current.remove(); lineRef.current = null }

    if (routeGeometry) {
      lineRef.current = L.geoJSON(routeGeometry, {
        style: { color: '#1e3d72', weight: 4, opacity: 0.85 },
      }).addTo(map)
    }

    const validStops = stops.filter(s => s.lat != null && s.lon != null)
    validStops.forEach((s, i) => {
      const color = stopColor(i, validStops.length)
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:24px;height:24px;border-radius:50%;
          background:${color};border:2px solid #fff;
          box-shadow:0 1px 4px rgba(0,0,0,0.4);
          display:flex;align-items:center;justify-content:center;
          font-family:Oswald,sans-serif;font-size:11px;font-weight:700;color:#fff;
        ">${i + 1}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      })
      const marker = L.marker([s.lat, s.lon], { icon })
      marker.bindTooltip(s.name, { direction: 'right', offset: [14, 0] })
      marker.addTo(map)
      markersRef.current.push(marker)
    })

    if (validStops.length >= 2) {
      map.fitBounds(
        L.latLngBounds(validStops.map(s => [s.lat, s.lon])),
        { padding: [32, 32] },
      )
    } else if (validStops.length === 1) {
      map.setView([validStops[0].lat, validStops[0].lon], 13)
    }
  }, [stops, routeGeometry])

  return <div ref={divRef} style={{ width: '100%', height: '100%' }} />
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RoutePlannerPage() {
  const [mode, setMode] = useState('edit') // 'edit' | 'new'
  const [newRouteForm, setNewRouteForm] = useState(NEW_ROUTE_EMPTY)

  const [routes,     setRoutes]     = useState([])
  const [timetables, setTimetables] = useState([])
  const [vehicles,   setVehicles]   = useState([])

  const [routeId,     setRouteId]     = useState('')
  const [timetableId, setTimetableId] = useState('')
  const [vehicleId,   setVehicleId]   = useState('')

  const [stops,       setStops]       = useState([])
  const [routing,     setRouting]     = useState(false)
  const [routeResult, setRouteResult] = useState(null)

  const [showSearch,    setShowSearch]    = useState(false)
  const [searchQuery,   setSearchQuery]   = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching,     setSearching]     = useState(false)
  const [addingStop,    setAddingStop]    = useState(false)

  const [saving,      setSaving]      = useState(false)
  const [saveError,   setSaveError]   = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  // ── Load lookups ─────────────────────────────────────────────────────────────

  async function loadRoutes() {
    const { data } = await supabase.from('routes').select('*').order('service_code')
    setRoutes(data ?? [])
  }

  useEffect(() => {
    loadRoutes()
    supabase.from('vehicles').select('*').order('registration')
      .then(({ data }) => setVehicles(data ?? []))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!routeId) { setTimetables([]); setTimetableId(''); return }
    supabase.from('timetables').select('*').eq('route_id', routeId).order('period')
      .then(({ data }) => setTimetables(data ?? []))
    setTimetableId('')
    setStops([])
  }, [routeId])

  useEffect(() => {
    if (!timetableId) { setStops([]); return }
    supabase
      .from('timetable_stops')
      .select('*, stops(*)')
      .eq('timetable_id', timetableId)
      .order('sequence')
      .then(({ data }) => {
        setStops((data ?? []).map(ts => ({
          _id:            ts.id,
          stop_id:        ts.stop_id,
          name:           ts.stops.name,
          lat:            ts.stops.lat,
          lon:            ts.stops.lon,
          stop_type:      ts.stop_type,
          scheduled_time: ts.scheduled_time ?? '',
        })))
      })
  }, [timetableId])

  // ── Auto-routing ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const pts = stops.filter(s => s.lat != null && s.lon != null)
    if (pts.length < 2) { setRouteResult(null); return }

    const vehicle = resolvedVehicle()
    let cancelled = false
    setRouting(true)
    getRouteORS(pts, vehicle).then(result => {
      if (!cancelled) { setRouteResult(result); setRouting(false) }
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, vehicleId])

  function resolvedVehicle() {
    const v = vehicles.find(v => v.id === vehicleId)
    if (!v) return null
    if (!v.height_metres && !v.width_metres && !v.length_metres) {
      return { ...v, ...TYPE_DEFAULTS[v.vehicle_type] }
    }
    return v
  }

  // ── Stop search ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      const results = []
      const { data: dbStops } = await supabase
        .from('stops')
        .select('id, name, lat, lon')
        .ilike('name', `%${searchQuery}%`)
        .limit(6)
      for (const s of dbStops ?? []) {
        results.push({ source: 'stop', stop_id: s.id, name: s.name, lat: s.lat, lon: s.lon })
      }
      const places = await searchPlaces(searchQuery).catch(() => [])
      for (const p of places ?? []) {
        if (!results.find(r => r.name === p.address)) {
          results.push({ source: 'addr', name: p.address, lat: p.lat, lon: p.lon })
        }
      }
      setSearchResults(results)
      setSearching(false)
    }, 350)
    return () => clearTimeout(timer)
  }, [searchQuery])

  async function handleAddStop(result) {
    setAddingStop(true)
    let stopId = result.stop_id

    if (!stopId) {
      const { data, error } = await supabase
        .from('stops')
        .insert({ name: result.name, lat: result.lat, lon: result.lon })
        .select('id')
        .single()
      if (error) {
        alert('Could not create stop: ' + error.message + '\n\nOnly super_user accounts can create new stops.')
        setAddingStop(false)
        return
      }
      stopId = data.id
    }

    setStops(prev => [...prev, {
      _id:            crypto.randomUUID(),
      stop_id:        stopId,
      name:           result.name,
      lat:            result.lat,
      lon:            result.lon,
      stop_type:      'timing_point',
      scheduled_time: '',
    }])
    setShowSearch(false)
    setSearchQuery('')
    setSearchResults([])
    setAddingStop(false)
  }

  // Map pin-drop: stop_id is null until saved — created in stops table on save
  function handleMapPinDrop({ name, lat, lon }) {
    setStops(prev => [...prev, {
      _id:            crypto.randomUUID(),
      stop_id:        null,
      name,
      lat,
      lon,
      stop_type:      'timing_point',
      scheduled_time: '',
    }])
  }

  function closeSearch() {
    setShowSearch(false); setSearchQuery(''); setSearchResults([])
  }

  // ── Stop list mutations ───────────────────────────────────────────────────────

  function moveStop(i, dir) {
    setStops(prev => {
      const arr = [...prev]
      const j = i + dir
      if (j < 0 || j >= arr.length) return arr
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return arr
    })
  }

  function removeStop(i) {
    setStops(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateStop(i, field, value) {
    setStops(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  // ── Save — edit mode ─────────────────────────────────────────────────────────

  async function handleSave() {
    if (!timetableId || stops.length < 2) return
    setSaving(true); setSaveError(''); setSaveSuccess(false)

    const { error: delErr } = await supabase
      .from('timetable_stops').delete().eq('timetable_id', timetableId)
    if (delErr) { setSaveError(delErr.message); setSaving(false); return }

    const rows = stops.map((s, i) => ({
      timetable_id:   timetableId,
      stop_id:        s.stop_id,
      sequence:       i + 1,
      stop_type:      s.stop_type,
      scheduled_time: s.stop_type === 'timing_point' && s.scheduled_time ? s.scheduled_time : null,
    }))

    const { error: insErr } = await supabase.from('timetable_stops').insert(rows)
    if (insErr) { setSaveError(insErr.message); setSaving(false); return }

    setSaving(false)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
  }

  // ── Save — new route mode ────────────────────────────────────────────────────

  async function handleSaveNewRoute() {
    if (!newRouteForm.service_code || stops.length < 2) return
    setSaving(true); setSaveError(''); setSaveSuccess(false)

    const company_id = await getCompanyId()

    const { data: routeData, error: routeErr } = await supabase
      .from('routes')
      .insert({
        company_id,
        service_code: newRouteForm.service_code,
        name:         newRouteForm.name || null,
        journey_type: newRouteForm.journey_type,
      })
      .select('id')
      .single()
    if (routeErr) { setSaveError(routeErr.message); setSaving(false); return }

    const { data: ttData, error: ttErr } = await supabase
      .from('timetables')
      .insert({
        route_id:   routeData.id,
        period:     newRouteForm.period,
        direction:  newRouteForm.direction,
        valid_from: newRouteForm.valid_from || null,
        valid_to:   newRouteForm.valid_to   || null,
      })
      .select('id')
      .single()
    if (ttErr) { setSaveError(ttErr.message); setSaving(false); return }

    // Create stops that were placed by pin-drop (no stop_id yet), then build timetable_stops
    const stopRows = []
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i]
      let stopId = s.stop_id

      if (!stopId) {
        const { data: stopData, error: stopErr } = await supabase
          .from('stops')
          .insert({ name: s.name, lat: s.lat, lon: s.lon })
          .select('id')
          .single()
        if (stopErr) {
          setSaveError(`Stop "${s.name}": ${stopErr.message}`)
          setSaving(false)
          return
        }
        stopId = stopData.id
      }

      stopRows.push({
        timetable_id:   ttData.id,
        stop_id:        stopId,
        sequence:       i + 1,
        stop_type:      s.stop_type,
        scheduled_time: s.stop_type === 'timing_point' && s.scheduled_time ? s.scheduled_time : null,
      })
    }

    const { error: stopsErr } = await supabase.from('timetable_stops').insert(stopRows)
    if (stopsErr) { setSaveError(stopsErr.message); setSaving(false); return }

    await loadRoutes()
    setNewRouteForm(NEW_ROUTE_EMPTY)
    setStops([])
    setSaving(false)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 4000)
  }

  // ── Mode switching ────────────────────────────────────────────────────────────

  function enterNewMode() {
    setMode('new')
    setNewRouteForm(NEW_ROUTE_EMPTY)
    setRouteId(''); setTimetableId(''); setStops([])
    setSaveError(''); setSaveSuccess(false)
    closeSearch()
  }

  function enterEditMode() {
    setMode('edit')
    setStops([])
    setSaveError(''); setSaveSuccess(false)
    closeSearch()
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const vehicle       = resolvedVehicle()
  const rawVehicle    = vehicles.find(v => v.id === vehicleId)
  const usingDefaults = rawVehicle && !rawVehicle.height_metres && !rawVehicle.width_metres && !rawVehicle.length_metres
  const warnings      = routeResult?.warnings ?? []
  const canSave = mode === 'edit'
    ? timetableId && stops.length >= 2 && !saving
    : newRouteForm.service_code && stops.length >= 2 && !saving

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 112px)', overflow: 'hidden' }}>

      {/* Header */}
      <div className="page-header" style={{ flexShrink: 0, marginBottom: 16 }}>
        <h1 className="page-title">Route Planner</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {saveSuccess && (
            <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>
              {mode === 'new' ? 'Route created ✓ — select it via Edit Existing' : 'Saved ✓'}
            </span>
          )}
          {mode === 'edit' ? (
            <button className="btn btn-ghost" onClick={enterNewMode}>+ New Route</button>
          ) : (
            <button className="btn btn-ghost" onClick={enterEditMode}>Edit Existing</button>
          )}
          <button
            className="btn btn-primary"
            onClick={mode === 'edit' ? handleSave : handleSaveNewRoute}
            disabled={!canSave}
          >
            {saving ? 'Saving…' : 'Save Route'}
          </button>
        </div>
      </div>

      {/* Two-panel body */}
      <div style={{ flex: 1, display: 'flex', gap: 16, overflow: 'hidden', minHeight: 0 }}>

        {/* ── Left panel ── */}
        <div style={{
          width: 400, flexShrink: 0, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8,
        }}>

          {/* Route context card */}
          {mode === 'edit' ? (
            <div className="card" style={{ padding: 16 }}>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label className="form-label">Route</label>
                <select
                  className="form-select"
                  value={routeId}
                  onChange={e => setRouteId(e.target.value)}
                >
                  <option value="">— Select route —</option>
                  {routes.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.service_code}{r.name ? ` — ${r.name}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Timetable</label>
                <select
                  className="form-select"
                  value={timetableId}
                  onChange={e => setTimetableId(e.target.value)}
                  disabled={!routeId}
                >
                  <option value="">— Select timetable —</option>
                  {timetables.map(t => (
                    <option key={t.id} value={t.id}>{t.period} {t.direction}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: 16 }}>
              <div style={{
                fontFamily: 'Oswald', fontWeight: 600, fontSize: 12,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--text-muted)', marginBottom: 14,
              }}>
                New Route
              </div>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label className="form-label">Service Code</label>
                <input
                  className="form-input"
                  style={{ fontSize: 13 }}
                  placeholder="e.g. S125S"
                  value={newRouteForm.service_code}
                  onChange={e => setNewRouteForm(f => ({ ...f, service_code: e.target.value.toUpperCase() }))}
                  autoFocus
                />
              </div>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label className="form-label">
                  Name{' '}
                  <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                </label>
                <input
                  className="form-input"
                  style={{ fontSize: 13 }}
                  placeholder="e.g. Sleaford – Cranwell"
                  value={newRouteForm.name}
                  onChange={e => setNewRouteForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label className="form-label">Journey Type</label>
                <select
                  className="form-select"
                  style={{ fontSize: 13 }}
                  value={newRouteForm.journey_type}
                  onChange={e => setNewRouteForm(f => ({ ...f, journey_type: e.target.value }))}
                >
                  {JOURNEY_TYPES.map(jt => <option key={jt} value={jt}>{jt}</option>)}
                </select>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />

              <div style={{
                fontFamily: 'Oswald', fontWeight: 600, fontSize: 12,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--text-muted)', marginBottom: 10,
              }}>
                Timetable
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Period</label>
                  <select
                    className="form-select"
                    style={{ fontSize: 13 }}
                    value={newRouteForm.period}
                    onChange={e => setNewRouteForm(f => ({ ...f, period: e.target.value }))}
                  >
                    {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Direction</label>
                  <select
                    className="form-select"
                    style={{ fontSize: 13 }}
                    value={newRouteForm.direction}
                    onChange={e => setNewRouteForm(f => ({ ...f, direction: e.target.value }))}
                  >
                    {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">
                    Valid From{' '}
                    <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(opt)</span>
                  </label>
                  <input
                    className="form-input"
                    style={{ fontSize: 13 }}
                    type="date"
                    value={newRouteForm.valid_from}
                    onChange={e => setNewRouteForm(f => ({ ...f, valid_from: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">
                    Valid To{' '}
                    <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(opt)</span>
                  </label>
                  <input
                    className="form-input"
                    style={{ fontSize: 13 }}
                    type="date"
                    value={newRouteForm.valid_to}
                    onChange={e => setNewRouteForm(f => ({ ...f, valid_to: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Vehicle (both modes) */}
          <div className="card" style={{ padding: 16 }}>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label className="form-label">Vehicle</label>
              <select
                className="form-select"
                value={vehicleId}
                onChange={e => setVehicleId(e.target.value)}
              >
                <option value="">— Route without vehicle dimensions —</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.registration} — {v.vehicle_type}
                  </option>
                ))}
              </select>
            </div>
            {vehicle && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 16 }}>
                <span>H: {vehicle.height_metres}m</span>
                <span>W: {vehicle.width_metres}m</span>
                <span>L: {vehicle.length_metres}m</span>
                {usingDefaults && <span style={{ color: '#d69e2e', marginLeft: 4 }}>type defaults</span>}
              </div>
            )}
            {!vehicleId && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Select a vehicle to apply height, width and length restrictions to routing.
              </div>
            )}
          </div>

          {/* Stops (both modes) */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14,
            }}>
              <span style={{
                fontFamily: 'Oswald', fontWeight: 600, fontSize: 12,
                textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)',
              }}>
                Stops
              </span>
              {routing && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Routing…</span>}
            </div>

            {stops.length === 0 && !showSearch && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '4px 0 10px' }}>
                {mode === 'new'
                  ? 'Click the map to place stops, or use search below.'
                  : 'No stops yet. Add stops below to plan the route.'}
              </div>
            )}

            {stops.map((s, i) => (
              <div
                key={s._id}
                style={{ borderLeft: `3px solid ${stopColor(i, stops.length)}`, paddingLeft: 10, marginBottom: 12 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
                  <span style={{
                    fontFamily: 'Oswald', fontWeight: 700, fontSize: 13,
                    color: stopColor(i, stops.length), minWidth: 20,
                  }}>
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{s.name}</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 5px', minWidth: 0, fontSize: 13 }}
                    onClick={() => moveStop(i, -1)} disabled={i === 0} title="Move up"
                  >↑</button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 5px', minWidth: 0, fontSize: 13 }}
                    onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1} title="Move down"
                  >↓</button>
                  <button
                    className="btn btn-danger btn-sm"
                    style={{ padding: '2px 6px', minWidth: 0, fontSize: 13 }}
                    onClick={() => removeStop(i)} title="Remove"
                  >×</button>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    className="form-select"
                    style={{ fontSize: 12, padding: '3px 8px', height: 28, flex: 1 }}
                    value={s.stop_type}
                    onChange={e => updateStop(i, 'stop_type', e.target.value)}
                  >
                    <option value="timing_point">Timing point</option>
                    <option value="routing_point">Routing point</option>
                  </select>
                  {s.stop_type === 'timing_point' && (
                    <input
                      type="time"
                      className="form-input"
                      style={{ fontSize: 12, padding: '3px 8px', height: 28, width: 90 }}
                      value={s.scheduled_time}
                      onChange={e => updateStop(i, 'scheduled_time', e.target.value)}
                    />
                  )}
                </div>
              </div>
            ))}

            {showSearch ? (
              <div style={{ marginTop: stops.length ? 6 : 0 }}>
                <input
                  autoFocus
                  className="form-input"
                  placeholder="Search stops or address…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{ marginBottom: 6 }}
                />
                {searching && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>Searching…</div>
                )}
                <div>
                  {searchResults.map((r, idx) => (
                    <div
                      key={idx}
                      onMouseDown={() => handleAddStop(r)}
                      style={{
                        padding: '6px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 13,
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: 'var(--bg)', marginBottom: 2,
                      }}
                    >
                      <span style={{
                        fontSize: 10, fontFamily: 'Oswald', fontWeight: 700,
                        color: r.source === 'stop' ? 'var(--green)' : 'var(--navy-brand)',
                        textTransform: 'uppercase', minWidth: 32,
                      }}>
                        {r.source === 'stop' ? 'Stop' : 'Addr'}
                      </span>
                      <span style={{ flex: 1, lineHeight: 1.3 }}>{r.name}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={closeSearch}>Cancel</button>
                  {addingStop && <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>Adding…</span>}
                </div>
              </div>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: stops.length ? 6 : 0 }}
                onClick={() => setShowSearch(true)}
                disabled={mode === 'edit' && !timetableId}
                title={mode === 'edit' && !timetableId ? 'Select a timetable first' : undefined}
              >
                + Add from search
              </button>
            )}
          </div>

          {/* Route summary */}
          {routeResult && !routeResult.error && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 20, alignItems: 'baseline', marginBottom: warnings.length ? 10 : 0 }}>
                <span style={{ fontFamily: 'Oswald', fontWeight: 700, fontSize: 18, color: 'var(--navy-brand)' }}>
                  {fmtDist(routeResult.distance)}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                  {fmtDur(routeResult.duration)}
                </span>
              </div>
              {warnings.map((w, idx) => (
                <div key={idx} style={{ fontSize: 12, color: '#d69e2e', display: 'flex', gap: 6, marginTop: 4 }}>
                  <span>⚠</span>
                  <span>{w.message ?? `Routing warning (code ${w.code})`}</span>
                </div>
              ))}
            </div>
          )}

          {routeResult?.error && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                Routing error: {routeResult.error}
              </div>
              {!import.meta.env.VITE_ORS_API_KEY && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  VITE_ORS_API_KEY is not set. Register at openrouteservice.org for a free key.
                </div>
              )}
            </div>
          )}

          {saveError && <div className="error-msg">{saveError}</div>}
        </div>

        {/* ── Map panel ── */}
        <div style={{
          flex: 1, minWidth: 0,
          borderRadius: 'var(--radius)', overflow: 'hidden',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow)',
          position: 'relative',
        }}>
          {mode === 'new' && stops.length === 0 && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(30,61,114,0.85)', color: '#fff',
              padding: '6px 18px', borderRadius: 20, fontSize: 13, fontWeight: 500,
              pointerEvents: 'none', zIndex: 1000, whiteSpace: 'nowrap',
            }}>
              Click the map to place your first stop
            </div>
          )}
          <PlannerMap
            stops={stops}
            routeGeometry={routeResult?.geometry ?? null}
            pinDropMode={mode === 'new'}
            onMapClick={handleMapPinDrop}
          />
        </div>
      </div>
    </div>
  )
}
