-- supabase/tests/announce_devices_rls.sql
--
-- BusOps Announce Lite tier — announce_devices RLS verification
-- Self-contained SQL: each block runs inside a DO $$ ... $$ that's forced to
-- roll back (via an unhandled/forced exception), so no test data persists
-- regardless of pass/fail.
--
-- Run with: psql <connection> -f supabase/tests/announce_devices_rls.sql
--
-- PRECONDITION: run this against a dev DB with at least one company that
-- has a vehicle. Each block SKIPs (rather than failing) when it can't find
-- what it needs, so it's safe to run before/after seeding.
--
-- Expected to FAIL (table/policies/functions don't exist yet) until
-- supabase/migration_announce_devices.sql has been applied — that's the
-- "red" half of TDD for this migration.

-- 1. Anon must NOT be able to select another device's row directly.
do $$
declare
  v_company_id uuid;
  v_other_device_id uuid;
  v_device_id uuid;
begin
  select id into v_company_id from companies limit 1;
  if v_company_id is null then
    raise notice 'SKIP: no company row to attach a test device to';
    return;
  end if;

  insert into announce_devices (company_id) values (v_company_id) returning id into v_device_id;
  insert into announce_devices (company_id) values (v_company_id) returning id into v_other_device_id;

  set local role anon;
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon', 'device_id', v_device_id)::text,
    true
  );

  if exists (select 1 from announce_devices where id = v_other_device_id) then
    raise exception 'FAIL: anon device_id claim could read another device''s row';
  else
    raise notice 'PASS: anon correctly cannot select a different device''s row';
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

-- 2. Anon MUST be able to select its own row (device_self policy) — needed
-- for the Realtime postgres_changes subscription in linked mode.
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
    raise notice 'PASS: anon correctly can select its own device row';
  else
    raise exception 'FAIL: anon with matching device_id claim could not select its own row';
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

-- 3. link_announce_device() must reject a vehicle from a different company.
do $$
declare
  v_company_a uuid;
  v_company_b uuid;
  v_device_id uuid;
  v_other_vehicle_id uuid;
begin
  select id into v_company_a from companies limit 1;
  select id into v_company_b from companies where id <> v_company_a limit 1;

  if v_company_a is null or v_company_b is null then
    raise notice 'SKIP: need at least two distinct companies to test cross-company rejection';
    return;
  end if;

  select id into v_other_vehicle_id from vehicles where company_id = v_company_b limit 1;
  if v_other_vehicle_id is null then
    raise notice 'SKIP: company B has no vehicle to attempt cross-company linking with';
    return;
  end if;

  insert into announce_devices (company_id) values (v_company_a) returning id into v_device_id;

  begin
    perform link_announce_device(v_device_id, v_other_vehicle_id);
    raise exception 'FAIL: link_announce_device allowed linking a vehicle from a different company';
  exception
    when others then
      if sqlerrm like 'vehicle % not found for this device''s company' then
        raise notice 'PASS: link_announce_device correctly rejected a cross-company vehicle';
      else
        raise;
      end if;
  end;

  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test rows cleanly';
    else
      raise;
    end if;
end $$;

-- 4. link_announce_device() then unlink_announce_device() must flip
-- link_state/gps_source as expected for a same-company vehicle.
do $$
declare
  v_company_id uuid;
  v_vehicle_id uuid;
  v_device_id uuid;
  v_link_state text;
  v_gps_source text;
