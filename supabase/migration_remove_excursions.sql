-- Remove excursion-specific DB objects.
-- Excursion journey type is superseded by route_type on the routes table.
-- journey_waypoints is retained — it serves Private Hire, Tour, and Other Contract journeys.

-- 1. Delete all Excursion journeys (cascades to journey_waypoints, journey_events,
--    journey_stop_times, and excursion_passengers via ON DELETE CASCADE).
delete from public.journeys where journey_type = 'Excursion';

-- 2. Drop the excursion_passengers table (RLS policy and index drop with it).
drop table if exists public.excursion_passengers;
