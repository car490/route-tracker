-- ============================================================
-- Removes the orphaned "Phil Haines Coaches Depot" row from public.stops.
--
-- Investigated 2026-07-30: this single row (id
-- 00000000-0000-0000-0001-000000000000, is_depot = true) is not referenced
-- by any timetable_stops or journey_waypoints row on dev or production, and
-- is not present in seed.sql. The actual depot padding used at the start/
-- end of every route in the app is a hardcoded JS constant instead — see
-- `DEPOT` in src/main.js and src/onboard.js (name/lat/lon match this row
-- exactly) and `withDepotStops()` in both files — so this DB row has never
-- actually been used by the running app. Safe to remove.
--
-- The DO block re-checks both FK tables at delete time (not just relying
-- on the investigation above), and raises rather than deleting if anything
-- now references it — in case data has changed since this was written.
-- ============================================================

do $$
declare
  v_stop_id uuid := '00000000-0000-0000-0001-000000000000';
  v_refs int;
begin
  select count(*) into v_refs from timetable_stops where stop_id = v_stop_id;
  if v_refs > 0 then
    raise exception 'Aborting: % timetable_stops row(s) still reference %', v_refs, v_stop_id;
  end if;

  select count(*) into v_refs from journey_waypoints where stop_id = v_stop_id;
  if v_refs > 0 then
    raise exception 'Aborting: % journey_waypoints row(s) still reference %', v_refs, v_stop_id;
  end if;

  delete from stops where id = v_stop_id and name = 'Phil Haines Coaches Depot';

  if not found then
    raise notice 'No matching row deleted — already removed, or id/name no longer match.';
  end if;
end $$;
