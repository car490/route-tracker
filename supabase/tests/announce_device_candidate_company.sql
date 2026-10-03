-- supabase/tests/announce_device_candidate_company.sql
--
-- Verification for supabase/migration_announce_device_candidate_company_check.sql.
-- Same rollback pattern as get_or_create_manual_journey_vehicle.sql: every
-- block raises 'rollback' at the end so nothing it changes is kept.
-- Run with: psql <connection> -f supabase/tests/announce_device_candidate_company.sql
--
-- Why this exists (2026-10-03): the Dashboard can now choose an Announce Solo
-- sign's departures (SoloSetupModal.jsx). candidate_departure_ids is a uuid
-- array with no foreign key, and every company's departures are readable by
-- anon, so without this check a dashboard user could point their own sign at
-- another company's departure, and the sign would then start journeys on it.
--
-- Makes a second company with one departure if the database has only one
-- (dev today); everything is rolled back.

do $$
declare
  v_company_a uuid;
  v_company_b uuid;
  v_dep_a     uuid;
  v_dep_b     uuid;
  v_device    uuid;
  v_ids       uuid[];
begin
  select r.company_id, td.id into v_company_a, v_dep_a
    from timetable_departures td join timetables t on t.id = td.timetable_id join routes r on r.id = t.route_id
   order by r.company_id limit 1;
  select r.company_id, td.id into v_company_b, v_dep_b
    from timetable_departures td join timetables t on t.id = td.timetable_id join routes r on r.id = t.route_id
   where r.company_id <> v_company_a
   limit 1;
  if v_dep_b is null then
    -- One company only: make a second one with a departure of its own.
    insert into companies (name, operator_licence_number, traffic_area)
      values ('TEST other company', 'TEST-PX0000000', 'North East of England') returning id into v_company_b;
    with r as (insert into routes (company_id, service_code, journey_type) values (v_company_b, 'TESTX', array['Local Bus']) returning id),
         t as (insert into timetables (route_id, name, direction) select id, 'Test', 'Outbound' from r returning id)
    insert into timetable_departures (timetable_id, departure_time, vehicle_journey_code)
      select id, '07:00', 'TESTX-1' from t returning id into v_dep_b;
  end if;
  if v_dep_a is null then raise notice 'SKIP: no departures at all'; return; end if;

  insert into announce_devices (company_id, label) values (v_company_a, 'TEST candidate check') returning id into v_device;

  -- 1. Its own company's departure is accepted.
  update announce_devices set candidate_departure_ids = array[v_dep_a] where id = v_device;
  select candidate_departure_ids into v_ids from announce_devices where id = v_device;
  if v_ids is distinct from array[v_dep_a] then raise exception 'FAIL: own departure not saved'; end if;

  -- 2. Another company's departure is refused, alone or mixed in.
  begin
    update announce_devices set candidate_departure_ids = array[v_dep_a, v_dep_b] where id = v_device;
    raise exception 'FAIL: another company''s departure was accepted';
  exception when check_violation then null;
  end;

  -- 3. An id that is no departure at all is refused.
  begin
    update announce_devices set candidate_departure_ids = array[gen_random_uuid()] where id = v_device;
    raise exception 'FAIL: an unknown departure id was accepted';
  exception when check_violation then null;
  end;

  -- 4. A new row is checked too.
  begin
    insert into announce_devices (company_id, candidate_departure_ids) values (v_company_a, array[v_dep_b]);
    raise exception 'FAIL: a new device with another company''s departure was accepted';
  exception when check_violation then null;
  end;

  -- 5. Moving a device to another company re-checks its departures.
  begin
    update announce_devices set company_id = v_company_b where id = v_device;
    raise exception 'FAIL: a device kept departures of the company it left';
  exception when check_violation then null;
  end;

  -- 6. Clearing the list is always allowed, and other edits are not blocked.
  update announce_devices set candidate_departure_ids = '{}', label = 'TEST renamed' where id = v_device;
  update announce_devices set revoked_at = now() where id = v_device;

  raise notice 'PASS: announce_device_candidate_company';
  raise exception 'rollback';
exception when raise_exception then
  if sqlerrm <> 'rollback' then raise; end if;
end $$;
