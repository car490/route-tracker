-- ============================================================
-- Migration: GPS tracking via journey_events
-- Run this in the Supabase SQL editor against the live database.
-- ============================================================

-- 1. Expand the event_type check to include GPS position fixes.
--    PostgreSQL names the constraint <table>_<column>_check by default.
ALTER TABLE journey_events
  DROP CONSTRAINT journey_events_event_type_check,
  ADD  CONSTRAINT journey_events_event_type_check
    CHECK (event_type IN ('incident', 'gps_fix'));

-- 2. Allow the anonymous role (driver PWA) to insert GPS fixes
--    for journeys that are currently in_progress.
--    Mirrors the pattern used for journey_stop_times.
CREATE POLICY "anon_gps_fix" ON journey_events
  FOR INSERT TO anon
  WITH CHECK (
    event_type = 'gps_fix'
    AND is_journey_in_progress(journey_id)
  );
