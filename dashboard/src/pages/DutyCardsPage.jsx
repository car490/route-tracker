import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const PWA_BASE = 'https://car490.github.io/route-tracker'

function todayStr() { return new Date().toISOString().slice(0, 10) }

function fmtLongDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// Strip non-digits; if starts with 0, swap for country code 44 (UK fallback)
function normalisePhone(phone) {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0')) return '44' + digits.slice(1)
  return digits
}

function dutyUrl(journeyIds) {
  return `${PWA_BASE}/?duties=${journeyIds.join(',')}`
}

function dutyMessage(driverName, date, url) {
  return `Hi ${driverName}, your duty card for ${fmtLongDate(date)} is ready:\n${url}`
}

export default function DutyCardsPage() {
  const [date, setDate] = useState(todayStr())
  const [duties, setDuties] = useState([])   // [{ driver, journeys[] }]
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(null)

  async function load(d) {
    setLoading(true)
    const { data } = await supabase
      .from('journeys')
      .select(`
        id, journey_date, status,
        timetable:timetables(period, direction, route:routes(service_code)),
        driver:staff(id, name, email, phone)
      `)
      .eq('journey_date', d)
      .neq('status', 'cancelled')
      .not('driver_id', 'is', null)
      .order('created_at')

    // Group by driver
    const map = {}
    for (const j of data ?? []) {
      if (!j.driver) continue
      const dId = j.driver.id
      if (!map[dId]) map[dId] = { driver: j.driver, journeys: [] }
      map[dId].journeys.push(j)
    }
    setDuties(Object.values(map).sort((a, b) => a.driver.name.localeCompare(b.driver.name)))
    setLoading(false)
  }

  useEffect(() => { load(date) }, [])

  function handleDateChange(e) {
    setDate(e.target.value)
    load(e.target.value)
  }

  function copyLink(driverName, journeyIds) {
    navigator.clipboard.writeText(dutyUrl(journeyIds))
    setCopied(driverName)
    setTimeout(() => setCopied(null), 2000)
  }

  function openEmail(driver, journeyIds) {
    if (!driver.email) { alert(`No email address on file for ${driver.name}.\nAdd one on the Staff page.`); return }
    const url = dutyUrl(journeyIds)
    const subject = encodeURIComponent(`Your Duty Card — ${fmtLongDate(date)}`)
    const body = encodeURIComponent(dutyMessage(driver.name, date, url))
    window.open(`mailto:${driver.email}?subject=${subject}&body=${body}`)
  }

  function openWhatsApp(driver, journeyIds) {
    if (!driver.phone) { alert(`No phone number on file for ${driver.name}.\nAdd one on the Staff page.`); return }
    const phone = normalisePhone(driver.phone)
    const text = encodeURIComponent(dutyMessage(driver.name, date, dutyUrl(journeyIds)))
    window.open(`https://wa.me/${phone}?text=${text}`)
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Duty Cards</h1>
        <input
          type="date"
          className="form-input"
          value={date}
          onChange={handleDateChange}
          style={{ width: 'auto' }}
        />
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
        {fmtLongDate(date)} — duty cards for all assigned drivers.
        Contact details can be added on the <a href="/drivers" style={{ color: 'var(--navy-brand)' }}>Staff page</a>.
      </p>

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : duties.length === 0 ? (
        <div className="empty-state">No drivers assigned for this date.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {duties.map(({ driver, journeys }) => {
            const ids = journeys.map(j => j.id)
            const url = dutyUrl(ids)
            const PERIOD_ORDER = ['Early Morning', 'Morning', 'Midday', 'Afternoon', 'Evening', 'Night', 'All Day']
            const sortedJourneys = [...journeys].sort((a, b) => {
              const sc = (a.timetable?.route?.service_code ?? '').localeCompare(b.timetable?.route?.service_code ?? '')
              if (sc !== 0) return sc
              return PERIOD_ORDER.indexOf(a.timetable?.period) - PERIOD_ORDER.indexOf(b.timetable?.period)
            })
            return (
              <div key={driver.id} className="card" style={{ padding: 20 }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 20, fontWeight: 600, color: 'var(--navy-mid)' }}>
                      {driver.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                      {driver.email ?? <span style={{ opacity: 0.5 }}>No email</span>}
                      {driver.phone && <span style={{ marginLeft: 12 }}>{driver.phone}</span>}
                    </div>
                  </div>
                  <span className="badge badge-gray" style={{ marginTop: 4 }}>
                    {journeys.length} {journeys.length === 1 ? 'run' : 'runs'}
                  </span>
                </div>

                {/* Runs */}
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
                        {j.status === 'completed' && <span className="badge badge-green">Completed</span>}
                        {j.status === 'in_progress' && <span className="badge badge-amber">In Progress</span>}
                        {j.status === 'scheduled' && <span className="badge badge-gray">Scheduled</span>}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Duty card link */}
                <div style={{ background: 'var(--bg)', borderRadius: 6, padding: '8px 12px', marginBottom: 14, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {url}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => copyLink(driver.name, ids)}
                    style={{ minWidth: 110 }}
                  >
                    {copied === driver.name ? '✓ Copied!' : 'Copy Link'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => openEmail(driver, ids)}
                    disabled={!driver.email}
                    title={driver.email ? `Send to ${driver.email}` : 'No email address on file'}
                  >
                    Send Email
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => openWhatsApp(driver, ids)}
                    disabled={!driver.phone}
                    title={driver.phone ? `Send to ${driver.phone}` : 'No phone number on file'}
                    style={driver.phone ? { color: '#25d366', borderColor: '#25d366' } : {}}
                  >
                    WhatsApp
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-ghost btn-sm"
                    style={{ textDecoration: 'none' }}
                  >
                    Preview ↗
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
