// Phase 3 of docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md ("never synthesize"). Two
// small pieces shared between the Driver/Lite journey-start preflight check
// (driver/src/journeyAnnouncementPreflight.js) and both surfaces' live
// per-stop playback path (shared/announcementAudio.js's createAnnouncementPlayer,
// wired up in driver/src/announcements.js and announce/src/announceSpeech.js):
//
//   fetchConfirmedClipKeys - which of a set of clip keys has a rendered row
//     in announcement_clips right now (the plan doc's "hash-confirmed
//     locally" check, done as a live lookup rather than a local hash store --
//     see the Phase 3 plan's rationale: the service worker's fetch handler is
//     already network-first, so a fresh live check at journey-start time
//     delivers the real guarantee cheaply).
//   recordAnnouncementCoverageGap - persists a loud, queryable row to
//     announcement_coverage_gap instead of a console.warn, whenever either
//     call site finds a clip that isn't confirmed.
//
// Raw fetch, not supabase-js, matching service-worker.js's own
// fetchAnnouncementClipStorageUrls -- this module is imported by both the
// module-scoped service worker and plain browser code, so it can't assume a
// supabase-js client is already on the page.

import { SUPABASE_URL, SUPABASE_KEY } from '../driver/src/config.js';

const REQUEST_HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

// PostgREST's `in.(...)` filter is comma-separated with no per-value
// quoting needed here -- every key this repo generates (approach/<uuid>,
// departure/<uuid>, service/<slug>__<slug>, terminus, diversion) is built
// from slug()'d text with commas/parens already stripped, see
// shared/announcementAudio.js's clipKeysFor. Batched defensively so a very
// long route's key list can't build an unreasonably long query string.
const BATCH_SIZE = 200;

export async function fetchConfirmedClipKeys(keys) {
  const confirmed = new Set();
  if (!keys || !keys.length) return confirmed;

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    const filter = encodeURIComponent(`(${batch.join(',')})`);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/announcement_clips?select=key&key=in.${filter}`,
      { headers: REQUEST_HEADERS }
    );
    if (!res.ok) throw new Error(`announcement_clips lookup failed: ${res.status}`);
    const rows = await res.json();
    rows.forEach((row) => confirmed.add(row.key));
  }

  return confirmed;
}

// Never throws -- a failed alert write must never break journey start or
// live playback, same defensive posture as the fire-and-forget
// pushAnnounceDeviceState(...).catch(() => {}) calls throughout main.js.
//
// vehicleId/deviceId: exactly one is expected to be set. Driver/Lite always
// has a real vehicleId; an Announce Solo device running its own autopilot
// has no vehicle link at all (that's what makes it Solo rather than Lite),
// so it passes its own announce_devices.id as deviceId instead — see
// supabase/migration_announcement_coverage_gap.sql's table comment.
export async function recordAnnouncementCoverageGap({ journeyId, vehicleId, deviceId, driverId, missingKeys, stage }) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/announcement_coverage_gap`, {
      method: 'POST',
      headers: { ...REQUEST_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        journey_id: journeyId,
        vehicle_id: vehicleId || null,
        device_id: deviceId || null,
        driver_id: driverId || null,
        stage,
        missing_keys: missingKeys,
      }),
    });
  } catch (err) {
    console.warn('[announcementCoverage] failed to record coverage gap', err);
  }
}
