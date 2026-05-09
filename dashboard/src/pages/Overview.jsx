import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Overview() {
  const [stats, setStats] = useState({ routes: '—', staff: '—', vehicles: '—', journeys: '—' })

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    Promise.all([
      supabase.from('routes').select('id', { count: 'exact', head: true }),
      supabase.from('staff').select('id', { count: 'exact', head: true }),
      supabase.from('vehicles').select('id', { count: 'exact', head: true }),
      supabase.from('journeys').select('id', { count: 'exact', head: true }).eq('journey_date', today),
    ]).then(([r, d, v, j]) => {
      const errs = [r, d, v, j].map(x => x.error?.message).filter(Boolean)
      if (errs.length) console.error('Supabase errors:', errs)
      setStats({
        routes:   r.error ? r.error.message : (r.count ?? 0),
        staff:    d.error ? d.error.message : (d.count ?? 0),
        vehicles: v.error ? v.error.message : (v.count ?? 0),
        journeys: j.error ? j.error.message : (j.count ?? 0),
      })
    })
  }, [])

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <>
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
