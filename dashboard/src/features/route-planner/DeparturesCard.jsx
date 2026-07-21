import { useEffect, useState } from 'react'
import { supabase } from '../../shared/supabase'
import { S, DAYS, DEP_EMPTY } from './constants'

export default function DeparturesCard({ timetableId, timetables, departures, setDepartures, isSchoolRoute }) {
  const [depModal,  setDepModal]  = useState(null)
  const [depForm,   setDepForm]   = useState(DEP_EMPTY)
  const [depSaving, setDepSaving] = useState(false)
  const [depError,  setDepError]  = useState('')
  const [termDates, setTermDates] = useState([])

  useEffect(() => {
    if (!isSchoolRoute) return
    supabase.from('term_dates').select('*').order('start_date').then(({ data }) => setTermDates(data ?? []))
  }, [isSchoolRoute])

  async function loadDepartures(ttId) {
    const { data } = await supabase
      .from('timetable_departures').select('*').eq('timetable_id', ttId).order('departure_time')
    setDepartures(data ?? [])
  }

  async function saveDeparture(e) {
    e.preventDefault()
    setDepSaving(true); setDepError('')
    const payload = {
      timetable_id:         timetableId,
      departure_time:       depForm.departure_time,
      days_of_week:         depForm.days_of_week,
      timing_profile:       depForm.timing_profile,
      vehicle_journey_code: depForm.vehicle_journey_code,
      valid_from:           depForm.valid_from || null,
      valid_to:             depForm.valid_to   || null,
    }
    const { error } = depModal === 'add'
      ? await supabase.from('timetable_departures').insert(payload)
      : await supabase.from('timetable_departures').update({
          departure_time:       depForm.departure_time,
          days_of_week:         depForm.days_of_week,
          timing_profile:       depForm.timing_profile,
          vehicle_journey_code: depForm.vehicle_journey_code,
          valid_from:           depForm.valid_from || null,
          valid_to:             depForm.valid_to   || null,
        }).eq('id', depModal.id)
    setDepSaving(false)
    if (error) { setDepError(error.message); return }
    setDepModal(null)
    loadDepartures(timetableId)
  }

  async function deleteDeparture(id) {
    if (!confirm('Delete this departure?')) return
    await supabase.from('timetable_departures').delete().eq('id', id)
    loadDepartures(timetableId)
  }

  async function nextVjc() {
    if (!timetables.length) return 'VJ1'
    const { count } = await supabase
      .from('timetable_departures')
      .select('id', { count: 'exact', head: true })
      .in('timetable_id', timetables.map(t => t.id))
    return `VJ${(count ?? 0) + 1}`
  }

  return (
    <div className="card" style={{ padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={S.sectionLabel}>Departures</span>
        <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: 11 }}
          onClick={async () => {
            const vjc = await nextVjc()
            setDepForm({ ...DEP_EMPTY, vehicle_journey_code: vjc, valid_from: new Date().toISOString().slice(0, 10) })
            setDepError('')
            setDepModal('add')
          }}
        >+ Add</button>
      </div>

      {departures.length === 0 && depModal === null && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>No departures yet.</p>
      )}

      {departures.map(dep => (
        <div key={dep.id} style={{ background: 'var(--bg)', borderRadius: 5, padding: '5px 7px', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--navy-brand)', minWidth: 42 }}>
            {dep.departure_time.slice(0, 5)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>
            {dep.days_of_week.map(d => DAYS[d - 1]).join(' ')}
            </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{dep.vehicle_journey_code}</span>
          <button className="btn btn-ghost btn-sm" style={{ padding: '1px 5px', minWidth: 0, fontSize: 11 }}
            onClick={() => {
              setDepForm({ departure_time: dep.departure_time.slice(0, 5), days_of_week: dep.days_of_week, timing_profile: dep.timing_profile, vehicle_journey_code: dep.vehicle_journey_code, valid_from: dep.valid_from ?? '', valid_to: dep.valid_to ?? '' })
              setDepError('')
              setDepModal(dep)
            }}
          >Edit</button>
          <button className="btn btn-danger btn-sm" style={{ padding: '1px 5px', minWidth: 0, fontSize: 11 }}
            onClick={() => deleteDeparture(dep.id)}>×</button>
        </div>
      ))}

      {depModal !== null && (
        <div style={{ background: 'var(--bg)', borderRadius: 6, padding: 8, marginTop: 6, border: '1px solid var(--border)' }}>
          {depError && <div className="error-msg" style={{ marginBottom: 6 }}>{depError}</div>}
          <form onSubmit={saveDeparture}>
            <div style={{ marginBottom: 6 }}>
              <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Departure Time</div>
              <input type="time" className="form-input" value={depForm.departure_time}
                onChange={e => setDepForm(f => ({ ...f, departure_time: e.target.value }))} required />
            </div>
            <div style={{ marginBottom: 6 }}>
              <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Days</div>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {DAYS.map((d, idx) => {
                  const dayNum = idx + 1
                  const on = depForm.days_of_week.includes(dayNum)
                  return (
                    <button key={d} type="button"
                      onClick={() => setDepForm(f => ({ ...f, days_of_week: on ? f.days_of_week.filter(x => x !== dayNum) : [...f.days_of_week, dayNum].sort((a, b) => a - b) }))}
                      style={{ padding: '2px 6px', fontSize: 10, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.5, border: `1px solid ${on ? 'var(--navy-brand)' : 'var(--border)'}`, background: on ? 'var(--navy-brand)' : 'transparent', color: on ? '#fff' : 'var(--text-muted)' }}
                    >{d}</button>
                  )
                })}
              </div>
            </div>
            <div style={{ marginBottom: 6 }}>
              <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Journey Code (VJC)</div>
              <input className="form-input" value={depForm.vehicle_journey_code}
                onChange={e => setDepForm(f => ({ ...f, vehicle_journey_code: e.target.value }))} required />
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Service Validity</div>
              {isSchoolRoute && termDates.length > 0 && (
                <select className="form-select" style={{ fontSize: 11, marginBottom: 4, width: '100%' }}
                  value=""
                  onChange={e => {
                    const term = termDates.find(t => t.id === e.target.value)
                    if (term) setDepForm(f => ({ ...f, valid_from: term.start_date, valid_to: term.end_date }))
                  }}
                >
                  <option value="" disabled>Fill from term dates…</option>
                  {termDates.map(t => (
                    <option key={t.id} value={t.id}>{t.academic_year} — {t.term_name} ({t.start_date} to {t.end_date})</option>
                  ))}
                </select>
              )}
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="date" className="form-input" style={{ flex: 1, fontSize: 11 }}
                  value={depForm.valid_from}
                  onChange={e => setDepForm(f => ({ ...f, valid_from: e.target.value }))} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  to <span style={{ opacity: 0.7 }}>(optional)</span>
                </span>
                <input type="date" className="form-input" style={{ flex: 1, fontSize: 11 }}
                  value={depForm.valid_to}
                  onChange={e => setDepForm(f => ({ ...f, valid_to: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDepModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={depSaving}>{depSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
