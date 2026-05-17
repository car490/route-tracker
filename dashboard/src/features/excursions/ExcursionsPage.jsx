import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../shared/supabase'
import { getCompanyId } from '../../shared/company'
import Modal from '../../shared/components/Modal'
import { searchPlaces } from './osPlaces'
import { getRoute } from './osrm'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const STATUS_BADGE = {
  scheduled:   <span className="badge badge-gray">Scheduled</span>,
  in_progress: <span className="badge badge-amber">In Progress</span>,
  completed:   <span className="badge badge-green">Completed</span>,
  cancelled:   <span className="badge badge-red">Cancelled</span>,
}

function todayStr() { return new Date().toISOString().slice(0, 10) }

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

function fmtDur(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m} min`
}

function wpLabel(i, total) {
  if (i === 0) return 'Pickup'
  if (i === total - 1) return 'Drop-off'
  return `Stop ${i}`
}

function wpColor(i, total) {
  if (i === 0) return '#4db848'
  if (i === total - 1) return '#e53935'
  return '#1e3d72'
}

// ── Route planner Leaflet map ─────────────────────────────────────────────────

function RoutePlannerMap({ waypoints, onRouteInfo }) {
  const divRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const lineRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!divRef.current || mapRef.current) return
    const map = L.map(divRef.current).setView([52.97, -0.02], 7)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map)
    mapRef.current = map
    // Invalidate size after modal animation settles
    setTimeout(() => map.invalidateSize(), 200)
    setReady(true)
    return () => {
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    if (lineRef.current) { lineRef.current.remove(); lineRef.current = null }

    if (!waypoints.length) return

    waypoints.forEach((wp, i) => {
      const color = wpColor(i, waypoints.length)
      const letter = String.fromCharCode(65 + i)
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${color};color:#fff;font-family:Oswald,sans-serif;font-size:11px;font-weight:700;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4)">${letter}</div>`,
        iconAnchor: [11, 11],
      })
      markersRef.current.push(
        L.marker([wp.lat, wp.lon], { icon }).bindPopup(wp.name).addTo(map)
      )
    })

    map.fitBounds(
      L.latLngBounds(waypoints.map(w => [w.lat, w.lon])),
      { padding: [40, 40] }
    )

    if (waypoints.length >= 2) {
      getRoute(waypoints).then(route => {
        if (!route || !mapRef.current) return
        lineRef.current = L.geoJSON(route.geometry, {
          style: { color: '#1e3d72', weight: 4, opacity: 0.75 },
        }).addTo(mapRef.current)
        onRouteInfo?.({ distance: route.distance, duration: route.duration })
      })
    } else {
      onRouteInfo?.(null)
    }
  }, [waypoints, ready])

  return (
    <div
      ref={divRef}
      style={{
        height: 260,
        width: '100%',
        borderRadius: 6,
        overflow: 'hidden',
        border: '1px solid var(--border)',
      }}
    />
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ExcursionsPage() {
  const [excursions, setExcursions] = useState([])
  const [loading, setLoading] = useState(true)
  const [drivers, setDrivers] = useState([])
  const [vehicles, setVehicles] = useState([])

  // Create / edit modal
  const [modal, setModal] = useState(null) // null | 'new' | excursion object
  const [form, setForm] = useState({ journey_date: todayStr(), notes: '', driver_id: '', vehicle_id: '' })
  const [waypoints, setWaypoints] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [routeInfo, setRouteInfo] = useState(null)

  // Address search
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)

  // Passenger modal
  const [passengerModal, setPassengerModal] = useState(null)
  const [passengers, setPassengers] = useState([])
  const [pLoading, setPLoading] = useState(false)
  const [pForm, setPForm] = useState({ name: '', phone: '', notes: '' })
  const [pSaving, setPSaving] = useState(false)
  const [pError, setPError] = useState('')

  // ── Data loading ───────────────────────────────────────────────────────────

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('journeys')
      .select(`
        *,
        driver:staff(name),
        vehicle:vehicles(registration),
        waypoints:journey_waypoints(id),
        passengers:excursion_passengers(id)
      `)
      .eq('journey_type', 'Excursion')
      .neq('status', 'cancelled')
      .order('journey_date', { ascending: false })
    setExcursions(data ?? [])
    setLoading(false)
  }

  async function loadDeps() {
    const [d, v] = await Promise.all([
      supabase.from('staff').select('id, name').order('name'),
      supabase.from('vehicles').select('id, registration').order('registration'),
    ])
    setDrivers(d.data ?? [])
    setVehicles(v.data ?? [])
  }

  useEffect(() => { load(); loadDeps() }, [])

  // ── Address search (debounced) ────────────────────────────────────────────

  useEffect(() => {
    if (search.length < 3) { setSearchResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      const results = await searchPlaces(search)
      setSearchResults(results)
      setSearching(false)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  function selectPlace(place) {
    setWaypoints(ws => [...ws, {
      _id: crypto.randomUUID(),
      name: place.address,
      lat: place.lat,
      lon: place.lon,
      time: '',
      wp_notes: '',
    }])
    setSearch('')
    setSearchResults([])
  }

  function removeWaypoint(id) {
    setWaypoints(ws => ws.filter(w => w._id !== id))
    setRouteInfo(null)
  }

  function updateWaypoint(id, field, value) {
    setWaypoints(ws => ws.map(w => w._id === id ? { ...w, [field]: value } : w))
  }

  // ── Open modals ────────────────────────────────────────────────────────────

  function openNew() {
    setForm({ journey_date: todayStr(), notes: '', driver_id: '', vehicle_id: '' })
    setWaypoints([])
    setError('')
    setRouteInfo(null)
    setSearch('')
    setSearchResults([])
    setModal('new')
  }

  async function openEdit(exc) {
    setForm({
      journey_date: exc.journey_date,
      notes: exc.notes ?? '',
      driver_id: exc.driver_id ?? '',
      vehicle_id: exc.vehicle_id ?? '',
    })
    const { data } = await supabase
      .from('journey_waypoints')
      .select('*')
      .eq('journey_id', exc.id)
      .order('sequence')
    setWaypoints(
      (data ?? []).map(w => ({
        _id: w.id,
        name: w.name ?? '',
        lat: w.lat,
        lon: w.lon,
        time: w.scheduled_at
          ? new Date(w.scheduled_at).toTimeString().slice(0, 5)
          : '',
        wp_notes: w.notes ?? '',
      }))
    )
    setError('')
    setRouteInfo(null)
    setSearch('')
    setSearchResults([])
    setModal(exc)
  }

  // ── Save excursion ────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.journey_date) { setError('Date is required'); return }
    if (waypoints.length < 2) { setError('Add at least 2 locations (pickup and drop-off)'); return }
    setSaving(true)
    setError('')
    try {
      const company_id = await getCompanyId()
      let journeyId

      const payload = {
        company_id,
        journey_date: form.journey_date,
        journey_type: 'Excursion',
        timetable_id: null,
        notes: form.notes || null,
        driver_id: form.driver_id || null,
        vehicle_id: form.vehicle_id || null,
      }

      if (modal === 'new') {
        const { data, error: err } = await supabase
          .from('journeys')
          .insert(payload)
          .select('id')
          .single()
        if (err) throw err
        journeyId = data.id
      } else {
        const { error: err } = await supabase
          .from('journeys')
          .update({
            journey_date: payload.journey_date,
            notes: payload.notes,
            driver_id: payload.driver_id,
            vehicle_id: payload.vehicle_id,
          })
          .eq('id', modal.id)
        if (err) throw err
        journeyId = modal.id
        const { error: delErr } = await supabase
          .from('journey_waypoints')
          .delete()
          .eq('journey_id', journeyId)
        if (delErr) throw delErr
      }

      const waypointRows = waypoints.map((w, i) => ({
        journey_id: journeyId,
        sequence: i + 1,
        name: w.name,
        lat: w.lat,
        lon: w.lon,
        stop_type: w.time ? 'timing_point' : 'routing_point',
        scheduled_at: w.time
          ? new Date(`${form.journey_date}T${w.time}:00`).toISOString()
          : null,
        notes: w.wp_notes || null,
      }))

      const { error: wpErr } = await supabase.from('journey_waypoints').insert(waypointRows)
      if (wpErr) throw wpErr

      setModal(null)
      load()
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  async function cancelExcursion(id) {
    if (!confirm('Cancel this excursion?')) return
    await supabase.from('journeys').update({ status: 'cancelled' }).eq('id', id)
    load()
  }

  // ── Passengers ────────────────────────────────────────────────────────────

  async function openPassengers(exc) {
    setPassengerModal(exc)
    setPLoading(true)
    setPForm({ name: '', phone: '', notes: '' })
    setPError('')
    const { data } = await supabase
      .from('excursion_passengers')
      .select('*')
      .eq('journey_id', exc.id)
      .order('created_at')
    setPassengers(data ?? [])
    setPLoading(false)
  }

  async function addPassenger() {
    if (!pForm.name.trim()) { setPError('Name is required'); return }
    setPSaving(true)
    setPError('')
    const { error: err } = await supabase.from('excursion_passengers').insert({
      journey_id: passengerModal.id,
      name: pForm.name.trim(),
      phone: pForm.phone.trim() || null,
      notes: pForm.notes.trim() || null,
    })
    if (err) { setPError(err.message); setPSaving(false); return }
    setPForm({ name: '', phone: '', notes: '' })
    const { data } = await supabase
      .from('excursion_passengers')
      .select('*')
      .eq('journey_id', passengerModal.id)
      .order('created_at')
    setPassengers(data ?? [])
    setPSaving(false)
  }

  async function removePassenger(id) {
    await supabase.from('excursion_passengers').delete().eq('id', id)
    setPassengers(ps => ps.filter(p => p.id !== id))
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Excursions</h1>
        <button className="btn btn-primary" onClick={openNew}>+ New Excursion</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : excursions.length === 0 ? (
            <div className="empty-state">No excursions yet. Create one to get started.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Notes</th>
                  <th>Driver</th>
                  <th>Vehicle</th>
                  <th>Stops</th>
                  <th>Passengers</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {excursions.map(exc => (
                  <tr key={exc.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(exc.journey_date)}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {exc.notes || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td>{exc.driver?.name ?? <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}</td>
                    <td>
                      {exc.vehicle?.registration
                        ? <span style={{ fontFamily: 'monospace' }}>{exc.vehicle.registration}</span>
                        : <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}
                    </td>
                    <td>
                      <span className="badge badge-gray">
                        {(exc.waypoints ?? []).length}
                      </span>
                    </td>
                    <td>
                      {(exc.passengers ?? []).length > 0
                        ? <span className="badge badge-blue">{(exc.passengers ?? []).length}</span>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td>{STATUS_BADGE[exc.status]}</td>
                    <td>
                      <div className="td-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(exc)}>Edit</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openPassengers(exc)}>
                          Passengers
                        </button>
                        {exc.status === 'scheduled' && (
                          <button className="btn btn-danger btn-sm" onClick={() => cancelExcursion(exc.id)}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Create / Edit modal ── */}
      {modal !== null && (
        <Modal
          title={modal === 'new' ? 'New Excursion' : 'Edit Excursion'}
          onClose={() => setModal(null)}
          wide
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save Excursion'}
              </button>
            </>
          }
        >
          {error && <div className="error-msg">{error}</div>}

          {/* Section 1 — Job details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input
                className="form-input"
                type="date"
                value={form.journey_date}
                onChange={e => setForm(f => ({ ...f, journey_date: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                Notes / Title{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <input
                className="form-input"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. Skegness Day Trip"
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                Driver{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <select className="form-select" value={form.driver_id} onChange={e => setForm(f => ({ ...f, driver_id: e.target.value }))}>
                <option value="">— Unassigned —</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">
                Vehicle{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <select className="form-select" value={form.vehicle_id} onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value }))}>
                <option value="">— Unassigned —</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}
              </select>
            </div>
          </div>

          {/* Section 2 — Route planner */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
            <div className="form-label" style={{ marginBottom: 10 }}>Route Planner</div>

            {/* Address search */}
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <input
                className="form-input"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search UK address or postcode…"
                autoComplete="off"
              />
              {(searchResults.length > 0 || searching) && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 6, boxShadow: 'var(--shadow-lg)', marginTop: 2,
                  maxHeight: 220, overflowY: 'auto',
                }}>
                  {searching && (
                    <div style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 13 }}>Searching…</div>
                  )}
                  {searchResults.map((r, i) => (
                    <button
                      key={i}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '9px 14px', background: 'none', border: 'none',
                        borderBottom: '1px solid var(--border)', fontSize: 13,
                        cursor: 'pointer', color: 'var(--text)',
                      }}
                      onMouseDown={() => selectPlace(r)}
                    >
                      {r.address}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Waypoints list */}
            {waypoints.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0 12px' }}>
                Search and add at least 2 locations (pickup → drop-off).
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {waypoints.map((wp, i) => (
                  <div
                    key={wp._id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto auto',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {/* Coloured letter dot */}
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: wpColor(i, waypoints.length),
                      color: '#fff', fontSize: 11, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, fontFamily: 'Oswald, sans-serif',
                    }}>
                      {String.fromCharCode(65 + i)}
                    </div>

                    {/* Name + label */}
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {wp.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                        {wpLabel(i, waypoints.length)}
                      </div>
                    </div>

                    {/* Departure time */}
                    <input
                      type="time"
                      className="form-input"
                      value={wp.time}
                      onChange={e => updateWaypoint(wp._id, 'time', e.target.value)}
                      style={{ width: 110 }}
                      title="Departure time (optional)"
                    />

                    {/* Remove */}
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => removeWaypoint(wp._id)}
                      style={{ padding: '4px 9px' }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Map + route info */}
            {waypoints.length > 0 && (
              <>
                <RoutePlannerMap waypoints={waypoints} onRouteInfo={setRouteInfo} />
                {routeInfo && (
                  <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                    <span>Distance: <strong style={{ color: 'var(--text)' }}>{fmtDist(routeInfo.distance)}</strong></span>
                    <span>Est. drive time: <strong style={{ color: 'var(--text)' }}>{fmtDur(routeInfo.duration)}</strong></span>
                  </div>
                )}
              </>
            )}
          </div>
        </Modal>
      )}

      {/* ── Passenger modal ── */}
      {passengerModal && (
        <Modal
          title={`Passengers — ${passengerModal.notes || fmtDate(passengerModal.journey_date)}`}
          onClose={() => setPassengerModal(null)}
          footer={
            <button className="btn btn-ghost" onClick={() => setPassengerModal(null)}>Close</button>
          }
        >
          {pLoading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
          ) : (
            <>
              {passengers.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                  No passengers added yet.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                  {passengers.map(p => (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 10px', borderRadius: 6,
                        background: 'var(--bg)', border: '1px solid var(--border)',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{p.name}</div>
                        {p.phone && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.phone}</div>}
                        {p.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>{p.notes}</div>}
                      </div>
                      <button
                        className="btn btn-danger btn-sm"
                        style={{ padding: '3px 8px' }}
                        onClick={() => removePassenger(p.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div className="form-label" style={{ marginBottom: 8 }}>Add Passenger</div>
                {pError && <div className="error-msg" style={{ marginBottom: 10 }}>{pError}</div>}
                <div className="form-group">
                  <input
                    className="form-input"
                    value={pForm.name}
                    onChange={e => setPForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Full name (required)"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPassenger() } }}
                  />
                </div>
                <div className="form-group">
                  <input
                    className="form-input"
                    value={pForm.phone}
                    onChange={e => setPForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="Phone number (optional)"
                  />
                </div>
                <div className="form-group">
                  <input
                    className="form-input"
                    value={pForm.notes}
                    onChange={e => setPForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Notes, e.g. wheelchair user (optional)"
                  />
                </div>
                <button
                  className="btn btn-primary"
                  onClick={addPassenger}
                  disabled={pSaving}
                >
                  {pSaving ? 'Adding…' : 'Add Passenger'}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  )
}
