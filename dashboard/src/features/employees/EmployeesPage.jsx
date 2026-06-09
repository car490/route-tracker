import { useEffect, useState } from 'react'
import { supabase } from '../../shared/supabase'
import { getCompanyId } from '../../shared/company'
import Modal from '../../shared/components/Modal'
import { useJourneyTypes } from '../../shared/hooks/useJourneyTypes'

const ACCESS_LEVELS = ['driver', 'ops_manager', 'super_user']
const JOB_ROLES     = ['DRIVER', 'OPS', 'OFFICE']
const WORK_TYPES    = ['FTE', 'SPLITSHIFT', 'TEMP']
const DAYS          = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const EMPTY_EMPLOYEE = {
  name: '', access_level: 'driver', job_role: 'DRIVER',
  status: 'AVAILABLE', work_type: 'FTE', hours_rule: 'DOMESTIC_GB', journey_types: [],
}
const EMPTY_CONTACT_FORM = { type: 'phone', value: '' }

// Accepts: 07700 900123, 07700900123, +447700900123, 01234 567890, etc.
function validateUkPhone(raw) {
  const s = raw.replace(/[\s\-().]/g, '')
  return /^(0[1-9][0-9]{9}|\+44[1-9][0-9]{9})$/.test(s)
}

function normalisePhone(raw) {
  const s = raw.replace(/[\s\-().]/g, '')
  return s.startsWith('0') ? '+44' + s.slice(1) : s
}

const accessLevelBadge = lvl => {
  if (lvl === 'super_user')  return <span className="badge badge-red">Super User</span>
  if (lvl === 'ops_manager') return <span className="badge badge-blue">Ops Manager</span>
  return <span className="badge badge-gray">Driver</span>
}

const jobRoleBadge = r => {
  if (r === 'DRIVER') return <span className="badge badge-blue">Driver</span>
  if (r === 'OPS')    return <span className="badge badge-gray">Ops</span>
  if (r === 'OFFICE') return <span className="badge badge-gray">Office</span>
  return null
}

const statusBadge = s =>
  s === 'AVAILABLE'
    ? <span className="badge badge-green">Available</span>
    : <span className="badge badge-red">Unavailable</span>

function typeBadge(type) {
  return (
    <span className={`badge ${type === 'email' ? 'badge-blue' : 'badge-gray'}`}
      style={{ fontSize: 10, marginRight: 6 }}>
      {type}
    </span>
  )
}

// Build availability state from DB rows: { [day]: [{start, end}, ...] }
function rowsToAvail(rows) {
  const avail = {}
  for (const r of rows) {
    if (!avail[r.day_of_week]) avail[r.day_of_week] = []
    avail[r.day_of_week].push({
      start: r.window_start.slice(0, 5),
      end:   r.window_end.slice(0, 5),
    })
  }
  return avail
}

const DEFAULT_AVAIL = {
  0: [{ start: '07:00', end: '18:00' }],
  1: [{ start: '07:00', end: '18:00' }],
  2: [{ start: '07:00', end: '18:00' }],
  3: [{ start: '07:00', end: '18:00' }],
  4: [{ start: '07:00', end: '18:00' }],
}

