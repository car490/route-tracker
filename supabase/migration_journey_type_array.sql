-- migration_journey_type_array.sql
-- Convert routes.journey_type from scalar text to text[]
-- so a route can belong to more than one journey type category.
-- Apply in Supabase SQL Editor.

-- 1. Drop the old scalar check constraint FIRST — it must be gone before
--    the column type changes, otherwise Postgres tries to re-validate
--    "journey_type IN ('Local Bus', ...)" against a text[] column and
--    fails with "operator does not exist: text[] = text".
alter table public.routes
  drop constraint if exists routes_journey_type_check;

-- 2. Drop the view that also depends on the column (recreated at end).
drop view if exists schedule_view;

-- 3. Widen the column – wrap every existing scalar value in an array.
alter table public.routes
  alter column journey_type type text[]
  using array[journey_type];

-- 4. Ensure the array is never empty.
alter table public.routes
  add constraint routes_journey_type_nonempty
  check (array_length(journey_type, 1) > 0);

-- 5. Validate every element against the allowed set.
alter table public.routes
  add constraint routes_journey_type_valid
  check (journey_type <@ array[
    'Local Bus',
    'Open Door Schools',
    'Contract Schools',
    'Private Hire',
    'Excursion',
    'Tour',
    'Other Contract'
  ]::text[]);

-- 6. Recreate schedule_view (journey_type is now text[]).
create or replace view schedule_view as
  select
    ts.id               as timetable_stop_id,
    ts.sequence,
    ts.stop_type,
    ts.scheduled_time,
    s.name,
    s.lat,
    s.lon,
    s.is_depot,
    s.naptan_code,
    ts.timetable_id,
    t.period,
    t.direction,
    t.days_of_week,
    r.service_code,
    r.name              as route_name,
    r.journey_type
  from timetable_stops  ts
  join stops            s  on s.id = ts.stop_id
  join timetables       t  on t.id = ts.timetable_id
  join routes           r  on r.id = t.route_id
  order by r.service_code, t.period, t.direction, ts.sequence;

grant select on schedule_view to anon;
grant select on schedule_view to authenticated;
