import { formatTime } from '../../shared/time/timeFormat.js'

// How a stop's departure is shown on the Journeys report: screen, print and
// CSV all use this, so "left early" reads the same everywhere. Text, never
// colour alone (docs/ACCESSIBILITY_BRAND_PLAYBOOK.md). Departures are
// recorded at every stop the bus leaves since 2026-10-01
// (supabase/migration_record_journey_departures.sql); a dash means none was
// recorded: the last stop, a skipped stop, or a trip before then.
const NONE = '—'

export function describeDeparture(stop) {
  if (!stop?.departed_at) return { time: NONE, leftEarly: NONE }
  const v = stop.departure_variance_seconds
  let leftEarly = NONE
  if (v != null) {
    const abs = Math.abs(v)
    leftEarly = v < 0 ? `Yes, ${Math.floor(abs / 60)}m ${abs % 60}s early` : 'No'
  }
  return { time: formatTime(stop.departed_at, { seconds: true }), leftEarly }
}

// One journey_stop_times row plus its schedule_view row, as the report uses it.
export function mapReportStop(st, schedMap) {
  const sched = schedMap[st.timetable_stop_id] ?? {}
  return {
    arrived_at:                 st.arrived_at,
    variance_seconds:           st.arrival_variance_seconds,
    is_early_arrival:           st.is_early_arrival,
    departed_at:                st.departed_at,
    departure_variance_seconds: st.departure_variance_seconds,
    is_early_departure:         st.is_early_departure,
    timetable_stop: {
      sequence:       sched.sequence,
      stop_type:      sched.stop_type,
      scheduled_time: sched.scheduled_time,
      stop:           { name: sched.name },
    },
  }
}
