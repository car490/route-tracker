// mele-server/scheduleCachePath.mjs
//
// Where server.mjs writes its diagnostic copy of the last pushed schedule
// (served at /api/schedule; nothing reads it back — the sign always waits
// for the Driver to push again). On the Controller the systemd unit sets
// SCHEDULE_CACHE_PATH to its RAM directory (/run/coachmate, RuntimeDirectory=),
// because the system disk is read-only there (docs/HARDWARE.md "Sudden power
// loss / ignition-off"). Anywhere else — a laptop, a test — it stays next to
// server.mjs, as it always has.
import path from 'node:path';

export function resolveScheduleCachePath(env, serverDir) {
  return env.SCHEDULE_CACHE_PATH || path.join(serverDir, 'schedule-cache.json');
}
