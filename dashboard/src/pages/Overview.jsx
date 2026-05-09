import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Overview() {
  const [stats, setStats] = useState({ routes: '—', staff: '—', vehicles: '—', journeys: '—' })
  const [debug, setDebug] = useState(null)

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    Promise.all([
      supabase.from('routes').select('id', { count: 'exact', head: true }),
      supabase.from('staff').select('id', { count: 'exact', head: true }),
      supabase.from('vehicles').select('id', { count: 'exact', head: true }),
      supabase.from('journeys').select('id', { count: 'exact', head: true }).eq('journey_date', today),
    ]).then(([r, d, v, j]) => {
      setDebug({ routes: r, staff: d, vehicles: v, journeys: j })
      setStats({
        routes:   r.error ? (r.error.message || JSON.stringify(r.error)) : (r.count ?? 0),
        staff:    d.error ? (d.error.message || JSON.stringify(d.error)) : (d.count ?? 0),
        vehicles: v.error ? (v.error.message || JSON.stringify(v.error)) : (v.count ?? 0),
        journeys: j.error ? (j.error.message || JSON.stringify(j.error)) : (j.count ?? 0),
      })
    }).catch(err => setDebug({ fatalError: err.message }))
  }, [])

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <>
      {debug && (
        <pre style={{ background: '#f0f3f8', border: '1px solid #dde3ed', borderRadius: 6, padding: 12, fontSize: 11, marginBottom: 20, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {JSON.stringify(debug, null, 2)}
        </pre>
      )}
      <div className="page-header">
        <h1 className="page-title">Overview</h1>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{today}</span>
      </div>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.routes}</div>
          <div className="stat-label">Routes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.staff}</div>
          <div className="stat-label">Staff</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.vehicles}</div>
          <div className="stat-label">Vehicles</div>
        </div>
        <div className="stat-card" style={{ borderTopColor: 'var(--green)' }}>
          <div className="stat-value" style={{ color: 'var(--green)' }}>{stats.journeys}</div>
          <div className="stat-label">Today's Journeys</div>
        </div>
      </div>
    </>
  )
}
