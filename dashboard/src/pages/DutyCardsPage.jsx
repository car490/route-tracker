import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const PWA_BASE = 'https://car490.github.io/route-tracker'

function todayStr() { return new Date().toISOString().slice(0, 10) }

function fmtLongDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// Strip non-digits from a +44XXXXXXXXXX number for wa.me
function phoneForWhatsApp(phone) {
  return phone.replace(/\D/g, '')
}

function dutyUrl(journeyIds) {
  return `${PWA_BASE}/?duties=${journeyIds.join(',')}`
}

function dutyMessage(driverName, date, url) {
  return `Hi ${driverName}, your duty card for ${fmtLongDate(date)} is ready:\n${url}`
}

// From a contacts array, get the best match for a given type.
// Prefer primary if it matches the type; otherwise return first of that type.
function getContact(contacts, type) {
  const primary = contacts.find(c => c.is_primary && c.type === type)
  if (primary) return primary
  return contacts.find(c => c.type === type) ?? null
}

const PERIOD_ORDER = ['Early Morning', 'Morning', 'Midday', 'Afternoon', 'Evening', 'Night', 'All Day']

export default function DutyCardsPage() {
  const [date, setDate] = useState(todayStr())
  const [duties, setDuties] = useState([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(null)

  async function load(d) {
    setLoading(true)
    const { data } = await supabase
      .from('journeys')
      .select(`
        id, journey_date, status,
        timetable:timetables(period, direction, route:routes(service_code)),
        driver:staff(id, name, contacts:staff_contacts(*))
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
    setDuties(
      Object.values(map).sort((a, b) => a.driver.name.localeCompare(b.driver.name))
    )
    setLoading(false)
  }

  useEffect(() => { load(date) }, [])

  function handleDateChange(e) {
    setDate(e.target.value)
    load(e.target.value)
  }

  function copyLink(driverName, ids) {
    navigator.clipboard.writeText(dutyUrl(ids))
    setCopied(driverName)
    setTimeout(() => setCopied(null), 2000)
  }

  function openEmail(driver, ids) {
    const contact = getContact(driver.contacts ?? [], 'email')
    if (!contact) {
      alert(`No email address on file for ${driver.name}.\nAdd one on the Staff page.`)
      return
    }
    const url = dutyUrl(ids)
    const subject = encodeURIComponent(`Your Duty Card — ${fmtLongDate(date)}`)
    const body = encodeURIComponent(dutyMessage(driver.name, date, url))
    window.open(`mailto:${contact.value}?subject=${subject}&body=${body}`)
  }

  function openWhatsApp(driver, ids) {
    const contact = getContact(driver.contacts ?? [], 'phone')
    if (!contact) {
      alert(`No phone number on file for ${driver.name}.\nAdd one on the Staff page.`)
      return
    }
    const phone = phoneForWhatsApp(contact.value)
    const text = encodeURIComponent(dutyMessage(driver.name, date, dutyUrl(ids)))
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
            const contacts = driver.contacts ?? []
            const primaryContact = contacts.find(c => c.is_primary) ?? contacts[0] ?? null
            const hasEmail = contacts.some(c => c.type === 'email')
            const hasPhone = contacts.some(c => c.type === 'phone')

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
                    {primaryContact && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        <span className={`badge ${primaryContact.type === 'email' ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: 10, marginRight: 6 }}>
                          {primaryContact.type} · primary
                        </span>
                        {primaryContact.value}
                      </div>
                    )}
                    {!primaryContact && (
                      <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4, opacity: 0.7 }}>
                        No contact details on file
                      </div>
                    )}
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
                        {j.status === 'completed'   && <span className="badge badge-green">Completed</span>}
                        {j.status === 'in_progress' && <span className="badge badge-amber">In Progress</span>}
                        {j.status === 'scheduled'   && <span className="badge badge-gray">Scheduled</span>}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Duty card URL */}
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
                    disabled={!hasEmail}
                    title={hasEmail ? `Send to ${getContact(contacts, 'email')?.value}` : 'No email address on file'}
                  >
                    Send Email
                  </button>

                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => openWhatsApp(driver, ids)}
                    disabled={!hasPhone}
                    title={hasPhone ? `Send to ${getContact(contacts, 'phone')?.value}` : 'No phone number on file'}
                    style={hasPhone ? { color: '#25d366', borderColor: '#25d366' } : {}}
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
