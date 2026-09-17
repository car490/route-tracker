-- supabase/tests/announce_device_revocation_rls.sql
--
-- Verification for the per-device revocation mechanism added in
-- supabase/migration_announce_device_revocation.sql (see
-- docs/SECURITY_FIXES_2026-09-17.md Item 4(b)). Same rollback-transaction
-- pattern as rpc_ownership_rls.sql/diversion_alert_event_rls.sql -- each
-- block runs inside a DO $$ ... $$ forced to roll back via an unhandled/
-- forced exception, so no test data persists regardless of pass/fail.
--
-- Run with: psql <connection> -f supabase/tests/announce_device_revocation_rls.sql
--
-- PRECONDITION: needs at least one company (tests 1-3), and, for test 4, a
-- journey with a non-null vehicle_id (same fixture requirement as
-- rpc_ownership_rls.sql's test 6). SKIPs rather than failing if fixtures
-- are missing.

-- 1. A non-revoked device (device_id claim matching its own row,
--    revoked_at is null) CAN select its own row via the device_self policy.
do $$
declare
  v_company_id uuid;
  v_device_id uuid;
begin
  select id into v_company_id from companies limit 1;
  if v_company_id is null then
    raise notice 'SKIP: no company row to attach a test device to';
    return;
  end if;

  insert into announce_devices (company_id) values (v_company_id) returning id into v_device_id;

  set local role anon;
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon', 'device_id', v_device_id)::text,
    true
  );

  if exists (select 1 from announce_devices where id = v_device_id) then
    raise notice 'PASS: non-revoked device can select its own row';
  else
    raise exception 'FAIL: non-revoked device could not select its own row';
  end if;

  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test rows cleanly';
    else
      raise;
    end if;
end $$;

-- 2. The same device, once revoked (revoked_at set to now()), CANNOT
--    select its own row any more -- RLS just filters it out (zero rows),
--    it doesn't raise.
do $$
declare
  v_company_id uuid;
  v_device_id uuid;
  v_row_count int;
begin
  select id into v_company_id from companies limit 1;
  if v_company_id is null then
    raise notice 'SKIP: no company row to attach a test device to';
    return;
  end if;

  insert into announce_devices (company_id) values (v_company_id) returning id into v_device_id;
  update announce_devices set revoked_at = now() where id = v_device_id;

  set local role anon;
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon', 'device_id', v_device_id)::text,
    true
  );

  select count(*) into v_row_count from announce_devices where id = v_device_id;
  if v_row_count = 0 then
    raise notice 'PASS: revoked device correctly cannot select its own row (filtered, no exception)';
  else
    raise exception 'FAIL: revoked device could still select its own row';
  end if;

  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test rows cleanly';
    else
      raise exception 'FAIL: revocation check on device_self misbehaved: %', sqlerrm;
    end if;
end $$;

-- 3. Regression for rpc_ownership_rls.sql test 4: with a device
--    non-revoked, update_announce_device_state/end_announce_device_journey/
--    unlink_announce_device all still succeed for that device's own
--    device-claim token (confirmed BEFORE revoking, so the "then it fails"
--    check below is a real regression, not a pre-existing failure). Once
--    revoked, all three now raise.
do $$
declare
  v_company_id uuid;
  v_device_id uuid;
  v_result boolean;
begin
  select id into v_company_id from companies limit 1;
  if v_company_id is null then
    raise notice 'SKIP: no company row to attach a test device to';
    return;
  end if;

  insert into announce_devices (company_id) values (v_company_id) returning id into v_device_id;

  set local role anon;
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon', 'device_id', v_device_id)::text,
    true
  );

  -- Before revocation: all three RPCs succeed, same as rpc_ownership_rls.sql
  -- test 4 -- confirms the regression checked below is real.
  select update_announce_device_state(v_device_id, null, null) into v_result;
  if not v_result then
    raise exception 'FAIL: update_announce_device_state returned false for own non-revoked device (unexpected pre-revocation failure)';
  end if;

  select end_announce_device_journey(v_device_id) into v_result;
  if not v_result then
    raise exception 'FAIL: end_announce_device_journey returned false for own non-revoked device (unexpected pre-revocation failure)';
  end if;

  select unlink_announce_device(v_device_id) into v_result;
  if not v_result then
    raise exception 'FAIL: unlink_announce_device returned false for own non-revoked device (unexpected pre-revocation failure)';
  end if;

  raise notice 'PASS: all three device RPCs succeed for a non-revoked device (baseline confirmed)';

  -- Revoke, still within the same transaction (this block's rollback below
  -- undoes it) -- reset role first since revoking is done as the table
  -- owner, not anon.
  reset role;
  update announce_devices set revoked_at = now() where id = v_device_id;

  set local role anon;
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon', 'device_id', v_device_id)::text,
    true
  );

  begin
    perform update_announce_device_state(v_device_id, null, null);
    raise exception 'FAIL: update_announce_device_state succeeded for a revoked device';
  exception
    when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      raise notice 'PASS: update_announce_device_state correctly blocked for a revoked device (%)', sqlerrm;
  end;

  begin
    perform end_announce_device_journey(v_device_id);
    raise exception 'FAIL: end_announce_device_journey succeeded for a revoked device';
  exception
    when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      raise notice 'PASS: end_announce_device_journey correctly blocked for a revoked device (%)', sqlerrm;
  end;

  begin
    perform unlink_announce_device(v_device_id);
    raise exception 'FAIL: unlink_announce_device succeeded for a revoked device';
  exception
    when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      raise notice 'PASS: unlink_announce_device correctly blocked for a revoked device (%)', sqlerrm;
  end;

  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test rows/updates cleanly';
    else
      raise exception 'FAIL: revocation regression check misbehaved: %', sqlerrm;
    end if;
end $$;

-- 4. Smoke check: a driver token acting on a non-revoked device via the
--    vehicle-matching branch (same setup as rpc_ownership_rls.sql test 6)
--    still works -- confirms the new revocation check didn't break the
--    existing vehicle-scoped branch. Not a full re-test of everything
--    test 6 already covers.
do $$
declare
  v_journey_id  uuid := (select id from journeys where vehicle_id is not null limit 1);
  v_vehicle_id  uuid;
  v_company_id  uuid;
  v_device_id   uuid;
  v_result      boolean;
begin
  if v_journey_id is null then
    raise notice 'SKIP: no journey with a vehicle_id to test vehicle-scoped device access';
    return;
  end if;

  select vehicle_id, company_id into v_vehicle_id, v_company_id
  from journeys where id = v_journey_id;

  select id into v_device_id
  from announce_devices
  where vehicle_id = v_vehicle_id
  limit 1;

  if v_device_id is null then
    insert into announce_devices (company_id, vehicle_id)
    values (v_company_id, v_vehicle_id)
    returning id into v_device_id;
  end if;

  set local role anon;
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon', 'journey_ids', array[v_journey_id])::text,
    true
  );

  select update_announce_device_state(v_device_id, null, null) into v_result;
  if not v_result then
    raise exception 'FAIL: update_announce_device_state returned false for a non-revoked same-vehicle device';
  end if;

  raise notice 'PASS: driver token still allowed to act on a non-revoked device sharing its journey''s vehicle';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test updates/inserts cleanly';
    else
      raise exception 'FAIL: vehicle-scoped device access smoke check misbehaved: %', sqlerrm;
    end if;
end $$;
