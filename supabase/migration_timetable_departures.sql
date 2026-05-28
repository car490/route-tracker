-- ============================================================
-- Migration: Timetable Departures
--
-- Splits timetables into two tiers:
--   timetables        = named stop-sequence pattern (direction, ordered stops with offsets)
--   timetable_departures = when a pattern runs (departure_time, days_of_week, timing_profile)
--
-- journeys now references timetable_departures instead of timetables directly.
-- timetable_stops.scheduled_time replaced by offset_standard / offset_delay / offset_early.
-- ============================================================

-- ── Step 1: Add name column to timetables ─────────────────────────────────────
-- Derive from existing period + direction; make not null after populating.

alter table timetables add column name text;
update timetables set name = period || ' ' || direction;
alter table timetables alter column name set not null;


-- ── Step 2: Add offset columns to timetable_stops ────────────────────────────

alter table timetable_stops add column offset_standard int;
alter table timetable_stops add column offset_delay    int;
alter table timetable_stops add column offset_early    int;


-- ── Step 3: Create timetable_departures ──────────────────────────────────────

create table public.timetable_departures (
  id                   uuid        primary key default gen_random_uuid(),
  timetable_id         uuid        not null references timetables(id) on delete cascade,
  departure_time       time        not null,
  days_of_week         int[]       not null default '{1,2,3,4,5}',
  timing_profile       text        not null default 'standard'
                         check (timing_profile in ('standard', 'delay', 'early')),
  valid_from           date,
  valid_to             date,
  vehicle_journey_code text        not null,
  created_at           timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);

grant select on public.timetable_departures to anon;
grant all    on public.timetable_departures to authenticated;

alter table public.timetable_departures enable row level security;

create policy "anon_read" on public.timetable_departures
  for select to anon using (true);

create policy "company_all" on public.timetable_departures
  for all to authenticated
  using (
    timetable_id in (
      select t.id from timetables t
      join routes r on r.id = t.route_id
      where r.company_id = current_company_id()
    )
  )
  with check (
    timetable_id in (
      select t.id from timetables t
      join routes r on r.id = t.route_id
      where r.company_id = current_company_id()
    )
  );

create index on timetable_departures (timetable_id);


-- ── Step 4: Populate timetable_departures from existing timetables ────────────
-- One departure per timetable, using the first timing stop's scheduled_time as
-- departure_time. vehicle_journey_code = VJ1, VJ2... per route.

insert into timetable_departures
  (timetable_id, departure_time, days_of_week, timing_profile, valid_from, valid_to, vehicle_journey_code)
select
  t.id,
  coalesce(
    (select ts.scheduled_time from timetable_stops ts
     where ts.timetable_id = t.id
       and ts.scheduled_time is not null
     order by ts.sequence limit 1),
    '09:00'::time
  ),
  t.days_of_week,
  'standard',
  t.valid_from,
  t.valid_to,
  'VJ' || row_number() over (partition by t.route_id order by t.created_at)
from timetables t;


-- ── Step 5: Populate offset columns on timetable_stops ───────────────────────
-- offset = stop's scheduled_time minus the departure_time for this timetable.
-- Routing points (scheduled_time IS NULL) keep offsets NULL.

update timetable_stops ts
set
  offset_standard = round(
    extract(epoch from (
      ts.scheduled_time - (
        select td.departure_time from timetable_departures td
        where td.timetable_id = ts.timetable_id limit 1
      )
    )) / 60
  )::int,
  offset_delay = round(
    extract(epoch from (
      ts.scheduled_time - (
        select td.departure_time from timetable_departures td
        where td.timetable_id = ts.timetable_id limit 1
      )
    )) / 60
  )::int,
  offset_early = round(
    extract(epoch from (
      ts.scheduled_time - (
        select td.departure_time from timetable_departures td
        where td.timetable_id = ts.timetable_id limit 1
      )
    )) / 60
  )::int
where ts.scheduled_time is not null;


-- ── Step 6: Add timetable_departure_id and timing_profile to journeys ─────────

alter table journeys
  add column timetable_departure_id uuid references timetable_departures(id),
  add column timing_profile         text check (timing_profile in ('standard', 'delay', 'early'));


-- ── Step 7: Populate timetable_departure_id from existing timetable_id ────────

update journeys j
set timetable_departure_id = td.id
from timetable_departures td
where td.timetable_id = j.timetable_id;


-- ── Step 8: Replace the no-double-booking unique index ────────────────────────

drop index if exists journeys_no_double_booking;
create unique index journeys_no_double_booking
  on journeys (timetable_departure_id, journey_date)
  where status != 'cancelled' and timetable_departure_id is not null;

create index on journeys (timetable_departure_id);


-- ── Step 9: Update check constraint on journeys ───────────────────────────────
-- Drop the old check (timetable_id is not null or journey_type is not null).
-- Postgres auto-names it journeys_check; use IF EXISTS for safety.

alter table journeys drop constraint if exists journeys_check;
alter table journeys add constraint journeys_check
  check (timetable_departure_id is not null or journey_type is not null);


-- ── Step 10: Drop scheduled_time from timetable_stops ────────────────────────
-- Drop schedule_view first (it references scheduled_time); recreated in Step 13.

drop view if exists schedule_view;

alter table timetable_stops drop constraint if exists timetable_stops_check;
alter table timetable_stops add constraint timetable_stops_timing_check
  check (stop_type = 'routing_point' or offset_standard is not null);
alter table timetable_stops drop column scheduled_time;


-- ── Step 11: Drop obsolete columns from timetables ───────────────────────────
-- valid_from/valid_to have a table-level check; drop it first.

