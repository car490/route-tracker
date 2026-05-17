import { useEffect, useState } from 'react'
import { supabase } from '../../shared/supabase'
import { getCompanyId } from '../../shared/company'
import Modal from '../../shared/components/Modal'

function getWeekStart(d) {
  const m = new Date(d)
  m.setDate(d.getDate() - d.getDay())
  m.setHours(0, 0, 0, 0)
  return m
}

function dateStr(d) { return d.toISOString().slice(0, 10) }
function todayStr() { return dateStr(new Date()) }

function weekDays(sunday) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday)
    d.setDate(sunday.getDate() + i)
    return d
  })
}

function fmtDay(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function fmtWeek(sunday) {
  const saturday = new Date(sunday)
  saturday.setDate(sunday.getDate() + 6)
  if (sunday.getMonth() === saturday.getMonth()) {
    return `${sunday.getDate()}–${saturday.getDate()} ${sunday.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
  }
  return `${sunday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${saturday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

function fmtLongDate(dateString) {
  return new Date(dateString + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function jsDayToDb(jsDay) { return jsDay === 0 ? 7 : jsDay }

const PERIOD_ORDER = ['Early Morning', 'Morning', 'Midday', 'Afternoon', 'Evening', 'Night', 'All Day']
const EMPTY_DUTY = { date: todayStr(), driver_id: '', vehicle_id: '', selectedTimetables: [] }

function CellBtn({ journey, onClick }) {
  if (!journey) {
    return <button onClick={onClick} style={cellStyle('#e53935', 'rgba(229,57,53,0.12)', 'rgba(229,57,53,0.35)')}>Not scheduled</button>
  }
  if (!journey.driver_id) {
    return <button onClick={onClick} style={cellStyle('#a05a10', 'rgba(251,140,0,0.12)', 'rgba(251,140,0,0.35)')}>No driver</button>
  }
  return <button onClick={onClick} style={cellStyle('#2d7a28', 'rgba(77,184,72,0.12)', 'rgba(77,184,72,0.35)')}>{journey.driver?.name}</button>
}

function cellStyle(color, bg, border) {
  return {
    background: bg, color, border: `1px solid ${border}`, borderRadius: 4,
    padding: '5px 8px', fontSize: 12, cursor: 'pointer', width: '100%',
    fontFamily: 'Oswald, sans-serif', letterSpacing: '0.03em', fontWeight: 500,
    lineHeight: 1.3, textAlign: 'center',
  }
}

export default function SchedulePage() {
  const [weekStart, setWeekStart] = useState(getWeekStart(new Date()))
  const [timetables, setTimetables] = useState([])
  const [journeyMap, setJourneyMap] = useState({})
  const [staff, setStaff] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)

  const [modal, setModal] = useState(null)
  const [cellData, setCellData] = useState(null)
  const [dutyForm, setDutyForm] = useState(EMPTY_DUTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load(sunday) {
    setLoading(true)
    const saturday = new Date(sunday)
    saturday.setDate(sunday.getDate() + 6)

    const [tmRes, jRes, staffRes, vRes] = await Promise.all([
      supabase
        .from('timetables')
        .select('id, period, direction, days_of_week, route:routes(service_code, name, journey_type)')
        .order('period'),
      supabase
        .from('journeys')
        .select('id, journey_date, timetable_id, driver_id, vehicle_id, status, driver:staff(name), vehicle:vehicles(registration)')
        .gte('journey_date', dateStr(sunday))
        .lte('journey_date', dateStr(saturday))
        .neq('status', 'cancelled'),
      supabase.from('staff').select('id, name').order('name'),
      supabase.from('vehicles').select('id, registration').order('registration'),
    ])

    setTimetables(tmRes.data ?? [])

    const map = {}
    for (const j of jRes.data ?? []) {
      map[`${j.timetable_id}-${j.journey_date}`] = j
    }
    setJourneyMap(map)
    setStaff(staffRes.data ?? [])
    setVehicles(vRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => { load(weekStart) }, [])

  function shiftWeek(delta) {
    const m = new Date(weekStart)
    m.setDate(m.getDate() + delta * 7)
    setWeekStart(m)
    load(m)
  }

  function openNewDuty() {
    setDutyForm(EMPTY_DUTY)
    setError('')
    setModal('new-duty')
  }

  function availableTimetables() {
    if (!dutyForm.date) return []
    const d = new Date(dutyForm.date + 'T00:00:00')
    const dbDay = jsDayToDb(d.getDay())
    return [...timetables]
      .filter(t => {
        if (!t.days_of_week?.includes(dbDay)) return false
        const j = journeyMap[`${t.id}-${dutyForm.date}`]
        return !j || !j.driver_id
      })
      .sort((a, b) => {
        const sc = (a.route?.service_code ?? '').localeCompare(b.route?.service_code ?? '')
        if (sc !== 0) return sc
        return PERIOD_ORDER.indexOf(a.period) - PERIOD_ORDER.indexOf(b.period)
      })
  }

  function toggleTimetable(id) {
    setDutyForm(f => ({
      ...f,
      selectedTimetables: f.selectedTimetables.includes(id)
        ? f.selectedTimetables.filter(x => x !== id)
        : [...f.selectedTimetables, id],
    }))
  }

  async function saveNewDuty() {
    if (!dutyForm.driver_id) { setError('Please select a driver'); return }
    if (!dutyForm.vehicle_id) { setError('Please select a vehicle'); return }
    if (!dutyForm.selectedTimetables.length) { setError('Select at least one run'); return }
    setSaving(true)
    setError('')
    try {
      const companyId = await getCompanyId()
      for (const tmId of dutyForm.selectedTimetables) {
        const existing = journeyMap[`${tmId}-${dutyForm.date}`]
        if (existing) {
          const { error: e } = await supabase
            .from('journeys')
            .update({ driver_id: dutyForm.driver_id, vehicle_id: dutyForm.vehicle_id })
            .eq('id', existing.id)
          if (e) throw e
        } else {
          const { error: e } = await supabase.from('journeys').insert({
            company_id: companyId,
            timetable_id: tmId,
            journey_date: dutyForm.date,
            driver_id: dutyForm.driver_id,
            vehicle_id: dutyForm.vehicle_id,
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

  function openCell(timetable, date, journey) {
    setCellData({ timetable, date, journey })
    setDutyForm({
      date,
      driver_id: journey?.driver_id ?? '',
      vehicle_id: journey?.vehicle_id ?? '',
      selectedTimetables: [],
    })
    setError('')
    setModal('cell')
  }

  async function saveCellAssignment() {
    if (!dutyForm.driver_id) { setError('Please select a driver'); return }
    if (!dutyForm.vehicle_id) { setError('Please select a vehicle'); return }
    setSaving(true)
    setError('')
    try {
      const companyId = await getCompanyId()
      if (cellData.journey) {
        const { error: e } = await supabase
          .from('journeys')
          .update({ driver_id: dutyForm.driver_id, vehicle_id: dutyForm.vehicle_id })
          .eq('id', cellData.journey.id)
        if (e) throw e
      } else {
        const { error: e } = await supabase.from('journeys').insert({
          company_id: companyId,
          timetable_id: cellData.timetable.id,
          journey_date: cellData.date,
          driver_id: dutyForm.driver_id,
          vehicle_id: dutyForm.vehicle_id,
        })
        if (e) throw e
      }
      setModal(null)
      load(weekStart)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  const days = weekDays(weekStart)

  const sortedTimetables = [...timetables].sort((a, b) => {
    const sc = (a.route?.service_code ?? '').localeCompare(b.route?.service_code ?? '')
    if (sc !== 0) return sc
    return PERIOD_ORDER.indexOf(a.period) - PERIOD_ORDER.indexOf(b.period)
  })

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Schedule</h1>
        <button className="btn btn-primary" onClick={openNewDuty}>+ Create New Duty</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => shiftWeek(-1)}>← Prev</button>
        <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: '1.05rem', color: 'var(--text)', minWidth: 220, textAlign: 'center' }}>
          {fmtWeek(weekStart)}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => shiftWeek(1)}>Next →</button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { const m = getWeekStart(new Date()); setWeekStart(m); load(m) }}
          style={{ marginLeft: 4 }}
        >
          This Week
        </button>
      </div>

      <div style={{ display: 'flex', gap: 20, marginBottom: 18, fontSize: 12, color: 'var(--text-muted)' }}>
        <span><span style={{ color: '#2d7a28', fontWeight: 700 }}>●</span> Assigned</span>
        <span><span style={{ color: '#a05a10', fontWeight: 700 }}>●</span> No driver</span>
        <span><span style={{ color: '#e53935', fontWeight: 700 }}>●</span> Not scheduled</span>
        <span><span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>●</span> Does not operate</span>
      </div>

      {loading ? (
        <div className="empty-state">Loading schedule…</div>
      ) : sortedTimetables.length === 0 ? (
        <div className="empty-state">No timetables found. Add routes and timetables first.</div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 660 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: 180, padding: '9px 16px' }}>Run</th>
                {days.map(d => (
                  <th key={dateStr(d)} style={{ textAlign: 'center', minWidth: 120, padding: '9px 12px' }}>
                    {fmtDay(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedTimetables.map(tm => (
                <tr key={tm.id}>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 600, fontSize: 14 }}>
                      {tm.route?.service_code}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {tm.period} · {tm.direction}
                    </div>
                  </td>
                  {days.map(d => {
                    const dbDay = jsDayToDb(d.getDay())
                    const operates = tm.days_of_week?.includes(dbDay)
                    if (!operates) {
                      return (
                        <td key={dateStr(d)} style={{ textAlign: 'center', padding: '10px 8px', color: 'var(--text-muted)', opacity: 0.35 }}>
                          —
                        </td>
                      )
                    }
                    const journey = journeyMap[`${tm.id}-${dateStr(d)}`]
                    return (
                      <td key={dateStr(d)} style={{ padding: '8px' }}>
                        <CellBtn journey={journey} onClick={() => openCell(tm, dateStr(d), journey)} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'cell' && cellData && (
        <Modal
          title={`Assign — ${cellData.timetable.route?.service_code} ${cellData.timetable.period} ${cellData.timetable.direction}`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCellAssignment} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>{fmtLongDate(cellData.date)}</p>
          {error && <div className="error-msg">{error}</div>}
          <div className="form-group">
            <label className="form-label">Driver</label>
            <select className="form-select" value={dutyForm.driver_id} onChange={e => setDutyForm(f => ({ ...f, driver_id: e.target.value }))}>
              <option value="">— Select driver —</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Vehicle</label>
            <select className="form-select" value={dutyForm.vehicle_id} onChange={e => setDutyForm(f => ({ ...f, vehicle_id: e.target.value }))}>
              <option value="">— Select vehicle —</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}
            </select>
          </div>
        </Modal>
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
              type="date"
              className="form-input"
              value={dutyForm.date}
              onChange={e => setDutyForm(f => ({ ...f, date: e.target.value, selectedTimetables: [] }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Driver</label>
            <select className="form-select" value={dutyForm.driver_id} onChange={e => setDutyForm(f => ({ ...f, driver_id: e.target.value }))}>
              <option value="">— Select driver —</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Vehicle</label>
            <select className="form-select" value={dutyForm.vehicle_id} onChange={e => setDutyForm(f => ({ ...f, vehicle_id: e.target.value }))}>
              <option value="">— Select vehicle —</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}
            </select>
          </div>

          <label className="form-label" style={{ marginBottom: 8 }}>
            Unassigned runs for {fmtLongDate(dutyForm.date)}
          </label>
          {availableTimetables().length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '10px 0' }}>
              All runs are already assigned for this date.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {availableTimetables().map(tm => {
                const checked = dutyForm.selectedTimetables.includes(tm.id)
                const existing = journeyMap[`${tm.id}-${dutyForm.date}`]
                return (
                  <label
                    key={tm.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                      padding: '9px 12px', borderRadius: 6,
                      background: checked ? 'rgba(77,184,72,0.08)' : 'var(--bg)',
                      border: `1px solid ${checked ? 'rgba(77,184,72,0.4)' : 'var(--border)'}`,
                      transition: 'background 0.12s, border-color 0.12s',
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleTimetable(tm.id)} style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 600, fontSize: 14 }}>{tm.route?.service_code}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tm.period} · {tm.direction}</div>
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
