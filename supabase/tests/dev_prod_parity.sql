-- supabase/tests/dev_prod_parity.sql
--
-- Verification for supabase/migration_dev_prod_parity.sql. Run it on BOTH dev
-- and production: it must pass on each, which is what makes the two agree.
-- Same rollback pattern as the other files here: every block that changes
-- anything raises 'rollback' at the end so nothing is kept.
-- Run with: psql <connection> -f supabase/tests/dev_prod_parity.sql
--
-- Why this exists (2026-09-29): a comparison of the two databases found that
-- production could not delete an employee (the trigger silently cancelled every
-- delete) or add a service county (the NaPTAN trigger called net.http_post with
-- the wrong argument type), while dev did both fine; and that dev let the public
-- anon key insert/update/delete on almost every table while production did not,
-- so a change tested on dev could be refused on production. Dev and production
-- are meant to have the same structure and the same access rules; only a
-- developer's local database may differ. scripts/db-drift/check.mjs proves the
-- two match; this file proves each behaves correctly.

-- 1. Deleting an employee who is not the last super_user removes the row.
--    (Production's trigger returned NEW, which is null on DELETE, so Postgres
--    skipped every delete without an error.)
do $$
declare
  v_company uuid;
  v_emp     uuid;
  v_left    int;
begin
  select id into v_company from companies limit 1;
  if v_company is null then raise notice 'SKIP: no company'; return; end if;

  insert into employees (company_id, name, access_level)
  values (v_company, 'Parity test driver', 'driver')
  returning id into v_emp;

  delete from employees where id = v_emp;

  select count(*) into v_left from employees where id = v_emp;
  if v_left <> 0 then raise exception 'FAIL: employee delete was silently skipped'; end if;

  raise notice 'PASS: an employee can be deleted';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'Rolled back test changes cleanly'; else raise exception '%', sqlerrm; end if;
end $$;

-- 2. The last super_user of a company still cannot be removed.
do $$
declare
  v_company uuid;
  v_emp     uuid;
  v_refused boolean := false;
begin
  insert into companies (name, operator_licence_number, traffic_area)
  values ('Parity test company', 'PARITY-TEST-' || gen_random_uuid(), 'East of England')
  returning id into v_company;
  insert into employees (company_id, name, access_level)
  values (v_company, 'Only super user', 'super_user')
  returning id into v_emp;

  begin
    delete from employees where id = v_emp;
  exception when others then
    v_refused := sqlerrm like '%must retain at least one super_user%';
  end;
  if not v_refused then raise exception 'FAIL: the last super_user was removed'; end if;

  raise notice 'PASS: the last super_user is protected';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'Rolled back test changes cleanly'; else raise exception '%', sqlerrm; end if;
end $$;

-- 3. Adding a service county succeeds. The trigger queues a NaPTAN import
--    through pg_net; the queued request is rolled back with everything else,
--    so nothing is sent. (Production passed a text body to net.http_post,
--    whose body is jsonb, so the whole update failed.)
do $$
declare
  v_company uuid;
begin
  select id into v_company from companies limit 1;
  if v_company is null then raise notice 'SKIP: no company'; return; end if;

  update companies
     set service_counties = array_append(coalesce(service_counties, '{}'), 'Parity Test County')
   where id = v_company;

  raise notice 'PASS: a service county can be added';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'Rolled back test changes cleanly'; else raise exception '%', sqlerrm; end if;
end $$;

-- 4. The anon key can write only where the Driver PWA / Announce sign need it
--    (everything else goes through security definer RPCs). Any other
--    INSERT/UPDATE/DELETE/TRUNCATE held by anon is a failure.
do $$
declare
  v_bad text;
begin
  select string_agg(c.relname || ':' || p, ', ' order by c.relname, p) into v_bad
  from pg_class c
  cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'v', 'p')
    and has_table_privilege('anon', c.oid, p)
    and (c.relname, p) not in (
      ('announcement_coverage_gap', 'INSERT'),
      ('diversion_alert_event', 'INSERT'),
      ('diversion_alert_event', 'UPDATE'),
      ('journey_events', 'INSERT'),
      ('journey_stop_times', 'INSERT'));
  if v_bad is not null then raise exception 'FAIL: anon can write to %', v_bad; end if;

  raise notice 'PASS: anon writes only where the devices need to';
end $$;

-- 5. A table created by a migration (as postgres) starts with the same rights
--    on both environments: anon read, authenticated read/write, service_role
--    nothing until granted explicitly (see CLAUDE.md, "grant service_role
--    explicitly").
do $$
declare
  v_oid oid;
begin
  create table public.parity_default_privileges_probe (id int);
  v_oid := 'public.parity_default_privileges_probe'::regclass;

  if has_table_privilege('anon', v_oid, 'INSERT') or not has_table_privilege('anon', v_oid, 'SELECT') then
    raise exception 'FAIL: a new table does not start anon on read-only';
  end if;
  if not has_table_privilege('authenticated', v_oid, 'INSERT') then
    raise exception 'FAIL: a new table does not start authenticated on read/write';
  end if;
  if has_table_privilege('service_role', v_oid, 'SELECT') then
    raise exception 'FAIL: a new table gives service_role access without an explicit grant';
  end if;

  raise notice 'PASS: a new table starts with the agreed default rights';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'Rolled back test changes cleanly'; else raise exception '%', sqlerrm; end if;
end $$;

-- 6. The retired Solo active-windows table is gone
--    (migration_announce_devices_drop_active_windows.sql, never applied to production).
do $$
begin
  if to_regclass('public.announce_device_active_windows') is not null then
    raise exception 'FAIL: announce_device_active_windows still exists';
  end if;
  raise notice 'PASS: announce_device_active_windows is gone';
end $$;
