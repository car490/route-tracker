import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function LiveTracking() {
  const [journeys, setJourneys] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)

    async function load() {
      const { data } = await supabase
        .from('journeys')
        .select(`
          *,
          timetable:timetables(period, route:routes(service_code)),
          driver:drivers(name),
          vehicle:vehicles(registration)
        `)
        .eq('journey_date', today)
        .eq('status', 'in_progress')
      setJourneys(data ?? [])
      setLoading(false)
    }

    load()

    const channel = supabase
      .channel('live-journeys')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'journeys' },
        () => load()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

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
                        ? <span className={`badge ${j.timetable.period === 'am' ? 'badge-amber' : 'badge-blue'}`}>
                            {j.timetable.period.toUpperCase()}
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

      <div className="card" style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📍</div>
        <div style={{ fontFamily: 'Oswald', fontSize: 17, color: 'var(--navy-mid)', marginBottom: 8 }}>
          GPS map view — coming next
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 380, margin: '0 auto' }}>
          Once the driver PWA writes GPS fixes to Supabase journey_events, live positions
          will appear here on a Leaflet map, updating in real time.
        </div>
      </div>
    </>
  )
}
