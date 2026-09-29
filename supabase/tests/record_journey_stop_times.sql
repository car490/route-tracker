-- supabase/tests/record_journey_stop_times.sql
--
-- Verification for record_journey_stop_times()
-- (supabase/migration_record_journey_stop_times.sql). Same rollback pattern as
-- reset_journey_rls.sql: every block raises 'rollback' at the end so nothing it
-- changes is kept.
-- Run with: psql <connection> -f supabase/tests/record_journey_stop_times.sql
--
-- Why this exists (found 2026-09-29): the Driver PWA and Announce Solo wrote
-- journey_stop_times directly with "skip duplicates" (PostgREST
-- resolution=ignore-duplicates / supabase-js upsert ignoreDuplicates). For the
-- anon role that becomes INSERT ... ON CONFLICT DO NOTHING, which Postgres
-- refuses unless the caller may also read the table (it may not), and Solo's
-- conflict target didn't match the partial unique index at all. No stop time
-- was stored on either environment since August. The function does the insert
-- itself, with the same checks the anon_insert policy made.
--
-- Fixtures are made inside each block (a journey set in_progress, its own
-- timetable's stops) and rolled back. SKIPs if there is no journey with a
-- timetable departure that has at least two stops.

-- 1. The Driver/Solo (anon, claim-less key) can record stop times for a journey
--    in progress; a second identical call records nothing (duplicates skipped).
do $$
declare
  v_journey uuid;
  v_rows    jsonb;
  v_first   int;
  v_second  int;
  v_stored  int;
begin
  select j.id,
         (select jsonb_agg(jsonb_build_object('journey_id', j.id, 'timetable_stop_id', ts.id,
                                              'arrived_at', now(), 'visit_status', 'visited'))
            from (select ts.id from timetable_stops ts
                    join timetable_departures td on td.timetable_id = ts.timetable_id
                   where td.id = j.timetable_departure_id
                   order by ts.sequence limit 2) ts)
    into v_journey, v_rows
    from journeys j
   where j.timetable_departure_id is not null
     and (select count(*) from timetable_stops ts join timetable_departures td on td.timetable_id = ts.timetable_id
           where td.id = j.timetable_departure_id) >= 2
   limit 1;
  if v_journey is null then
    raise notice 'SKIP: no journey with a timetable departure of 2+ stops';
    return;
  end if;
  update journeys set status = 'in_progress' where id = v_journey;
  delete from journey_stop_times where journey_id = v_journey;

  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

  select record_journey_stop_times(v_journey, v_rows) into v_first;
  select record_journey_stop_times(v_journey, v_rows) into v_second;

  reset role;
  select count(*) into v_stored from journey_stop_times where journey_id = v_journey;
  if v_first <> 2 or v_second <> 0 or v_stored <> 2 then
    raise exception 'FAIL: first call %, second call %, stored % (expected 2, 0, 2)', v_first, v_second, v_stored;
  end if;

  raise notice 'PASS: anon records stop times once; a retry adds nothing';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'Rolled back test changes cleanly'; else raise exception '%', sqlerrm; end if;
end $$;

-- 2. Rows are always stored under the journey named in the call, whatever
--    journey_id the rows themselves carry.
do $$
declare
  v_journey uuid;
  v_stop    uuid;
  v_other   uuid := gen_random_uuid();
  v_on_it   int;
begin
  select j.id, ts.id into v_journey, v_stop
    from journeys j
    join timetable_departures td on td.id = j.timetable_departure_id
    join timetable_stops ts on ts.timetable_id = td.timetable_id
   limit 1;
  if v_journey is null then raise notice 'SKIP: no journey with timetable stops'; return; end if;
  update journeys set status = 'in_progress' where id = v_journey;
  delete from journey_stop_times where journey_id = v_journey;

  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform record_journey_stop_times(v_journey, jsonb_build_array(jsonb_build_object(
    'journey_id', v_other, 'timetable_stop_id', v_stop, 'arrived_at', now(), 'visit_status', 'visited')));

  reset role;
  select count(*) into v_on_it from journey_stop_times where journey_id = v_journey and timetable_stop_id = v_stop;
  if v_on_it <> 1 then raise exception 'FAIL: row not stored under the called journey'; end if;

  raise notice 'PASS: rows are stored under the journey named in the call';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'Rolled back test changes cleanly'; else raise exception '%', sqlerrm; end if;
end $$;

-- 3. A duty token for a different journey is refused (same check as the
--    anon_insert policy: is_jwt_journey_allowed).
do $$
declare
  v_journey uuid;
  v_stop    uuid;
  v_refused boolean := false;
begin
  select j.id, ts.id into v_journey, v_stop
    from journeys j
    join timetable_departures td on td.id = j.timetable_departure_id
    join timetable_stops ts on ts.timetable_id = td.timetable_id
   limit 1;
  if v_journey is null then raise notice 'SKIP: no journey with timetable stops'; return; end if;
  update journeys set status = 'in_progress' where id = v_journey;

  set local role anon;
  perform set_config('request.jwt.claims',
    json_build_object('role', 'anon', 'journey_ids', json_build_array(gen_random_uuid()))::text, true);
  begin
    perform record_journey_stop_times(v_journey, jsonb_build_array(jsonb_build_object(
      'timetable_stop_id', v_stop, 'arrived_at', now(), 'visit_status', 'visited')));
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then raise exception 'FAIL: a token for another journey could record stop times'; end if;

  raise notice 'PASS: a duty token for a different journey is refused';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'Rolled back test changes cleanly'; else raise exception '%', sqlerrm; end if;
end $$;

-- 4. A journey that is not in progress (completed, or never started) is refused.
do $$
declare
  v_journey uuid;
  v_stop    uuid;
  v_refused boolean := false;
begin
  select j.id, ts.id into v_journey, v_stop
    from journeys j
    join timetable_departures td on td.id = j.timetable_departure_id
    join timetable_stops ts on ts.timetable_id = td.timetable_id
   limit 1;
  if v_journey is null then raise notice 'SKIP: no journey with timetable stops'; return; end if;
  update journeys set status = 'completed' where id = v_journey;

  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    perform record_journey_stop_times(v_journey, jsonb_build_array(jsonb_build_object(
      'timetable_stop_id', v_stop, 'arrived_at', now(), 'visit_status', 'visited')));
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then raise exception 'FAIL: stop times were recorded on a completed journey'; end if;

  raise notice 'PASS: a journey not in progress is refused';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'Rolled back test changes cleanly'; else raise exception '%', sqlerrm; end if;
end $$;

-- 5. Grants: anon may call it; dashboard users (authenticated) and PUBLIC may
--    not; and anon still cannot read journey_stop_times (the fix adds no read
--    access).
do $$
begin
  if not has_function_privilege('anon', 'public.record_journey_stop_times(uuid, jsonb)', 'EXECUTE') then
    raise exception 'FAIL: anon cannot execute record_journey_stop_times';
  end if;
  if has_function_privilege('authenticated', 'public.record_journey_stop_times(uuid, jsonb)', 'EXECUTE') then
    raise exception 'FAIL: authenticated can execute record_journey_stop_times';
  end if;
  if exists (select 1 from pg_policies where tablename = 'journey_stop_times' and cmd in ('SELECT', 'ALL') and 'anon' = any(roles)) then
    raise exception 'FAIL: anon has a read policy on journey_stop_times';
  end if;
  raise notice 'PASS: grants (anon only; no anon read policy)';
end $$;
