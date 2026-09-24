-- supabase/tests/reset_journey_rls.sql
--
-- Verification for reset_journey() (supabase/migration_reset_journey_rpc.sql).
-- Same rollback-transaction pattern as rpc_ownership_rls.sql: every block
-- raises 'rollback' at the end so nothing it changes is kept.
-- Run with: psql <connection> -f supabase/tests/reset_journey_rls.sql
--
-- Identity: dashboard users are impersonated as the `authenticated` role with
-- request.jwt.claims.sub set to an employee's auth_user_id, which is what
-- auth.uid() — and so current_company_id() — reads.
--
-- PRECONDITION: needs a non-scheduled journey whose company has an employee
-- with a login (auth_user_id). Test 3 also needs an employee in a different
-- company. SKIPs rather than failing if fixtures are missing.

-- 1. A dashboard user CAN reset their own company's journey: status back to
--    scheduled, timestamps cleared, events and stop times gone.
do $$
declare
  v_journey uuid;
  v_user    uuid;
  v_result  boolean;
  v_status  text;
  v_left    int;
begin
  select j.id, e.auth_user_id into v_journey, v_user
    from journeys j
    join employees e on e.company_id = j.company_id and e.auth_user_id is not null
   where j.status in ('in_progress', 'completed')
   limit 1;
  if v_journey is null then
    raise notice 'SKIP: no started journey with a logged-in employee in its company';
    return;
  end if;

  insert into journey_events (journey_id, event_type, metadata)
    values (v_journey, 'incident', '{"category":"test"}');

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', v_user)::text, true);

  select reset_journey(v_journey) into v_result;
  if not v_result then
    raise exception 'FAIL: reset_journey returned false for own company journey';
  end if;

  select status into v_status from journeys where id = v_journey;
  select (select count(*) from journey_events where journey_id = v_journey)
       + (select count(*) from journey_stop_times where journey_id = v_journey)
    into v_left;
  if v_status <> 'scheduled' or v_left <> 0 then
    raise exception 'FAIL: after reset status=%, % event/stop rows left', v_status, v_left;
  end if;

  raise notice 'PASS: own company journey reset cleanly';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test changes cleanly';
    else
      raise exception '%', sqlerrm;
    end if;
end $$;

-- 2. The anon key (driver PWA) CANNOT call reset_journey at all.
do $$
declare
  v_journey uuid := (select id from journeys limit 1);
begin
  if v_journey is null then
    raise notice 'SKIP: no journeys';
    return;
  end if;

  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

  begin
    perform reset_journey(v_journey);
    raise exception 'FAIL: anon was allowed to call reset_journey';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anon blocked from reset_journey';
  end;

  raise exception 'rollback';
exception
  when others then
    if sqlerrm <> 'rollback' then
      raise exception '%', sqlerrm;
    end if;
end $$;

-- 3. A dashboard user from ANOTHER company gets false and changes nothing.
do $$
declare
  v_journey uuid;
  v_company uuid;
  v_user    uuid;
  v_result  boolean;
  v_status  text;
begin
  select id, company_id into v_journey, v_company
    from journeys where status in ('in_progress', 'completed') limit 1;
  select auth_user_id into v_user
    from employees where company_id <> v_company and auth_user_id is not null limit 1;
  if v_journey is null or v_user is null then
    raise notice 'SKIP: need a started journey and a logged-in employee of another company';
    return;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', v_user)::text, true);

  select reset_journey(v_journey) into v_result;
  reset role;

  select status into v_status from journeys where id = v_journey;
  if v_result or v_status = 'scheduled' then
    raise exception 'FAIL: other company reset the journey (result=%, status=%)', v_result, v_status;
  end if;

  raise notice 'PASS: other company cannot reset the journey';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm <> 'rollback' then
      raise exception '%', sqlerrm;
    end if;
end $$;

-- 4. A logged-in user with no employee row (no company at all) gets false and
--    changes nothing. Covers the same property as test 3 on a database with
--    only one company, where test 3 SKIPs.
do $$
declare
  v_journey uuid := (select id from journeys where status in ('in_progress', 'completed') limit 1);
  v_result  boolean;
  v_status  text;
begin
  if v_journey is null then
    raise notice 'SKIP: no started journey';
    return;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', gen_random_uuid())::text, true);

  select reset_journey(v_journey) into v_result;
  reset role;

  select status into v_status from journeys where id = v_journey;
  if v_result or v_status = 'scheduled' then
    raise exception 'FAIL: user with no company reset the journey (result=%, status=%)', v_result, v_status;
  end if;

  raise notice 'PASS: user with no company cannot reset the journey';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm <> 'rollback' then
      raise exception '%', sqlerrm;
    end if;
end $$;
