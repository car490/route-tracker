import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../shared/supabase'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Lincolnshire centre — covers both S125S and S116S routes
const MAP_CENTRE = [52.97, -0.02]
const MAP_ZOOM   = 11

function makeBusIcon(label) {
  return L.divIcon({
    className: '',
    html: `<div style="background:#4db848;color:#07111f;font-family:Oswald,sans-serif;font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.5);white-space:nowrap">${label}</div>`,
    iconAnchor: [0, 0],
  })
}

export default function LiveTracking() {
  const [journeys, setJourneys] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [mapReady, setMapReady] = useState(false)

  const mapDivRef   = useRef(null)
  const mapRef      = useRef(null)
  const markersRef  = useRef({})
  const journeysRef = useRef([])

  useEffect(() => { journeysRef.current = journeys }, [journeys])

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)

    async function load() {
      const { data } = await supabase
        .from('journeys')
        .select(`
          *,
          timetable:timetables(period, route:routes(service_code)),
          driver:staff(name),
          vehicle:vehicles(registration)
        `)
        .eq('journey_date', today)
        .eq('status', 'in_progress')
      setJourneys(data ?? [])
      setLoading(false)
    }

    load()

    const ch = supabase
      .channel('live-journeys')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'journeys' }, () => load())
      .subscribe()

    return () => supabase.removeChannel(ch)
  }, [])

  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return

    const map = L.map(mapDivRef.current).setView(MAP_CENTRE, MAP_ZOOM)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map)
    mapRef.current = map
    setMapReady(true)

    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  useEffect(() => {
    if (!mapReady) return

    const ch = supabase
      .channel('gps-fixes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'journey_events',
          filter: 'event_type=eq.gps_fix',
        },
        ({ new: row }) => {
          const { journey_id, lat, lon } = row
          const map = mapRef.current
          if (!map || lat == null || lon == null) return

          const existing = markersRef.current[journey_id]
          if (existing) {
            existing.setLatLng([lat, lon])
          } else {
            const j = journeysRef.current.find(x => x.id === journey_id)
            const label = j
              ? `${j.timetable?.route?.service_code ?? '?'} · ${j.driver?.name ?? '?'}`
              : journey_id.slice(0, 8)
            const marker = L.marker([lat, lon], { icon: makeBusIcon(label) }).addTo(map)
            marker.bindPopup(
              j
                ? `<b>${j.timetable?.route?.service_code}</b><br>${j.driver?.name ?? 'Unknown driver'}<br>${j.vehicle?.registration ?? ''}`
                : journey_id
            )
            markersRef.current[journey_id] = marker
          }
        }
      )
      .subscribe()

    return () => supabase.removeChannel(ch)
  }, [mapReady])

  useEffect(() => {
    const activeIds = new Set(journeys.map(j => j.id))
    for (const [id, marker] of Object.entries(markersRef.current)) {
      if (!activeIds.has(id)) {
        marker.remove()
        delete markersRef.current[id]
      }
    }
  }, [journeys])

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Live Tracking</h1>
        <span className="badge badge-green" style={{ fontSize: 12 }}>● Live</span>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">Journeys In Progress Today</div>
        <div className="table-wrap">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : journeys.length === 0 ? (
            <div className="empty-state">No journeys in progress right now.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Period</th>
                  <th>Driver</th>
                  <th>Vehicle</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {journeys.map(j => (
                  <tr key={j.id}>
                    <td>
                      <span style={{ fontFamily: 'Oswald', fontWeight: 600, color: 'var(--navy-brand)' }}>
                        {j.timetable?.route?.service_code ?? '—'}
                      </span>
                    </td>
                    <td>
                      {j.timetable?.period
                        ? <span className={`badge ${j.timetable.period === 'Morning' || j.timetable.period === 'Early Morning' ? 'badge-amber' : 'badge-blue'}`}>
                            {j.timetable.period}
                          </span>
                        : '—'}
                    </td>
                    <td>{j.driver?.name ?? '—'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{j.vehicle?.registration ?? '—'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {j.started_at
                        ? new Date(j.started_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div ref={mapDivRef} style={{ height: 480, width: '100%' }} />
      </div>
    </>
  )
}
