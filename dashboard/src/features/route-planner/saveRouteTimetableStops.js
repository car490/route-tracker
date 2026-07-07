import { supabase } from '../../shared/supabase'
import { getCompanyId } from '../../shared/company'
import { timeToMinutes } from './utils'

// Persists a route (if new) + timetable (if new) + its ordered stops in one call.
// Shared by RoutePlannerPage.handleSave and RouteWizard's Timetable/Review step so
// the two never drift on how routes/timetables/stops get resolved and inserted.
//
// routeId/timetableId: an existing row id, or '__new__' to create one.
// newRouteFields: { code, name, journeyTypes, singleJourney, isBodsRoute, origin, destination, serviceReg }
// departures: existing timetable_departures for this timetable (used only to anchor stop-time offsets
//   — a brand-new timetable has none, so offsets anchor to '07:00:00', matching current behaviour).
export async function saveRouteTimetableStops({
  routeId, timetableId,
  newRouteFields = {},
  newTtName, newDirection,
  stopsToSave,
  departures = [],
}) {
  let resolvedRouteId     = routeId
  let resolvedTimetableId = timetableId

  if (routeId === '__new__') {
    const company_id = await getCompanyId()
    if (!company_id) return { error: 'Could not determine company — please reload and try again.' }
    const code = newRouteFields.code.toUpperCase()
    const { data: existing } = await supabase.from('routes')
      .select('id').eq('company_id', company_id).eq('service_code', code).maybeSingle()
    if (existing) {
      resolvedRouteId = existing.id
    } else {
      const { data, error } = await supabase.from('routes')
        .insert({
          company_id,
          service_code:   code,
          name:           newRouteFields.name || null,
          journey_type:   newRouteFields.journeyTypes,
          single_journey: newRouteFields.singleJourney,
          ...(newRouteFields.isBodsRoute && {
            origin:                      newRouteFields.origin?.trim()      || null,
            destination:                 newRouteFields.destination?.trim() || null,
            service_registration_number: newRouteFields.serviceReg?.trim()  || null,
          }),
        })
        .select('id').single()
      if (error) return { error: error.message }
      resolvedRouteId = data.id
    }
  }

  if (timetableId === '__new__') {
    const { data, error } = await supabase.from('timetables')
      .insert({ route_id: resolvedRouteId, name: newTtName, direction: newDirection })
      .select('id').single()
    if (error) return { error: error.message }
    resolvedTimetableId = data.id
  }

  const { error: delErr } = await supabase
    .from('timetable_stops').delete().eq('timetable_id', resolvedTimetableId)
  if (delErr) return { error: delErr.message }

  // Offsets are relative to the timetable's first departure, not to whatever the first
  // stop's time happens to show — otherwise edits to that stop's time silently collapse
  // to offset 0 and revert on reload.
  const baseStr = departures[0]?.departure_time ?? '07:00:00'
  const base    = timeToMinutes(baseStr.slice(0, 5))

  const stopRows = []
  for (let i = 0; i < stopsToSave.length; i++) {
    const s = stopsToSave[i]
    let stopId = s.stop_id
    if (!stopId) {
      if (s.naptan_code) {
        // Reuse existing stops row if this NAPTAN stop was already created
        const { data: existing } = await supabase
          .from('stops').select('id').eq('naptan_code', s.naptan_code).maybeSingle()
        if (existing) {
          stopId = existing.id
        } else {
          const { data, error } = await supabase
            .from('stops').insert({ name: s.name, lat: s.lat, lon: s.lon, naptan_code: s.naptan_code })
            .select('id').single()
          if (error) return { error: `Stop "${s.name}": ${error.message}` }
          stopId = data.id
        }
      } else {
        const { data, error } = await supabase
          .from('stops').insert({ name: s.name, lat: s.lat, lon: s.lon }).select('id').single()
        if (error) return { error: `Stop "${s.name}": ${error.message}` }
        stopId = data.id
      }
    }
    const isTiming = s.stop_type === 'timing_point'
    stopRows.push({
      timetable_id:    resolvedTimetableId,
      stop_id:         stopId,
      sequence:        i + 1,
      stop_type:       s.stop_type,
      offset_standard: isTiming && s.time_std && base != null ? timeToMinutes(s.time_std) - base : null,
    })
  }

  const { error: insErr } = await supabase.from('timetable_stops').insert(stopRows)
  if (insErr) return { error: insErr.message }

  return { routeId: resolvedRouteId, timetableId: resolvedTimetableId, error: null }
}
