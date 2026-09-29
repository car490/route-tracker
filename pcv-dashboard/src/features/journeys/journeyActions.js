// Journey actions shared by the desktop Journeys page and the phone page
// (/m/journeys). The Supabase-backed ones take the client as an argument so
// the logic can be tested without a live database.

export const STATUS_LABEL = {
  scheduled:   'Scheduled',
  in_progress: 'In progress',
  completed:   'Completed',
  cancelled:   'Cancelled',
}

// Local date, not toISOString() — that's UTC, so just after midnight in
// summer time it would show yesterday's journeys.
export function todayStr(now = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function depLabel(j) {
  const dep = j.departure
  if (!dep) return '—'
  return `${dep.timetable?.route?.service_code ?? ''} ${dep.timetable?.name ?? ''} ${dep.timetable?.direction ?? ''} @ ${dep.departure_time?.slice(0, 5) ?? ''}`
}

// Which buttons a journey card offers. Run opens the driver app, so it's only
// offered while there's still a journey to drive; Reset only once one has been
// driven (there's nothing to clear on a scheduled journey).
export function journeyActionsFor(status) {
  return {
    run:      status === 'scheduled' || status === 'in_progress',
    reset:    status === 'in_progress' || status === 'completed',
    complete: status === 'in_progress',
    remove:   true,
  }
}

// Distinct routes that have at least one departure, sorted by service code.
export function routeOptionsFor(departures) {
  const seen = new Map()
  for (const dep of departures) {
    const r = dep.timetable?.route
    if (r && !seen.has(r.id)) seen.set(r.id, r)
  }
  return [...seen.values()].sort((a, b) => (a.service_code ?? '').localeCompare(b.service_code ?? ''))
}

// Distinct timetables (runs) on one route.
export function timetableOptionsFor(departures, routeId) {
  const seen = new Map()
  for (const dep of departures) {
    const t = dep.timetable
    if (t && t.route?.id === routeId && !seen.has(dep.timetable_id)) seen.set(dep.timetable_id, t)
  }
  return [...seen.values()]
}

// Turns the one database error ops can actually cause by hand into plain English.
export function friendlySaveError(message) {
  if (message?.includes('journeys_no_double_booking')) {
    return 'That departure already has a journey on this date. Reset or delete the existing one instead.'
  }
  return message
}

// One transaction on the server (reset_journey()), so a dropped connection
// can't leave a journey half-reset.
export async function resetJourney(supabase, id) {
  const { data, error } = await supabase.rpc('reset_journey', { p_journey_id: id })
  if (error) return { error: error.message }
  if (!data) return { error: 'Journey not found — it may have been deleted.' }
  return { error: null }
}

// journey_events and journey_stop_times cascade on delete.
export async function deleteJourney(supabase, id) {
  const { error, count } = await supabase.from('journeys').delete({ count: 'exact' }).eq('id', id)
  if (error) return { error: error.message }
  if (count === 0) return { error: 'Journey not found — it may have been deleted.' }
  return { error: null }
}

export function driverLink(pwaBase, journeyId, token) {
  const base = `${pwaBase}/?duties=${journeyId}`
  return token ? `${base}&token=${token}` : base
}

// Signed duty link for one journey, via the same /api/sign-token endpoint the
// Duty Cards page uses.
export async function signedDriverLink({ supabase, fetchImpl = fetch, pwaBase, journey }) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetchImpl('/api/sign-token', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session?.access_token ?? ''}`,
    },
    body: JSON.stringify({
      journey_ids: [journey.id],
      driver_name: journey.driver?.name ?? 'Driver',
      driver_id:   journey.driver_id ?? undefined,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { error: body.error ?? `Signing failed (${res.status})` }
  if (!body.token) return { error: 'No token returned' }
  return { url: driverLink(pwaBase, journey.id, body.token), error: null }
}

// ── Stop-time upload problems ──────────────────────────────────────────────
// A Driver PWA or Announce Solo device reports when the server refused a
// trip's stop times (supabase/migration_stop_time_upload_problem.sql). The
// device keeps the trip and retries; an accepted upload marks the problem
// resolved. Both journeys pages embed the problems and show the open one.
export const UPLOAD_PROBLEMS_EMBED =
  'upload_problems:stop_time_upload_problem(source, http_status, reason, row_count, reported_at, resolved_at)'

export function openUploadProblem(journey) {
  return (journey?.upload_problems ?? []).find(p => !p.resolved_at) ?? null
}

// The Driver sends the raw error body; pull the server's message out of it.
function serverMessage(reason) {
  if (!reason) return ''
  try {
    const parsed = JSON.parse(reason)
    if (parsed && typeof parsed.message === 'string') return parsed.message
  } catch { /* not JSON: already a plain message */ }
  return reason
}

export function uploadProblemText(problem) {
  const device = problem.source === 'solo' ? 'The Announce Solo sign' : 'The Driver app'
  const one = problem.row_count === 1
  const message = serverMessage(problem.reason)
  return `${device} could not save ${problem.row_count} stop ${one ? 'time' : 'times'}: `
    + `the server refused ${one ? 'it' : 'them'}${message ? ` (${message})` : ''}. `
    + `${one ? 'It is' : 'They are'} kept on the device and will upload once the problem is fixed.`
}
