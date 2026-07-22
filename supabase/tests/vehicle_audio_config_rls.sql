-- supabase/tests/vehicle_audio_config_rls.sql
--
-- Slice 1: Fixed-Volume Audio Config — RLS verification
-- Self-contained SQL: each block runs inside a DO $$ ... $$ that's forced to
-- roll back (via an unhandled/forced exception), so no test data persists
-- regardless of pass/fail.
--
-- Run with: psql <connection> -f supabase/tests/vehicle_audio_config_rls.sql
--
-- How impersonation works here: current_employee_role() does NOT read JWT
-- claims — it looks up employees.access_level by
-- `where auth_user_id = auth.uid()`. So to impersonate a role, we set
-- request.jwt.claim.sub to a REAL employee's auth_user_id (auth.uid() reads
-- that GUC), not a fake role claim.
--
-- PRECONDITION: this database must already have at least one employee row
-- per role below with a non-null auth_user_id (i.e. a real dashboard login),
-- which any dev DB with staff accounts set up will have. Each block SKIPs
-- (rather than failing) if no such employee exists, so this is safe to run
-- against a DB that hasn't been seeded that way.

-- 1. Unauthorised role ('driver') must NOT be able to insert.
do $$
declare
  v_auth_uid uuid;
  v_employee_id uuid;
  v_vehicle_id uuid;
begin
  select auth_user_id, id into v_auth_uid, v_employee_id
  from employees
  where access_level = 'driver' and auth_user_id is not null
  limit 1;

  if v_auth_uid is null then
    raise notice 'SKIP: no driver employee with a linked auth_user_id to impersonate';
    return;
  end if;

  select id into v_vehicle_id from vehicles limit 1;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_auth_uid::text, true);

  insert into vehicle_audio_config (
    vehicle_id, ambient_reading_db, fixed_output_level, measured_at, measured_by
  ) values (
    v_vehicle_id, 62.5, 72.5, now(), v_employee_id
  );

  raise exception 'FAIL: driver role was able to insert into vehicle_audio_config';
exception
  when insufficient_privilege then
    raise notice 'PASS: driver role correctly blocked from insert';
end $$;

-- 2. Authorised role ('ops_manager' or 'super_user') MUST be able to insert.
do $$
declare
  v_auth_uid uuid;
  v_employee_id uuid;
  v_vehicle_id uuid;
begin
  select auth_user_id, id into v_auth_uid, v_employee_id
  from employees
  where access_level in ('ops_manager', 'super_user') and auth_user_id is not null
  limit 1;

  if v_auth_uid is null then
    raise notice 'SKIP: no ops_manager/super_user employee with a linked auth_user_id to impersonate';
    return;
  end if;

  select id into v_vehicle_id from vehicles limit 1;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_auth_uid::text, true);

  insert into vehicle_audio_config (
    vehicle_id, ambient_reading_db, fixed_output_level, measured_at, measured_by
  ) values (
    v_vehicle_id, 62.5, 72.5, now(), v_employee_id
  );

  raise notice 'PASS: authorised role correctly allowed to insert';
  raise exception 'rollback'; -- force rollback so no data persists
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test insert cleanly';
    else
      raise exception 'FAIL: authorised insert was blocked unexpectedly: %', sqlerrm;
    end if;
end $$;

-- 3. Any authenticated employee MUST be able to select.
do $$
declare
  v_auth_uid uuid;
begin
  select auth_user_id into v_auth_uid
  from employees
  where auth_user_id is not null
  limit 1;

  if v_auth_uid is null then
    raise notice 'SKIP: no employee with a linked auth_user_id to impersonate';
    return;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_auth_uid::text, true);

  perform * from vehicle_audio_config limit 1;
  raise notice 'PASS: authenticated employee correctly allowed to select';
end $$;

-- 4. Anon must NOT be able to select the raw table directly (only via the
-- get_audio_config_for_vehicle() RPC, which is security definer).
do $$
begin
  set local role anon;

  if exists (select 1 from vehicle_audio_config limit 1) then
    raise exception 'FAIL: anon was able to select from vehicle_audio_config directly';
  else
    raise notice 'PASS: anon correctly sees no rows (RLS has no anon select policy)';
  end if;
end $$;
