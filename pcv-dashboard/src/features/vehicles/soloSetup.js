// src/features/vehicles/soloSetup.js
//
// Pure logic for the Dashboard's Announce Solo set-up (SoloSetupModal.jsx):
// which departures a sign runs (announce_devices.candidate_departure_ids),
// how close in time (match_window_before_min/after_min) and how far from the
// first stop (terminus_radius_m) it may start one by itself.
//
// Solo starts a departure when the bus is near its first stop at about the
// right time (shared/scheduleAutopilot.js). That is only safe when no other
// service starts or ends at the same place, and when two departures the sign
// carries from one place are far enough apart in time to tell apart
// (docs/ANNOUNCE-PRODUCT-TIERS.md "Hard precondition"). findSoloWarnings()
// checks both against the company's own timetables; another operator's
// services at the same stop are not visible here, so the runbook still asks
// the installer to check on site (docs/SOLO-COMMISSIONING.md).

export const SOLO_DEFAULTS = { beforeMin: 15, afterMin: 30, radiusM: 150 }

// Ranges the form allows. Wider test-only values (docs/TESTING.md §17) are
// still set by SQL on dev, never from here.
export const SOLO_LIMITS = {
  beforeMin: { min: 0, max: 60 },
  afterMin:  { min: 0, max: 120 },
  radiusM:   { min: 50, max: 500 },
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] // days_of_week: 1 = Mon … 7 = Sun

export function formatDays(days) {
  const set = [...new Set(days ?? [])].filter(d => d >= 1 && d <= 7).sort((a, b) => a - b)
  if (set.length === 0) return 'No days'
  if (set.length === 7) return 'Every day'
  if (set.join() === '1,2,3,4,5') return 'Mon–Fri'
  return set.map(d => DAY_NAMES[d - 1]).join(', ')
}

function stopOf(s) {
  return s?.stop ? { id: s.stop.id, name: s.stop.name, lat: s.stop.lat, lon: s.stop.lon } : null
}

// One row of the departures query in SoloSetupModal.jsx → what the form and
// the warnings need.
export function toDepartureOption(row) {
  const route = row.timetable?.route ?? {}
  const stops = [...(row.timetable?.timetable_stops ?? [])].sort((a, b) => a.sequence - b.sequence)
  const time = String(row.departure_time ?? '').slice(0, 5)
  const service = route.service_code ?? '?'
  const name = `${service} ${time}`
  const parts = [`${name}${route.destination ? ` to ${route.destination}` : ''}`, formatDays(row.days_of_week)]
  if (row.school_term_time) parts.push('school term only')
  return {
    id: row.id,
    routeId: route.id ?? null,
    name,
    label: parts.join(' · '),
    minutes: toMinutes(time),
    days: row.days_of_week ?? [],
    firstStop: stopOf(stops[0]),
    lastStop: stopOf(stops[stops.length - 1]),
  }
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

function wholeNumber(v) {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isInteger(n) ? n : null
}

const FIELD_TEXT = {
  beforeMin: 'Minutes before the departure time',
  afterMin:  'Minutes after the departure time',
  radiusM:   'Distance from the first stop (metres)',
}

// Plain-English errors, one per bad field, in form order. Empty = valid.
export function validateSoloSettings(settings) {
  return Object.keys(SOLO_LIMITS).flatMap(key => {
    const n = wholeNumber(settings[key])
    const { min, max } = SOLO_LIMITS[key]
    return n === null || n < min || n > max
      ? [`${FIELD_TEXT[key]} must be a whole number from ${min} to ${max}.`]
      : []
  })
}

// Straight-line distance in metres (haversine).
function distanceM(a, b) {
  const R = 6371000
  const rad = d => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function near(a, b, radiusM) {
  return !!a && !!b && distanceM(a, b) <= radiusM
}

function ends(option) {
  return [option.firstStop, option.lastStop].filter(Boolean)
}

// Plain-English warnings for the chosen departures. Empty = nothing to flag.
export function findSoloWarnings(chosenIds, options, settings) {
  const radiusM = Number(settings.radiusM)
  const windowMin = Number(settings.beforeMin) + Number(settings.afterMin)
  const byId = new Map(options.map(o => [o.id, o]))
  const chosen = chosenIds.map(id => byId.get(id)).filter(Boolean)
  const warnings = []

  if (chosenIds.length === 0) {
    warnings.push('No departures are chosen, so this sign will never start a trip by itself.')
  }
  const missing = chosenIds.length - chosen.length
  if (missing > 0) {
    warnings.push(`${missing} chosen departure${missing === 1 ? ' is' : 's are'} no longer in your timetables and will be removed when you save.`)
  }

  // Another service starting or ending where a chosen departure starts or ends.
  const chosenSet = new Set(chosen.map(o => o.id))
  for (const mine of chosen) {
    const flagged = new Set()
    for (const other of options) {
      if (chosenSet.has(other.id) || other.routeId === mine.routeId || flagged.has(other.routeId)) continue
      const hit = ends(mine).find(a => ends(other).some(b => near(a, b, radiusM)))
      if (hit) {
        flagged.add(other.routeId)
        warnings.push(
          `${mine.name} starts or ends within ${radiusM} m of where service ${other.name.split(' ')[0]} starts or ends (${hit.name}). ` +
          'This sign could start the wrong trip when the bus is running that service.')
      }
    }
  }

  // Two chosen departures from one place, on a shared day, too close in time.
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      const a = chosen[i]
      const b = chosen[j]
      const sharedDay = a.days.some(d => b.days.includes(d))
      const closeInTime = a.minutes !== null && b.minutes !== null && Math.abs(a.minutes - b.minutes) < windowMin
      if (sharedDay && closeInTime && near(a.firstStop, b.firstStop, radiusM)) {
        warnings.push(
          `${a.name} and ${b.name} start from the same place within ${windowMin} minutes of each other. ` +
          'The sign cannot tell them apart; narrow the minutes before and after, or choose one.')
      }
    }
  }

  return warnings
}

// The Status column on the Announce Devices page.
export function describeDeviceStatus(device) {
  if (device.revoked_at) return 'Revoked'
  if (device.link_state === 'linked') return 'Linked to driver device (Lite)'
  const n = device.candidate_departure_ids?.length ?? 0
  if (n === 0) return 'Solo · no departures chosen'
  return `Solo · ${n} departure${n === 1 ? '' : 's'}`
}
