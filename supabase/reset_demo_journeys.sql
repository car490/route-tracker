-- ============================================================
-- Resets the PSVAIR demo journeys back to a clean 'scheduled' state,
-- ready for another node scripts/demo-2up.mjs / demo-drive.mjs run.
--
-- Not automated (no service_role key in this project, and deliberately
-- not adding an anon-writable reset RPC just for demo convenience — see
-- memory/project_demo_journey_reset). Run this manually in the SQL editor
-- on dev (cgcbfgceputvdvhzrgio) before each demo run instead.
--
-- Covers both demo journeys unconditionally, so you don't need to know
-- (or ask) which one was last run — resetting one that wasn't touched is
-- a harmless no-op (0 rows).
--   - duty mode:   fixed journey id (S125S Weston -> Boston College)
--   - manual mode: today's row for the fixed departure id — manual mode
--                  creates/reuses a row keyed on (departure, date), so
--                  "today's row" is always the relevant one to reset
-- ============================================================

do $$
declare
  v_journey_id uuid;
begin
  -- duty mode
  delete from journey_events
    where journey_id = '2d2f26b1-31b9-434b-a858-e614a53599b5';
  update journeys
    set status = 'scheduled', started_at = null, completed_at = null
    where id = '2d2f26b1-31b9-434b-a858-e614a53599b5';

  -- manual mode — resolve today's row for the fixed departure, if it exists
  for v_journey_id in
    select id from journeys
    where timetable_departure_id = '338aebc6-8b5e-4a86-acad-a56bcf7a123b'
      and journey_date = current_date
  loop
    delete from journey_events where journey_id = v_journey_id;
    update journeys
      set status = 'scheduled', started_at = null, completed_at = null
      where id = v_journey_id;
  end loop;
end $$;
