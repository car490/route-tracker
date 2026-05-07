import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getCompanyId } from '../lib/company'
import Modal from '../components/Modal'

const ROUTE_EMPTY = { service_code: '', name: '' }
const PERIODS    = ['Early Morning', 'Morning', 'Midday', 'Afternoon', 'Evening', 'Night', 'All Day']
const DIRECTIONS = ['Outbound', 'Inbound', 'Circular']
const TT_EMPTY = { period: 'Morning', direction: 'Outbound', valid_from: '', valid_to: '' }

function TimetableStopCount({ timetableId }) {
  const [count, setCount] = useState('…')
  useEffect(() => {
    supabase
      .from('timetable_stops')
      .select('id', { count: 'exact', head: true })
      .eq('timetable_id', timetableId)
      .then(({ count: c }) => setCount(c ?? 0))
  }, [timetableId])
  return <span className="badge badge-gray">{count} stops</span>
}

export default function RoutesPage() {
  const [routes, setRoutes] = useState([])
  const [timetables, setTimetables] = useState({})   // routeId -> timetable[]
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  const [routeModal, setRouteModal] = useState(null)
  const [routeForm, setRouteForm] = useState(ROUTE_EMPTY)
  const [ttModal, setTtModal] = useState(null)
  const [ttForm, setTtForm] = useState(TT_EMPTY)

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
        .order('period')
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
    const company_id = await getCompanyId()
    const payload = { ...routeForm, company_id }
    const { error: err } = routeModal === 'add'
      ? await supabase.from('routes').insert(payload)
      : await supabase.from('routes').update({ service_code: routeForm.service_code, name: routeForm.name || null }).eq('id', routeModal.id)
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

  async function saveTimetable(e) {
    e.preventDefault()
    setSaving(true); setError('')
    const payload = {
      route_id:   selected,
      period:     ttForm.period,
      direction:  ttForm.direction,
      valid_from: ttForm.valid_from || null,
      valid_to:   ttForm.valid_to   || null,
    }
    const { error: err } = ttModal === 'add'
      ? await supabase.from('timetables').insert(payload)
      : await supabase.from('timetables').update({
          period:     ttForm.period,
          direction:  ttForm.direction,
          valid_from: ttForm.valid_from || null,
          valid_to:   ttForm.valid_to   || null,
        }).eq('id', ttModal.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setTtModal(null); load()
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
          onClick={() => { setRouteForm(ROUTE_EMPTY); setError(''); setRouteModal('add') }}
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
                      <span style={{ fontFamily: 'Oswald', fontWeight: 600, fontSize: 15, color: 'var(--navy-brand)' }}>
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
                            setRouteForm({ service_code: r.service_code, name: r.name ?? '' })
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
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{selectedRoute.service_code} — Timetables</span>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => { setTtForm(TT_EMPTY); setError(''); setTtModal('add') }}
            >
              + Add Timetable
            </button>
          </div>
          <div className="table-wrap">
            {(timetables[selected] ?? []).length === 0 ? (
              <div className="empty-state">No timetables for this route.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Valid From</th>
                    <th>Valid To</th>
                    <th>Stops</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(timetables[selected] ?? []).map(t => (
                    <tr key={t.id}>
                      <td>
                        <span className={`badge ${t.period === 'Morning' || t.period === 'Early Morning' ? 'badge-amber' : 'badge-blue'}`}>
                          {t.period} {t.direction}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{t.valid_from ?? '—'}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{t.valid_to ?? '—'}</td>
                      <td><TimetableStopCount timetableId={t.id} /></td>
                      <td>
                        <div className="td-actions">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setTtForm({ period: t.period, direction: t.direction ?? 'Outbound', valid_from: t.valid_from ?? '', valid_to: t.valid_to ?? '' })
                              setError(''); setTtModal(t)
                            }}
                          >
                            Edit
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteTimetable(t.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {routeModal !== null && (
        <Modal
          title={routeModal === 'add' ? 'Add Route' : 'Edit Route'}
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
                className="form-input"
                value={routeForm.name}
                onChange={e => setRouteForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Sleaford – Cranwell"
              />
            </div>
          </form>
        </Modal>
      )}

      {ttModal !== null && (
        <Modal
          title={ttModal === 'add' ? 'Add Timetable' : 'Edit Timetable'}
          onClose={() => setTtModal(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setTtModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveTimetable} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          {error && <div className="error-msg">{error}</div>}
          <form onSubmit={saveTimetable}>
            <div className="form-group">
              <label className="form-label">Period</label>
              <select
                className="form-select"
                value={ttForm.period}
                onChange={e => setTtForm(f => ({ ...f, period: e.target.value }))}
              >
                {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Direction</label>
              <select
                className="form-select"
                value={ttForm.direction}
                onChange={e => setTtForm(f => ({ ...f, direction: e.target.value }))}
              >
                {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">
                Valid From{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <input
                className="form-input"
                type="date"
                value={ttForm.valid_from}
                onChange={e => setTtForm(f => ({ ...f, valid_from: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                Valid To{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <input
                className="form-input"
                type="date"
                value={ttForm.valid_to}
                onChange={e => setTtForm(f => ({ ...f, valid_to: e.target.value }))}
              />
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