begin
  select id into v_company_id from companies limit 1;
  if v_company_id is null then
    raise notice 'SKIP: no company row to attach a test device to';
    return;
  end if;

  select id into v_vehicle_id from vehicles where company_id = v_company_id limit 1;
  if v_vehicle_id is null then
    raise notice 'SKIP: company has no vehicle to link against';
    return;
  end if;

  insert into announce_devices (company_id) values (v_company_id) returning id into v_device_id;

  perform link_announce_device(v_device_id, v_vehicle_id);
  select link_state, gps_source into v_link_state, v_gps_source
  from announce_devices where id = v_device_id;

  if v_link_state <> 'linked' or v_gps_source <> 'driver-device' then
    raise exception 'FAIL: link_announce_device did not set linked/driver-device (got %/%)', v_link_state, v_gps_source;
  end if;

  perform unlink_announce_device(v_device_id);
  select link_state, gps_source into v_link_state, v_gps_source
  from announce_devices where id = v_device_id;

  if v_link_state <> 'unlinked' or v_gps_source <> 'internal' then
    raise exception 'FAIL: unlink_announce_device did not restore unlinked/internal (got %/%)', v_link_state, v_gps_source;
  end if;

  raise notice 'PASS: link_announce_device/unlink_announce_device round-trip correctly';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test rows cleanly';
    else
      raise;
    end if;
end $$;

-- 5b. link_announce_device() must refuse to link a Solo-commissioned device
-- (candidate_departure_ids populated) unless p_force := true is passed —
-- found live 2026-09-04: an unguarded link silently converted a Solo device
-- to Lite mode, where it then waited forever for a driver push that never
-- came. See migration_announce_devices_solo_guard.sql.
do $$
declare
  v_company_id uuid;
  v_vehicle_id uuid;
  v_device_id uuid;
  v_link_state text;
  v_gps_source text;
begin
  select id into v_company_id from companies limit 1;
  if v_company_id is null then
    raise notice 'SKIP: no company row to attach a test device to';
    return;
  end if;

  select id into v_vehicle_id from vehicles where company_id = v_company_id limit 1;
  if v_vehicle_id is null then
    raise notice 'SKIP: company has no vehicle to link against';
    return;
  end if;

  insert into announce_devices (company_id, candidate_departure_ids)
  values (v_company_id, array[gen_random_uuid()])
  returning id into v_device_id;

  begin
    perform link_announce_device(v_device_id, v_vehicle_id);
    raise exception 'FAIL: link_announce_device allowed linking a Solo-commissioned device without p_force';
  exception
    when others then
      if sqlerrm like 'announce device % is commissioned as Solo%' then
        raise notice 'PASS: link_announce_device correctly refused an unforced Solo link';
      else
        raise;
      end if;
  end;

  perform link_announce_device(v_device_id, v_vehicle_id, p_force := true);
  select link_state, gps_source into v_link_state, v_gps_source
  from announce_devices where id = v_device_id;

  if v_link_state <> 'linked' or v_gps_source <> 'driver-device' then
    raise exception 'FAIL: link_announce_device with p_force did not link a Solo-commissioned device (got %/%)', v_link_state, v_gps_source;
  end if;

  raise notice 'PASS: link_announce_device with p_force := true still links a Solo-commissioned device deliberately';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test rows cleanly';
    else
      raise;
    end if;
end $$;

-- 5. Regression: a state-only push must not wipe out a previously pushed
-- schedule (main.js calls update_announce_device_state on two different
-- cadences — schedule once per journey start, state on every GPS fix — so
-- the columns must be independently coalesced, not overwritten with null).
do $$
declare
  v_company_id uuid;
  v_device_id uuid;
  v_schedule_after jsonb;
begin
  select id into v_company_id from companies limit 1;
  if v_company_id is null then
    raise notice 'SKIP: no company row to attach a test device to';
    return;
  end if;

  insert into announce_devices (company_id) values (v_company_id) returning id into v_device_id;

  perform update_announce_device_state(v_device_id, '{"type":"schedule","serviceCode":"42"}'::jsonb, null);
  perform update_announce_device_state(v_device_id, null, '{"type":"state","nextStopIndex":1}'::jsonb);

  select latest_schedule into v_schedule_after from announce_devices where id = v_device_id;

  if v_schedule_after is null then
    raise exception 'FAIL: state-only push wiped out the previously pushed schedule';
  else
    raise notice 'PASS: state-only push left the previous schedule intact: %', v_schedule_after;
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
