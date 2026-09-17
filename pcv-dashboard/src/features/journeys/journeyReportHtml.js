import { escapeHtml } from '../../shared/escapeHtml.js'

// Pure HTML-string-building half of JourneysPage.jsx's printReport(j, stops,
// incidents) — extracted so it's testable with plain string assertions (no
// DOM, no @testing-library/react). depLabelText is passed in rather than
// calling depLabel(j) directly, since depLabel stays defined inside
// JourneysPage for its other (React/JSX, already-safe) call sites.
export function buildJourneyReportHtml(j, stops, incidents, depLabelText) {
  const fmt = ts => ts ? new Date(ts).toLocaleString('en-GB') : '—'
  const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'
  const fmtVariance = s => {
    if (s == null) return '—'
    const abs  = Math.abs(s)
    const sign = s < 0 ? 'Early ' : s > 0 ? 'Late ' : ''
    return `${sign}${Math.floor(abs / 60)}m ${abs % 60}s`
  }
  const varColour = s => s == null ? '' : s < 0 ? 'color:#F59E0B' : s > 30 ? 'color:#EF4444' : 'color:#10B981'
  const route = j.departure?.timetable?.route?.service_code ?? 'Journey'
  const stopRows = stops.map(s => `
    <tr>
      <td>${s.timetable_stop?.sequence ?? ''}</td>
      <td>${escapeHtml(s.timetable_stop?.stop?.name ?? '—')}</td>
      <td>${s.timetable_stop?.stop_type === 'timing_point' ? 'TP' : 'RP'}</td>
      <td>${s.timetable_stop?.scheduled_time ?? '—'}</td>
      <td>${fmtTime(s.arrived_at)}</td>
      <td style="${varColour(s.variance_seconds)}">${fmtVariance(s.variance_seconds)}</td>
    </tr>`).join('')
  const incidentRows = incidents.map(i => `
    <tr>
      <td>${fmtTime(i.occurred_at)}</td>
      <td>${escapeHtml(i.metadata?.category ?? '')}</td>
      <td>${escapeHtml(i.metadata?.description ?? '')}</td>
      <td>${escapeHtml(i.metadata?.near_stop ?? '')}</td>
    </tr>`).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Journey Report — ${escapeHtml(route)} ${j.journey_date}</title>
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
    <h1>Journey Report — ${escapeHtml(depLabelText)}</h1>
    <div class="meta">
      <div><span>Date</span><strong>${j.journey_date}</strong></div>
      <div><span>Driver</span><strong>${escapeHtml(j.driver?.name ?? 'Unassigned')}</strong></div>
      <div><span>Vehicle</span><strong>${escapeHtml(j.vehicle?.registration ?? 'Unassigned')}</strong></div>
      <div><span>Status</span><strong>${escapeHtml(j.status)}</strong></div>
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
  return html
}
