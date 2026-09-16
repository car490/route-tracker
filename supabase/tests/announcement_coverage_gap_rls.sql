-- supabase/tests/announcement_coverage_gap_rls.sql
--
-- Phase 3 of docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md ("never synthesize") --
-- announcement_coverage_gap RLS. Same rollback-transaction pattern as the
-- other Slice/Phase RLS tests in this directory.
-- Run with: psql <connection> -f supabase/tests/announcement_coverage_gap_rls.sql
--
-- PRECONDITION: needs at least one journey (any status) with a non-null
-- vehicle_id. SKIPs rather than failing if fixtures are missing.

-- 1. anon can insert unrestricted (no login session to scope by -- see the
--    migration's own comment on revisiting this once PWA/driver-device auth
--    exists).
do $$
declare
  v_journey_id uuid := (select id from journeys where vehicle_id is not null limit 1);
  v_vehicle_id uuid := (select vehicle_id from journeys where id = v_journey_id);
begin
  if v_journey_id is null then
    raise notice 'SKIP: no journey with a vehicle_id to test against';
    return;
  end if;

  set local role anon;

  insert into announcement_coverage_gap (journey_id, vehicle_id, stage, missing_keys)
  values (v_journey_id, v_vehicle_id, 'journey_start', array['approach/test-stop']);

  raise notice 'PASS: anon correctly allowed to insert a coverage gap';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test insert cleanly';
    else
      raise exception 'FAIL: anon was blocked from inserting a coverage gap: %', sqlerrm;
    end if;
end $$;

-- 2. stage is constrained to the two known values.
do $$
declare
  v_journey_id uuid := (select id from journeys where vehicle_id is not null limit 1);
  v_vehicle_id uuid := (select vehicle_id from journeys where id = v_journey_id);
begin
  if v_journey_id is null then
    raise notice 'SKIP: no journey with a vehicle_id to test against';
    return;
  end if;

  set local role anon;

  insert into announcement_coverage_gap (journey_id, vehicle_id, stage, missing_keys)
  values (v_journey_id, v_vehicle_id, 'not_a_real_stage', array['approach/test-stop']);

  raise exception 'FAIL: an invalid stage value was accepted';
exception
  when check_violation then
    raise notice 'PASS: invalid stage value correctly rejected';
  when others then
    if sqlerrm like 'FAIL%' then
      raise exception '%', sqlerrm;
    end if;
    raise;
end $$;

-- 2b. A Solo device (no vehicle_id at all -- see the migration's own
--     comment) can still insert using device_id in place of vehicle_id.
do $$
declare
  v_journey_id uuid := (select id from journeys limit 1);
  v_device_id  uuid := (select id from announce_devices limit 1);
begin
  if v_journey_id is null then
    raise notice 'SKIP: no journey to test against';
    return;
  end if;
  if v_device_id is null then
    raise notice 'SKIP: no announce_devices row to test the Solo (device_id-only) path against';
    return;
  end if;

  set local role anon;

  insert into announcement_coverage_gap (journey_id, device_id, stage, missing_keys)
  values (v_journey_id, v_device_id, 'live_stop', array['diversion']);

  raise notice 'PASS: Solo-style device_id-only insert correctly allowed';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test insert cleanly';
    else
      raise exception 'FAIL: device_id-only insert was blocked: %', sqlerrm;
    end if;
end $$;

-- 2c. Neither vehicle_id nor device_id set -- must fail the has_source check.
do $$
declare
  v_journey_id uuid := (select id from journeys limit 1);
begin
  if v_journey_id is null then
    raise notice 'SKIP: no journey to test against';
    return;
  end if;

  set local role anon;

  insert into announcement_coverage_gap (journey_id, stage, missing_keys)
  values (v_journey_id, 'live_stop', array['diversion']);

  raise exception 'FAIL: a row with neither vehicle_id nor device_id was accepted';
exception
  when check_violation then
    raise notice 'PASS: row with no vehicle_id/device_id correctly rejected';
  when others then
    if sqlerrm like 'FAIL%' then
      raise exception '%', sqlerrm;
    end if;
    raise;
end $$;

-- 3. anon cannot select rows back (grant is insert-only; no anon select
--    policy exists, so RLS silently returns zero rows).
do $$
declare
  v_count int;
begin
  set local role anon;
  select count(*) into v_count from announcement_coverage_gap;
  if v_count <> 0 then
    raise exception 'FAIL: anon was able to read % coverage gap row(s)', v_count;
  end if;
  raise notice 'PASS: anon correctly reads zero rows (no select policy)';
end $$;

-- 4. Any authenticated employee (ops visibility) can select their own
--    company's rows, scoped via vehicle_id -- same impersonation pattern as
--    diversion_alert_event_rls.sql's case 5.
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

  perform * from announcement_coverage_gap limit 1;
  raise notice 'PASS: authenticated employee correctly allowed to select';
end $$;

-- 5. An authenticated employee cannot see another company's rows -- inserts
--    one as service_role (bypasses RLS) against a vehicle from a *different*
--    company than the impersonated employee, then confirms it's excluded.
do $$
declare
  v_auth_uid       uuid;
  v_own_company_id uuid;
  v_other_vehicle  uuid;
  v_journey_id     uuid;
  v_gap_id         uuid;
  v_visible        boolean;
begin
  select auth_user_id, company_id into v_auth_uid, v_own_company_id
  from employees
  where auth_user_id is not null
  limit 1;

  if v_auth_uid is null then
    raise notice 'SKIP: no employee with a linked auth_user_id to impersonate';
    return;
  end if;

  select v.id into v_other_vehicle
  from vehicles v
  where v.company_id <> v_own_company_id
  limit 1;

  if v_other_vehicle is null then
    raise notice 'SKIP: no vehicle belonging to a different company to test cross-company isolation';
    return;
  end if;

  select id into v_journey_id from journeys where vehicle_id = v_other_vehicle limit 1;
  if v_journey_id is null then
    raise notice 'SKIP: the other-company vehicle has no journey to attach a test row to';
    return;
  end if;

  insert into announcement_coverage_gap (journey_id, vehicle_id, stage, missing_keys)
  values (v_journey_id, v_other_vehicle, 'journey_start', array['approach/test-stop'])
  returning id into v_gap_id;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_auth_uid::text, true);

  select exists(select 1 from announcement_coverage_gap where id = v_gap_id) into v_visible;

  reset role;
  delete from announcement_coverage_gap where id = v_gap_id;

  if v_visible then
    raise exception 'FAIL: authenticated employee could see another company''s coverage gap row';
  end if;

  raise notice 'PASS: cross-company coverage gap row correctly hidden';
end $$;
