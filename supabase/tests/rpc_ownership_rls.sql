-- supabase/tests/rpc_ownership_rls.sql
--
-- Ownership-check verification for the five anon-callable SECURITY DEFINER
-- RPCs hardened in supabase/migration_harden_anon_rpc_ownership.sql
-- (start_journey, complete_journey, update_announce_device_state,
-- end_announce_device_journey, unlink_announce_device). Same rollback-
-- transaction pattern as diversion_alert_event_rls.sql.
-- Run with: psql <connection> -f supabase/tests/rpc_ownership_rls.sql
--
-- Identity mechanism: journey-scoped calls (start_journey/complete_journey,
-- plus the device RPCs when called by a driver device) are gated by
-- is_jwt_journey_allowed()/is_jwt_device_allowed() reading the signed duty
-- token's `journey_ids` claim (see api/sign-token.js); device-scoped calls
-- (the three announce_devices RPCs when called by an Announce device itself)
-- are gated by the same is_jwt_device_allowed() reading the signed device
-- token's `device_id` claim (see api/sign-announce-token.js). Impersonation
-- below runs as the `anon` role and sets `request.jwt.claims` directly,
-- which is what auth.jwt() reads.
--
-- PRECONDITION: needs journeys in both 'scheduled' and 'in_progress' status,
-- a second distinct journey row, at least one announce_devices row (two, to
-- test cross-device scoping), and a journey with a non-null vehicle_id.
-- SKIPs rather than failing if fixtures are missing.

-- 1. A driver token (journey_ids claim) CAN start_journey/complete_journey
--    for a journey id inside its own claim (matching each function's own
--    status guard: 'scheduled' for start, 'in_progress' for complete).
do $$
declare
  v_start_journey    uuid := (select id from journeys where status = 'scheduled' limit 1);
  v_complete_journey uuid := (select id from journeys where status = 'in_progress' limit 1);
  v_result boolean;
begin
  if v_start_journey is null then
    raise notice 'SKIP: no scheduled journey to test start_journey against';
    return;
  end if;
  if v_complete_journey is null then
    raise notice 'SKIP: no in-progress journey to test complete_journey against';
    return;
  end if;

  set local role anon;
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'anon',
      'journey_ids', array[v_start_journey, v_complete_journey]
    )::text,
    true
  );

  select start_journey(v_start_journey) into v_result;
  if not v_result then
    raise exception 'FAIL: start_journey returned false for own claimed scheduled journey';
  end if;

  select complete_journey(v_complete_journey) into v_result;
  if not v_result then
    raise exception 'FAIL: complete_journey returned false for own claimed in-progress journey';
  end if;

  raise notice 'PASS: driver token allowed to start/complete its own claimed journeys';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test updates cleanly';
    else
      raise exception 'FAIL: driver token blocked from its own claimed journeys: %', sqlerrm;
    end if;
end $$;

-- 2. A driver token CANNOT call start_journey/complete_journey for a
--    journey id NOT in its journey_ids claim (the main security property
--    of these two RPCs).
do $$
declare
  v_own_journey   uuid := (select id from journeys where status = 'scheduled' limit 1);
  v_in_progress   uuid := (select id from journeys where status = 'in_progress' limit 1);
  v_other_journey uuid;
begin
  if v_own_journey is null then
    raise notice 'SKIP: no scheduled journey to build a claim from';
    return;
  end if;

  select id into v_other_journey from journeys where id <> v_own_journey limit 1;
  if v_other_journey is null then
    raise notice 'SKIP: need a second journey row to test cross-journey scoping';
    return;
  end if;

  set local role anon;
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon', 'journey_ids', array[v_own_journey])::text,
    true
  );

  begin
    perform start_journey(v_other_journey);
    raise exception 'FAIL: driver token was able to start_journey for a journey outside its claim';
  exception
    when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      raise notice 'PASS: cross-journey start_journey correctly blocked (%)', sqlerrm;
  end;

  if v_in_progress is not null and v_in_progress <> v_own_journey then
    begin
      perform complete_journey(v_in_progress);
      raise exception 'FAIL: driver token was able to complete_journey for a journey outside its claim';
    exception
      when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        raise notice 'PASS: cross-journey complete_journey correctly blocked (%)', sqlerrm;
    end;
  else
    raise notice 'SKIP: no distinct in-progress journey to test complete_journey scoping';
  end if;
exception
  when others then
    raise exception '%', sqlerrm;
end $$;

-- 3. A token with no journey_ids claim at all (legacy/manual-selection
--    anon key) can still call both — intentional compatibility, not a bug.
do $$
declare
  v_start_journey    uuid := (select id from journeys where status = 'scheduled' limit 1);
  v_complete_journey uuid := (select id from journeys where status = 'in_progress' limit 1);
  v_result boolean;
