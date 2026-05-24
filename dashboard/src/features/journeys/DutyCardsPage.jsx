import { useEffect, useState } from 'react'
import { supabase } from '../../shared/supabase'

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

const PERIOD_ORDER = ['Early Morning', 'Morning', 'Midday', 'Afternoon', 'Evening', 'Night', 'All Day']

export default function DutyCardsPage() {
  const [weekStart,    setWeekStart]    = useState(() => getWeekStart(new Date()))
  const [matrix,       setMatrix]       = useState({}) // { driverId: { date: journey[] } }
  const [drivers,      setDrivers]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [selected,     setSelected]     = useState(null) // { driver, date, journeys }
  const [token,        setToken]        = useState(null)
  const [tokenError,   setTokenError]   = useState(null)
  const [tokenLoading, setTokenLoading] = useState(false)
  const [copied,       setCopied]       = useState(false)

  useEffect(() => { load(weekStart) }, [])

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
        id, journey_date, status,
        timetable:timetables(period, direction, route:routes(service_code)),
        driver:employees(id, name)
      `)
      .gte('journey_date', start)
      .lte('journey_date', end)
      .neq('status', 'cancelled')
      .not('driver_id', 'is', null)
      .order('journey_date')

    if (qErr) { setError(qErr.message); setLoading(false); return }

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
    const { data: { session } } = await supabase.auth.getSession()
    const authHeader = session?.access_token
      ? `Bearer ${session.access_token}`
      : `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
    try {
      const resp = await fetch('/api/sign-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify({ journey_ids: journeys.map(j => j.id), driver_name: driver.name, driver_id: driver.id }),
      })
      const payload = await resp.json().catch(() => ({}))
      if (!resp.ok) setTokenError(payload.error ?? `HTTP ${resp.status}`)
      else if (payload.token) setToken(payload.token)
      else setTokenError('No token in response')
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
    generateToken(driver, journeys)
  }

  function copyLink() {
    navigator.clipboard.writeText(dutyUrl(selected.journeys.map(j => j.id), token))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function openEmail() {
    const { driver, date, journeys } = selected
    const contact = getContact(driver.contacts ?? [], 'email')
    if (!contact) { alert(`No email address on file for ${driver.name}.\nAdd one on the Employees page.`); return }
    const url = dutyUrl(journeys.map(j => j.id), token)
    window.open(`mailto:${contact.value}?subject=${encodeURIComponent(`Your Duty Card — ${fmtLongDate(date)}`)}&body=${encodeURIComponent(dutyMessage(driver.name, date, url))}`)
  }

  function openWhatsApp() {
    const { driver, date, journeys } = selected
    const contact = getContact(driver.contacts ?? [], 'phone')
    if (!contact) { alert(`No phone number on file for ${driver.name}.\nAdd one on the Employees page.`); return }
    const url = dutyUrl(journeys.map(j => j.id), token)
    window.open(`https://wa.me/${phoneForWhatsApp(contact.value)}?text=${encodeURIComponent(dutyMessage(driver.name, date, url))}`)
  }

  const days  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today = todayStr()

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Duty Cards</h1>
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
                              {j.timetable?.route?.service_code ?? '?'}
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
              const sc = (a.timetable?.route?.service_code ?? '').localeCompare(b.timetable?.route?.service_code ?? '')
              return sc !== 0 ? sc : PERIOD_ORDER.indexOf(a.timetable?.period) - PERIOD_ORDER.indexOf(b.timetable?.period)
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
                        {j.timetable?.route?.service_code ?? '—'}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        {j.timetable?.period} · {j.timetable?.direction}
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
                  <button className="btn btn-ghost btn-sm" onClick={openEmail}
                    disabled={!hasEmail || !tokenReady}
                    title={hasEmail ? `Send to ${getContact(contacts, 'email')?.value}` : 'No email on file'}>
                    Send Email
                  </button>
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
    </div>
  )
}
