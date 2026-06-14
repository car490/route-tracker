-- ============================================================
-- RouteTracker v2  —  Seed data
-- Run AFTER schema.sql on a fresh Supabase project.
--
-- Contains only reference data needed for the app to function.
-- Operational data (routes, timetables, stops, timetable_stops,
-- timetable_departures) should be created via the dashboard
-- Route Planner and Schedule pages.
-- ============================================================


-- ── Journey types ─────────────────────────────────────────────────────────────

insert into public.journey_types (name, sort_order, requires_bods) values
  ('Local Bus',          1, true),
  ('Open Door Schools',  2, true),
  ('Contract Schools',   3, false),
  ('Private Hire',       4, false),
  ('Tour',               5, false),
  ('Other Contract',     6, false);


-- ── Company ───────────────────────────────────────────────────────────────────

insert into companies (id, name, trading_name, operator_licence_number, traffic_area, status) values
  ('00000000-0000-0000-0000-000000000001',
   'Phil Haines Coaches',
   'PHIL HAINES COACHES LTD',
   'PF1135558',
   'East of England',
   'active');
