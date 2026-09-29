-- Dev/production parity (2026-09-29). Idempotent; safe to re-run; the same
-- file is applied to dev and to production and leaves both identical.
--
-- A read-only comparison of the two databases (scripts/db-drift/check.mjs)
-- found they had drifted apart. Some drift hid real production bugs, some let
-- dev accept what production refuses. The rule from now on: dev and production
-- have the same structure and the same access rules; only a developer's local
-- database may differ. Proven by supabase/tests/dev_prod_parity.sql (run on
-- both) and scripts/db-drift/check.mjs (compares the two).
--
-- Reference for every value below: production's access rules (the stricter
-- and the one that runs), and schema.sql for names/definitions.

-- ── 1. Production bug: employees could not be deleted ───────────────────────
-- Production still had an old protect_last_super_user() that ended with
-- "return new". On DELETE, NEW is null, so a BEFORE DELETE trigger returning
-- it cancels the delete: every employee delete was silently skipped.
-- Definition as in schema.sql.
create or replace function public.protect_last_super_user()
returns trigger
language plpgsql
as $$
begin
  if old.access_level = 'super_user' and (tg_op = 'DELETE' or new.access_level != 'super_user') then
    if (
      select count(*) from employees
      where company_id = old.company_id
        and access_level = 'super_user'
        and id != old.id
    ) = 0 then
      raise exception 'A company must retain at least one super_user.';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ── 2. Production bug: adding a service county failed ───────────────────────
-- Production's copy passed body => (...)::text to net.http_post, whose body
-- parameter is jsonb; no such function exists, and because the trigger runs
-- after the update, the whole companies update was rejected. Definition as
-- in migration_naptan_trigger.sql (now also in schema.sql).
create or replace function public.fn_naptan_import_on_county_change()
returns trigger
language plpgsql
security definer
as $$
declare
  _new_counties  text[];
  _token         text;
  _url           text;
begin
  -- Find counties added (in NEW but not in OLD)
  select array_agg(c) into _new_counties
  from unnest(NEW.service_counties) c
  where c <> all(OLD.service_counties);

  -- Nothing added — nothing to do
  if _new_counties is null or array_length(_new_counties, 1) = 0 then
    return NEW;
  end if;

  -- Read service role key from vault
  select decrypted_secret into _token
  from vault.decrypted_secrets
  where name = 'naptan_import_token'
  limit 1;

  if _token is null then
    raise warning 'naptan_import_token not found in vault — new counties not imported automatically. Run import-naptan.js manually.';
    return NEW;
  end if;

  select value into _url from public.app_config where key = 'supabase_url';

  if _url is null then
    raise warning 'app_config.supabase_url not set — new counties not imported automatically. Run import-naptan.js manually.';
    return NEW;
  end if;

  -- Fire-and-forget async HTTP call via pg_net
  perform net.http_post(
    url     => _url || '/functions/v1/naptan-import',
    headers => jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || _token
    ),
    body    => jsonb_build_object(
      'counties', _new_counties,
      'mode',     'add'
    )
  );

  raise notice 'NAPTAN import triggered for counties: %', _new_counties;
  return NEW;
end;
$$;

revoke execute on function public.fn_naptan_import_on_county_change() from public, anon, authenticated;

-- ── 3. Production leftover: retired table ───────────────────────────────────
-- migration_announce_devices_drop_active_windows.sql dropped this on dev
-- (2026-09-04) but was never applied to production. Nothing reads it.
drop table if exists public.announce_device_active_windows;

-- ── 4. Names: production kept pre-rename names ──────────────────────────────
-- Same definitions, different names (production predates the staff ->
-- employees rename and two constraint re-creations). Renamed to the names
-- schema.sql produces, so a later migration that names one works on both.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('employee_contacts', 'staff_contacts_pkey',           'employee_contacts_pkey'),
      ('employee_contacts', 'staff_contacts_staff_id_fkey',  'employee_contacts_employee_id_fkey'),
      ('employee_contacts', 'staff_contacts_type_check',     'employee_contacts_type_check'),
      ('employees',         'staff_pkey',                    'employees_pkey'),
      ('employees',         'staff_auth_user_id_key',        'employees_auth_user_id_key'),
      ('employees',         'staff_auth_user_id_fkey',       'employees_auth_user_id_fkey'),
      ('employees',         'staff_company_id_fkey',         'employees_company_id_fkey'),
      ('employees',         'staff_role_check',              'employees_access_level_check'),
      ('routes',            'routes_journey_type_nonempty',  'routes_journey_type_check'),
      ('timetable_stops',   'timetable_stops_timing_check',  'timetable_stops_check')
    ) v(tbl, old_name, new_name)
  loop
    if exists (select 1 from pg_constraint
               where conrelid = ('public.' || r.tbl)::regclass and conname = r.old_name)
       and not exists (select 1 from pg_constraint
               where conrelid = ('public.' || r.tbl)::regclass and conname = r.new_name) then
      execute format('alter table public.%I rename constraint %I to %I', r.tbl, r.old_name, r.new_name);
    end if;
  end loop;
end $$;

alter index if exists public.staff_company_id_idx rename to employees_company_id_idx;

