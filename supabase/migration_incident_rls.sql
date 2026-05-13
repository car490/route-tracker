-- Migration: allow anon drivers to insert incidents for in-progress journeys
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-05-13

create policy "anon_incident" on journey_events
  for insert to anon
  with check (
    event_type = 'incident'
    and is_journey_in_progress(journey_id)
  );
