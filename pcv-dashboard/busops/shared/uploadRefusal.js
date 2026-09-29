// shared/uploadRefusal.js
//
// Tells a refusal (the server answered and said no) from a failure that will
// sort itself out (no signal, a timeout, rate limiting, a server fault).
// Retrying a refused request won't change the answer, so someone has to be
// told; see supabase/migration_stop_time_upload_problem.sql. Used by the
// Driver PWA (driver/src/stopTimesUpload.js) and Announce Solo
// (announce/src/soloTripQueue.js).

const TEMPORARY_4XX = new Set([408, 429]);

export function isRefusal(status) {
  return Number.isInteger(status) && status >= 400 && status < 500 && !TEMPORARY_4XX.has(status);
}
