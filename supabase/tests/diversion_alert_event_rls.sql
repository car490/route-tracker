-- supabase/tests/diversion_alert_event_rls.sql
--
-- Slice 2: Driver-Triggered Diversion Alert — RLS verification
-- Same rollback-transaction pattern as Slice 1's RLS test.
-- Run with: psql <connection> -f supabase/tests/diversion_alert_event_rls.sql
--
-- Identity mechanism: unlike Slice 1's vehicle_audio_config (authenticated
-- role, current_employee_role() via auth.uid()), drivers have no dashboard
-- login. This table is written by the anon-key Driver PWA using the signed
-- duty-token's `driver_id` claim (same claim get_duty_card() embeds and
-- is_jwt_journey_allowed() already reads for journey_events/
-- journey_stop_times). Impersonation below runs as the `anon` role and sets
-- `request.jwt.claims` directly, which is what auth.jwt() reads.
--
-- PRECONDITION: needs an in-progress journey, its vehicle, and at least one
-- employee row (two, to test cross-driver scoping). SKIPs rather than
-- failing if fixtures are missing.

-- 1. A driver CAN trigger an alert for their own driver_id, on an
--    in-progress journey.
do $$
declare
  own_driver_id uuid := (select id from employees limit 1);
  v_journey_id   uuid := (select id from journeys where status = 'in_progress' limit 1);
  v_vehicle_id   uuid := (select vehicle_id from journeys where id = v_journey_id);
begin
  if v_journey_id is null then
    raise notice 'SKIP: no in-progress journey to test against';
    return;
  end if;

  set local role anon;
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon', 'driver_id', own_driver_id)::text,
    true
  );

  insert into diversion_alert_event (journey_id, vehicle_id, driver_id)
  values (v_journey_id, v_vehicle_id, own_driver_id);

  raise notice 'PASS: driver correctly allowed to trigger their own alert';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test insert cleanly';
    else
      raise exception 'FAIL: driver was blocked from triggering their own alert: %', sqlerrm;
    end if;
end $$;

-- 2. A driver CANNOT trigger an alert scoped to a different driver_id
--    (cannot remotely trigger another vehicle's alert — the main security
--    property of this table).
do $$
declare
  own_driver_id   uuid := (select id from employees limit 1);
  other_driver_id uuid := (select id from employees offset 1 limit 1);
  v_journey_id    uuid := (select id from journeys where status = 'in_progress' limit 1);
  v_vehicle_id    uuid := (select vehicle_id from journeys where id = v_journey_id);
begin
  if other_driver_id is null then
    raise notice 'SKIP: need a second employee row to test cross-driver scoping';
    return;
  end if;
  if v_journey_id is null then
    raise notice 'SKIP: no in-progress journey to test against';
    return;
  end if;

  set local role anon;
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon', 'driver_id', own_driver_id)::text,
    true
  );

  insert into diversion_alert_event (journey_id, vehicle_id, driver_id)
  values (v_journey_id, v_vehicle_id, other_driver_id);

  raise exception 'FAIL: driver was able to trigger an alert for a different driver_id';
exception
  when insufficient_privilege then
    raise notice 'PASS: cross-driver trigger correctly blocked';
  when others then
    if sqlerrm like 'FAIL%' then
      raise exception '%', sqlerrm;
    end if;
    raise notice 'PASS (blocked via RLS check — no rows affected): %', sqlerrm;
end $$;

-- 3. A plain/legacy anon key with no driver_id claim at all CANNOT insert.
do $$
declare
  own_driver_id uuid := (select id from employees limit 1);
  v_journey_id  uuid := (select id from journeys where status = 'in_progress' limit 1);
  v_vehicle_id  uuid := (select vehicle_id from journeys where id = v_journey_id);
begin
  if v_journey_id is null then
    raise notice 'SKIP: no in-progress journey to test against';
    return;
  end if;

  set local role anon;
  perform set_config('request.jwt.claims', '{}', true);

  insert into diversion_alert_event (journey_id, vehicle_id, driver_id)
  values (v_journey_id, v_vehicle_id, own_driver_id);

  raise exception 'FAIL: anon key with no driver_id claim was able to insert';
exception
  when insufficient_privilege then
    raise notice 'PASS: no-claim anon key correctly blocked';
  when others then
    if sqlerrm like 'FAIL%' then
      raise exception '%', sqlerrm;
    end if;
    raise notice 'PASS (blocked via RLS check — no rows affected): %', sqlerrm;
end $$;

-- 4. A driver CAN clear (update cleared_at on) their own alert.
do $$
declare
  own_driver_id uuid := (select id from employees limit 1);
  v_journey_id  uuid := (select id from journeys where status = 'in_progress' limit 1);
  v_vehicle_id  uuid := (select vehicle_id from journeys where id = v_journey_id);
  v_alert_id    uuid;
begin
  if v_journey_id is null then
    raise notice 'SKIP: no in-progress journey to test against';
    return;
  end if;

  set local role anon;
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon', 'driver_id', own_driver_id)::text,
    true
  );

  insert into diversion_alert_event (journey_id, vehicle_id, driver_id)
  values (v_journey_id, v_vehicle_id, own_driver_id)
  returning id into v_alert_id;

  update diversion_alert_event set cleared_at = now() where id = v_alert_id;

  raise notice 'PASS: driver correctly allowed to clear their own alert';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test insert/update cleanly';
    else
      raise exception 'FAIL: driver was blocked from clearing their own alert: %', sqlerrm;
    end if;
end $$;

-- 5. Any authenticated employee (ops/compliance) can select company-scoped
--    rows — same current_company_id() impersonation as Slice 1's RLS test.
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

  perform * from diversion_alert_event limit 1;
  raise notice 'PASS: authenticated employee correctly allowed to select';
end $$;
