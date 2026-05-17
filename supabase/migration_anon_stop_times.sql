-- Migration: allow anon drivers to insert stop times for in-progress journeys
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-05-17
--
-- journey_stop_times was created before the anon INSERT grant was needed.
-- schema.sql grants anon only SELECT on all tables; this adds INSERT +
-- the matching RLS policy so the PWA can batch-upload stop times at trip end.

grant insert on public.journey_stop_times to anon;

create policy "anon_insert" on journey_stop_times
  for insert to anon
  with check (is_journey_in_progress(journey_id));