begin
  if v_start_journey is null then
    raise notice 'SKIP: no scheduled journey to test start_journey against';
    return;
  end if;
  if v_complete_journey is null then
    raise notice 'SKIP: no in-progress journey to test complete_journey against';
    return;
  end if;

  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

  select start_journey(v_start_journey) into v_result;
  if not v_result then
    raise exception 'FAIL: start_journey returned false for a no-claim anon token';
  end if;

  select complete_journey(v_complete_journey) into v_result;
  if not v_result then
    raise exception 'FAIL: complete_journey returned false for a no-claim anon token';
  end if;

  raise notice 'PASS: no-claim anon token still allowed to start/complete journeys (intentional compatibility)';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test updates cleanly';
    else
      raise exception '%', sqlerrm;
    end if;
end $$;

-- 4. A device token (device_id claim matching a real announce_devices.id)
--    CAN call unlink_announce_device / update_announce_device_state /
--    end_announce_device_journey for its own device id.
do $$
declare
  v_device_id uuid := (select id from announce_devices limit 1);
  v_result boolean;
begin
  if v_device_id is null then
    raise notice 'SKIP: no announce_devices row to test against';
    return;
  end if;

  set local role anon;
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon', 'device_id', v_device_id)::text,
    true
  );

  select update_announce_device_state(v_device_id, null, null) into v_result;
  if not v_result then
    raise exception 'FAIL: update_announce_device_state returned false for own device';
  end if;

  select end_announce_device_journey(v_device_id) into v_result;
  if not v_result then
    raise exception 'FAIL: end_announce_device_journey returned false for own device';
  end if;

  select unlink_announce_device(v_device_id) into v_result;
  if not v_result then
    raise exception 'FAIL: unlink_announce_device returned false for own device';
  end if;

  raise notice 'PASS: device token allowed to call all three device RPCs on its own device';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test updates cleanly';
    else
      raise exception 'FAIL: device token blocked from its own device: %', sqlerrm;
    end if;
end $$;

-- 5. A device token CANNOT call any of the three device RPCs for a
--    different device id.
do $$
declare
  v_own_device   uuid := (select id from announce_devices limit 1);
  v_other_device uuid;
begin
  if v_own_device is null then
    raise notice 'SKIP: no announce_devices row to build a device token from';
    return;
  end if;

  select coalesce(
    (select id from announce_devices where id <> v_own_device limit 1),
    gen_random_uuid()
  ) into v_other_device;

  set local role anon;
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon', 'device_id', v_own_device)::text,
    true
  );

  begin
    perform update_announce_device_state(v_other_device, null, null);
    raise exception 'FAIL: device token was able to update_announce_device_state for a different device id';
  exception
    when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      raise notice 'PASS: cross-device update_announce_device_state correctly blocked (%)', sqlerrm;
  end;

  begin
    perform end_announce_device_journey(v_other_device);
    raise exception 'FAIL: device token was able to end_announce_device_journey for a different device id';
  exception
    when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      raise notice 'PASS: cross-device end_announce_device_journey correctly blocked (%)', sqlerrm;
  end;

  begin
    perform unlink_announce_device(v_other_device);
    raise exception 'FAIL: device token was able to unlink_announce_device for a different device id';
  exception
    when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      raise notice 'PASS: cross-device unlink_announce_device correctly blocked (%)', sqlerrm;
  end;
exception
  when others then
    raise exception '%', sqlerrm;
end $$;

-- 6. A driver token (journey_ids claim) CAN call the device RPCs for a
--    device whose vehicle_id matches the vehicle_id of one of the journeys
--    in its claim, and CANNOT for a device on an unrelated vehicle. Tested
--    via update_announce_device_state as a representative call — the
--    entitlement check (is_jwt_device_allowed's journey_ids branch) is the
--    exact same code path regardless of which of the three functions calls
--    it.
do $$
declare
  v_journey_id  uuid := (select id from journeys where vehicle_id is not null limit 1);
  v_vehicle_id  uuid;
  v_company_id  uuid;
  v_device_id   uuid;
  v_other_device uuid;
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
    -- No existing device is on this vehicle -- insert one for the duration
    -- of this test only; this block's own rollback below undoes it, same
    -- as diversion_alert_event_rls.sql's insert-then-rollback tests.
    insert into announce_devices (company_id, vehicle_id)
    values (v_company_id, v_vehicle_id)
    returning id into v_device_id;
  end if;

  select id into v_other_device
  from announce_devices
  where vehicle_id is distinct from v_vehicle_id
  limit 1;

  set local role anon;
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon', 'journey_ids', array[v_journey_id])::text,
    true
  );

  select update_announce_device_state(v_device_id, null, null) into v_result;
  if not v_result then
    raise exception 'FAIL: update_announce_device_state returned false for same-vehicle device';
  end if;

  if v_other_device is not null then
    begin
      perform update_announce_device_state(v_other_device, null, null);
      raise exception 'FAIL: driver token was able to act on a device on an unrelated vehicle';
    exception
      when others then
        if sqlerrm like 'FAIL%' then raise; end if;
        raise notice 'PASS: unrelated-vehicle device access correctly blocked (%)', sqlerrm;
    end;
  else
    raise notice 'SKIP: no announce_devices row on an unrelated vehicle to test negative case';
  end if;

  raise notice 'PASS: driver token allowed to act on a device sharing its journey''s vehicle';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test updates/inserts cleanly';
    else
      raise exception 'FAIL: vehicle-scoped device access check misbehaved: %', sqlerrm;
    end if;
end $$;
