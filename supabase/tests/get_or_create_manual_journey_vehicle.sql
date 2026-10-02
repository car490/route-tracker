-- supabase/tests/get_or_create_manual_journey_vehicle.sql
--
-- Verification for supabase/migration_journey_vehicle_fill_in.sql. Same
-- rollback pattern as record_journey_stop_times.sql: every block raises
-- 'rollback' at the end so nothing it changes is kept.
-- Run with: psql <connection> -f supabase/tests/get_or_create_manual_journey_vehicle.sql
--
-- Why this exists (found 2026-10-02): on 1 October Announce Solo started the
-- 07:27 S125S before the Driver did and sent no bus, so the journey was stored
-- with none; the Driver's SN06JVZ was then ignored because the journey
-- already existed. A journey with no bus now takes the bus from whichever
-- device asks for it next; a bus already set is never replaced.
--
-- Fixtures (a vehicle, today's journey) are made inside each block and rolled
-- back. SKIPs if there is no timetable departure that runs today.

-- 1. No bus yet: the next caller's bus is filled in, on the same journey.
--    A bus already set is never replaced; a call with no bus changes nothing.
do $$
declare
  v_dep      uuid;
  v_company  uuid;
  v_bus_a    uuid;
  v_bus_b    uuid;
  v_first    uuid;
  v_second   uuid;
  v_bus      uuid;
begin
  select td.id, r.company_id into v_dep, v_company
    from timetable_departures td join timetables t on t.id = td.timetable_id join routes r on r.id = t.route_id
   where extract(isodow from current_date)::int = any(td.days_of_week)
     and not td.school_term_time
     and (td.valid_from is null or td.valid_from <= current_date)
     and (td.valid_to is null or td.valid_to >= current_date)
   limit 1;
  if v_dep is null then raise notice 'SKIP: no departure runs today'; return; end if;
  delete from journeys where timetable_departure_id = v_dep and journey_date = current_date;
  insert into vehicles (company_id, registration, vehicle_type, fuel_type) values (v_company, 'TEST A', 'Single Decker Bus', 'Diesel') returning id into v_bus_a;
  insert into vehicles (company_id, registration, vehicle_type, fuel_type) values (v_company, 'TEST B', 'Single Decker Bus', 'Diesel') returning id into v_bus_b;

  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

  -- Solo starts first, with no bus (the old behaviour).
  select journey_id into v_first from get_or_create_manual_journey(v_dep, current_date, null, gen_random_uuid());
  -- A call with no bus leaves it empty.
  perform get_or_create_manual_journey(v_dep, current_date, null, gen_random_uuid());
  reset role;
  select vehicle_id into v_bus from journeys where id = v_first;
  if v_bus is not null then raise exception 'FAIL: a bus appeared from a call that sent none'; end if;

  -- The Driver asks next, with bus A: filled in, same journey.
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  select journey_id into v_second from get_or_create_manual_journey(v_dep, current_date, v_bus_a, gen_random_uuid());
  reset role;
  select vehicle_id into v_bus from journeys where id = v_first;
  if v_second <> v_first then raise exception 'FAIL: a second journey was made for the same departure'; end if;
  if v_bus is distinct from v_bus_a then raise exception 'FAIL: the missing bus was not filled in (got %)', v_bus; end if;

  -- A later caller with bus B does not replace it.
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform get_or_create_manual_journey(v_dep, current_date, v_bus_b, gen_random_uuid());
  reset role;
  select vehicle_id into v_bus from journeys where id = v_first;
  if v_bus is distinct from v_bus_a then raise exception 'FAIL: a bus already set was replaced'; end if;

  raise notice 'PASS: a missing bus is filled in by the next caller, never replaced';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'Rolled back test changes cleanly'; else raise exception '%', sqlerrm; end if;
end $$;

-- 2. No fill-in where it isn't wanted: a duty token for a different journey,
--    or a journey that has finished or been cancelled. The call itself still
--    returns the journey, exactly as before.
do $$
declare
  v_dep      uuid;
  v_company  uuid;
  v_bus      uuid;
  v_journey  uuid;
  v_status   text;
  v_got      uuid;
begin
  select td.id, r.company_id into v_dep, v_company
    from timetable_departures td join timetables t on t.id = td.timetable_id join routes r on r.id = t.route_id
   where extract(isodow from current_date)::int = any(td.days_of_week)
     and not td.school_term_time
     and (td.valid_from is null or td.valid_from <= current_date)
     and (td.valid_to is null or td.valid_to >= current_date)
   limit 1;
  if v_dep is null then raise notice 'SKIP: no departure runs today'; return; end if;
  delete from journeys where timetable_departure_id = v_dep and journey_date = current_date;
  insert into vehicles (company_id, registration, vehicle_type, fuel_type) values (v_company, 'TEST A', 'Single Decker Bus', 'Diesel') returning id into v_bus;
  select journey_id into v_journey from get_or_create_manual_journey(v_dep, current_date, null, gen_random_uuid());

  -- A duty token that does not cover this journey.
  set local role anon;
  perform set_config('request.jwt.claims',
    json_build_object('role', 'anon', 'journey_ids', json_build_array(gen_random_uuid()))::text, true);
  select journey_id into v_got from get_or_create_manual_journey(v_dep, current_date, v_bus, gen_random_uuid());
  reset role;
  if v_got <> v_journey then raise exception 'FAIL: the call no longer returns the existing journey'; end if;
  if (select vehicle_id from journeys where id = v_journey) is not null then
    raise exception 'FAIL: a duty token for another journey set its bus';
  end if;

  -- Finished (completed) journeys are left alone. A cancelled one is not
  -- returned at all (a new journey is made), so it is never touched either.
  update journeys set status = 'in_progress', started_at = now() - interval '1 hour' where id = v_journey;
  update journeys set status = 'completed', completed_at = now() where id = v_journey;
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform get_or_create_manual_journey(v_dep, current_date, v_bus, gen_random_uuid());
  reset role;
  if (select vehicle_id from journeys where id = v_journey) is not null then
    raise exception 'FAIL: a completed journey had its bus changed';
  end if;

  raise notice 'PASS: no fill-in for another journey''s duty token or a completed journey';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'Rolled back test changes cleanly'; else raise exception '%', sqlerrm; end if;
end $$;
