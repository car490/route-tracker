// Run at boot (before/alongside the Pi joins its own AP) while the Pi still
// has a route to the internet — e.g. depot WiFi each morning. Fetches the
// current schedule_view rows and caches them locally so pi-server/server.mjs
// can serve /api/schedule to the Fire HD all day with no live Supabase
// dependency. If it can't reach Supabase in the retry window (already
// offline, missed the window), it leaves yesterday's cache alone rather
// than wiping it — a stale schedule beats no schedule.
//
// Run manually: node sync-schedule.mjs
// Or as a systemd oneshot before pi-server.service starts (see DEPLOY.md).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, 'schedule-cache.json');

// Same anon/publishable keys as src/config.js — safe to duplicate here (see
// that file's comment on why: RLS gates access, not the key itself). Kept
// separate on purpose rather than importing src/config.js, which assumes a
// browser `window` global this script doesn't have.
const SUPABASE = {
  dev:  { url: 'https://cgcbfgceputvdvhzrgio.supabase.co', key: 'sb_publishable_LZVX8fASyDG8UtMp3eeRJQ_SBxpCa54' },
  prod: { url: 'https://nwhayupsvcelyiwltdqo.supabase.co', key: 'sb_publishable_gij_rPjr2EJrcv0W9sU-Ow_C3nNqGcn' },
};
const ENV = process.env.SUPABASE_ENV === 'dev' ? 'dev' : 'prod';
const SUPABASE_URL = process.env.SYNC_SUPABASE_URL || SUPABASE[ENV].url;
const SUPABASE_KEY = process.env.SYNC_SUPABASE_KEY || SUPABASE[ENV].key;

const SCHEDULE_QUERY =
  '?select=timetable_stop_id,stop_type,scheduled_time,display_name,lat,lon,service_code,timetable_name,direction,departure_id,departure_time,sequence,psvair_in_scope' +
  '&order=service_code,departure_time,sequence';

const RETRY_INTERVAL_MS = Number(process.env.SYNC_RETRY_INTERVAL_MS) || 10_000;
const RETRY_WINDOW_MS = Number(process.env.SYNC_RETRY_WINDOW_MS) || 5 * 60_000; // give up after 5 minutes of no connectivity by default

async function fetchScheduleRows() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/schedule_view${SCHEDULE_QUERY}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`schedule_view ${res.status}`);
  return res.json();
}

async function writeCache(rows) {
  // Atomic write: temp file + rename, so pi-server never reads a half-written file mid-request.
  const tmpPath = `${CACHE_PATH}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(rows), 'utf8');
  await fs.rename(tmpPath, CACHE_PATH);
}

async function main() {
  console.log(`[sync] fetching schedule from ${ENV} (${SUPABASE_URL})`);
  const deadline = Date.now() + RETRY_WINDOW_MS;

  while (Date.now() < deadline) {
    try {
      const rows = await fetchScheduleRows();
      await writeCache(rows);
      console.log(`[sync] wrote ${rows.length} row(s) to ${CACHE_PATH}`);
      return;
    } catch (err) {
      console.warn(`[sync] attempt failed: ${err.message} — retrying in ${RETRY_INTERVAL_MS / 1000}s`);
      await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
    }
  }

  const hadCache = await fs.access(CACHE_PATH).then(() => true, () => false);
  console.warn(hadCache
    ? `[sync] gave up after ${RETRY_WINDOW_MS / 60000}min with no connectivity — keeping existing cache`
    : `[sync] gave up after ${RETRY_WINDOW_MS / 60000}min with no connectivity and no existing cache — /api/schedule will be empty`);
}

main();
