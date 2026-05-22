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

const S = {
  sectionLabel: {
    fontFamily: 'Oswald', fontWeight: 700, fontSize: 10,
    textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)',
  },
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

function PlannerMap({ stops, routeGeometry, pinDropMode, onMapClick, onRemoveStop, fitKey }) {
  const divRef        = useRef(null)
  const mapRef        = useRef(null)
  const markersRef    = useRef([])
  const lineRef       = useRef(null)
  const clickRef      = useRef(null)
  const prevFitKeyRef = useRef(null)

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
      input.placeholder = 'Finding location…'
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

      fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`,
        { headers: { 'Accept-Language': 'en' } },
      )
        .then(r => r.json())
        .then(data => {
          input.placeholder = 'Stop name…'
          if (input.value) return
          const addr = data.address || {}
          const road  = addr.road || addr.pedestrian || addr.footway || addr.path
          const place = addr.village || addr.suburb || addr.town || addr.city || addr.hamlet
          const suggestion = road && place ? `${road}, ${place}` : (road || place || '')
          if (suggestion) { input.value = suggestion; input.select() }
        })
        .catch(() => { input.placeholder = 'Stop name…' })

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

      if (onRemoveStop) {
        marker.on('click', () => {
          const wrap = document.createElement('div')
          wrap.style.cssText = 'padding:8px;text-align:center;min-width:160px'

          const nameEl = document.createElement('div')
          nameEl.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:8px;color:#1a2535;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
          nameEl.textContent = s.name

          const btn = document.createElement('button')
          btn.textContent = 'Remove stop'
          btn.style.cssText = 'padding:4px 14px;font-size:12px;background:#e53e3e;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:inherit'
          btn.addEventListener('click', () => { onRemoveStop(s._id); map.closePopup() })

          wrap.appendChild(nameEl)
          wrap.appendChild(btn)
          L.popup({ closeButton: true, maxWidth: 240 })
            .setLatLng([s.lat, s.lon]).setContent(wrap).openOn(map)
        })
      }

      marker.addTo(map)
      markersRef.current.push(marker)
    })

    // Only fit/pan when fitKey changes — i.e. when stops are loaded from the DB.
    // User-initiated adds (pin-drop, search) leave the map view unchanged.
    if (fitKey !== null && fitKey !== prevFitKeyRef.current) {
      prevFitKeyRef.current = fitKey
      if (validStops.length >= 2) {
        map.fitBounds(L.latLngBounds(validStops.map(s => [s.lat, s.lon])), { padding: [32, 32] })
      } else if (validStops.length === 1) {
        map.setView([validStops[0].lat, validStops[0].lon], 13)
      }
    }
  }, [stops, routeGeometry, fitKey, onRemoveStop])

  return <div ref={divRef} style={{ width: '100%', height: '100%' }} />
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RoutePlannerPage() {
  // Route selection: '' = none, '__new__' = inline new form, uuid = existing
  const [routeId,     setRouteId]     = useState('')
  const [timetableId, setTimetableId] = useState('')
  const [vehicleId,   setVehicleId]   = useState('')

  const [routes,     setRoutes]     = useState([])
  const [timetables, setTimetables] = useState([])
  const [vehicles,   setVehicles]   = useState([])

  // Inline new-route fields (shown when routeId === '__new__')
  const [newCode,        setNewCode]        = useState('')
  const [newName,        setNewName]        = useState('')
  const [newJourneyType, setNewJourneyType] = useState('Local Bus')

  // Inline new-timetable fields (shown when timetableId === '__new__')
  const [newPeriod,    setNewPeriod]    = useState('Morning')
  const [newDirection, setNewDirection] = useState('Outbound')
  const [newValidFrom, setNewValidFrom] = useState('')
  const [newValidTo,   setNewValidTo]   = useState('')

  const [stops,       setStops]       = useState([])
  const [routing,     setRouting]     = useState(false)
  const [routeResult, setRouteResult] = useState(null)
  const [pinDropMode, setPinDropMode] = useState(false)

  const [showSearch,    setShowSearch]    = useState(false)
  const [searchQuery,   setSearchQuery]   = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching,     setSearching]     = useState(false)
  const [addingStop,    setAddingStop]    = useState(false)

  const [fitKey,      setFitKey]      = useState(null)

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
    if (!routeId || routeId === '__new__') {
      setTimetables([]); setTimetableId(''); setStops([])
      return
    }
    supabase.from('timetables').select('*').eq('route_id', routeId).order('period')
      .then(({ data }) => setTimetables(data ?? []))
    setTimetableId('')
    setStops([])
  }, [routeId])

  useEffect(() => {
    if (!timetableId || timetableId === '__new__') { setStops([]); return }
    supabase
      .from('timetable_stops').select('*, stops(*)').eq('timetable_id', timetableId).order('sequence')
      .then(({ data }) => {
        const loaded = (data ?? []).map(ts => ({
          _id:            ts.id,
          stop_id:        ts.stop_id,
          name:           ts.stops.name,
          lat:            ts.stops.lat,
          lon:            ts.stops.lon,
          stop_type:      ts.stop_type,
          scheduled_time: ts.scheduled_time ?? '',
        }))
        setStops(loaded)
        if (loaded.length > 0) setFitKey(k => (k ?? 0) + 1)
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
        .from('stops').select('id, name, lat, lon').ilike('name', `%${searchQuery}%`).limit(6)
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
        .from('stops').insert({ name: result.name, lat: result.lat, lon: result.lon })
        .select('id').single()
      if (error) {
        alert('Could not create stop: ' + error.message + '\n\nOnly super_user accounts can create new stops.')
        setAddingStop(false)
        return
      }
      stopId = data.id
    }

    setStops(prev => [...prev, {
      _id: crypto.randomUUID(), stop_id: stopId,
      name: result.name, lat: result.lat, lon: result.lon,
      stop_type: 'timing_point', scheduled_time: '',
    }])
    setShowSearch(false); setSearchQuery(''); setSearchResults([])
    setAddingStop(false)
  }

  function handleMapPinDrop({ name, lat, lon }) {
    setStops(prev => [...prev, {
      _id: crypto.randomUUID(), stop_id: null,
      name, lat, lon, stop_type: 'timing_point', scheduled_time: '',
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

  function removeStop(i) { setStops(prev => prev.filter((_, idx) => idx !== i)) }
  function removeStopById(id) { setStops(prev => prev.filter(s => s._id !== id)) }

  function updateStop(i, field, value) {
    setStops(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  // ── Save ─────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (stops.length < 2) return
    setSaving(true); setSaveError(''); setSaveSuccess(false)

    let resolvedRouteId     = routeId
    let resolvedTimetableId = timetableId

    if (routeId === '__new__') {
      const company_id = await getCompanyId()
      const { data, error } = await supabase.from('routes')
        .insert({ company_id, service_code: newCode.toUpperCase(), name: newName || null, journey_type: newJourneyType })
        .select('id').single()
      if (error) { setSaveError(error.message); setSaving(false); return }
      resolvedRouteId = data.id
    }

    if (timetableId === '__new__') {
      const { data, error } = await supabase.from('timetables')
        .insert({ route_id: resolvedRouteId, period: newPeriod, direction: newDirection, valid_from: newValidFrom || null, valid_to: newValidTo || null })
        .select('id').single()
      if (error) { setSaveError(error.message); setSaving(false); return }
      resolvedTimetableId = data.id
    }

    const { error: delErr } = await supabase
      .from('timetable_stops').delete().eq('timetable_id', resolvedTimetableId)
    if (delErr) { setSaveError(delErr.message); setSaving(false); return }

    const stopRows = []
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i]
      let stopId = s.stop_id
      if (!stopId) {
        const { data, error } = await supabase
          .from('stops').insert({ name: s.name, lat: s.lat, lon: s.lon }).select('id').single()
        if (error) { setSaveError(`Stop "${s.name}": ${error.message}`); setSaving(false); return }
        stopId = data.id
      }
      stopRows.push({
        timetable_id: resolvedTimetableId, stop_id: stopId, sequence: i + 1,
        stop_type: s.stop_type,
        scheduled_time: s.stop_type === 'timing_point' && s.scheduled_time ? s.scheduled_time : null,
      })
    }

    const { error: insErr } = await supabase.from('timetable_stops').insert(stopRows)
    if (insErr) { setSaveError(insErr.message); setSaving(false); return }

    const wasNew = routeId === '__new__'
    await loadRoutes()
    if (wasNew) {
      setNewCode(''); setNewName(''); setNewJourneyType('Local Bus')
      setNewPeriod('Morning'); setNewDirection('Outbound'); setNewValidFrom(''); setNewValidTo('')
      setRouteId(''); setTimetableId(''); setStops([])
    }
    setSaving(false); setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const vehicle       = resolvedVehicle()
  const rawVehicle    = vehicles.find(v => v.id === vehicleId)
  const usingDefaults = rawVehicle && !rawVehicle.height_metres && !rawVehicle.width_metres && !rawVehicle.length_metres
  const warnings      = routeResult?.warnings ?? []

  const routeReady = routeId === '__new__' ? newCode.trim().length > 0 : !!routeId
  const ttReady    = !!timetableId
  const canSave    = routeReady && ttReady && stops.length >= 2 && !saving

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 112px)', overflow: 'hidden' }}>

      {/* Header */}
      <div className="page-header" style={{ flexShrink: 0, marginBottom: 12 }}>
        <h1 className="page-title">Route Planner</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saveSuccess && (
            <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>
              {routeId === '__new__' ? 'Route created ✓ — select from list to continue' : 'Saved ✓'}
            </span>
          )}
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save Route'}
          </button>
        </div>
      </div>

      {/* Two-panel body */}
      <div style={{ flex: 1, display: 'flex', gap: 12, overflow: 'hidden', minHeight: 0 }}>

        {/* ── Sidebar (280px) ── */}
        <div style={{
          width: 280, minWidth: 280, flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 8,
          overflowY: 'auto', paddingBottom: 8,
        }}>

          {/* ── Card 1: Route + Timetable ── */}
          <div className="card" style={{ padding: 10 }}>

            {/* Route select */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Route</div>
              <select
                className="form-select"
                value={routeId}
                onChange={e => {
                  const val = e.target.value
                  setRouteId(val)
                  // Auto-select new timetable when creating a new route
                  if (val === '__new__') setTimetableId('__new__')
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

            {/* Inline new-route form */}
            {routeId === '__new__' && (
              <div style={{
                background: 'var(--bg)', borderRadius: 6, padding: 8, marginBottom: 6,
                border: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <div style={{ flex: '0 0 84px' }}>
                    <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Code</div>
                    <input
                      className="form-input" style={{ textTransform: 'uppercase' }}
                      placeholder="S125S" autoFocus value={newCode}
                      onChange={e => setNewCode(e.target.value.toUpperCase())}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Journey Type</div>
                    <select className="form-select" value={newJourneyType}
                      onChange={e => setNewJourneyType(e.target.value)}>
                      {JOURNEY_TYPES.map(jt => <option key={jt} value={jt}>{jt}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <div style={{ ...S.sectionLabel, marginBottom: 3 }}>
                    Name <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                  </div>
                  <input className="form-input" placeholder="e.g. Sleaford – Cranwell"
                    value={newName} onChange={e => setNewName(e.target.value)} />
                </div>
              </div>
            )}

            {/* Timetable select */}
            <div>
              <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Timetable</div>
              <select
                className="form-select"
                value={timetableId}
                onChange={e => setTimetableId(e.target.value)}
                disabled={!routeId}
              >
                <option value="">— Select timetable —</option>
                <option value="__new__">＋ New timetable…</option>
                {timetables.length > 0 && <option disabled>──────────</option>}
                {timetables.map(t => (
                  <option key={t.id} value={t.id}>{t.period} · {t.direction}</option>
                ))}
              </select>
            </div>

            {/* Inline new-timetable form */}
            {timetableId === '__new__' && (
              <div style={{
                background: 'var(--bg)', borderRadius: 6, padding: 8, marginTop: 6,
                border: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Period</div>
                    <select className="form-select" value={newPeriod}
                      onChange={e => setNewPeriod(e.target.value)}>
                      {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Direction</div>
                    <select className="form-select" value={newDirection}
                      onChange={e => setNewDirection(e.target.value)}>
                      {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...S.sectionLabel, marginBottom: 3 }}>From <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(opt)</span></div>
                    <input className="form-input" type="date"
                      value={newValidFrom} onChange={e => setNewValidFrom(e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...S.sectionLabel, marginBottom: 3 }}>To <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(opt)</span></div>
                    <input className="form-input" type="date"
                      value={newValidTo} onChange={e => setNewValidTo(e.target.value)} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Card 2: Vehicle ── */}
          <div className="card" style={{ padding: '7px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...S.sectionLabel, whiteSpace: 'nowrap' }}>Vehicle</span>
              <select className="form-select" style={{ flex: 1 }}
                value={vehicleId} onChange={e => setVehicleId(e.target.value)}>
                <option value="">— None —</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>{v.registration} · {v.vehicle_type}</option>
                ))}
              </select>
            </div>
            {vehicle && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, paddingLeft: 52 }}>
                H {vehicle.height_metres}m · W {vehicle.width_metres}m · L {vehicle.length_metres}m
                {usingDefaults && <span style={{ color: '#d69e2e' }}> · type defaults</span>}
              </div>
            )}
          </div>

          {/* ── Card 3: Stops + summary + errors ── */}
          <div className="card" style={{ padding: 10 }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={S.sectionLabel}>
                Stops{stops.length > 0 ? ` · ${stops.length}` : ''}
              </span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {routing && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Routing…</span>}
                <button
                  className={`btn btn-sm ${pinDropMode ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ padding: '2px 8px' }}
                  onClick={() => setPinDropMode(p => !p)}
                  title="Toggle map pin-drop mode"
                >
                  {pinDropMode ? 'Pinning…' : 'Drop pins'}
                </button>
              </div>
            </div>

            {stops.length === 0 && !showSearch && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px' }}>
                Toggle Drop pins to click the map, or use search below.
              </p>
            )}

            {stops.map((s, i) => {
              const color = stopColor(i, stops.length)
              return (
                <div key={s._id} style={{ borderLeft: `3px solid ${color}`, paddingLeft: 8, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 3 }}>
                    <span style={{
                      fontFamily: 'Oswald', fontWeight: 700, fontSize: 10,
                      color, width: 14, flexShrink: 0, textAlign: 'right',
                    }}>
                      {i + 1}
                    </span>
                    <span style={{
                      flex: 1, fontSize: 13, fontWeight: 600, lineHeight: 1.3,
                      paddingLeft: 5, paddingRight: 2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }} title={s.name}>
                      {s.name}
                    </span>
                    <button className="btn btn-ghost btn-sm"
                      style={{ padding: '1px 4px', minWidth: 0, lineHeight: 1 }}
                      onClick={() => moveStop(i, -1)} disabled={i === 0} title="Move up">↑</button>
                    <button className="btn btn-ghost btn-sm"
                      style={{ padding: '1px 4px', minWidth: 0, lineHeight: 1 }}
                      onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1} title="Move down">↓</button>
                    <button className="btn btn-danger btn-sm"
                      style={{ padding: '1px 5px', minWidth: 0, lineHeight: 1 }}
                      onClick={() => removeStop(i)} title="Remove">×</button>
                  </div>
                  <div style={{ display: 'flex', gap: 4, paddingLeft: 19 }}>
                    <select className="form-select"
                      style={{ fontSize: 12, height: 26, padding: '2px 6px', flex: 1 }}
                      value={s.stop_type} onChange={e => updateStop(i, 'stop_type', e.target.value)}>
                      <option value="timing_point">Timing point</option>
                      <option value="routing_point">Routing point</option>
                    </select>
                    {s.stop_type === 'timing_point' && (
                      <input type="time" className="form-input"
                        style={{ fontSize: 12, height: 26, padding: '2px 4px', width: 78, flexShrink: 0 }}
                        value={s.scheduled_time} onChange={e => updateStop(i, 'scheduled_time', e.target.value)} />
                    )}
                  </div>
                </div>
              )
            })}

            {showSearch ? (
              <div style={{ marginTop: stops.length ? 4 : 0 }}>
                <input autoFocus className="form-input" style={{ marginBottom: 5 }}
                  placeholder="Search stops or address…" value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)} />
                {searching && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '2px 0 4px' }}>Searching…</div>}
                {searchResults.map((r, idx) => (
                  <div key={idx} onMouseDown={() => handleAddStop(r)} style={{
                    padding: '5px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 13,
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'var(--bg)', marginBottom: 2,
                  }}>
                    <span style={{
                      fontSize: 10, fontFamily: 'Oswald', fontWeight: 700,
                      color: r.source === 'stop' ? 'var(--green)' : 'var(--navy-brand)',
                      textTransform: 'uppercase', minWidth: 28,
                    }}>{r.source === 'stop' ? 'Stop' : 'Addr'}</span>
                    <span style={{ flex: 1, lineHeight: 1.3 }}>{r.name}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                  <button className="btn btn-ghost btn-sm" onClick={closeSearch}>Cancel</button>
                  {addingStop && <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>Adding…</span>}
                </div>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm"
                style={{ marginTop: stops.length ? 4 : 0 }}
                onClick={() => setShowSearch(true)}>
                + Add from search
              </button>
            )}

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
                {!import.meta.env.VITE_ORS_API_KEY && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>VITE_ORS_API_KEY is not set.</div>
                )}
              </div>
            )}

            {saveError && <div className="error-msg" style={{ marginTop: 10 }}>{saveError}</div>}
          </div>
        </div>

        {/* ── Map panel ── */}
        <div style={{
          flex: 1, minWidth: 0, position: 'relative',
          borderRadius: 'var(--radius)', overflow: 'hidden',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow)',
        }}>
          {pinDropMode && stops.length === 0 && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(30,61,114,0.88)', color: '#fff',
              padding: '6px 18px', borderRadius: 20, fontSize: 13, fontWeight: 500,
              pointerEvents: 'none', zIndex: 1000, whiteSpace: 'nowrap',
            }}>
              Click the map to place your first stop
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
    </div>
  )
}
