import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getCompanyId } from '../lib/company'
import Modal from '../components/Modal'

const ROLES = ['driver', 'ops_manager', 'super_user']
const EMPTY = { name: '', role: 'driver', email: '', phone: '' }

const roleBadge = r => {
  if (r === 'super_user')  return <span className="badge badge-red">Super User</span>
  if (r === 'ops_manager') return <span className="badge badge-blue">Ops Manager</span>
  return <span className="badge badge-gray">Driver</span>
}

export default function DriversPage() {
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)   // null | 'add' | staff object
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('staff').select('*').order('name')
    setStaff(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openAdd() { setForm(EMPTY); setError(''); setModal('add') }
  function openEdit(s) { setForm({ name: s.name, role: s.role, email: s.email ?? '', phone: s.phone ?? '' }); setError(''); setModal(s) }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError('')
    const company_id = await getCompanyId()
    const payload = { ...form, company_id }
    const { error: err } = modal === 'add'
      ? await supabase.from('staff').insert(payload)
      : await supabase.from('staff').update({ name: form.name, role: form.role, email: form.email || null, phone: form.phone || null }).eq('id', modal.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setModal(null); load()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this staff member?')) return
    await supabase.from('staff').delete().eq('id', id)
    load()
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Staff</h1>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Staff Member</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : staff.length === 0 ? (
            <div className="empty-state">No staff yet. Add one to get started.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {staff.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 500 }}>{s.name}</td>
                    <td>{roleBadge(s.role)}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{s.email ?? '—'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{s.phone ?? '—'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {new Date(s.created_at).toLocaleDateString('en-GB')}
                    </td>
                    <td>
                      <div className="td-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(s)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s.id)}>Delete</button>
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
          title={modal === 'add' ? 'Add Staff Member' : 'Edit Staff Member'}
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
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="driver@example.com"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Phone <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>(international format, e.g. +447700900123)</span></label>
              <input
                type="tel"
                className="form-input"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+447700900123"
              />
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