-- ── 5. Indexes that existed on one side only / on neither in schema.sql ─────
-- employees(company_id) is on both (added by hand, never in schema.sql);
-- employee_contacts(employee_id) was on dev only. Both back a foreign key the
-- dashboard filters on, so keep them everywhere.
create index if not exists employees_company_id_idx on public.employees (company_id);
create index if not exists employee_contacts_employee_id_idx on public.employee_contacts (employee_id);

-- ── 6. Table access: the same on both ───────────────────────────────────────
-- Dev let anon insert/update/delete on almost every table and gave
-- service_role everything, through dev's wider default privileges; production
-- did not. A change tested on dev could then be refused on production (or,
-- as with the Edge Function grants in CLAUDE.md, the reverse gap was hidden).
-- Every public table's rights for anon, authenticated and service_role are set
-- here explicitly to production's. RLS still decides which rows.
-- A public table missing from this list stops the migration, so nothing is
-- left on whatever an environment happened to have.
do $$
declare
  r        record;
  missing  text;
begin
  create temporary table parity_grants (tbl text primary key, anon text, authed text, service text) on commit drop;
  insert into parity_grants values
    ('announce_devices',          'select',                'select, insert, update, delete', null),
    ('announcement_clip_jobs',    null,                    null,                             'all'),
    ('announcement_clip_reviews', null,                    null,                             'select'),
    ('announcement_clips',        'select',                'select, insert, update, delete', 'all'),
    ('announcement_coverage_gap', 'select, insert',        'select, insert, update, delete', null),
    ('app_config',                null,                    null,                             'select'),
    ('companies',                 null,                    'select, insert, update, delete', null),
    ('diversion_alert_event',     'select, insert, update','select, insert, update, delete', null),
    ('drivers_hours_rules',       'select',                'select, insert, update, delete', null),
    ('elevenlabs_usage',          null,                    null,                             'select, insert'),
    ('employee_availability',     'select',                'select, insert, update, delete', null),
    ('employee_contacts',         'select',                'select, insert, update, delete', null),
    ('employees',                 'select',                'select, insert, update, delete', null),
    ('journey_events',            'select, insert',        'select, insert, update, delete', null),
    ('journey_stop_times',        'select, insert',        'select, insert, update, delete', null),
    ('journey_types',             'select',                'select',                         null),
    ('journey_waypoints',         'select',                'select, insert, update, delete', null),
    ('journeys',                  'select',                'select, insert, update, delete', null),
    ('naptan_stops',              'select',                'select, insert, update, delete', 'all'),
    ('routes',                    'select',                'select, insert, update, delete', null),
    ('schedule_view',             'select',                'select, insert, update, delete', null),
    ('service_exceptions',        'select',                'select, insert, update, delete', null),
    ('stop_time_upload_problem',  null,                    'select',                         null),
    ('stops',                     'select',                'select, insert, update, delete', null),
    ('term_dates',                'select',                'select',                         null),
    ('timetable_departures',      'select',                'select, insert, update, delete', null),
    ('timetable_stops',           'select',                'select, insert, update, delete', 'select'),
    ('timetables',                'select',                'select, insert, update, delete', null),
    ('vehicle_audio_config',      'select',                'select, insert, update, delete', null),
    ('vehicles',                  'select',                'select, insert, update, delete', null);

  select string_agg(c.relname, ', ' order by c.relname) into missing
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'v', 'm', 'p')
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    and c.relname not in (select tbl from parity_grants);
  if missing is not null then
    raise exception 'dev/prod parity: no agreed access for public table(s) %; add them to this list', missing;
  end if;

  for r in select * from parity_grants loop
    continue when to_regclass('public.' || r.tbl) is null;
    execute format('revoke all on public.%I from anon, authenticated, service_role', r.tbl);
    if r.anon    is not null then execute format('grant %s on public.%I to anon',          r.anon,    r.tbl); end if;
    if r.authed  is not null then execute format('grant %s on public.%I to authenticated', r.authed,  r.tbl); end if;
    if r.service is not null then execute format('grant %s on public.%I to service_role',  r.service, r.tbl); end if;
  end loop;
end $$;

-- anon reads branding columns only (migration_security_hardening_phase1.sql);
-- the revoke above also removed these column grants.
grant select (id, name, logo_path, primary_color, accent_color) on public.companies to anon;

-- Sequences (the identity columns of announcement_clip_reviews and
-- elevenlabs_usage): authenticated only, as on production. Identity inserts
-- by service_role don't need sequence rights.
do $$
declare
  s record;
begin
  for s in select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'S' loop
    execute format('revoke all on sequence public.%I from anon, authenticated, service_role', s.relname);
    execute format('grant usage, select, update on sequence public.%I to authenticated', s.relname);
  end loop;
end $$;

-- ── 7. Default rights for tables/functions created later ────────────────────
-- What production gives a new object created by a migration (as postgres):
-- tables: anon read, authenticated read/write, service_role nothing until
-- granted explicitly; sequences: authenticated only; functions: the Postgres
-- default (EXECUTE to PUBLIC, revoked per function where needed). Dev's wider
-- defaults are what let its tables drift. (Supabase's own supabase_admin
-- defaults can't be changed from here; they only affect objects Supabase
-- itself creates — see scripts/db-drift/expected-differences.json.)
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant select on tables to anon;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to authenticated;

alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to public;
