import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getCompanyId } from '../lib/company'
import Modal from '../components/Modal'

const STATUS_BADGE = {
  scheduled:   <span className="badge badge-gray">Scheduled</span>,
  in_progress: <span className="badge badge-amber">In Progress</span>,
  completed:   <span className="badge badge-green">Completed</span>,
  cancelled:   <span className="badge badge-red">Cancelled</span>,
}

function todayStr() { return new Date().toISOString().slice(0, 10) }

const EMPTY_FORM = { timetable_id: '', driver_id: '', vehicle_id: '', journey_date: todayStr() }

export default function JourneysPage() {
  const [journeys, setJourneys] = useState([])
  const [timetables, setTimetables] = useState([])
  const [drivers, setDrivers] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState(todayStr())
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState(null)

  async function loadJourneys(date) {
    setLoading(true)
    const { data } = await supabase
      .from('journeys')
      .select(`
        *,
        timetable:timetables(period, direction, route:routes(service_code)),
        driver:staff(name),
        vehicle:vehicles(registration)
      `)
      .eq('journey_date', date)
      .order('created_at')
    setJourneys(data ?? [])
    setLoading(false)
  }

  async function loadDeps() {
    const [t, d, v] = await Promise.all([
      supabase.from('timetables').select('id, period, direction, route:routes(service_code)').order('period'),
      supabase.from('staff').select('id, name').order('name'),
      supabase.from('vehicles').select('id, registration').order('registration'),
    ])
    setTimetables(t.data ?? [])
    setDrivers(d.data ?? [])
    setVehicles(v.data ?? [])
  }

  useEffect(() => { loadJourneys(dateFilter); loadDeps() }, [])

  function handleDateChange(e) {
    setDateFilter(e.target.value)
    loadJourneys(e.target.value)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError('')
    const company_id = await getCompanyId()
    const payload = {
      timetable_id: form.timetable_id || null,
      driver_id:    form.driver_id    || null,
      vehicle_id:   form.vehicle_id   || null,
      journey_date: form.journey_date,
      company_id,
    }
    const { error: err } = modal === 'add'
      ? await supabase.from('journeys').insert(payload)
      : await supabase.from('journeys').update(payload).eq('id', modal.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setModal(null); loadJourneys(dateFilter)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this journey?')) return
    await supabase.from('journeys').delete().eq('id', id)
    loadJourneys(dateFilter)
  }

  async function updateStatus(id, status) {
    const extra = status === 'in_progress' ? { started_at: new Date().toISOString() }
                : status === 'completed'   ? { completed_at: new Date().toISOString() }
                : {}
    await supabase.from('journeys').update({ status, ...extra }).eq('id', id)
    loadJourneys(dateFilter)
  }

  function copyDriverLink(id) {
    navigator.clipboard.writeText(`https://car490.github.io/route-tracker/?duties=${id}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function openAdd() {
    setForm({ ...EMPTY_FORM, journey_date: dateFilter })
    setError(''); setModal('add')
  }

  function openEdit(j) {
    setForm({
      timetable_id: j.timetable_id ?? '',
      driver_id:    j.driver_id    ?? '',
      vehicle_id:   j.vehicle_id   ?? '',
      journey_date: j.journey_date,
    })
    setError(''); setModal(j)
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Daily Journeys</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            className="form-input"
            type="date"
            value={dateFilter}
            onChange={handleDateChange}
            style={{ width: 160 }}
          />
          <button className="btn btn-primary" onClick={openAdd}>+ Add Journey</button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : journeys.length === 0 ? (
            <div className="empty-state">No journeys scheduled for this date.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Period</th>
                  <th>Driver</th>
                  <th>Vehicle</th>
                  <th>Status</th>
                  <th></th>
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
                            {j.timetable.period} {j.timetable.direction}
                          </span>
                        : '—'}
                    </td>
                    <td>{j.driver?.name ?? <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}</td>
                    <td>
                      {j.vehicle?.registration
                        ? <span style={{ fontFamily: 'monospace' }}>{j.vehicle.registration}</span>
                        : <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}
                    </td>
                    <td>{STATUS_BADGE[j.status]}</td>
                    <td>
                      <div className="td-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(j)}>Edit</button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => copyDriverLink(j.id)}
                          title="Copy driver link"
                        >
                          {copiedId === j.id ? 'Copied!' : 'Copy Link'}
                        </button>
                        {j.status === 'scheduled' && (
                          <button className="btn btn-success btn-sm" onClick={() => updateStatus(j.id, 'in_progress')}>
                            Start
                          </button>
                        )}
                        {j.status === 'in_progress' && (
                          <button className="btn btn-primary btn-sm" onClick={() => updateStatus(j.id, 'completed')}>
                            Complete
                          </button>
                        )}
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(j.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modal !== null && (
        <Modal
          title={modal === 'add' ? 'Add Journey' : 'Edit Journey'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          {error && <div className="error-msg">{error}</div>}
          <form onSubmit={handleSave}>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input
                className="form-input"
                type="date"
                value={form.journey_date}
                onChange={e => setForm(f => ({ ...f, journey_date: e.target.value }))}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Timetable</label>
              <select
                className="form-select"
                value={form.timetable_id}
                onChange={e => setForm(f => ({ ...f, timetable_id: e.target.value }))}
              >
                <option value="">— Select —</option>
                {timetables.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.route?.service_code} {t.period} {t.direction}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">
                Driver{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <select
                className="form-select"
                value={form.driver_id}
                onChange={e => setForm(f => ({ ...f, driver_id: e.target.value }))}
              >
                <option value="">— Unassigned —</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">
                Vehicle{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <select
                className="form-select"
                value={form.vehicle_id}
                onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value }))}
              >
                <option value="">— Unassigned —</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}
              </select>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
