import { useEffect, useState } from 'react'
import { supabase } from '../../shared/supabase'
import { getCompanyId } from '../../shared/company'
import Modal from '../../shared/components/Modal'

const VEHICLE_TYPES = ['Minibus', 'Midi Coach', 'Full Size Coach', 'Single Decker Bus', 'Double Decker']
const FUEL_TYPES    = ['Diesel', 'Petrol', 'Electric', 'Hybrid', 'Hydrogen']

const TYPE_DIMENSION_DEFAULTS = {
  'Minibus':           { height_metres: '2.85', width_metres: '2.20', length_metres: '8.00'  },
  'Midi Coach':        { height_metres: '3.20', width_metres: '2.40', length_metres: '10.00' },
  'Full Size Coach':   { height_metres: '3.70', width_metres: '2.55', length_metres: '13.75' },
  'Single Decker Bus': { height_metres: '3.15', width_metres: '2.55', length_metres: '12.00' },
  'Double Decker':     { height_metres: '4.35', width_metres: '2.55', length_metres: '11.00' },
}

const EMPTY = {
  registration: '', fleet_number: '', vehicle_type: 'Minibus', fuel_type: 'Diesel',
  height_metres: '2.85', width_metres: '2.20', length_metres: '8.00',
}

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
      registration:  v.registration,
      fleet_number:  v.fleet_number ?? '',
      vehicle_type:  v.vehicle_type,
      fuel_type:     v.fuel_type,
      height_metres: v.height_metres != null ? String(v.height_metres) : '',
      width_metres:  v.width_metres  != null ? String(v.width_metres)  : '',
      length_metres: v.length_metres != null ? String(v.length_metres) : '',
    })
    setError('')
    setModal(v)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError('')
    const company_id = await getCompanyId()
    const dims = {
      height_metres: form.height_metres !== '' ? parseFloat(form.height_metres) : null,
      width_metres:  form.width_metres  !== '' ? parseFloat(form.width_metres)  : null,
      length_metres: form.length_metres !== '' ? parseFloat(form.length_metres) : null,
    }
    const payload = {
      registration: form.registration,
      fleet_number: form.fleet_number || null,
      vehicle_type: form.vehicle_type,
      fuel_type:    form.fuel_type,
      ...dims,
      company_id,
    }
    const { error: err } = modal === 'add'
      ? await supabase.from('vehicles').insert(payload)
      : await supabase.from('vehicles').update({
          registration: form.registration,
          fleet_number: form.fleet_number || null,
          vehicle_type: form.vehicle_type,
          fuel_type:    form.fuel_type,
          ...dims,
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
                  <th>Dimensions (H × W × L)</th>
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
                    <td style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
                      {v.height_metres != null
                        ? `${v.height_metres}m × ${v.width_metres}m × ${v.length_metres}m`
                        : '—'}
                    </td>
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
                onChange={e => {
                  const type = e.target.value
                  const defaults = TYPE_DIMENSION_DEFAULTS[type] ?? {}
                  setForm(f => ({ ...f, vehicle_type: type, ...defaults }))
                }}
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
            <div style={{ marginBottom: 8 }}>
              <label className="form-label" style={{ marginBottom: 6, display: 'block' }}>
                Dimensions (metres){' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— used for route planning</span>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Height</label>
                  <input
                    className="form-input"
                    type="number" step="0.01" min="1" max="6"
                    value={form.height_metres}
                    onChange={e => setForm(f => ({ ...f, height_metres: e.target.value }))}
                    placeholder="e.g. 3.70"
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Width</label>
                  <input
                    className="form-input"
                    type="number" step="0.01" min="1" max="4"
                    value={form.width_metres}
                    onChange={e => setForm(f => ({ ...f, width_metres: e.target.value }))}
                    placeholder="e.g. 2.55"
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Length</label>
                  <input
                    className="form-input"
                    type="number" step="0.01" min="3" max="25"
                    value={form.length_metres}
                    onChange={e => setForm(f => ({ ...f, length_metres: e.target.value }))}
                    placeholder="e.g. 13.75"
                  />
                </div>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
