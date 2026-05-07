import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getCompanyId } from '../lib/company'
import Modal from '../components/Modal'

const VEHICLE_TYPES = ['Minibus', 'Midi Coach', 'Full Size Coach', 'Single Decker Bus', 'Double Decker']
const FUEL_TYPES    = ['Diesel', 'Petrol', 'Electric', 'Hybrid', 'Hydrogen']
const EMPTY = { registration: '', fleet_number: '', vehicle_type: 'Minibus', fuel_type: 'Diesel' }

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('vehicles').select('*').order('registration')
    setVehicles(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openAdd() { setForm(EMPTY); setError(''); setModal('add') }
  function openEdit(v) {
    setForm({
      registration: v.registration,
      fleet_number: v.fleet_number ?? '',
      vehicle_type: v.vehicle_type,
      fuel_type:    v.fuel_type,
    })
    setError('')
    setModal(v)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError('')
    const company_id = await getCompanyId()
    const payload = {
      registration: form.registration,
      fleet_number: form.fleet_number || null,
      vehicle_type: form.vehicle_type,
      fuel_type:    form.fuel_type,
      company_id,
    }
    const { error: err } = modal === 'add'
      ? await supabase.from('vehicles').insert(payload)
      : await supabase.from('vehicles').update({
          registration: form.registration,
          fleet_number: form.fleet_number || null,
          vehicle_type: form.vehicle_type,
          fuel_type:    form.fuel_type,
        }).eq('id', modal.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setModal(null); load()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this vehicle?')) return
    await supabase.from('vehicles').delete().eq('id', id)
    load()
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Vehicles</h1>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Vehicle</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : vehicles.length === 0 ? (
            <div className="empty-state">No vehicles yet. Add one to get started.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Registration</th>
                  <th>Fleet No.</th>
                  <th>Type</th>
                  <th>Fuel</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map(v => (
                  <tr key={v.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.05em' }}>
                      {v.registration}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{v.fleet_number ?? '—'}</td>
                    <td>{v.vehicle_type}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{v.fuel_type}</td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {new Date(v.created_at).toLocaleDateString('en-GB')}
                    </td>
                    <td>
                      <div className="td-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(v)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(v.id)}>Delete</button>
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
          title={modal === 'add' ? 'Add Vehicle' : 'Edit Vehicle'}
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
              <label className="form-label">Registration</label>
              <input
                className="form-input"
                value={form.registration}
                onChange={e => setForm(f => ({ ...f, registration: e.target.value.toUpperCase() }))}
                required
                autoFocus
                placeholder="e.g. AB12 CDE"
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                Fleet Number{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <input
                className="form-input"
                value={form.fleet_number}
                onChange={e => setForm(f => ({ ...f, fleet_number: e.target.value }))}
                placeholder="e.g. 42"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Vehicle Type</label>
              <select
                className="form-select"
                value={form.vehicle_type}
                onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value }))}
              >
                {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Fuel Type</label>
              <select
                className="form-select"
                value={form.fuel_type}
                onChange={e => setForm(f => ({ ...f, fuel_type: e.target.value }))}
              >
                {FUEL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
