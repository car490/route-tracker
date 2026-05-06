import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getCompanyId } from '../lib/company'
import Modal from '../components/Modal'

const ROLES = ['driver', 'ops_manager', 'admin']
const EMPTY = { name: '', role: 'driver' }

const roleBadge = r => {
  if (r === 'admin')       return <span className="badge badge-red">Admin</span>
  if (r === 'ops_manager') return <span className="badge badge-blue">Ops Manager</span>
  return <span className="badge badge-gray">Driver</span>
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)   // null | 'add' | driver object
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('drivers').select('*').order('name')
    setDrivers(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openAdd() { setForm(EMPTY); setError(''); setModal('add') }
  function openEdit(d) { setForm({ name: d.name, role: d.role }); setError(''); setModal(d) }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError('')
    const company_id = await getCompanyId()
    const payload = { ...form, company_id }
    const { error: err } = modal === 'add'
      ? await supabase.from('drivers').insert(payload)
      : await supabase.from('drivers').update({ name: form.name, role: form.role }).eq('id', modal.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setModal(null); load()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this driver?')) return
    await supabase.from('drivers').delete().eq('id', id)
    load()
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Drivers</h1>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Driver</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : drivers.length === 0 ? (
            <div className="empty-state">No drivers yet. Add one to get started.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {drivers.map(d => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 500 }}>{d.name}</td>
                    <td>{roleBadge(d.role)}</td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {new Date(d.created_at).toLocaleDateString('en-GB')}
                    </td>
                    <td>
                      <div className="td-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(d)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(d.id)}>Delete</button>
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
          title={modal === 'add' ? 'Add Driver' : 'Edit Driver'}
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
              <label className="form-label">Name</label>
              <input
                className="form-input"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Role</label>
              <select
                className="form-select"
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>{r.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
