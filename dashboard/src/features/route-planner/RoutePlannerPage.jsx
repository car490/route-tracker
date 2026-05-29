import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../shared/supabase'
import { getCompanyId } from '../../shared/company'
import { searchPlaces } from '../../shared/api/osPlaces'
import { getRouteORS } from './ors'
import { useJourneyTypes } from '../../shared/hooks/useJourneyTypes'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const TYPE_DEFAULTS = {
  'Minibus':           { height_metres: 2.85, width_metres: 2.20, length_metres:  8.00 },
  'Midi Coach':        { height_metres: 3.20, width_metres: 2.40, length_metres: 10.00 },
  'Full Size Coach':   { height_metres: 3.70, width_metres: 2.55, length_metres: 13.75 },
  'Single Decker Bus': { height_metres: 3.15, width_metres: 2.55, length_metres: 12.00 },
  'Double Decker':     { height_metres: 4.35, width_metres: 2.55, length_metres: 11.00 },
}

const DIRECTIONS = ['Outbound', 'Inbound', 'Circular']
const DAYS       = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DEP_EMPTY  = { departure_time: '', days_of_week: [1,2,3,4,5], timing_profile: 'standard', vehicle_journey_code: '' }

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
function timeToMinutes(t) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
function minutesToTime(mins) {
  if (mins == null) return ''
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
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
  const { journeyTypes } = useJourneyTypes()
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

  // Inline new-timetable fields
  const [newTtName,       setNewTtName]       = useState('')
  const [newDirection,    setNewDirection]    = useState('Outbound')
  const [newTtCollapsed,  setNewTtCollapsed]  = useState(false)

  // Departures
  const [departures, setDepartures] = useState([])
  const [depModal,   setDepModal]   = useState(null)
  const [depForm,    setDepForm]    = useState(DEP_EMPTY)
  const [depSaving,  setDepSaving]  = useState(false)
  const [depError,   setDepError]   = useState('')

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
  const [showSetup,   setShowSetup]   = useState(true)

  // ── Load lookups ─────────────────────────────────────────────────────────────

  async function loadRoutes() {
    const { data } = await supabase.from('routes').select('*').order('service_code')
    setRoutes(data ?? [])
  }

  useEffect(() => { loadRoutes() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!routeId || routeId === '__new__') {
      setTimetables([]); setTimetableId('')
      setStops([]); setDepartures([])
      return
    }
    supabase.from('timetables').select('*').eq('route_id', routeId).order('name')
      .then(({ data }) => setTimetables(data ?? []))
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

  // ── Auto-hide setup cards when route + timetable are confirmed ───────────────

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
  }, [stops, vehicleType])

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
      stop_type: 'timing_point', time_std: '', time_delay: '', time_early: '',
    }])
    setShowSearch(false); setSearchQuery(''); setSearchResults([])
    setAddingStop(false)
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

  // ── Departures ────────────────────────────────────────────────────────────────

  async function loadDepartures(ttId) {
    const { data } = await supabase
      .from('timetable_departures').select('*').eq('timetable_id', ttId).order('departure_time')
    setDepartures(data ?? [])
  }

  async function saveDeparture(e) {
    e.preventDefault()
    setDepSaving(true); setDepError('')
    const payload = {
      timetable_id:         timetableId,
      departure_time:       depForm.departure_time,
      days_of_week:         depForm.days_of_week,
      timing_profile:       depForm.timing_profile,
      vehicle_journey_code: depForm.vehicle_journey_code,
    }
    const { error } = depModal === 'add'
      ? await supabase.from('timetable_departures').insert(payload)
      : await supabase.from('timetable_departures').update({
          departure_time:       depForm.departure_time,
          days_of_week:         depForm.days_of_week,
          timing_profile:       depForm.timing_profile,
          vehicle_journey_code: depForm.vehicle_journey_code,
        }).eq('id', depModal.id)
    setDepSaving(false)
    if (error) { setDepError(error.message); return }
    setDepModal(null)
    loadDepartures(timetableId)
  }

  async function deleteDeparture(id) {
    if (!confirm('Delete this departure?')) return
    await supabase.from('timetable_departures').delete().eq('id', id)
    loadDepartures(timetableId)
  }

  async function nextVjc() {
    if (!timetables.length) return 'VJ1'
    const { count } = await supabase
      .from('timetable_departures')
      .select('id', { count: 'exact', head: true })
      .in('timetable_id', timetables.map(t => t.id))
    return `VJ${(count ?? 0) + 1}`
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
        .insert({ company_id, service_code: newCode.toUpperCase(), name: newName || null, journey_type: newJourneyTypes })
        .select('id').single()
      if (error) { setSaveError(error.message); setSaving(false); return }
      resolvedRouteId = data.id
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

    // First timing point's time_std = departure time (offset 0)
    const firstTiming = stops.find(s => s.stop_type === 'timing_point' && s.time_std)
    const base        = firstTiming ? timeToMinutes(firstTiming.time_std) : null

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
      setNewTtName(''); setNewDirection('Outbound')
      setRouteId(''); setTimetableId(''); setStops([])
    }
    setSaving(false); setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const vehicle  = resolvedVehicle()
  const warnings = routeResult?.warnings ?? []

  const routeConfirmed = routeId === '__new__' ? newRouteCollapsed : !!routeId
  const routeReady = routeId === '__new__' ? newCode.trim().length > 0 && newJourneyTypes.length > 0 : !!routeId
  const ttReady    = !!timetableId
  const canSave    = routeReady && ttReady && stops.length >= 2 && !saving

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
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save Route'}
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
                name="route_id"
                className="form-select"
                style={{ fontSize: 12 }}
                value={routeId}
                onChange={e => {
                  const val = e.target.value
                  setRouteId(val)
                  if (val === '__new__') { setNewRouteCollapsed(false); setNewTtCollapsed(false) }
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
              <div
                style={{ background: 'var(--bg)', borderRadius: 6, padding: 8, marginBottom: 6, border: '1px solid var(--border)' }}
              >
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
                      <input
                        name="service_code"
                        className="form-input" style={{ textTransform: 'uppercase', fontSize: 12 }}
                        placeholder="S125S" autoFocus value={newCode}
                        onChange={e => setNewCode(e.target.value.toUpperCase())}
                      />
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ ...S.sectionLabel, marginBottom: 4 }}>Journey Types</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {journeyTypes.map(jt => {
                          const on = newJourneyTypes.includes(jt)
                          return (
                            <button key={jt} type="button"
                              onClick={() => setNewJourneyTypes(on ? [] : [jt])}
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
                      <div style={{ ...S.sectionLabel, marginBottom: 3 }}>
                        Name <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                      </div>
                      <input name="route_name" className="form-input" style={{ fontSize: 12 }} placeholder="e.g. Sleaford – Cranwell"
                        value={newName} onChange={e => setNewName(e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-primary btn-sm"
                        disabled={!newCode.trim() || newJourneyTypes.length === 0}
                        onClick={() => setNewRouteCollapsed(true)}
                      >Confirm route</button>
                    </div>
                  </>
                )}
              </div>
            )}

          </div>

          {routeConfirmed && (<>

          {/* Card 2: Timetable */}
          <div className="card" style={{ padding: 10 }}>

            <div style={{ marginBottom: timetableId === '__new__' ? 6 : 0 }}>
              <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Timetable</div>
              <select
                name="timetable_id"
                className="form-select"
                style={{ fontSize: 12 }}
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
              <div
                style={{ background: 'var(--bg)', borderRadius: 6, padding: 8, border: '1px solid var(--border)' }}
              >
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
                        {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
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

          {/* Card 3: Vehicle type */}
          <div className="card" style={{ padding: '7px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={S.sectionLabel}>Vehicle Type</span>
              {(() => {
                const allSelected = vehicleType.length === Object.keys(TYPE_DEFAULTS).length
                return (
                  <button type="button"
                    onClick={() => setVehicleType(allSelected ? [] : Object.keys(TYPE_DEFAULTS))}
                    style={{ fontSize: 11, color: 'var(--navy-brand)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                )
              })()}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
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
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                H {vehicle.height_metres}m · W {vehicle.width_metres}m · L {vehicle.length_metres}m
              </div>
            )}
          </div>

          </>)}

          </>)}

          {/* Card 4: Stops */}
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

            {/* Summary of selections from above */}
            {(() => {
              const selRoute = routeId && routeId !== '__new__' ? routes.find(r => r.id === routeId) : null
              const selTt    = timetableId && timetableId !== '__new__' ? timetables.find(t => t.id === timetableId) : null
              const code     = routeId === '__new__' ? newCode : selRoute?.service_code
              const name     = routeId === '__new__' ? newName : selRoute?.name
              const jtypes   = routeId === '__new__' ? newJourneyTypes : (selRoute?.journey_types ?? [])
              const ttLabel  = timetableId === '__new__'
                ? [newTtName, newDirection].filter(Boolean).join(' · ')
                : selTt ? `${selTt.name} · ${selTt.direction}` : ''
              if (!code && !ttLabel && !vehicleType.length) return null
              return (
                <div style={{
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '6px 8px', marginBottom: 10, fontSize: 12,
                }}>
                  {code && (
                    <div style={{ display: 'flex', gap: 5, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 3 }}>
                      <span style={{ fontFamily: 'Oswald', fontWeight: 700, fontSize: 13, color: 'var(--navy-brand)', flexShrink: 0 }}>
                        {code}
                      </span>
                      {name && (
                        <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {name}
                        </span>
                      )}
                      {jtypes.map(jt => (
                        <span key={jt} style={{
                          fontSize: 10, fontFamily: 'Oswald', fontWeight: 700,
                          background: 'var(--navy-brand)', color: '#fff',
                          borderRadius: 8, padding: '1px 6px', letterSpacing: '0.04em',
                          textTransform: 'uppercase', flexShrink: 0,
                        }}>{jt}</span>
                      ))}
                      <button type="button"
                        onClick={() => { setShowSetup(true); setNewRouteCollapsed(false); setNewTtCollapsed(false) }}
                        style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--navy-brand)', cursor: 'pointer', fontSize: 11, padding: 0, flexShrink: 0, textDecoration: 'underline', fontFamily: 'inherit' }}
                      >Edit</button>
                    </div>
                  )}
                  {ttLabel && (
                    <div style={{ color: 'var(--text-muted)', marginBottom: vehicleType.length ? 3 : 0 }}>
                      {ttLabel}
                    </div>
                  )}
                  {vehicleType.length > 0 && (
                    <div style={{ color: 'var(--text-muted)' }}>
                      {vehicleType.join(', ')}
                    </div>
                  )}
                </div>
              )
            })()}

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
                  <div style={{ paddingLeft: 19 }}>
                    <select name="stop_type" className="form-select"
                      style={{ fontSize: 12, height: 26, padding: '2px 6px', width: '100%', marginBottom: 3 }}
                      value={s.stop_type} onChange={e => updateStop(i, 'stop_type', e.target.value)}>
                      <option value="timing_point">Timing point</option>
                      <option value="routing_point">Routing point</option>
                    </select>
                    {s.stop_type === 'timing_point' && (
                      <div style={{ display: 'flex', gap: 3 }}>
                        {[['time_std','Std'],['time_delay','Delay'],['time_early','Early']].map(([field, label]) => (
                          <div key={field} style={{ flex: 1 }}>
                            <div style={{
                              fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Oswald',
                              fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 1,
                            }}>{label}</div>
                            <input type="time" className="form-input"
                              style={{ fontSize: 11, height: 24, padding: '1px 3px', width: '100%' }}
                              value={s[field]} onChange={e => updateStop(i, field, e.target.value)} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {showSearch ? (
              <div style={{ marginTop: stops.length ? 4 : 0 }}>
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

          {/* Card 4: Departures */}
          {timetableId && timetableId !== '__new__' && (
            <div className="card" style={{ padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={S.sectionLabel}>Departures</span>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={async () => {
                    const vjc = await nextVjc()
                    setDepForm({ ...DEP_EMPTY, vehicle_journey_code: vjc })
                    setDepError('')
                    setDepModal('add')
                  }}
                >+ Add</button>
              </div>

              {departures.length === 0 && depModal === null && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>No departures yet.</p>
              )}

              {departures.map(dep => (
                <div key={dep.id} style={{
                  background: 'var(--bg)', borderRadius: 5, padding: '5px 7px',
                  marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ fontFamily: 'Oswald', fontWeight: 700, fontSize: 14, color: 'var(--navy-brand)', minWidth: 42 }}>
                    {dep.departure_time.slice(0, 5)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>
                    {dep.days_of_week.map(d => DAYS[d - 1]).join(' ')}
                    {dep.timing_profile !== 'standard' && (
                      <span style={{ marginLeft: 4, color: dep.timing_profile === 'delay' ? '#d69e2e' : 'var(--green)' }}>
                        · {dep.timing_profile}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{dep.vehicle_journey_code}</span>
                  <button className="btn btn-ghost btn-sm"
                    style={{ padding: '1px 5px', minWidth: 0, fontSize: 11 }}
                    onClick={() => {
                      setDepForm({
                        departure_time:       dep.departure_time.slice(0, 5),
                        days_of_week:         dep.days_of_week,
                        timing_profile:       dep.timing_profile,
                        vehicle_journey_code: dep.vehicle_journey_code,
                      })
                      setDepError('')
                      setDepModal(dep)
                    }}
                  >Edit</button>
                  <button className="btn btn-danger btn-sm"
                    style={{ padding: '1px 5px', minWidth: 0, fontSize: 11 }}
                    onClick={() => deleteDeparture(dep.id)}
                  >×</button>
                </div>
              ))}

              {depModal !== null && (
                <div style={{
                  background: 'var(--bg)', borderRadius: 6, padding: 8, marginTop: 6,
                  border: '1px solid var(--border)',
                }}>
                  {depError && <div className="error-msg" style={{ marginBottom: 6 }}>{depError}</div>}
                  <form onSubmit={saveDeparture}>
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Departure Time</div>
                      <input type="time" className="form-input"
                        value={depForm.departure_time}
                        onChange={e => setDepForm(f => ({ ...f, departure_time: e.target.value }))}
                        required />
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Days</div>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {DAYS.map((d, idx) => {
                          const dayNum = idx + 1
                          const on = depForm.days_of_week.includes(dayNum)
                          return (
                            <button key={d} type="button"
                              onClick={() => setDepForm(f => ({
                                ...f,
                                days_of_week: on
                                  ? f.days_of_week.filter(x => x !== dayNum)
                                  : [...f.days_of_week, dayNum].sort((a, b) => a - b),
                              }))}
                              style={{
                                padding: '2px 6px', fontSize: 10, borderRadius: 8, cursor: 'pointer',
                                fontFamily: 'inherit', lineHeight: 1.5,
                                border: `1px solid ${on ? 'var(--navy-brand)' : 'var(--border)'}`,
                                background: on ? 'var(--navy-brand)' : 'transparent',
                                color: on ? '#fff' : 'var(--text-muted)',
                              }}
                            >{d}</button>
                          )
                        })}
                      </div>
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Timing Profile</div>
                      <select className="form-select" value={depForm.timing_profile}
                        onChange={e => setDepForm(f => ({ ...f, timing_profile: e.target.value }))}>
                        <option value="standard">Standard</option>
                        <option value="delay">Delay</option>
                        <option value="early">Early</option>
                      </select>
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Journey Code (VJC)</div>
                      <input className="form-input"
                        value={depForm.vehicle_journey_code}
                        onChange={e => setDepForm(f => ({ ...f, vehicle_journey_code: e.target.value }))}
                        required />
                    </div>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDepModal(null)}>Cancel</button>
                      <button type="submit" className="btn btn-primary btn-sm" disabled={depSaving}>
                        {depSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

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
