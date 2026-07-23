# SIRI-VM Position Source Verification

## Question checked
Whether the current SIRI-VM slice implementation already reads from a generic canonical position source, or has PWA-specific assumptions baked in.

## Result
There is no actual SIRI-VM slice/endpoint implementation in this repository yet.

Current live-position flow is PWA-centric and writes/reads directly via `journey_events` with `event_type = 'gps_fix'`, not through a generic canonical position abstraction.

## Evidence from implementation

1. **Driver PWA writes GPS fixes directly to `journey_events`**  
   File: `/home/runner/work/route-tracker/route-tracker/src/main.js`  
   Relevant lines: `226-236`  
   - `onGpsFix` posts to `/rest/v1/journey_events`
   - Payload includes:
     - `event_type: 'gps_fix'`
     - `lat`, `lon`, `occurred_at`
     - `metadata` with speed/accuracy

2. **Schema comments describe `gps_fix` as from the driver PWA**  
   File: `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql`  
   Relevant lines: `509-510`  
   - Explicitly states `'gps_fix'` is a periodic GPS position from the **driver PWA**.

3. **Anon insert policy is driver/PWA-oriented**  
   File: `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql`  
   Relevant lines: `1135-1142`  
   - Policy `anon_gps_fix` permits anon inserts for `event_type = 'gps_fix'`
   - Requires in-progress journey + JWT journey scope checks.

4. **Dashboard live tracking reads directly from `journey_events` GPS fix stream**  
   File: `/home/runner/work/route-tracker/route-tracker/dashboard/src/features/tracking/LiveTracking.jsx`  
   Relevant lines: `79-88`  
   - Subscribes to realtime inserts on table `journey_events`
   - Filter: `event_type=eq.gps_fix`

## Conclusion
The current implementation does **not** read from a generic canonical position source.  
It currently has assumptions tied to the PWA ingestion path (`journey_events.gps_fix`).
