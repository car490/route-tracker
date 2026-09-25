// driver/src/autostart/candidates.js
//
// The departures automatic mode can match against: every Local Bus
// departure the company runs (owner's choice, 2026-09-27: no per-vehicle
// commissioning, unlike Announce Solo's candidate_departure_ids). The same
// set the manual picker offers (supabaseApi.js fetchAvailableServices), in
// the candidate shape shared/scheduleAutopilot.js matches on.
//
// Reads (anon, all already granted): schedule_view (paged: it has one row
// per stop, easily past PostgREST's 1000-row cap), term_dates, and
// service_exceptions. service_exceptions has no anon RLS policy, so the
// Driver usually gets none back; that is accepted, not widened: a departure
// cancelled for the day is still refused server-side by
// get_or_create_manual_journey, and the controller treats that refusal as
// "don't offer this one again today".
//
// The last good result is cached on the device (public timetable data only)
// so automatic mode still works offline mid-shift.

export const PAGE_SIZE = 1000;
export const CACHE_KEY = 'busops.driver.autostart.data';

const SCHEDULE_SELECT =
  'departure_id,service_code,timetable_name,departure_time,journey_type,' +
  'display_name,lat,lon,sequence,days_of_week,school_term_time';

export function buildCandidates(scheduleRows, exceptionRows = []) {
  const firstStop = new Map();
  for (const r of scheduleRows) {
    if (!r.journey_type?.includes('Local Bus')) continue;
    const current = firstStop.get(r.departure_id);
    if (!current || r.sequence < current.sequence) firstStop.set(r.departure_id, r);
  }

  const exceptions = new Map();
  for (const e of exceptionRows) {
    if (!exceptions.has(e.timetable_departure_id)) {
      exceptions.set(e.timetable_departure_id, { removedDates: [], addedDates: [] });
    }
    const bucket = exceptions.get(e.timetable_departure_id);
    (e.exception_type === 'removed' ? bucket.removedDates : bucket.addedDates).push(e.exception_date);
  }

  const candidates = [];
  for (const r of firstStop.values()) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    const ex = exceptions.get(r.departure_id) ?? { removedDates: [], addedDates: [] };
    candidates.push({
      departureId: r.departure_id,
      serviceCode: r.service_code,
      label: r.timetable_name,
      departureTime: String(r.departure_time).substring(0, 5),
      firstStopName: r.display_name,
      firstStopLat: r.lat,
      firstStopLon: r.lon,
      daysOfWeek: r.days_of_week ?? [],
      schoolTermTime: !!r.school_term_time,
      removedDates: ex.removedDates,
      addedDates: ex.addedDates,
    });
  }
  return candidates;
}

async function fetchSchedulePages(fetchJson) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchJson(
      `/rest/v1/schedule_view?select=${SCHEDULE_SELECT}` +
      `&order=departure_id,sequence&limit=${PAGE_SIZE}&offset=${offset}`
    );
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function readCache(storage) {
  try {
    const raw = storage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(storage, data) {
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Blocked or full storage: automatic mode still works while online.
  }
}

// fetchJson(path) resolves to parsed JSON or throws (main.js wraps sbFetch).
export async function fetchCandidateData({ fetchJson, storage = globalThis.localStorage }) {
  let scheduleRows;
  try {
    scheduleRows = await fetchSchedulePages(fetchJson);
  } catch (err) {
    const cached = readCache(storage);
    if (cached) return cached;
    throw err;
  }
  const [exceptionRows, termDateRanges] = await Promise.all([
    fetchJson('/rest/v1/service_exceptions?select=timetable_departure_id,exception_date,exception_type').catch(() => []),
    fetchJson('/rest/v1/term_dates?select=start_date,end_date').catch(() => []),
  ]);
  const data = { candidates: buildCandidates(scheduleRows, exceptionRows), termDateRanges };
  writeCache(storage, data);
  return data;
}
