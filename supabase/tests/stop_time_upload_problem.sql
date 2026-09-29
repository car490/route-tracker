-- supabase/tests/stop_time_upload_problem.sql
--
-- Verification for report_stop_time_upload_problem() and the
-- stop_time_upload_problem table (supabase/migration_stop_time_upload_problem.sql).
-- Same rollback pattern as record_journey_stop_times.sql: every block raises
-- 'rollback' at the end so nothing it changes is kept.
-- Run with: psql <connection> -f supabase/tests/stop_time_upload_problem.sql
--
-- Why this exists (2026-09-29): for ten weeks every stop-time upload was
-- refused and nobody knew. A refusal is now reported to ops by the device;
-- the Journeys page shows it until a later upload is accepted.

-- 1. A device (anon) reports a refusal: one open row, company taken from the
--    journey; a second report updates that row rather than adding one.
do $$
declare
  v_journey uuid;
  v_company uuid;
  v_rows    int;
  v_row     record;
begin
  select id, company_id into v_journey, v_company from journeys limit 1;
  if v_journey is null then raise notice 'SKIP: no journey'; return; end if;
  delete from stop_time_upload_problem where journey_id = v_journey;

  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform report_stop_time_upload_problem(v_journey, 'driver', 401, 'first', 3);
  perform report_stop_time_upload_problem(v_journey, 'solo', 409, repeat('x', 900), 5);

  reset role;
  select count(*) into v_rows from stop_time_upload_problem where journey_id = v_journey;
  select * into v_row from stop_time_upload_problem where journey_id = v_journey;
  if v_rows <> 1 then raise exception 'FAIL: % rows (expected 1 open problem)', v_rows; end if;
  if v_row.company_id <> v_company then raise exception 'FAIL: company not taken from the journey'; end if;
  if v_row.source <> 'solo' or v_row.http_status <> 409 or v_row.row_count <> 5 then
    raise exception 'FAIL: second report did not update the open problem';
  end if;
  if char_length(v_row.reason) <> 500 then raise exception 'FAIL: reason not cut to 500 characters'; end if;

  raise notice 'PASS: a report makes one open problem per journey, company from the journey';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'Rolled back test changes cleanly'; else raise exception '%', sqlerrm; end if;
end $$;

-- 2. An accepted upload resolves the open problem.
do $$
declare
  v_journey uuid;
  v_stop    uuid;
  v_open    int;
begin
  select j.id, ts.id into v_journey, v_stop
    from journeys j
    join timetable_departures td on td.id = j.timetable_departure_id
    join timetable_stops ts on ts.timetable_id = td.timetable_id
   limit 1;
  if v_journey is null then raise notice 'SKIP: no journey with timetable stops'; return; end if;
  update journeys set status = 'in_progress' where id = v_journey;

  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform report_stop_time_upload_problem(v_journey, 'driver', 401, 'refused', 1);
  perform record_journey_stop_times(v_journey, jsonb_build_array(jsonb_build_object(
    'timetable_stop_id', v_stop, 'arrived_at', now(), 'visit_status', 'visited')));

  reset role;
  select count(*) into v_open from stop_time_upload_problem where journey_id = v_journey and resolved_at is null;
  if v_open <> 0 then raise exception 'FAIL: problem still open after an accepted upload'; end if;

  raise notice 'PASS: an accepted upload resolves the problem';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'Rolled back test changes cleanly'; else raise exception '%', sqlerrm; end if;
end $$;

-- 3. A duty token for a different journey cannot report on this one, and an
--    unknown source is refused.
do $$
declare
  v_journey   uuid;
  v_token_no  boolean := false;
  v_source_no boolean := false;
begin
  select id into v_journey from journeys limit 1;
  if v_journey is null then raise notice 'SKIP: no journey'; return; end if;

  set local role anon;
  perform set_config('request.jwt.claims',
    json_build_object('role', 'anon', 'journey_ids', json_build_array(gen_random_uuid()))::text, true);
  begin
    perform report_stop_time_upload_problem(v_journey, 'driver', 401, 'x', 1);
  exception when insufficient_privilege then v_token_no := true;
  end;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    perform report_stop_time_upload_problem(v_journey, 'someone', 401, 'x', 1);
  exception when invalid_parameter_value then v_source_no := true;
  end;
  if not v_token_no then raise exception 'FAIL: a token for another journey could report'; end if;
  if not v_source_no then raise exception 'FAIL: an unknown source was accepted'; end if;

  raise notice 'PASS: other-journey token and unknown source are refused';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'Rolled back test changes cleanly'; else raise exception '%', sqlerrm; end if;
end $$;

-- 4. Grants: anon may only call the function (no table access); dashboard
--    users may read the table but not call the function; RLS is on.
do $$
begin
  if not has_function_privilege('anon', 'public.report_stop_time_upload_problem(uuid, text, integer, text, integer)', 'EXECUTE') then
    raise exception 'FAIL: anon cannot execute report_stop_time_upload_problem';
  end if;
  if has_function_privilege('authenticated', 'public.report_stop_time_upload_problem(uuid, text, integer, text, integer)', 'EXECUTE') then
    raise exception 'FAIL: authenticated can execute report_stop_time_upload_problem';
  end if;
  if has_table_privilege('anon', 'public.stop_time_upload_problem', 'SELECT')
     or has_table_privilege('anon', 'public.stop_time_upload_problem', 'INSERT') then
    raise exception 'FAIL: anon has direct access to stop_time_upload_problem';
  end if;
  if has_table_privilege('authenticated', 'public.stop_time_upload_problem', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.stop_time_upload_problem', 'DELETE') then
    raise exception 'FAIL: dashboard users can delete or truncate stop_time_upload_problem';
  end if;
  if not has_table_privilege('authenticated', 'public.stop_time_upload_problem', 'SELECT') then
    raise exception 'FAIL: dashboard users cannot read stop_time_upload_problem';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.stop_time_upload_problem'::regclass) then
    raise exception 'FAIL: RLS is off on stop_time_upload_problem';
  end if;
  raise notice 'PASS: grants and RLS';
end $$;
