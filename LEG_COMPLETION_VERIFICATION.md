# Leg-Completion Consumption Verification

## Questions checked

1. How does the current leg-completion / visit-status logic consume `journey_events` rows — per-row
   incrementally, or as a batch read at a single point in time?
2. What triggers a leg or journey to be marked complete today — a specific event from the PWA, a
   geofence/turnaround condition, a timeout, or something else?
3. Does anything other than `onGpsFix` write to `journey_events`? List each distinct `event_type`,
   what writes it, and when.
4. Is there an existing incremental state machine, or is leg-completion computed statelessly on
   each read?

---

## Result

**Q1.** `journey_events` rows are **never read** by any leg-completion or visit-status logic.
The entire stop-arrival and skip-status computation runs in-memory inside the browser process
(`src/gps.js`). `gps_fix` rows are written fire-and-forget to `journey_events` and never read
back. The only server-side consumers of `journey_events` are the ops dashboard's live-tracking
map (real-time display only) and the journey-report incident list (read-only ops view). Neither
affects stop or leg state.

**Q2.** Stop-level visit-status (`visited`, `skipped_signal`, `skipped_detour`) is determined
entirely in-browser by the GPS `watchPosition` callback in `src/gps.js`. Arrival is recorded
when the vehicle enters a 50 m geofence around the next scheduled stop; skip status is set when
the forward-geofence matcher (`src/geofence.js`) finds the vehicle has rejoined a later stop.
Journey completion is triggered by the driver pressing the "End trip and upload stop times"
button (`btn-complete`) in `src/main.js`. That button handler (a) batch-uploads all in-memory
`arrivals` data to `journey_stop_times` via a single HTTP POST, then (b) calls the
`complete_journey` RPC which sets `journeys.status = 'completed'` and `journeys.completed_at`.

**Q3.** Exactly two event types exist and exactly two code paths write to `journey_events`:
`gps_fix` (written by `onGpsFix` in `src/gps.js`, throttled to one INSERT per 30 seconds
throughout the journey) and `incident` (written by the incident-submit click handler in
`src/main.js` when the driver files a report). No other event types or write paths exist;
the schema `CHECK` constraint on `event_type` enforces this.

**Q4.** The state machine is **incremental and stateful**, but the state is held **entirely
in-memory** in the browser process. There is no server-side incremental state machine.
Five module-level variables in `src/gps.js` carry state across GPS pings: `nextStopIndex`,
`arrivals`, `atStop`, `pendingMatch`, and `lastGpsUploadMs`. None of these are persisted to
Supabase between fixes. If the PWA process is killed and restarted, all in-memory state is lost
and there is no mechanism to reconstruct it from `journey_events`.

---

## Evidence from implementation

**Finding 1 — gps_fix writes are throttled, per-fix, and fire-and-forget**
- File: `src/gps.js`, lines 108–119
- On every `watchPosition` callback, if at least 30 seconds have elapsed since the last upload,
  `onGpsFix` is called with the current position. The call is fire-and-forget (no `await`, no
  error handling in the caller). `lastGpsUploadMs` is updated immediately so the throttle is
  maintained even if the network request fails.

**Finding 2 — onGpsFix posts directly to `journey_events` REST endpoint**
- File: `src/main.js`, lines 224–238
- Inside `runTracker()`, `onGpsFix` is a closure that calls `sbFetch('/rest/v1/journey_events', { method: 'POST', … })` with `event_type: 'gps_fix'`. `.catch(() => {})` swallows errors so the GPS loop is never blocked.

**Finding 3 — incident event posted to same table by submit handler**
- File: `src/main.js`, lines 269–289
- The `incident-submit` button's `onclick` handler calls `sbFetch('/rest/v1/journey_events', { method: 'POST', … })` with `event_type: 'incident'`. This is the only other code path writing to `journey_events`.

**Finding 4 — schema constrains event_type to exactly two values**
- File: `supabase/schema.sql`, lines 517–518
- `CHECK (event_type IN ('incident', 'gps_fix'))` is the only constraint; no other event types
  are possible.

**Finding 5 — visit-status assignment is in-memory in gps.js, not derived from journey_events**
- File: `src/gps.js`, lines 12–17 (state declarations), 71–76 (arrival recording),
  93–105 (skip/detour recording)
