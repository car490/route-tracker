import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Driver token is read lazily (not at module load) so this module has no
// top-level `window` access — it can be imported from a non-browser
// context (e.g. Jest, which runs in Node) without throwing.
function driverToken() {
  return typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('token')
    : null;
}

export async function sbFetch(path, opts = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${driverToken() || SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      ...(opts.headers ?? {}),
    },
  });
}

export async function rpc(fn, args) {
  const res = await sbFetch(`/rest/v1/rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `RPC ${fn}: ${res.status}`);
  }
  return res.json();
}

export async function fetchStopsForDeparture(departureId) {
  const res = await sbFetch(
    `/rest/v1/schedule_view` +
    `?departure_id=eq.${departureId}` +
    `&select=timetable_stop_id,stop_type,scheduled_time,display_name,lat,lon,sequence,psvair_in_scope` +
    `&order=sequence`
  );
  if (!res.ok) throw new Error(res.status);
  const rows = await res.json();
  return {
    stops: rows.map(r => ({
      name: r.display_name,
      lat: r.lat,
      lon: r.lon,
      time: r.scheduled_time.substring(0, 5),
      stop_type: r.stop_type,
      timetable_stop_id: r.timetable_stop_id,
    })),
    psvairInScope: rows[0]?.psvair_in_scope ?? false,
  };
}
