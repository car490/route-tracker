// Builds journey_stop_times insert rows from a tracker's per-stop state.
//
// Shared by the Driver PWA (driver/src/main.js, batch-uploaded at trip end)
// and BusOps Announce Solo (announce/src/announceSoloAutopilot.js) -- both
// drive the same shared/gps.js tracking engine, so stopStates has the same
// shape either way (see announceGps.js's header comment). Extracted here
// because Solo previously never wrote this table at all: it created,
// started and completed journeys on its own, but produced no per-stop
// arrival/lateness record for ops to review -- every Solo-tracked journey
// was invisible to PSVAIR compliance reporting. Moving this one pure
// function here, rather than duplicating it, keeps the row shape identical
// across both writers.
const UPLOADABLE_STOP_STATUSES = new Set(['arrived', 'departed', 'skipped_signal', 'skipped_detour']);

export function buildStopTimeRows(journeyId, stopStates, stops) {
  const rows = [];
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const s = stopStates[i];
    if (!stop.timetable_stop_id || !s || !UPLOADABLE_STOP_STATUSES.has(s.status)) continue;
    rows.push({
      journey_id: journeyId,
      timetable_stop_id: stop.timetable_stop_id,
      arrived_at: s.arrivedAt ? s.arrivedAt.toISOString() : null,
      visit_status: s.status === 'skipped_signal' || s.status === 'skipped_detour' ? s.status : 'visited',
    });
  }
  return rows;
}
