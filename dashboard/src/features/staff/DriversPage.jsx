import { useEffect, useState } from 'react'
import { supabase } from '../../shared/supabase'
import { getCompanyId } from '../../shared/company'
import Modal from '../../shared/components/Modal'

const ROLES = ['driver', 'ops_manager', 'super_user']
const EMPTY_STAFF = { name: '', role: 'driver' }
const EMPTY_CONTACT_FORM = { type: 'phone', value: '' }

// Accepts: 07700 900123, 07700900123, +447700900123, 01234 567890, etc.
function validateUkPhone(raw) {
  const s = raw.replace(/[\s\-().]/g, '')
  return /^(0[1-9][0-9]{9}|\+44[1-9][0-9]{9})$/.test(s)
}

// Normalise to +44XXXXXXXXXX
function normalisePhone(raw) {
  const s = raw.replace(/[\s\-().]/g, '')
  return s.startsWith('0') ? '+44' + s.slice(1) : s
}

const roleBadge = r => {
  if (r === 'super_user')  return <span className="badge badge-red">Super User</span>
  if (r === 'ops_manager') return <span className="badge badge-blue">Ops Manager</span>
  return <span className="badge badge-gray">Driver</span>
}

function typeBadge(type) {
  return (
    <span className={`badge ${type === 'email' ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: 10, marginRight: 6 }}>
      {type}
    </span>
  )
}

export default function DriversPage() {
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(EMPTY_STAFF)
  const [contacts, setContacts] = useState([])
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT_FORM)
  const [contactError, setContactError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('staff')
      .select('*, contacts:staff_contacts(*)')
      .order('name')
    setStaff(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openAdd() {
    setForm(EMPTY_STAFF)
    setContacts([])
    setContactForm(EMPTY_CONTACT_FORM)
    setContactError('')
    setError('')
    setModal('add')
  }

  function openEdit(s) {
    setForm({ name: s.name, role: s.role })
    const sorted = [...(s.contacts ?? [])].sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
      return new Date(a.created_at) - new Date(b.created_at)
    })
    setContacts(sorted)
    setContactForm(EMPTY_CONTACT_FORM)
    setContactError('')
    setError('')
    setModal(s)
  }

  function addContact() {
    setContactError('')
    const val = contactForm.value.trim()
    if (!val) { setContactError('Enter a value'); return }
    if (contactForm.type === 'phone') {
      if (!validateUkPhone(val)) {
        setContactError('Enter a valid UK number (e.g. 07700 900123 or +447700900123)')
        return
      }
    }
    const normalised = contactForm.type === 'phone' ? normalisePhone(val) : val.toLowerCase()
    const isFirst = contacts.length === 0
    setContacts(c => [...c, { type: contactForm.type, value: normalised, is_primary: isFirst }])
    setContactForm(f => ({ ...f, value: '' }))
  }

  function removeContact(idx) {
    setContacts(c => {
      const wasPrimary = c[idx].is_primary
      const next = c.filter((_, i) => i !== idx)
      if (wasPrimary && next.length > 0) next[0] = { ...next[0], is_primary: true }
      return next
    })
  }

  function setPrimary(idx) {
    setContacts(c => c.map((ct, i) => ({ ...ct, is_primary: i === idx })))
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const company_id = await getCompanyId()
      let staffId

      if (modal === 'add') {
        const { data, error: err } = await supabase
          .from('staff')
          .insert({ name: form.name, role: form.role, company_id })
          .select('id')
          .single()
        if (err) throw err
        staffId = data.id
      } else {
        const { error: err } = await supabase
          .from('staff')
          .update({ name: form.name, role: form.role })
          .eq('id', modal.id)
        if (err) throw err
        staffId = modal.id
        const { error: delErr } = await supabase
          .from('staff_contacts')
          .delete()
          .eq('staff_id', staffId)
        if (delErr) throw delErr
      }

      if (contacts.length > 0) {
        const { error: err } = await supabase
          .from('staff_contacts')
          .insert(contacts.map(c => ({
            staff_id: staffId,
            type: c.type,
            value: c.value,
            is_primary: c.is_primary,
          })))
        if (err) throw err
      }

      setModal(null)
      load()
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this staff member?')) return
    await supabase.from('staff').delete().eq('id', id)
    load()
  }

  function primaryContact(s) {
    const list = s.contacts ?? []
    return list.find(c => c.is_primary) ?? list[0] ?? null
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
                  <th>Primary Contact</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {staff.map(s => {
                  const pc = primaryContact(s)
                  return (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 500 }}>{s.name}</td>
                      <td>{roleBadge(s.role)}</td>
                      <td style={{ color: 'var(--text-muted)' }}>
                        {pc ? <span>{typeBadge(pc.type)}{pc.value}</span> : '—'}
                      </td>
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
                  )
                })}
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
          </form>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
            <div className="form-label" style={{ marginBottom: 10 }}>Contact Methods</div>

            {contacts.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                No contacts added yet.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {contacts.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 10px',
                      borderRadius: 6,
                      background: 'var(--bg)',
                      border: c.is_primary
                        ? '1px solid rgba(77,184,72,0.45)'
                        : '1px solid var(--border)',
                    }}
                  >
                    {typeBadge(c.type)}
                    <span style={{ flex: 1, fontSize: 13 }}>{c.value}</span>
                    {c.is_primary
                      ? <span className="badge badge-green" style={{ fontSize: 10 }}>Primary</span>
                      : (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => setPrimary(i)}
                        >
                          Set Primary
                        </button>
                      )
                    }
                    <button
                      className="btn btn-danger btn-sm"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => removeContact(i)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {contactError && (
              <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 6 }}>{contactError}</div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                className="form-select"
                value={contactForm.type}
                onChange={e => setContactForm({ type: e.target.value, value: '' })}
                style={{ width: 88, flexShrink: 0 }}
              >
                <option value="phone">Phone</option>
                <option value="email">Email</option>
              </select>
              <input
                className="form-input"
                value={contactForm.value}
                onChange={e => setContactForm(f => ({ ...f, value: e.target.value }))}
                placeholder={contactForm.type === 'phone' ? '07700 900123' : 'driver@example.com'}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addContact() } }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={addContact}
                style={{ flexShrink: 0, padding: '9px 14px' }}
              >
                Add
              </button>
            </div>
            {contactForm.type === 'phone' && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>
                UK numbers only — mobile or landline (e.g. 07700 900123)
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
