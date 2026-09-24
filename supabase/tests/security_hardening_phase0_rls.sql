-- supabase/tests/security_hardening_phase0_rls.sql
--
-- Verifies supabase/migration_security_hardening_phase0.sql.
-- Run with: psql <connection> -f supabase/tests/security_hardening_phase0_rls.sql
-- (or paste into the Supabase SQL editor). A failure RAISES EXCEPTION 'FAIL: ...';
-- a pass prints a NOTICE and continues. Nothing persists: every write is inside a
-- sub-block that is rolled back.
--
-- The "signed-up stranger" below is an `authenticated` user whose auth.uid() matches
-- NO employees row -- exactly what open Supabase Auth signup produces.

-- 1. Stranger cannot insert a stop.
do $$
begin
  reset role;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
    insert into stops (name, lat, lon) values ('SECURITY-TEST-STRANGER', 51.5, -0.1);
    raise exception 'FAIL: signed-up stranger inserted into stops';
  exception when insufficient_privilege then
    raise notice 'PASS: stranger blocked from inserting stops';
  end;
  reset role;
end $$;

-- 2. Stranger cannot update any stop (RLS has no UPDATE policy now => 0 rows).
do $$
declare v_rows int;
begin
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  update stops set announcement_name = 'SECURITY-TEST' where true;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 0 then
    raise exception 'FAIL: stranger updated % stop rows', v_rows;
  end if;
  raise notice 'PASS: stops UPDATE affects 0 rows for a stranger';
end $$;

-- 3. Even a real ops employee cannot UPDATE stops via the client any more.
do $$
declare v_uid uuid; v_rows int;
begin
  reset role;
  select auth_user_id into v_uid from employees
   where access_level in ('super_user','ops_manager') and auth_user_id is not null limit 1;
  if v_uid is null then raise notice 'SKIP: no ops employee with auth_user_id'; return; end if;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  update stops set announcement_name = 'SECURITY-TEST' where true;
  get diagnostics v_rows = row_count;
  reset role;
  if v_rows <> 0 then raise exception 'FAIL: ops user updated % stop rows', v_rows; end if;
  raise notice 'PASS: ops user has no client-side UPDATE on stops';
end $$;

-- 4. A real ops employee CAN still insert a stop (route planner path).
do $$
declare v_uid uuid;
begin
  reset role;
  select auth_user_id into v_uid from employees
   where access_level in ('super_user','ops_manager') and auth_user_id is not null limit 1;
  if v_uid is null then raise notice 'SKIP: no ops employee with auth_user_id'; return; end if;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    insert into stops (name, lat, lon) values ('SECURITY-TEST-OPS', 51.5, -0.1);
    raise exception 'ROLLBACK_OK';
  exception when raise_exception then
    if sqlerrm <> 'ROLLBACK_OK' then raise; end if;
  end;
  reset role;
  raise notice 'PASS: ops employee can still insert stops';
end $$;

-- 5. A driver-level employee cannot insert a stop.
do $$
declare v_uid uuid;
begin
  reset role;
  select auth_user_id into v_uid from employees
   where access_level = 'driver' and auth_user_id is not null limit 1;
  if v_uid is null then raise notice 'SKIP: no driver employee with auth_user_id'; return; end if;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    insert into stops (name, lat, lon) values ('SECURITY-TEST-DRIVER', 51.5, -0.1);
    raise exception 'FAIL: driver inserted into stops';
  exception when insufficient_privilege then
    raise notice 'PASS: driver blocked from inserting stops';
  end;
  reset role;
end $$;

-- 6. journey_types / term_dates are read-only to authenticated clients.
do $$
begin
  reset role;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
    delete from term_dates where true;
    raise exception 'FAIL: authenticated user could DELETE term_dates';
  exception when insufficient_privilege then
    raise notice 'PASS: term_dates DELETE blocked';
  end;
  reset role;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
    update journey_types set name = name where true;
    raise exception 'FAIL: authenticated user could UPDATE journey_types';
  exception when insufficient_privilege then
    raise notice 'PASS: journey_types UPDATE blocked';
  end;
  reset role;
  -- ...but still readable (dashboard + route planner depend on it).
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  perform 1 from journey_types limit 1;
  perform 1 from term_dates limit 1;
  reset role;
  raise notice 'PASS: journey_types / term_dates still readable';
end $$;

-- 7. Dropped/removed objects are really gone.
do $$
begin
  reset role;
  if exists (select 1 from pg_proc where proname = 'generate_duty_token' and pronamespace = 'public'::regnamespace) then
    raise exception 'FAIL: generate_duty_token() still exists';
  end if;
  if exists (select 1 from pg_policies where tablename = 'journey_stop_times' and policyname = 'anon_upload_stop_times') then
    raise exception 'FAIL: anon_upload_stop_times policy still exists';
  end if;
  raise notice 'PASS: generate_duty_token() and anon_upload_stop_times are gone';
end $$;

-- 8. Helpers / trigger fn are not anon-executable.
do $$
begin
  reset role;
  if has_function_privilege('anon', 'public.current_company_id()', 'execute')
     or has_function_privilege('anon', 'public.current_employee_role()', 'execute')
     or has_function_privilege('anon', 'public.fn_naptan_import_on_county_change()', 'execute')
     or has_function_privilege('authenticated', 'public.fn_naptan_import_on_county_change()', 'execute') then
    raise exception 'FAIL: a helper/trigger function is still executable by anon/authenticated';
  end if;
  if not has_function_privilege('authenticated', 'public.current_company_id()', 'execute')
     or not has_function_privilege('authenticated', 'public.current_employee_role()', 'execute') then
    raise exception 'FAIL: authenticated lost EXECUTE on an RLS helper (every policy would break)';
  end if;
  raise notice 'PASS: helper EXECUTE grants are correct';
end $$;

-- 9. A token scoped to a DIFFERENT journey cannot insert a coverage-gap row.
do $$
declare v_journey uuid; v_vehicle uuid;
begin
  reset role;
  select id into v_journey from journeys limit 1;
  select id into v_vehicle from vehicles limit 1;
  if v_journey is null or v_vehicle is null then raise notice 'SKIP: no journey/vehicle'; return; end if;
  begin
    set local role anon;
    perform set_config('request.jwt.claims',
      json_build_object('role','anon','journey_ids', json_build_array(gen_random_uuid()))::text, true);
    insert into announcement_coverage_gap (journey_id, vehicle_id, stage, missing_keys)
      values (v_journey, v_vehicle, 'live_stop', array['x']);
    raise exception 'FAIL: anon with another journey''s token inserted a coverage gap';
  exception when insufficient_privilege then
    raise notice 'PASS: coverage-gap insert scoped to the token''s journeys';
  end;
  reset role;
end $$;

select 'security_hardening_phase0_rls: all blocks completed without FAIL' as result;
