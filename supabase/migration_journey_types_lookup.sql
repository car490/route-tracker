-- migration_journey_types_lookup.sql
-- Moves journey type list from hardcoded CHECK constraints into a lookup table.
-- Adds journey_types text[] to staff for employee qualification tracking.
--
-- Apply via Supabase SQL Editor or Management API.

-- 1. Lookup table
create table public.journey_types (
  name       text    primary key,
  sort_order integer not null default 0
);

grant select on public.journey_types to anon;
grant all    on public.journey_types to authenticated;

-- 2. Seed existing values (preserve display order)
insert into public.journey_types (name, sort_order) values
  ('Local Bus',          1),
  ('Open Door Schools',  2),
  ('Contract Schools',   3),
  ('Private Hire',       4),
  ('Excursion',          5),
  ('Tour',               6),
  ('Other Contract',     7);

-- 3. Drop hardcoded CHECK on routes.journey_type (named by previous migration)
alter table public.routes drop constraint if exists routes_journey_type_valid;

-- 4. Drop hardcoded CHECK on journeys.journey_type (auto-named by Postgres)
alter table public.journeys drop constraint if exists journeys_journey_type_check;

-- 5. Add journey_types to employees (table was renamed from staff by migration_rename_staff_to_employees.sql)
alter table public.employees
  add column if not exists journey_types text[] not null default '{}';