alter table timetables drop constraint if exists timetables_check;
alter table timetables drop column period;
alter table timetables drop column days_of_week;
alter table timetables drop column valid_from;
alter table timetables drop column valid_to;


-- ── Step 12: Drop timetable_id from journeys ─────────────────────────────────
-- The plain index and FK constraint are dropped automatically with the column.

drop index if exists journeys_timetable_id_idx;
alter table journeys drop column timetable_id;


-- ── Step 13: Recreate schedule_view ──────────────────────────────────────────
-- Now returns one row per (departure × stop).
-- scheduled_time is computed as departure_time + offset for the departure's profile.
-- Filter by departure_id to get a specific departure's stops.

drop view if exists schedule_view;

create or replace view schedule_view as
  select
    ts.id                as timetable_stop_id,
    ts.sequence,
    ts.stop_type,
    (td.departure_time + make_interval(mins =>
      case td.timing_profile
        when 'delay' then coalesce(ts.offset_delay, ts.offset_standard, 0)
        when 'early' then coalesce(ts.offset_early, ts.offset_standard, 0)
        else              coalesce(ts.offset_standard, 0)
      end
    ))::time             as scheduled_time,
    ts.offset_standard,
    ts.offset_delay,
    ts.offset_early,
    s.name,
    s.lat,
    s.lon,
    s.is_depot,
    s.naptan_code,
    ts.timetable_id,
    td.id                as departure_id,
    td.departure_time,
    td.timing_profile,
    td.days_of_week,
    td.vehicle_journey_code,
    t.name               as timetable_name,
    t.direction,
    r.service_code,
    r.name               as route_name,
    r.journey_type
  from timetable_stops     ts
  join stops               s  on s.id  = ts.stop_id
  join timetables          t  on t.id  = ts.timetable_id
  join timetable_departures td on td.timetable_id = t.id
  join routes              r  on r.id  = t.route_id
  order by r.service_code, td.departure_time, ts.sequence;

grant select on schedule_view to anon;
grant select on schedule_view to authenticated;


-- ── Step 14: Update compute_stop_time_variance trigger function ───────────────
-- Now joins through timetable_departures to get departure_time and profile.

create or replace function compute_stop_time_variance()
returns trigger
language plpgsql
as $$
declare
  v_scheduled_at  timestamptz;
  v_stop_type     text;
begin
  if new.timetable_stop_id is not null then
    select
      (j.journey_date +
        td.departure_time +
        make_interval(mins =>
          case coalesce(j.timing_profile, td.timing_profile)
            when 'delay' then coalesce(ts.offset_delay, ts.offset_standard, 0)
            when 'early' then coalesce(ts.offset_early, ts.offset_standard, 0)
            else              coalesce(ts.offset_standard, 0)
          end
        )
      ) at time zone 'Europe/London',
      ts.stop_type
    into v_scheduled_at, v_stop_type
    from timetable_stops      ts
    join journeys             j  on j.id  = new.journey_id
    join timetable_departures td on td.id = j.timetable_departure_id
    where ts.id = new.timetable_stop_id;

  elsif new.journey_waypoint_id is not null then
    select jw.scheduled_at,
           jw.stop_type
    into   v_scheduled_at, v_stop_type
    from   journey_waypoints jw
    where  jw.id = new.journey_waypoint_id;
  end if;

  if v_stop_type = 'timing_point' and v_scheduled_at is not null then
    new.arrival_variance_seconds :=
      extract(epoch from (new.arrived_at - v_scheduled_at))::int;
    new.is_early_arrival := new.arrival_variance_seconds < 0;

    if new.departed_at is not null then
      new.departure_variance_seconds :=
        extract(epoch from (new.departed_at - v_scheduled_at))::int;
      new.is_early_departure := new.departure_variance_seconds < 0;
    end if;
  end if;

  return new;
end;
$$;


-- ── Step 15: Update get_duty_card function ────────────────────────────────────
-- Returns timetable_departure_id + timetable_name instead of timetable_id + period.

CREATE OR REPLACE FUNCTION public.get_duty_card(journey_ids uuid[])
 RETURNS TABLE(
   journey_id             uuid,
   status                 text,
   started_at             timestamp with time zone,
   completed_at           timestamp with time zone,
   driver_name            text,
   vehicle_registration   text,
   service_code           text,
   route_name             text,
   timetable_name         text,
   direction              text,
   timetable_departure_id uuid,
   first_stop_time        text,
   last_stop_name         text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select
    j.id,
    j.status,
    j.started_at,
    j.completed_at,
    coalesce(e.name, 'Driver')                               as driver_name,
    coalesce(v.registration, 'Unknown')                      as vehicle_registration,
    r.service_code,
    r.name                                                   as route_name,
    t.name                                                   as timetable_name,
    t.direction,
    td.id                                                    as timetable_departure_id,
    to_char(td.departure_time, 'HH24:MI')                   as first_stop_time,
    (select st.name from timetable_stops ts3
     join stops st on st.id = ts3.stop_id
     where ts3.timetable_id = t.id order by ts3.sequence desc limit 1) as last_stop_name
  from journeys j
  left join employees           e  on e.id  = j.driver_id
  left join vehicles            v  on v.id  = j.vehicle_id
  left join timetable_departures td on td.id = j.timetable_departure_id
  left join timetables          t  on t.id  = td.timetable_id
  left join routes              r  on r.id  = t.route_id
  where j.id = any(journey_ids)
  order by array_position(journey_ids, j.id)
$function$;

grant execute on function get_duty_card(uuid[]) to anon;
