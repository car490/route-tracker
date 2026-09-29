// src/stopTimesUpload.js
//
// Uploads a trip's arrival times through record_journey_stop_times()
// (supabase/migration_record_journey_stop_times.sql). Safe to call more than
// once for the same rows: the function skips rows already stored for that
// journey and stop. Needed because a queued trip (main.js's
// enqueuePendingTrip) may retry an upload that already succeeded once, if the
// failure that queued it was on the complete_journey call that follows.
//
// Not a direct POST to journey_stop_times: "skip duplicates" on that table is
// refused for anon (HTTP 401), which is why no stop time was stored on
// production from 14 July to 29 September 2026.
//
// fetchFn is supabaseApi.js's sbFetch, passed in so this file can be tested
// without config.js (which reads the page's location at import).

import { log } from '../../shared/logger.js';

export { isRefusal } from '../../shared/uploadRefusal.js';

export async function uploadStopTimes(fetchFn, journeyId, rows) {
  log('info', `Upload payload (${rows.length} rows): ${JSON.stringify(rows)}`);
  if (!rows.length) return { ok: true, count: 0 };
  const res = await fetchFn('/rest/v1/rpc/record_journey_stop_times', {
    method: 'POST',
    body: JSON.stringify({ p_journey_id: journeyId, p_rows: rows }),
  });
  const responseBody = res.ok ? '' : await res.text().catch(() => '(could not read response)');
  if (!res.ok) log('error', `Upload failed HTTP ${res.status}: ${responseBody}`);
  return { ok: res.ok, status: res.status, count: rows.length, responseBody };
}

// Tells ops the server refused this trip's stop times
// (supabase/migration_stop_time_upload_problem.sql): the dashboard's Journeys
// page shows it until a later upload is accepted. Never throws; resolves true
// if the report was taken.
export async function reportUploadProblem(fetchFn, { journeyId, httpStatus, reason, rowCount }) {
  try {
    const res = await fetchFn('/rest/v1/rpc/report_stop_time_upload_problem', {
      method: 'POST',
      body: JSON.stringify({
        p_journey_id: journeyId,
        p_source: 'driver',
        p_http_status: httpStatus ?? null,
        p_reason: String(reason ?? '').slice(0, 500),
        p_row_count: rowCount ?? 0,
      }),
    });
    if (!res.ok) log('warn', `Could not report the refused upload to the office: HTTP ${res.status}`);
    return res.ok;
  } catch (err) {
    log('warn', `Could not report the refused upload to the office: ${err.message}`);
    return false;
  }
}
