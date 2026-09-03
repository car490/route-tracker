import { Fragment, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../shared/supabase'
import Modal from '../../shared/components/Modal'
import { DAYS } from '../route-planner/constants'
import { TimetableStopCount } from './TimetableStopCount'

function DeparturesList({ departures }) {
  if (departures === undefined) {
    return <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Loading…</p>
  }
  if (departures.length === 0) {
    return <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>No departures found for this timetable.</p>
  }
  return (
    <>
      {departures.map(dep => (
        <div key={dep.id} style={{ background: 'var(--bg)', borderRadius: 5, padding: '5px 7px', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--navy-brand)', minWidth: 42 }}>
            {dep.departure_time.slice(0, 5)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>
            {dep.days_of_week.map(d => DAYS[d - 1]).join(' ')}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{dep.vehicle_journey_code}</span>
        </div>
      ))}
    </>
  )
}

export default function RouteDetailModal({ route, timetables, onClose, onAddTimetable, onDeleteTimetable }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(() => new Set())
  const [departuresByTt, setDeparturesByTt] = useState({})

  async function toggleTimetable(ttId) {
    const next = new Set(expanded)
    if (next.has(ttId)) {
      next.delete(ttId)
      setExpanded(next)
      return
    }
    next.add(ttId)
    setExpanded(next)
    if (departuresByTt[ttId] === undefined) {
      const { data } = await supabase
        .from('timetable_departures').select('*').eq('timetable_id', ttId).order('departure_time')
      setDeparturesByTt(d => ({ ...d, [ttId]: data ?? [] }))
    }
  }

  return (
    <Modal title={`${route.service_code} — Route Details`} onClose={onClose} wide>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 2px' }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--navy-brand)' }}>{route.service_code}</span>
          <span>{route.name ?? '—'}</span>
          <span className="badge badge-blue">{timetables.length} timetable{timetables.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Timetables</span>
        <button className="btn btn-primary btn-sm" onClick={onAddTimetable}>+ Add Timetable</button>
      </div>
      <div className="table-wrap">
        {timetables.length === 0 ? (
          <div className="empty-state">No timetables for this route.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th></th>
                <th>Stops</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {timetables.map(t => (
                <Fragment key={t.id}>
                  <tr>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '1px 7px', minWidth: 0 }}
                        onClick={() => toggleTimetable(t.id)}
                        title="Show departures"
                      >
                        {expanded.has(t.id) ? '▾' : '▸'}
                      </button>
                    </td>
                    <td>
                      <span className="badge badge-blue">{t.name}</span>
                      {' '}
                      <span className="badge badge-gray">{t.direction}</span>
                    </td>
                    <td></td>
                    <td><TimetableStopCount timetableId={t.id} /></td>
                    <td>
                      <div className="td-actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => navigate(`/route-planner?route=${route.id}&timetable=${t.id}`)}
                        >
                          View
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => onDeleteTimetable(t.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                  {expanded.has(t.id) && (
                    <tr>
                      <td></td>
                      <td colSpan={4} style={{ paddingTop: 0 }}>
                        <DeparturesList departures={departuresByTt[t.id]} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  )
}
