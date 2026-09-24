import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, PWA_BASE } from '../../shared/supabase'
import { getCompanyId } from '../../shared/company'
import {
  STATUS_LABEL, todayStr, depLabel, journeyActionsFor, routeOptionsFor, timetableOptionsFor,
  friendlySaveError, resetJourney, deleteJourney, signedDriverLink,
} from './journeyActions.js'
import './mobileJourneys.css'

// Phone-sized page for the day-to-day testing loop: run a journey in the
// driver app, reset it, add or delete one. Sits outside the desktop sidebar
// layout on purpose. The full Journeys page (/journeys) still has everything
// else — reports, editing drivers/vehicles.

const EMPTY_FORM = { route_id: '', timetable_id: '', timetable_departure_id: '' }
const LOAD_TIMEOUT_MS = 20000

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return todayStr(d)
}

function fmtDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function MobileJourneysPage() {
  const [date,       setDate]       = useState(todayStr())
  const [journeys,   setJourneys]   = useState([])
  const [departures, setDepartures] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [loadError,  setLoadError]  = useState('')
  const [busyId,     setBusyId]     = useState(null)
  const [message,    setMessage]    = useState(null) // { text, error }
  const [adding,     setAdding]     = useState(false)
  const [form,       setForm]       = useState(EMPTY_FORM)
  const [saving,     setSaving]     = useState(false)
  const [formError,  setFormError]  = useState('')

  const latestLoad = useRef(0)

  // Never leaves the page stuck on "Loading…": a request that hangs (weak
  // mobile signal) is abandoned after LOAD_TIMEOUT_MS, and any failure shows
  // an error with a Try again button. Only the newest load updates the page,
  // so tapping through dates quickly can't show an older day's journeys.
  async function loadJourneys(d) {
    const loadId = ++latestLoad.current
    setLoading(true)
    setLoadError('')
    let rows = [], errorText = ''
    try {
      const { data, error } = await supabase
        .from('journeys')
        .select(`
          *,
          departure:timetable_departures(departure_time, timetable_id, timetable:timetables(name, direction, route:routes(id, service_code, single_journey))),
          driver:employees(name),
          vehicle:vehicles(registration)
        `)
        .eq('journey_date', d)
        .abortSignal(AbortSignal.timeout(LOAD_TIMEOUT_MS))
      if (error) errorText = /abort|timeout/i.test(`${error.name} ${error.message}`) ? 'No response — check your signal.' : error.message
      rows = data ?? []
    } catch (err) {
      errorText = err?.message || 'Something went wrong.'
    }
    if (loadId !== latestLoad.current) return
    rows.sort((a, b) => (a.departure?.departure_time ?? '').localeCompare(b.departure?.departure_time ?? ''))
    setJourneys(rows)
    setLoadError(errorText)
    setLoading(false)
  }

  useEffect(() => { loadJourneys(date) }, [date])

  useEffect(() => {
    supabase
      .from('timetable_departures')
      .select('id, departure_time, timetable_id, timetable:timetables(id, name, direction, route:routes(id, service_code, single_journey))')
      .order('departure_time')
      .then(({ data }) => setDepartures(data ?? []))
  }, [])

  function say(text, error = false) { setMessage({ text, error }) }

  async function withBusy(id, fn) {
    setBusyId(id)
    setMessage(null)
    try { await fn() } finally { setBusyId(null) }
  }

  function handleRun(j) {
    // Open the tab now, while we're still inside the tap — phone browsers
    // block a window.open() that happens after an await.
    const win = window.open('', '_blank')
    withBusy(j.id, async () => {
      const { url, error } = await signedDriverLink({ supabase, pwaBase: PWA_BASE, journey: j })
      if (error) {
        win?.close()
        say(`Couldn't open the driver app: ${error}`, true)
        return
      }
      if (win) win.location.href = url
      else window.location.href = url
    })
  }

  function handleReset(j) {
    if (!confirm(`Reset ${depLabel(j)} to Scheduled?\n\nThis permanently deletes its stop times, GPS track and incident log.`)) return
    withBusy(j.id, async () => {
      const { error } = await resetJourney(supabase, j.id)
      if (error) { say(`Reset failed: ${error}`, true); return }
      say(`${depLabel(j)} reset to Scheduled.`)
      await loadJourneys(date)
    })
  }

  function handleComplete(j) {
    withBusy(j.id, async () => {
      const { error } = await supabase.from('journeys')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', j.id)
      if (error) { say(`Couldn't mark it completed: ${error.message}`, true); return }
      say(`${depLabel(j)} marked completed.`)
      await loadJourneys(date)
    })
  }

  function handleDelete(j) {
    if (!confirm(`Delete ${depLabel(j)}?\n\nThis also deletes its stop times, GPS track and incident log.`)) return
    withBusy(j.id, async () => {
      const { error } = await deleteJourney(supabase, j.id)
      if (error) { say(`Delete failed: ${error}`, true); return }
      say(`${depLabel(j)} deleted.`)
      await loadJourneys(date)
    })
  }

  // ── Add journey ────────────────────────────────────────────────────────────
  const routeOptions     = useMemo(() => routeOptionsFor(departures), [departures])
  const timetableOptions = useMemo(() => timetableOptionsFor(departures, form.route_id), [departures, form.route_id])
  const selectedRoute    = routeOptions.find(r => r.id === form.route_id)
  const timetableDeps    = departures.filter(d => d.timetable_id === form.timetable_id)

  function openAdd() {
    setForm(EMPTY_FORM); setFormError(''); setAdding(true)
  }

  function handleRouteChange(routeId) {
    setForm({ route_id: routeId, timetable_id: '', timetable_departure_id: '' })
  }

  function handleTimetableChange(timetableId) {
    const deps = departures.filter(d => d.timetable_id === timetableId)
    setForm(f => ({
      ...f,
      timetable_id: timetableId,
      timetable_departure_id: selectedRoute?.single_journey || deps.length === 1 ? (deps[0]?.id ?? '') : '',
    }))
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.timetable_departure_id) { setFormError('Choose a route, run and departure time.'); return }
    setSaving(true); setFormError('')
    const company_id = await getCompanyId()
    const { error } = await supabase.from('journeys').insert({
      timetable_departure_id: form.timetable_departure_id,
      journey_date: date,
      company_id,
    })
    setSaving(false)
    if (error) { setFormError(friendlySaveError(error.message)); return }
    setAdding(false)
    say('Journey added.')
    loadJourneys(date)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (adding) {
    return (
      <div className="mj-page">
        <header className="mj-header">
          <h1 className="mj-title">Add journey</h1>
          <button type="button" className="mj-link-btn" onClick={() => setAdding(false)}>Cancel</button>
        </header>
        <form className="mj-form" onSubmit={handleAdd}>
          <p className="mj-form-date">For {fmtDate(date)}</p>
          {formError && <div className="mj-message mj-message--error" role="alert">{formError}</div>}

          <label className="mj-label" htmlFor="mj-route">Route</label>
          <select id="mj-route" className="mj-select" value={form.route_id} onChange={e => handleRouteChange(e.target.value)}>
            <option value="">Choose a route</option>
            {routeOptions.map(r => <option key={r.id} value={r.id}>{r.service_code}</option>)}
          </select>

          <label className="mj-label" htmlFor="mj-run">Run</label>
          <select id="mj-run" className="mj-select" value={form.timetable_id} onChange={e => handleTimetableChange(e.target.value)} disabled={!form.route_id}>
            <option value="">Choose a run</option>
            {timetableOptions.map(t => <option key={t.id} value={t.id}>{t.name} {t.direction}</option>)}
          </select>

          <label className="mj-label" htmlFor="mj-dep">Departure time</label>
          <select
            id="mj-dep"
            className="mj-select"
            value={form.timetable_departure_id}
            onChange={e => setForm(f => ({ ...f, timetable_departure_id: e.target.value }))}
            disabled={!form.timetable_id}
          >
            <option value="">Choose a time</option>
            {timetableDeps.map(d => <option key={d.id} value={d.id}>{d.departure_time?.slice(0, 5)}</option>)}
          </select>

          <p className="mj-hint">Driver and vehicle can be set later on the full Journeys page.</p>

          <button type="submit" className="mj-btn mj-btn--primary mj-btn--block" disabled={saving}>
            {saving ? 'Adding…' : 'Add journey'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="mj-page">
      <header className="mj-header">
        <h1 className="mj-title">Journeys</h1>
        <Link className="mj-link-btn" to="/journeys">Full page</Link>
      </header>

      <nav className="mj-date" aria-label="Choose date">
        <button type="button" className="mj-btn mj-btn--ghost mj-date-step" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day">‹</button>
        <input
          className="mj-date-input"
          type="date"
          aria-label="Date"
          value={date}
          onChange={e => e.target.value && setDate(e.target.value)}
        />
        <button type="button" className="mj-btn mj-btn--ghost mj-date-step" onClick={() => setDate(shiftDate(date, 1))} aria-label="Next day">›</button>
      </nav>
      <p className="mj-date-label">
        {fmtDate(date)}
        {date !== todayStr() && (
          <button type="button" className="mj-link-btn mj-today" onClick={() => setDate(todayStr())}>Back to today</button>
        )}
      </p>

      <div aria-live="polite">
        {message && (
          <div className={message.error ? 'mj-message mj-message--error' : 'mj-message'}>{message.text}</div>
        )}
      </div>

      {loading ? (
        <p className="mj-empty">Loading…</p>
      ) : loadError ? (
        <div className="mj-message mj-message--error" role="alert">
          <p>Couldn't load journeys: {loadError}</p>
          <button type="button" className="mj-btn mj-btn--ghost mj-retry" onClick={() => loadJourneys(date)}>Try again</button>
        </div>
      ) : journeys.length === 0 ? (
        <p className="mj-empty">No journeys on this date.</p>
      ) : (
        <ul className="mj-list">
          {journeys.map(j => {
            const actions = journeyActionsFor(j.status)
            const busy = busyId === j.id
            const tt = j.departure?.timetable
            return (
              <li key={j.id} className="mj-card">
                <div className="mj-card-top">
                  <span className="mj-time">{j.departure?.departure_time?.slice(0, 5) ?? '—'}</span>
                  <span className="mj-service">{tt?.route?.service_code ?? j.journey_type ?? '—'}</span>
                  <span className={`mj-status mj-status--${j.status}`}>{STATUS_LABEL[j.status] ?? j.status}</span>
                </div>
                <div className="mj-card-run">{tt ? `${tt.name} ${tt.direction ?? ''}` : 'No timetable'}</div>
                <div className="mj-card-meta">
                  {j.driver?.name ?? 'No driver'} · {j.vehicle?.registration ?? 'No vehicle'}
                </div>
                <div className="mj-actions">
                  {actions.run && (
                    <button type="button" className="mj-btn mj-btn--primary" onClick={() => handleRun(j)} disabled={busy}>Run</button>
                  )}
                  {actions.reset && (
                    <button type="button" className="mj-btn mj-btn--ghost" onClick={() => handleReset(j)} disabled={busy}>Reset</button>
                  )}
                  {actions.complete && (
                    <button type="button" className="mj-btn mj-btn--ghost" onClick={() => handleComplete(j)} disabled={busy}>Complete</button>
                  )}
                  {actions.remove && (
                    <button type="button" className="mj-btn mj-btn--danger" onClick={() => handleDelete(j)} disabled={busy}>Delete</button>
                  )}
                </div>
                {busy && <p className="mj-busy">Working…</p>}
              </li>
            )
          })}
        </ul>
      )}

      <div className="mj-footer">
        <button type="button" className="mj-btn mj-btn--primary mj-btn--block" onClick={openAdd}>+ Add journey</button>
      </div>
    </div>
  )
}
