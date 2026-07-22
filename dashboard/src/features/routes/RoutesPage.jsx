import { useEffect, useState } from 'react'
import { supabase } from '../../shared/supabase'
import Modal from '../../shared/components/Modal'
import { useJourneyTypes } from '../../shared/hooks/useJourneyTypes'
import RouteWizard from '../route-planner/RouteWizard'
import RouteDetailModal from './RouteDetailModal'

const ROUTE_EMPTY = { service_code: '', name: '', journey_type: [], single_journey: false }

export default function RoutesPage() {
  const { journeyTypes } = useJourneyTypes()
  const [routes, setRoutes] = useState([])
  const [timetables, setTimetables] = useState({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  const [routeModal, setRouteModal] = useState(null)
  const [routeForm, setRouteForm] = useState(ROUTE_EMPTY)
  const [wizard, setWizard] = useState(null) // 'new' | a route row (add timetable to it) | null

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const { data: rData } = await supabase.from('routes').select('*').order('service_code')
    const rows = rData ?? []
    setRoutes(rows)

    if (rows.length) {
      const { data: tData } = await supabase
        .from('timetables')
        .select('*')
        .in('route_id', rows.map(r => r.id))
        .order('name')
      const grouped = {}
      for (const t of tData ?? []) {
        if (!grouped[t.route_id]) grouped[t.route_id] = []
        grouped[t.route_id].push(t)
      }
      setTimetables(grouped)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function saveRoute(e) {
    e.preventDefault()
    setSaving(true); setError('')
    const { error: err } = await supabase.from('routes')
      .update({
        service_code:   routeForm.service_code,
        name:           routeForm.name || null,
        journey_type:   routeForm.journey_type,
        single_journey: routeForm.single_journey,
      })
      .eq('id', routeModal.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setRouteModal(null); load()
  }

  async function deleteRoute(id) {
    if (!confirm('Delete this route and all its timetables?')) return
    await supabase.from('routes').delete().eq('id', id)
    if (selected === id) setSelected(null)
    load()
  }

  async function deleteTimetable(id) {
    if (!confirm('Delete this timetable and all its stops?')) return
    await supabase.from('timetables').delete().eq('id', id)
    load()
  }

  const selectedRoute = routes.find(r => r.id === selected)

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Routes & Timetables</h1>
        <button
          className="btn btn-primary"
          onClick={() => setWizard('new')}
        >
          + Add Route
        </button>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="table-wrap">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : routes.length === 0 ? (
            <div className="empty-state">No routes yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Service Code</th>
                  <th>Name</th>
                  <th>Timetables</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {routes.map(r => (
                  <tr
                    key={r.id}
                    style={{ cursor: 'pointer', background: selected === r.id ? 'var(--bg)' : '' }}
                    onClick={() => setSelected(selected === r.id ? null : r.id)}
                  >
                    <td>
                      <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--navy-brand)' }}>
                        {r.service_code}
                      </span>
                    </td>
                    <td>{r.name ?? '—'}</td>
                    <td>
                      <span className="badge badge-blue">
                        {(timetables[r.id] ?? []).length}
                      </span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="td-actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setRouteForm({
                              service_code:   r.service_code,
                              name:           r.name ?? '',
                              journey_type:   Array.isArray(r.journey_type) ? r.journey_type : [r.journey_type].filter(Boolean),
                              single_journey: r.single_journey ?? false,
                            })
                            setError(''); setRouteModal(r)
                          }}
                        >
                          Edit
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteRoute(r.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selected && selectedRoute && (
        <RouteDetailModal
          route={selectedRoute}
          timetables={timetables[selected] ?? []}
          onClose={() => setSelected(null)}
          onAddTimetable={() => setWizard(selectedRoute)}
          onDeleteTimetable={deleteTimetable}
        />
      )}

      {routeModal !== null && (
        <Modal
          title="Edit Route"
          onClose={() => setRouteModal(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setRouteModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRoute} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          {error && <div className="error-msg">{error}</div>}
          <form onSubmit={saveRoute}>
            <div className="form-group">
              <label className="form-label">Service Code</label>
              <input
                name="service_code"
                className="form-input"
                value={routeForm.service_code}
                onChange={e => setRouteForm(f => ({ ...f, service_code: e.target.value.toUpperCase() }))}
                required
                autoFocus
                placeholder="e.g. S125S"
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                Name{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <input
                name="name"
                className="form-input"
                value={routeForm.name}
                onChange={e => setRouteForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Sleaford – Cranwell"
              />
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={routeForm.single_journey}
                  onChange={e => setRouteForm(f => ({ ...f, single_journey: e.target.checked }))}
                />
                <span style={{ fontSize: 12, color: 'var(--text)' }}>One journey each way</span>
              </label>
            </div>
            <div className="form-group">
              <label className="form-label">Journey Types</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {journeyTypes.map(jt => {
                  const on = routeForm.journey_type.includes(jt)
                  return (
                    <button key={jt} type="button"
                      onClick={() => setRouteForm(f => ({ ...f, journey_type: on ? [] : [jt] }))}
                      style={{
                        padding: '4px 11px', fontSize: 12, borderRadius: 12, cursor: 'pointer',
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
          </form>
        </Modal>
      )}

      {wizard && (
        <RouteWizard
          existingRoute={wizard === 'new' ? undefined : wizard}
          onCancel={() => setWizard(null)}
          onFinish={() => { setWizard(null); load() }}
        />
      )}
    </>
  )
}
