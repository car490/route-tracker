import { useEffect, useState } from 'react'
import { supabase } from '../../shared/supabase'
import { getCompanyId, getCompanyName } from '../../shared/company'
import Modal from '../../shared/components/Modal'

const PWA_BASE = 'https://car490.github.io/route-tracker'

function dateStr(d) { return d.toISOString().slice(0, 10) }
function todayStr() { return dateStr(new Date()) }

function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function getWeekStart(d) {
  const m = new Date(d)
  m.setDate(d.getDate() - d.getDay())
  m.setHours(0, 0, 0, 0)
  return m
}

function fmtWeek(sunday) {
  const saturday = addDays(sunday, 6)
  if (sunday.getMonth() === saturday.getMonth()) {
    return `${sunday.getDate()}–${saturday.getDate()} ${sunday.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
  }
  return `${sunday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${saturday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

function fmtColHeader(d) {
  return {
    day:  d.toLocaleDateString('en-GB', { weekday: 'short' }),
    date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  }
}

function fmtLongDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function phoneForWhatsApp(phone) { return phone.replace(/\D/g, '') }

function dutyBaseUrl(ids) { return `${PWA_BASE}/?duties=${ids.join(',')}` }
function dutyUrl(ids, token) {
  const base = dutyBaseUrl(ids)
  return token ? `${base}&token=${token}` : base
}
function dutyMessage(driverName, date, url) {
  return `Hi ${driverName}, your duty card for ${fmtLongDate(date)} is ready:\n${url}`
}

function getContact(contacts, type) {
  return contacts.find(c => c.is_primary && c.type === type)
    ?? contacts.find(c => c.type === type)
    ?? null
}

function jsDayToDb(jsDay) { return jsDay === 0 ? 7 : jsDay }

const EMPTY_DUTY = { date: todayStr(), driver_id: '', vehicle_id: '', selectedDepartures: [] }

export default function DutyCardsPage() {
  const [weekStart,    setWeekStart]    = useState(() => getWeekStart(new Date()))
  const [matrix,       setMatrix]       = useState({})
  const [drivers,      setDrivers]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [selected,     setSelected]     = useState(null)
  const [token,        setToken]        = useState(null)
  const [tokenError,   setTokenError]   = useState(null)
  const [tokenLoading, setTokenLoading] = useState(false)
  const [copied,       setCopied]       = useState(false)
  const [emailSending, setEmailSending] = useState(false)
  const [emailSent,    setEmailSent]    = useState(false)
  const [emailError,   setEmailError]   = useState(null)

  const [departures,   setDepartures]   = useState([])
  const [journeyMap,   setJourneyMap]   = useState({})
  const [employees,    setEmployees]    = useState([])
  const [vehicles,     setVehicles]     = useState([])
  const [modal,        setModal]        = useState(null)
  const [dutyForm,     setDutyForm]     = useState(EMPTY_DUTY)
  const [saving,       setSaving]       = useState(false)

  useEffect(() => { load(weekStart) }, [])

  useEffect(() => {
    async function loadStatic() {
      const [depRes, empRes, vRes] = await Promise.all([
        supabase.from('timetable_departures')
          .select('id, departure_time, days_of_week, timetable:timetables(name, direction, route:routes(service_code, name))')
          .order('departure_time'),
        supabase.from('employees').select('id, name').order('name'),
        supabase.from('vehicles').select('id, registration').order('registration'),
      ])
      setDepartures(depRes.data ?? [])
      setEmployees(empRes.data ?? [])
      setVehicles(vRes.data ?? [])
    }
    loadStatic()
  }, [])

  function shiftWeek(delta) {
    const m = addDays(weekStart, delta * 7)
    setWeekStart(m)
    setSelected(null)
    load(m)
  }

  function goToWeek(m) {
    setWeekStart(m)
    setSelected(null)
    load(m)
  }

  async function load(sunday) {
    setLoading(true)
    setError('')
    const start = dateStr(sunday)
    const end   = dateStr(addDays(sunday, 6))

    const { data, error: qErr } = await supabase
      .from('journeys')
      .select(`
        id, journey_date, timetable_departure_id, driver_id, vehicle_id, status,
        departure:timetable_departures(departure_time, timetable:timetables(name, direction, route:routes(service_code))),
        driver:employees(id, name)
      `)
      .gte('journey_date', start)
      .lte('journey_date', end)
      .neq('status', 'cancelled')
      .order('journey_date')

    if (qErr) { setError(qErr.message); setLoading(false); return }

    const jMap = {}
    for (const j of data ?? []) {
      jMap[`${j.timetable_departure_id}-${j.journey_date}`] = j
    }
    setJourneyMap(jMap)

    const driverIds = [...new Set((data ?? []).map(j => j.driver?.id).filter(Boolean))]
    const contactsMap = {}
    if (driverIds.length > 0) {
      const { data: cData } = await supabase
        .from('employee_contacts').select('*').in('employee_id', driverIds)
      for (const c of cData ?? []) {
        if (!contactsMap[c.employee_id]) contactsMap[c.employee_id] = []
        contactsMap[c.employee_id].push(c)
      }
    }

    const driverMap = {}
    const mat = {}
    for (const j of data ?? []) {
      if (!j.driver) continue
      const dId = j.driver.id
      if (!driverMap[dId]) driverMap[dId] = { ...j.driver, contacts: contactsMap[dId] ?? [] }
      if (!mat[dId]) mat[dId] = {}
      if (!mat[dId][j.journey_date]) mat[dId][j.journey_date] = []
      mat[dId][j.journey_date].push(j)
    }

    setDrivers(Object.values(driverMap).sort((a, b) => a.name.localeCompare(b.name)))
    setMatrix(mat)
    setLoading(false)
  }

  async function generateToken(driver, journeys) {
    setTokenLoading(true)
    setToken(null)
    setTokenError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/sign-token', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          journey_ids: journeys.map(j => j.id),
          driver_name: driver.name,
          driver_id:   driver.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) setTokenError(data.error ?? 'Signing failed')
      else if (data.token) setToken(data.token)
      else setTokenError('No token returned')
    } catch (err) {
      setTokenError(`fetch failed: ${err.message}`)
    }
    setTokenLoading(false)
  }

  function selectCell(driver, date) {
    const journeys = matrix[driver.id]?.[date]
    if (!journeys?.length) return
    setSelected({ driver, date, journeys })
    setToken(null); setTokenError(null); setCopied(false)
    setEmailSending(false); setEmailSent(false); setEmailError(null)
    generateToken(driver, journeys)
  }

  function copyLink() {
    navigator.clipboard.writeText(dutyUrl(selected.journeys.map(j => j.id), token))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function sendEmail() {
    const { driver, date, journeys } = selected
    const contact = getContact(driver.contacts ?? [], 'email')
    if (!contact) { alert(`No email address on file for ${driver.name}.\nAdd one on the Employees page.`); return }
    const url = dutyUrl(journeys.map(j => j.id), token)
    setEmailSending(true); setEmailError(null); setEmailSent(false)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/send-duty-email', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ to: contact.value, driver_name: driver.name, date, url, company_name: await getCompanyName() }),
      })
      const data = await res.json()
      if (!res.ok) setEmailError(data.error ?? 'Send failed')
      else { setEmailSent(true); setTimeout(() => setEmailSent(false), 3000) }
    } catch (err) {
      setEmailError(`fetch failed: ${err.message}`)
    }
    setEmailSending(false)
  }

  function openWhatsApp() {
    const { driver, date, journeys } = selected
    const contact = getContact(driver.contacts ?? [], 'phone')
    if (!contact) { alert(`No phone number on file for ${driver.name}.\nAdd one on the Employees page.`); return }
    const url = dutyUrl(journeys.map(j => j.id), token)
    window.open(`https://wa.me/${phoneForWhatsApp(contact.value)}?text=${encodeURIComponent(dutyMessage(driver.name, date, url))}`)
  }

  function openNewDuty() {
    setDutyForm(EMPTY_DUTY)
    setError('')
    setModal('new-duty')
  }

  function availableDepartures() {
    if (!dutyForm.date) return []
    const d = new Date(dutyForm.date + 'T00:00:00')
    const dbDay = jsDayToDb(d.getDay())
    return [...departures]
      .filter(dep => {
        if (!dep.days_of_week?.includes(dbDay)) return false
        const j = journeyMap[`${dep.id}-${dutyForm.date}`]
        return !j || !j.driver_id
      })
      .sort((a, b) => {
        const sc = (a.timetable?.route?.service_code ?? '').localeCompare(b.timetable?.route?.service_code ?? '')
        if (sc !== 0) return sc
        return (a.departure_time ?? '').localeCompare(b.departure_time ?? '')
      })
  }

  function toggleDeparture(id) {
    setDutyForm(f => ({
      ...f,
      selectedDepartures: f.selectedDepartures.includes(id)
        ? f.selectedDepartures.filter(x => x !== id)
        : [...f.selectedDepartures, id],
    }))
  }

  async function saveNewDuty() {
    if (!dutyForm.driver_id) { setError('Please select a driver'); return }
    if (!dutyForm.vehicle_id) { setError('Please select a vehicle'); return }
    if (!dutyForm.selectedDepartures.length) { setError('Select at least one run'); return }
    setSaving(true)
    setError('')
    try {
      const companyId = await getCompanyId()
      for (const depId of dutyForm.selectedDepartures) {
        const existing = journeyMap[`${depId}-${dutyForm.date}`]
        if (existing) {
          const { error: e } = await supabase
            .from('journeys')
            .update({ driver_id: dutyForm.driver_id, vehicle_id: dutyForm.vehicle_id })
            .eq('id', existing.id)
          if (e) throw e
        } else {
          const { error: e } = await supabase.from('journeys').insert({
            company_id:             companyId,
            timetable_departure_id: depId,
            journey_date:           dutyForm.date,
            driver_id:              dutyForm.driver_id,
            vehicle_id:             dutyForm.vehicle_id,
          })
          if (e) throw e
        }
      }
      setModal(null)
      load(weekStart)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  const days  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today = todayStr()

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Duty Cards</h1>
        <button className="btn btn-primary" onClick={openNewDuty}>+ Create New Duty</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => shiftWeek(-1)}>← Prev</button>
        <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: '1.05rem', color: 'var(--text)', minWidth: 200, textAlign: 'center' }}>
          {fmtWeek(weekStart)}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => shiftWeek(1)}>Next →</button>
        <button className="btn btn-ghost btn-sm" onClick={() => goToWeek(getWeekStart(new Date()))}>
          This Week
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => { const m = getWeekStart(new Date()); m.setDate(m.getDate() + 7); goToWeek(m) }}>
          Next Week
        </button>
        <input
          type="date"
          className="form-input"
          style={{ width: 'auto', fontSize: 12, padding: '5px 10px' }}
          onChange={e => {
            if (!e.target.value) return
            goToWeek(getWeekStart(new Date(e.target.value + 'T00:00:00')))
            e.target.value = ''
          }}
        />
      </div>

      {error && <div className="error-msg">{error}</div>}

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : drivers.length === 0 ? (
        <div className="empty-state">No assigned journeys this week.</div>
      ) : (
        <>
          <div className="card duty-matrix-wrap">
            <table className="duty-matrix">
              <thead>
                <tr>
                  <th className="dm-name">Driver</th>
                  {days.map(d => {
                    const ds = dateStr(d)
                    const { day, date } = fmtColHeader(d)
                    return (
                      <th key={ds} className={`dm-date${ds === today ? ' dm-today' : ''}`}>
                        <span className="dm-day">{day}</span>
                        <span className="dm-num">{date}</span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {drivers.map(driver => (
                  <tr key={driver.id}>
                    <td className="dm-name">{driver.name}</td>
                    {days.map(d => {
                      const ds = dateStr(d)
                      const journeys = matrix[driver.id]?.[ds] ?? []
                      const isSelected = selected?.driver.id === driver.id && selected?.date === ds
                      return (
                        <td
                          key={ds}
                          className={[
                            'dm-cell',
                            ds === today     ? 'dm-today'          : '',
                            journeys.length  ? 'dm-cell--assigned' : '',
                            isSelected       ? 'dm-cell--selected' : '',
                          ].filter(Boolean).join(' ')}
                          onClick={() => selectCell(driver, ds)}
                        >
                          {journeys.map(j => (
                            <span key={j.id} className="dm-pill">
                              {j.departure?.timetable?.route?.service_code ?? '?'}
                            </span>
                          ))}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (() => {
            const { driver, date, journeys } = selected
            const ids = journeys.map(j => j.id)
            const url = dutyUrl(ids, token)
            const contacts   = driver.contacts ?? []
            const hasEmail   = contacts.some(c => c.type === 'email')
            const hasPhone   = contacts.some(c => c.type === 'phone')
            const tokenReady = !!token && !tokenLoading
            const sortedJourneys = [...journeys].sort((a, b) => {
              const sc = (a.departure?.timetable?.route?.service_code ?? '').localeCompare(b.departure?.timetable?.route?.service_code ?? '')
              if (sc !== 0) return sc
              return (a.departure?.departure_time ?? '').localeCompare(b.departure?.departure_time ?? '')
            })
            return (
              <div className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 20, fontWeight: 600, color: 'var(--navy-mid)' }}>
                      {driver.name}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{fmtLongDate(date)}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>✕</button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                  {sortedJourneys.map(j => (
                    <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: 'var(--bg)', borderRadius: 6 }}>
                      <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 600, fontSize: 14, color: 'var(--navy-brand)', minWidth: 60 }}>
                        {j.departure?.timetable?.route?.service_code ?? '—'}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        {j.departure?.timetable?.name} · {j.departure?.timetable?.direction}
                        {j.departure?.departure_time && <span style={{ marginLeft: 6, fontFamily: 'Oswald', fontWeight: 600 }}>@ {j.departure.departure_time.slice(0, 5)}</span>}
                      </span>
                      <span style={{ marginLeft: 'auto' }}>
                        {j.status === 'completed'   && <span className="badge badge-green">Completed</span>}
                        {j.status === 'in_progress' && <span className="badge badge-amber">In Progress</span>}
                        {j.status === 'scheduled'   && <span className="badge badge-gray">Scheduled</span>}
                      </span>
                    </div>
                  ))}
                </div>

                <div style={{ background: 'var(--bg)', borderRadius: 6, padding: '8px 12px', marginBottom: 14, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {dutyBaseUrl(ids)}
                  {tokenLoading
                    ? <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontFamily: 'sans-serif', fontSize: 11 }}>signing…</span>
                    : tokenReady
                      ? <span style={{ marginLeft: 6, color: '#4db848', fontFamily: 'sans-serif', fontSize: 11 }}>✓ signed</span>
                      : tokenError
                        ? <span style={{ marginLeft: 6, color: '#e53935', fontFamily: 'sans-serif', fontSize: 11 }}>✗ {tokenError}</span>
                        : null}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={copyLink} style={{ minWidth: 110 }}>
                    {copied ? '✓ Copied!' : 'Copy Link'}
                  </button>
                  {tokenError && (
                    <button className="btn btn-ghost btn-sm" onClick={() => generateToken(driver, journeys)}
                      style={{ color: '#e53935', borderColor: '#e53935' }}>
                      Retry Signing
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={sendEmail}
                    disabled={!hasEmail || !tokenReady || emailSending}
                    title={hasEmail ? `Send to ${getContact(contacts, 'email')?.value}` : 'No email on file'}
                    style={emailSent ? { color: '#4db848', borderColor: '#4db848' } : emailError ? { color: '#e53935', borderColor: '#e53935' } : {}}>
                    {emailSending ? 'Sending…' : emailSent ? '✓ Email sent' : 'Send Email'}
                  </button>
                  {emailError && (
                    <span style={{ fontSize: 11, color: '#e53935', alignSelf: 'center' }}>{emailError}</span>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={openWhatsApp}
                    disabled={!hasPhone || !tokenReady}
                    title={hasPhone ? `Send to ${getContact(contacts, 'phone')?.value}` : 'No phone on file'}
                    style={hasPhone && tokenReady ? { color: '#25d366', borderColor: '#25d366' } : {}}>
                    WhatsApp
                  </button>
                  <a href={url} target="_blank" rel="noreferrer"
                    className="btn btn-ghost btn-sm"
                    style={{ textDecoration: 'none', pointerEvents: tokenReady ? 'auto' : 'none', opacity: tokenReady ? 1 : 0.4 }}>
                    Preview ↗
                  </a>
                </div>
              </div>
            )
          })()}
        </>
      )}

      {modal === 'new-duty' && (
        <Modal
          title="Create New Duty"
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveNewDuty} disabled={saving}>
                {saving ? 'Creating…' : 'Create Duty'}
              </button>
            </>
          }
        >
          {error && <div className="error-msg">{error}</div>}
          <div className="form-group">
            <label className="form-label">Date</label>
            <input
              name="journey_date"
              type="date"
              className="form-input"
              value={dutyForm.date}
              onChange={e => setDutyForm(f => ({ ...f, date: e.target.value, selectedDepartures: [] }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Driver</label>
            <select name="driver_id" className="form-select" value={dutyForm.driver_id} onChange={e => setDutyForm(f => ({ ...f, driver_id: e.target.value }))}>
              <option value="">— Select driver —</option>
              {employees.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Vehicle</label>
            <select name="vehicle_id" className="form-select" value={dutyForm.vehicle_id} onChange={e => setDutyForm(f => ({ ...f, vehicle_id: e.target.value }))}>
              <option value="">— Select vehicle —</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}
            </select>
          </div>

          <label className="form-label" style={{ marginBottom: 8 }}>
            Unassigned runs for {fmtLongDate(dutyForm.date)}
          </label>
          {availableDepartures().length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '10px 0' }}>
              All runs are already assigned for this date.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {availableDepartures().map(dep => {
                const checked = dutyForm.selectedDepartures.includes(dep.id)
                const existing = journeyMap[`${dep.id}-${dutyForm.date}`]
                return (
                  <label
                    key={dep.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                      padding: '9px 12px', borderRadius: 6,
                      background: checked ? 'rgba(77,184,72,0.08)' : 'var(--bg)',
                      border: `1px solid ${checked ? 'rgba(77,184,72,0.4)' : 'var(--border)'}`,
                      transition: 'background 0.12s, border-color 0.12s',
                    }}
                  >
                    <input type="checkbox" name="departure_id" checked={checked} onChange={() => toggleDeparture(dep.id)} style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 600, fontSize: 14 }}>
                        {dep.timetable?.route?.service_code}
                        <span style={{ fontFamily: 'inherit', fontWeight: 700, marginLeft: 8 }}>{dep.departure_time.slice(0, 5)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{dep.timetable?.name} · {dep.timetable?.direction}</div>
                    </div>
                    {existing && !existing.driver_id && <span className="badge badge-amber">No driver</span>}
                  </label>
                )
              })}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