export default function EmployeesPage() {
  const [employees, setEmployees]     = useState([])
  const [hoursRules, setHoursRules]   = useState([])
  const [loading, setLoading]         = useState(true)
  const [modal, setModal]             = useState(null)
  const [form, setForm]               = useState(EMPTY_EMPLOYEE)
  const [avail, setAvail]             = useState(DEFAULT_AVAIL)
  const [contacts, setContacts]       = useState([])
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT_FORM)
  const [contactError, setContactError] = useState('')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const { journeyTypes, loading: jtLoading } = useJourneyTypes()

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('employees')
      .select('*, contacts:employee_contacts(*), availability:employee_availability(*)')
      .order('name')
    setEmployees(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    supabase.from('drivers_hours_rules').select('id, label').order('id')
      .then(({ data }) => setHoursRules(data ?? []))
  }, [])

  function openAdd() {
    setForm(EMPTY_EMPLOYEE)
    setAvail(DEFAULT_AVAIL)
    setContacts([])
    setContactForm(EMPTY_CONTACT_FORM)
    setContactError('')
    setError('')
    setModal('add')
  }

  function openEdit(emp) {
    setForm({
      name:         emp.name,
      access_level: emp.access_level,
      job_role:     emp.job_role    ?? 'DRIVER',
      status:       emp.status      ?? 'AVAILABLE',
      work_type:    emp.work_type   ?? 'FTE',
      hours_rule:   emp.hours_rule  ?? 'DOMESTIC_GB',
      journey_types: emp.journey_types ?? [],
    })
    setAvail(rowsToAvail(emp.availability ?? []))
    const sorted = [...(emp.contacts ?? [])].sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
      return new Date(a.created_at) - new Date(b.created_at)
    })
    setContacts(sorted)
    setContactForm(EMPTY_CONTACT_FORM)
    setContactError('')
    setError('')
    setModal(emp)
  }

  // ── Availability helpers ───────────────────────────────────────────────────

  function toggleDay(day) {
    setAvail(a => {
      if (a[day]) { const n = { ...a }; delete n[day]; return n }
      return { ...a, [day]: [{ start: '07:00', end: '18:00' }] }
    })
  }

  function updateWindow(day, wi, field, val) {
    setAvail(a => ({
      ...a,
      [day]: a[day].map((w, i) => i === wi ? { ...w, [field]: val } : w),
    }))
  }

  function addSplitWindow(day) {
    setAvail(a => ({ ...a, [day]: [...a[day], { start: '14:00', end: '18:00' }] }))
  }

  function removeSplitWindow(day) {
    setAvail(a => ({ ...a, [day]: [a[day][0]] }))
  }

  // ── Contact helpers ────────────────────────────────────────────────────────

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

  function toggleJourneyType(jt) {
    setForm(f => ({
      ...f,
      journey_types: f.journey_types.includes(jt)
        ? f.journey_types.filter(x => x !== jt)
        : [...f.journey_types, jt],
    }))
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave(e) {
    e.preventDefault()
    if (form.journey_types.length === 0) {
      setError('Please select at least one journey type.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const company_id = await getCompanyId()
      let employeeId

      const employeePayload = {
        name:          form.name,
        access_level:  form.access_level,
        job_role:      form.job_role,
        status:        form.status,
        work_type:     form.work_type,
        hours_rule:    form.hours_rule,
        journey_types: form.journey_types,
      }

      if (modal === 'add') {
        const { data, error: err } = await supabase
          .from('employees')
          .insert({ ...employeePayload, company_id })
          .select('id')
          .single()
        if (err) throw err
        employeeId = data.id
      } else {
        const { error: err } = await supabase
          .from('employees')
          .update(employeePayload)
          .eq('id', modal.id)
        if (err) throw err
        employeeId = modal.id
        const { error: delErr } = await supabase
          .from('employee_contacts')
          .delete()
          .eq('employee_id', employeeId)
        if (delErr) throw delErr
      }

      if (contacts.length > 0) {
        const { error: err } = await supabase
          .from('employee_contacts')
          .insert(contacts.map(c => ({
            employee_id: employeeId,
            type:        c.type,
            value:       c.value,
            is_primary:  c.is_primary,
          })))
        if (err) throw err
      }

      // Availability: delete-then-reinsert
      await supabase.from('employee_availability').delete().eq('employee_id', employeeId)
      const availRows = Object.entries(avail).flatMap(([day, windows]) =>
        windows.map(w => ({
          employee_id:  employeeId,
          day_of_week:  parseInt(day),
          window_start: w.start,
          window_end:   w.end,
        }))
      )
      if (availRows.length > 0) {
        const { error: err } = await supabase.from('employee_availability').insert(availRows)
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
    if (!confirm('Delete this employee?')) return
    await supabase.from('employees').delete().eq('id', id)
    load()
  }

  function primaryContact(emp) {
    const list = emp.contacts ?? []
    return list.find(c => c.is_primary) ?? list[0] ?? null
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Employees</h1>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Employee</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : employees.length === 0 ? (
            <div className="empty-state">No employees yet. Add one to get started.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Access Level</th>
                  <th>Status</th>
                  <th>Primary Contact</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => {
                  const pc = primaryContact(emp)
                  return (
                    <tr key={emp.id}>
                      <td style={{ fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.name}</td>
                      <td>{accessLevelBadge(emp.access_level)}</td>
                      <td>{statusBadge(emp.status ?? 'AVAILABLE')}</td>
                      <td style={{ maxWidth: 180 }}>
                        {pc ? (
                          <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                            {typeBadge(pc.type)}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', flex: 1 }}>{pc.value}</span>
                          </span>
                        ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td>
                        <div className="td-actions">
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(emp)}>Edit</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(emp.id)}>Delete</button>
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
          title={modal === 'add' ? 'Add Employee' : 'Edit Employee'}
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
            {/* Name */}
            <div className="form-group">
              <label className="form-label">Name</label>
              <input
                name="name"
                className="form-input"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
                autoFocus
              />
            </div>

            {/* Three-column row: Access Level / Job Role / Work Type */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Access Level</label>
                <select
                  className="form-select"
                  value={form.access_level}
                  onChange={e => setForm(f => ({ ...f, access_level: e.target.value }))}
                >
                  {ACCESS_LEVELS.map(l => (
                    <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Job Role</label>
                <select
                  className="form-select"
                  value={form.job_role}
                  onChange={e => setForm(f => ({ ...f, job_role: e.target.value }))}
                >
                  {JOB_ROLES.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Work Type</label>
                <select
                  className="form-select"
                  value={form.work_type}
                  onChange={e => setForm(f => ({ ...f, work_type: e.target.value }))}
                >
                  {WORK_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Hours Regime */}
            <div className="form-group" style={{ marginTop: 12 }}>
              <label className="form-label">Drivers' Hours Regime</label>
              <select
                className="form-select"
                value={form.hours_rule}
                onChange={e => setForm(f => ({ ...f, hours_rule: e.target.value }))}
              >
                {hoursRules.map(r => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div className="form-group" style={{ marginTop: 0 }}>
              <label className="form-label">Status</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                {['AVAILABLE', 'UNAVAILABLE'].map(s => {
                  const on = form.status === s
                  return (
                    <button key={s} type="button"
                      onClick={() => setForm(f => ({ ...f, status: s }))}
                      style={{
                        padding: '5px 14px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
                        fontFamily: 'inherit',
                        border: `1px solid ${on ? (s === 'AVAILABLE' ? 'var(--success)' : 'var(--danger)') : 'var(--border)'}`,
                        background: on ? (s === 'AVAILABLE' ? 'rgba(77,184,72,0.12)' : 'rgba(220,53,69,0.12)') : 'transparent',
                        color: on ? (s === 'AVAILABLE' ? 'var(--success)' : 'var(--danger)') : 'var(--text-muted)',
                        fontWeight: on ? 600 : 400,
                      }}
                    >{s === 'AVAILABLE' ? 'Available' : 'Unavailable'}</button>
                  )
                })}
              </div>
            </div>

            {/* Journey Types */}
            <div className="form-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>
                  Journey Types <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                {!jtLoading && journeyTypes.length > 0 && (() => {
                  const allSelected = journeyTypes.every(jt => form.journey_types.includes(jt))
                  return (
                    <button type="button"
                      onClick={() => setForm(f => ({ ...f, journey_types: allSelected ? [] : [...journeyTypes] }))}
                      style={{ fontSize: 12, color: 'var(--navy-brand)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                    >
                      {allSelected ? 'Deselect all' : 'Select all'}
                    </button>
                  )
                })()}
              </div>
              {jtLoading ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Loading…</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {journeyTypes.map(jt => {
                    const on = form.journey_types.includes(jt)
                    return (
                      <button key={jt} type="button"
                        onClick={() => toggleJourneyType(jt)}
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
              )}
            </div>
          </form>

          {/* Working Hours */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
            <div className="form-label" style={{ marginBottom: 10 }}>Working Hours</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {DAYS.map((day, i) => {
                const windows = avail[i]
                const active  = !!windows && windows.length > 0
                const isSplit = form.work_type === 'SPLITSHIFT'
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, width: 52, paddingTop: 6, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggleDay(i)}
                        style={{ accentColor: 'var(--navy-brand)' }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{day}</span>
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {active ? windows.map((w, wi) => (
                        <div key={wi} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="time"
                            value={w.start}
                            onChange={e => updateWindow(i, wi, 'start', e.target.value)}
                            className="form-input"
                            style={{ width: 100, padding: '4px 8px' }}
                          />
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
                          <input
                            type="time"
                            value={w.end}
                            onChange={e => updateWindow(i, wi, 'end', e.target.value)}
                            className="form-input"
                            style={{ width: 100, padding: '4px 8px' }}
                          />
                          {wi === 0 && isSplit && windows.length === 1 && (
                            <button type="button" onClick={() => addSplitWindow(i)}
                              style={{ fontSize: 11, color: 'var(--navy-brand)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', whiteSpace: 'nowrap' }}>
                              + split
                            </button>
                          )}
                          {wi === 1 && (
                            <button type="button" onClick={() => removeSplitWindow(i)}
                              style={{ fontSize: 11, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px' }}>
                              ✕
                            </button>
                          )}
                        </div>
                      )) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: '30px' }}>Not working</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Contact Methods */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
            <div className="form-label" style={{ marginBottom: 10 }}>Contact Methods</div>

            {contacts.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                No contacts added yet.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {contacts.map((c, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', borderRadius: 6, background: 'var(--bg)',
                    border: c.is_primary ? '1px solid rgba(77,184,72,0.45)' : '1px solid var(--border)',
                  }}>
                    {typeBadge(c.type)}
                    <span style={{ flex: 1, fontSize: 13 }}>{c.value}</span>
                    {c.is_primary
                      ? <span className="badge badge-green" style={{ fontSize: 10 }}>Primary</span>
                      : (
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => setPrimary(i)}>
                          Set Primary
                        </button>
                      )
                    }
                    <button className="btn btn-danger btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => removeContact(i)}>
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
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={addContact} style={{ flexShrink: 0, padding: '9px 14px' }}>
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
