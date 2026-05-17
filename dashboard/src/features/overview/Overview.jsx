import { useEffect, useState } from 'react'
import { supabase } from '../../shared/supabase'
import Modal from '../../shared/components/Modal'

const STATUS_BADGE = {
  scheduled:   <span className="badge badge-gray">Scheduled</span>,
  in_progress: <span className="badge badge-amber">In Progress</span>,
  completed:   <span className="badge badge-green">Completed</span>,
  cancelled:   <span className="badge badge-red">Cancelled</span>,
}

const ROLE_BADGE = {
  super_user:  <span className="badge badge-red">Super User</span>,
  ops_manager: <span className="badge badge-blue">Ops Manager</span>,
  driver:      <span className="badge badge-gray">Driver</span>,
}

function DrillTable({ type, rows }) {
  if (rows.length === 0)
    return <div style={{ color: 'var(--text-muted)', padding: '12px 0' }}>No records found.</div>

  if (type === 'routes') return (
    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th style={thStyle}>Code</th>
          <th style={thStyle}>Name</th>
          <th style={thStyle}>Type</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ ...tdStyle, fontFamily: 'Oswald', fontWeight: 600, color: 'var(--navy-brand)' }}>{r.service_code}</td>
            <td style={tdStyle}>{r.name}</td>
            <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{r.journey_type}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  if (type === 'staff') return (
    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th style={thStyle}>Name</th>
          <th style={thStyle}>Role</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ ...tdStyle, fontWeight: 500 }}>{r.name}</td>
            <td style={tdStyle}>{ROLE_BADGE[r.role] ?? r.role}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  if (type === 'vehicles') return (
    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th style={thStyle}>Registration</th>
          <th style={thStyle}>Type</th>
          <th style={thStyle}>Fuel</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{r.registration}</td>
            <td style={tdStyle}>{r.vehicle_type}</td>
            <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{r.fuel_type}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  if (type === 'journeys') return (
    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th style={thStyle}>Route</th>
          <th style={thStyle}>Period</th>
          <th style={thStyle}>Driver</th>
          <th style={thStyle}>Vehicle</th>
          <th style={thStyle}>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ ...tdStyle, fontFamily: 'Oswald', fontWeight: 600, color: 'var(--navy-brand)' }}>
              {r.timetable?.route?.service_code ?? '—'}
            </td>
            <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>
              {r.timetable ? `${r.timetable.period} ${r.timetable.direction}` : '—'}
            </td>
            <td style={tdStyle}>{r.driver?.name ?? <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}</td>
            <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{r.vehicle?.registration ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
            <td style={tdStyle}>{STATUS_BADGE[r.status] ?? r.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return null
}

const thStyle = { textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 500 }
const tdStyle = { padding: '6px 8px' }

const TITLES = {
  routes:   'Routes',
  staff:    'Staff',
  vehicles: 'Vehicles',
  journeys: "Today's Journeys",
}

export default function Overview() {
  const [rows, setRows] = useState({ routes: [], staff: [], vehicles: [], journeys: [] })
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    Promise.all([
      supabase.from('routes').select('id, service_code, name, journey_type').order('service_code'),
      supabase.from('staff').select('id, name, role').order('name'),
      supabase.from('vehicles').select('id, registration, vehicle_type, fuel_type').order('registration'),
      supabase.from('journeys')
        .select(`id, status, timetable:timetables(period, direction, route:routes(service_code)), driver:staff(name), vehicle:vehicles(registration)`)
        .eq('journey_date', today)
        .order('created_at'),
    ]).then(([r, s, v, j]) => {
      setRows({
        routes:   r.data ?? [],
        staff:    s.data ?? [],
        vehicles: v.data ?? [],
        journeys: j.data ?? [],
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
        {[
          { type: 'routes',   label: 'Routes' },
          { type: 'staff',    label: 'Staff' },
          { type: 'vehicles', label: 'Vehicles' },
          { type: 'journeys', label: "Today's Journeys" },
        ].map(({ type, label }) => (
          <div
            key={type}
            className="stat-card stat-card--clickable"
            onClick={() => setDetail(type)}
          >
            <div className="stat-value">{rows[type].length || '—'}</div>
            <div className="stat-label">{label}</div>
            <div className="stat-drill">View all →</div>
          </div>
        ))}
      </div>

      {detail && (
        <Modal
          title={TITLES[detail]}
          onClose={() => setDetail(null)}
          footer={<button className="btn btn-ghost" onClick={() => setDetail(null)}>Close</button>}
        >
          <DrillTable type={detail} rows={rows[detail]} />
        </Modal>
      )}
    </>
  )
}
