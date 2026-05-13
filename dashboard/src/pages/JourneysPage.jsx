import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getCompanyId } from '../lib/company'
import Modal from '../components/Modal'

const STATUS_BADGE = {
  scheduled:   <span className="badge badge-gray">Scheduled</span>,
  in_progress: <span className="badge badge-amber">In Progress</span>,
  completed:   <span className="badge badge-green">Completed</span>,
  cancelled:   <span className="badge badge-red">Cancelled</span>,
}

function todayStr() { return new Date().toISOString().slice(0, 10) }

const EMPTY_FORM = { timetable_id: '', driver_id: '', vehicle_id: '', journey_date: todayStr() }

export default function JourneysPage() {
  const [journeys, setJourneys] = useState([])
  const [timetables, setTimetables] = useState([])
  const [drivers, setDrivers] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState(todayStr())
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const [detailJourney, setDetailJourney] = useState(null)
  const [detailStops, setDetailStops] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [reportJourney, setReportJourney] = useState(null)
  const [reportStops, setReportStops] = useState([])
  const [reportIncidents, setReportIncidents] = useState([])
  const [reportLoading, setReportLoading] = useState(false)

  async function loadJourneys(date) {
    setLoading(true)
    const { data } = await supabase
      .from('journeys')
      .select(`
        *,
        timetable:timetables(period, direction, route:routes(service_code)),
        driver:staff(name),
        vehicle:vehicles(registration)
      `)
      .eq('journey_date', date)
      .order('created_at')
    setJourneys(data ?? [])
    setLoading(false)
  }

  async function loadDeps() {
    const [t, d, v] = await Promise.all([
      supabase.from('timetables').select('id, period, direction, route:routes(service_code)').order('period'),
      supabase.from('staff').select('id, name').order('name'),
      supabase.from('vehicles').select('id, registration').order('registration'),
    ])
    setTimetables(t.data ?? [])
    setDrivers(d.data ?? [])
    setVehicles(v.data ?? [])
  }

  useEffect(() => { loadJourneys(dateFilter); loadDeps() }, [])

  function handleDateChange(e) {
    setDateFilter(e.target.value)
    loadJourneys(e.target.value)
  }

  async function openDetail(j) {
    setDetailJourney(j)
    setDetailStops([])
    setDetailLoading(true)
    if (j.timetable_id) {
      const { data } = await supabase
        .from('timetable_stops')
        .select('sequence, scheduled_time, stop_type, stop:stops(name)')
        .eq('timetable_id', j.timetable_id)
        .order('sequence')
      setDetailStops(data ?? [])
    }
    setDetailLoading(false)
  }

  async function openReport(j) {
    setReportJourney(j)
    setReportStops([])
    setReportIncidents([])
    setReportLoading(true)
    const [stopRes, incidentRes] = await Promise.all([
      supabase
        .from('journey_stop_times')
        .select('arrived_at, departed_at, variance_seconds, is_early_arrival, timetable_stop:timetable_stops(sequence, scheduled_time, stop_type, stop:stops(name))')
        .eq('journey_id', j.id),
      supabase
        .from('journey_events')
        .select('occurred_at, metadata, lat, lon')
        .eq('journey_id', j.id)
        .eq('event_type', 'incident')
        .order('occurred_at'),
    ])
    const stops = (stopRes.data ?? []).sort(
      (a, b) => (a.timetable_stop?.sequence ?? 0) - (b.timetable_stop?.sequence ?? 0)
    )
    setReportStops(stops)
    setReportIncidents(incidentRes.data ?? [])
    setReportLoading(false)
  }

  function downloadCsv(j, stops, incidents) {
    const fmt = ts => ts ? new Date(ts).toLocaleString('en-GB') : '—'
    const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
    const fmtVariance = s => {
      if (s == null) return '—'
      const abs = Math.abs(s)
      const sign = s < 0 ? '-' : s > 0 ? '+' : ''
      return `${sign}${Math.floor(abs / 60)}m ${abs % 60}s`
    }
    const route = j.timetable?.route?.service_code ?? ''
    const period = j.timetable?.period ?? ''
    const direction = j.timetable?.direction ?? ''
    const lines = [
      'Journey Report',
      `Date,${j.journey_date}`,
      `Route,${route}`,
      `Period,${period} ${direction}`,
      `Driver,${j.driver?.name ?? 'Unassigned'}`,
      `Vehicle,${j.vehicle?.registration ?? 'Unassigned'}`,
      `Status,${j.status}`,
      `Started,${fmt(j.started_at)}`,
      `Completed,${fmt(j.completed_at)}`,
      '',
      'Stop Times',
      '#,Stop,Type,Scheduled,Actual Arrival,Variance,Early?',
      ...stops.map(s => [
        s.timetable_stop?.sequence ?? '',
        `"${s.timetable_stop?.stop?.name ?? '—'}"`,
        s.timetable_stop?.stop_type ?? '',
        s.timetable_stop?.scheduled_time ?? '—',
        fmtTime(s.arrived_at),
        fmtVariance(s.variance_seconds),
        s.is_early_arrival ? 'Yes' : 'No',
      ].join(',')),
    ]
    if (incidents.length > 0) {
      lines.push('', 'Incidents', 'Time,Category,Description,Near Stop,Lat,Lon')
      incidents.forEach(i => {
        lines.push([
          fmtTime(i.occurred_at),
          `"${i.metadata?.category ?? ''}"`,
          `"${i.metadata?.description ?? ''}"`,
          `"${i.metadata?.near_stop ?? ''}"`,
          i.lat ?? '',
          i.lon ?? '',
        ].join(','))
      })
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `journey-report-${route}-${j.journey_date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function printReport(j, stops, incidents) {
    const fmt = ts => ts ? new Date(ts).toLocaleString('en-GB') : '—'
    const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'
    const fmtVariance = s => {
      if (s == null) return '—'
      const abs = Math.abs(s)
      const sign = s < 0 ? 'Early ' : s > 0 ? 'Late ' : ''
      return `${sign}${Math.floor(abs / 60)}m ${abs % 60}s`
    }
    const varColour = s => s == null ? '' : s < 0 ? 'color:#fb8c00' : s > 30 ? 'color:#e53935' : 'color:#4db848'
    const route = j.timetable?.route?.service_code ?? 'Journey'
    const stopRows = stops.map(s => `
      <tr>
        <td>${s.timetable_stop?.sequence ?? ''}</td>
        <td>${s.timetable_stop?.stop?.name ?? '—'}</td>
        <td>${s.timetable_stop?.stop_type === 'timing_point' ? 'TP' : 'RP'}</td>
        <td>${s.timetable_stop?.scheduled_time ?? '—'}</td>
        <td>${fmtTime(s.arrived_at)}</td>
        <td style="${varColour(s.variance_seconds)}">${fmtVariance(s.variance_seconds)}</td>
      </tr>`).join('')
    const incidentRows = incidents.map(i => `
      <tr>
        <td>${fmtTime(i.occurred_at)}</td>
        <td>${i.metadata?.category ?? ''}</td>
        <td>${i.metadata?.description ?? ''}</td>
        <td>${i.metadata?.near_stop ?? ''}</td>
      </tr>`).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Journey Report — ${route} ${j.journey_date}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:24px}
        h1{font-size:16px;margin:0 0 4px}
        h2{font-size:13px;margin:16px 0 6px;border-bottom:1px solid #ccc;padding-bottom:4px}
        .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 16px;margin-bottom:8px}
        .meta span{color:#555;font-size:11px}
        .meta strong{display:block}
        table{width:100%;border-collapse:collapse;font-size:11px}
        th{text-align:left;padding:4px 6px;background:#f0f0f0;border:1px solid #ddd;font-weight:600}
        td{padding:4px 6px;border:1px solid #ddd}
        tr:nth-child(even) td{background:#fafafa}
        @media print{body{margin:12px}}
      </style></head><body>
      <h1>Journey Report — ${route} ${j.timetable?.period ?? ''} ${j.timetable?.direction ?? ''}</h1>
      <div class="meta">
        <div><span>Date</span><strong>${j.journey_date}</strong></div>
        <div><span>Driver</span><strong>${j.driver?.name ?? 'Unassigned'}</strong></div>
        <div><span>Vehicle</span><strong>${j.vehicle?.registration ?? 'Unassigned'}</strong></div>
        <div><span>Status</span><strong>${j.status}</strong></div>
        <div><span>Started</span><strong>${fmt(j.started_at)}</strong></div>
        <div><span>Completed</span><strong>${fmt(j.completed_at)}</strong></div>
      </div>
      <h2>Stop Times</h2>
      <table><thead><tr><th>#</th><th>Stop</th><th>Type</th><th>Scheduled</th><th>Actual</th><th>Variance</th></tr></thead>
        <tbody>${stopRows || '<tr><td colspan="6">No stop times recorded</td></tr>'}</tbody>
      </table>
      ${incidents.length > 0 ? `
      <h2>Incidents (${incidents.length})</h2>
      <table><thead><tr><th>Time</th><th>Category</th><th>Description</th><th>Near Stop</th></tr></thead>
        <tbody>${incidentRows}</tbody>
      </table>` : ''}
      </body></html>`
    const w = window.open('', '_blank', 'width=800,height=600')
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError('')
    const company_id = await getCompanyId()
    const payload = {
      timetable_id: form.timetable_id || null,
      driver_id:    form.driver_id    || null,
      vehicle_id:   form.vehicle_id   || null,
      journey_date: form.journey_date,
      company_id,
    }
    const { error: err } = modal === 'add'
      ? await supabase.from('journeys').insert(payload)
      : await supabase.from('journeys').update(payload).eq('id', modal.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setModal(null); loadJourneys(dateFilter)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this journey?')) return
    await supabase.from('journeys').delete().eq('id', id)
    loadJourneys(dateFilter)
  }

  async function updateStatus(id, status) {
    const extra = status === 'completed' ? { completed_at: new Date().toISOString() } : {}
    await supabase.from('journeys').update({ status, ...extra }).eq('id', id)
    loadJourneys(dateFilter)
  }

  function copyDriverLink(id) {
    navigator.clipboard.writeText(`https://car490.github.io/route-tracker/?duties=${id}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function openAdd() {
    setForm({ ...EMPTY_FORM, journey_date: dateFilter })
    setError(''); setModal('add')
  }

  function openEdit(j) {
    setForm({
      timetable_id: j.timetable_id ?? '',
      driver_id:    j.driver_id    ?? '',
      vehicle_id:   j.vehicle_id   ?? '',
      journey_date: j.journey_date,
    })
    setError(''); setModal(j)
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Daily Journeys</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            className="form-input"
            type="date"
            value={dateFilter}
            onChange={handleDateChange}
            style={{ width: 160 }}
          />
          <button className="btn btn-primary" onClick={openAdd}>+ Add Journey</button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : journeys.length === 0 ? (
            <div className="empty-state">No journeys scheduled for this date.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Period</th>
                  <th>Driver</th>
                  <th>Vehicle</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {journeys.map(j => (
                  <tr key={j.id}>
                    <td>
                      <span style={{ fontFamily: 'Oswald', fontWeight: 600, color: 'var(--navy-brand)' }}>
                        {j.timetable?.route?.service_code ?? '—'}
                      </span>
                    </td>
                    <td>
                      {j.timetable?.period
                        ? <span className={`badge ${j.timetable.period === 'Morning' || j.timetable.period === 'Early Morning' ? 'badge-amber' : 'badge-blue'}`}>
                            {j.timetable.period} {j.timetable.direction}
                          </span>
                        : '—'}
                    </td>
                    <td>{j.driver?.name ?? <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}</td>
                    <td>
                      {j.vehicle?.registration
                        ? <span style={{ fontFamily: 'monospace' }}>{j.vehicle.registration}</span>
                        : <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}
                    </td>
                    <td>{STATUS_BADGE[j.status]}</td>
                    <td>
                      <div className="td-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => openDetail(j)}>View</button>
                        {j.status === 'completed' && (
                          <button className="btn btn-ghost btn-sm" onClick={() => openReport(j)}>Report</button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(j)}>Edit</button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => copyDriverLink(j.id)}
                          title="Copy driver link"
                        >
                          {copiedId === j.id ? 'Copied!' : 'Copy Link'}
                        </button>
                        {j.status === 'in_progress' && (
                          <button className="btn btn-primary btn-sm" onClick={() => updateStatus(j.id, 'completed')}>
                            Complete
                          </button>
                        )}
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(j.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Journey detail modal */}
      {detailJourney && (
        <Modal
          title={`${detailJourney.timetable?.route?.service_code ?? 'Journey'} — ${detailJourney.timetable?.period ?? ''} ${detailJourney.timetable?.direction ?? ''}`}
          onClose={() => setDetailJourney(null)}
          footer={
            <button className="btn btn-ghost" onClick={() => setDetailJourney(null)}>Close</button>
          }
        >
          <div style={{ marginBottom: 16, display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 14 }}>
            <div>
              <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>Driver</span>
              <strong>{detailJourney.driver?.name ?? 'Unassigned'}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>Vehicle</span>
              <strong style={{ fontFamily: 'monospace' }}>{detailJourney.vehicle?.registration ?? 'Unassigned'}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>Date</span>
              <strong>{new Date(detailJourney.journey_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>Status</span>
              {STATUS_BADGE[detailJourney.status]}
            </div>
          </div>

          {detailLoading ? (
            <div style={{ color: 'var(--text-muted)', padding: '12px 0' }}>Loading stops…</div>
          ) : detailStops.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', padding: '12px 0' }}>No timetable assigned.</div>
          ) : (
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 500, width: 32 }}>#</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 500 }}>Stop</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 500, width: 60 }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {detailStops.map(s => (
                  <tr key={s.sequence} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontSize: 12 }}>{s.sequence}</td>
                    <td style={{ padding: '5px 8px' }}>{s.stop?.name ?? '—'}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#a0aec0' }}>
                      {s.scheduled_time}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}

      {/* Journey report modal */}
      {reportJourney && (
        <Modal
          title={`Report — ${reportJourney.timetable?.route?.service_code ?? 'Journey'} ${reportJourney.timetable?.period ?? ''} ${reportJourney.timetable?.direction ?? ''}`}
          onClose={() => setReportJourney(null)}
          footer={
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <button className="btn btn-ghost" onClick={() => setReportJourney(null)}>Close</button>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => downloadCsv(reportJourney, reportStops, reportIncidents)}
                  disabled={reportLoading}
                >
                  Export CSV
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => printReport(reportJourney, reportStops, reportIncidents)}
                  disabled={reportLoading}
                >
                  Print / PDF
                </button>
              </div>
            </div>
          }
        >
          {reportLoading ? (
            <div style={{ color: 'var(--text-muted)', padding: '12px 0' }}>Loading report…</div>
          ) : (
            <>
              {/* Summary */}
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13, marginBottom: 16 }}>
                <div>
                  <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>Driver</span>
                  <strong>{reportJourney.driver?.name ?? 'Unassigned'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>Vehicle</span>
                  <strong style={{ fontFamily: 'monospace' }}>{reportJourney.vehicle?.registration ?? 'Unassigned'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>Date</span>
                  <strong>{new Date(reportJourney.journey_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</strong>
                </div>
                {reportJourney.started_at && (
                  <div>
                    <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>Started</span>
                    <strong>{new Date(reportJourney.started_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</strong>
                  </div>
                )}
                {reportJourney.completed_at && (
                  <div>
                    <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>Completed</span>
                    <strong>{new Date(reportJourney.completed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</strong>
                  </div>
                )}
              </div>

              {/* Stop times */}
              <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Stop Times {reportStops.length > 0 ? `(${reportStops.length})` : ''}
              </div>
              {reportStops.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0 12px' }}>No stop times recorded for this journey.</div>
              ) : (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginBottom: 16 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500, width: 28 }}>#</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500 }}>Stop</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500, width: 60 }}>Sched</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500, width: 60 }}>Actual</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500, width: 72 }}>Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportStops.map((s, i) => {
                      const v = s.variance_seconds
                      const varStr = v == null ? '—'
                        : v === 0 ? 'On time'
                        : `${v < 0 ? '-' : '+'}${Math.floor(Math.abs(v) / 60)}m ${Math.abs(v) % 60}s`
                      const varColour = v == null ? 'var(--text-muted)'
                        : v < 0 ? 'var(--early)'
                        : v > 30 ? 'var(--late)'
                        : 'var(--on-time)'
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '5px 6px', color: 'var(--text-muted)', fontSize: 11 }}>{s.timetable_stop?.sequence ?? ''}</td>
                          <td style={{ padding: '5px 6px' }}>{s.timetable_stop?.stop?.name ?? '—'}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: 'monospace', color: '#a0aec0' }}>
                            {s.timetable_stop?.scheduled_time ?? '—'}
                          </td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontFamily: 'monospace' }}>
                            {s.arrived_at ? new Date(s.arrived_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}
                          </td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 600, color: varColour }}>{varStr}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              {/* Incidents */}
              <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Incidents {reportIncidents.length > 0 ? `(${reportIncidents.length})` : '(none)'}
              </div>
              {reportIncidents.length > 0 && (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500, width: 56 }}>Time</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500, width: 100 }}>Category</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500 }}>Description</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--text-muted)', fontWeight: 500 }}>Near Stop</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportIncidents.map((inc, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '5px 6px', fontFamily: 'monospace', color: '#a0aec0' }}>
                          {new Date(inc.occurred_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '5px 6px' }}>
                          <span className="badge badge-amber">{inc.metadata?.category ?? '—'}</span>
                        </td>
                        <td style={{ padding: '5px 6px', color: 'var(--text-muted)' }}>{inc.metadata?.description || '—'}</td>
                        <td style={{ padding: '5px 6px', color: 'var(--text-muted)' }}>{inc.metadata?.near_stop || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </Modal>
      )}

      {/* Add / edit modal */}
      {modal !== null && (
        <Modal
          title={modal === 'add' ? 'Add Journey' : 'Edit Journey'}
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
              <label className="form-label">Date</label>
              <input
                className="form-input"
                type="date"
                value={form.journey_date}
                onChange={e => setForm(f => ({ ...f, journey_date: e.target.value }))}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Timetable</label>
              <select
                className="form-select"
                value={form.timetable_id}
                onChange={e => setForm(f => ({ ...f, timetable_id: e.target.value }))}
              >
                <option value="">— Select —</option>
                {timetables.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.route?.service_code} {t.period} {t.direction}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">
                Driver{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <select
                className="form-select"
                value={form.driver_id}
                onChange={e => setForm(f => ({ ...f, driver_id: e.target.value }))}
              >
                <option value="">— Unassigned —</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">
                Vehicle{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <select
                className="form-select"
                value={form.vehicle_id}
                onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value }))}
              >
                <option value="">— Unassigned —</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}
              </select>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