- `arrivals[nextStopIndex] = arrivalTime` (Date object) records a normal visit. For skipped
  stops, `arrivals[k] = { status: match.status }` records 'skipped_signal' or 'skipped_detour'.
  These values are accumulated in the `arrivals` array in memory throughout the journey.

**Finding 6 — skip status is computed by geofence.js, not by reading journey_events**
- File: `src/geofence.js`, lines 28–48; `src/gps.js`, lines 87–105
- `findForwardMatch()` searches the in-memory schedule array forward from the missed stop.
  It requires two consecutive GPS pings within 50 m of the same later stop before confirming
  a skip (`count >= 2`, geofence.js line 34). `pendingMatch` carries the debounce state between
  pings. No database read is involved.

**Finding 7 — stop times are batch-uploaded at journey end**
- File: `src/main.js`, lines 91–115 (`uploadStopTimes`), lines 292–318 (`btn-complete` handler)
- When the driver presses "End trip", `uploadStopTimes()` iterates `arrivalsRef` (the accumulated
  in-memory arrivals) and constructs a JSON array of rows, then POSTs the entire batch to
  `/rest/v1/journey_stop_times` in a single request. Individual stop arrivals are never written
  incrementally to `journey_stop_times` during the journey.

**Finding 8 — complete_journey RPC sets journeys.status = 'completed'**
- File: `supabase/schema.sql`, lines 841–850; `src/main.js`, line 300
- The SQL function `complete_journey(p_journey_id)` runs `UPDATE journeys SET status = 'completed',
  completed_at = now() WHERE id = p_journey_id AND status = 'in_progress'`. It is called by
  `main.js` immediately after `uploadStopTimes()` returns, also at journey end.

**Finding 9 — LiveTracking.jsx subscribes to journey_events for display only**
- File: `dashboard/src/features/tracking/LiveTracking.jsx`, lines 79–113
- The ops dashboard subscribes to Supabase Realtime INSERT events on `journey_events` filtered
  to `event_type = 'gps_fix'`. Each incoming row moves a Leaflet marker on the map. No stop
  state, leg state, or visit_status is updated by this handler.

**Finding 10 — JourneysPage.jsx reads journey_events for incident display only**
- File: `dashboard/src/features/journeys/JourneysPage.jsx`, lines 107–111
- The ops journey-report fetches `journey_events` filtered to `event_type = 'incident'` for
  display in the report view. No stop or leg state is derived from these rows.

**Finding 11 — no trigger on journey_events in schema**
- File: `supabase/schema.sql`, lines 585–688
- Three triggers exist in the schema: `trg_protect_last_super_user` (on `employees`),
  `trg_protect_vehicle_status` (on `vehicles`), and `trg_compute_stop_time_variance`
  (on `journey_stop_times`). There is no trigger on `journey_events`. A `gps_fix` INSERT
  fires nothing server-side.

**Finding 12 — trg_compute_stop_time_variance fires on journey_stop_times insert, not journey_events**
- File: `supabase/schema.sql`, lines 628–687
- This trigger computes `arrival_variance_seconds`, `departure_variance_seconds`, `is_early_arrival`,
  and `is_early_departure` on each row inserted into `journey_stop_times`. It reads the scheduled
  timetable data at insert time. It fires once per stop, at batch-upload time (journey end), not
  during the journey.

---

## Conclusion

BH-004's assumption — "PWA writes are a single batch at journey end, BusHub introduces real-time
streaming as a new concept" — is **partially incorrect**.

**GPS position data (`journey_events`, `event_type = 'gps_fix'`) is already written in real
time**, one INSERT per 30-second throttle interval throughout the journey. Real-time streaming of
GPS positions is not a new concept introduced by BusHub; it is the current behaviour. The
SIRI_VM_VERIFICATION finding is confirmed by the code.

**Stop visit data (`journey_stop_times`, including `visit_status`) is written as a single batch
at journey end**. That part of the assumption is correct. The `visit_status` values
('visited', 'skipped_signal', 'skipped_detour') are computed in-memory by the client-side state
machine in `src/gps.js` and uploaded only when the driver presses "End trip".

There is **no server-side consumer of `journey_events` rows for leg or stop state**. No trigger,
no subscription, and no scheduled function reads `gps_fix` rows to update leg progress. Any
BH-004 design that depends on `gps_fix` rows being processed server-side to infer stop
completion must introduce that processing as new work — it does not exist today.
