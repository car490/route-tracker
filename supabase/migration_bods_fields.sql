-- ── BODS / GTFS readiness fields ─────────────────────────────────────────────
-- Adds the data the system needs to produce TransXChange / GTFS exports later.
-- Differentiates BODS-compliant journey types via requires_bods flag.
-- Run on top of schema.sql for live DB; schema.sql already incorporates these.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. journey_types: flag which types require BODS registration
alter table public.journey_types
  add column requires_bods boolean not null default false;

update public.journey_types
  set requires_bods = true
  where name in ('Local Bus', 'Open Door Schools');


-- 2. companies: National Operator Code (assigned by Traveline/DfT — mandatory for BODS)
alter table public.companies
  add column noc_code char(4) unique;


-- 3. routes: origin/destination description + Traffic Commissioner registration number
alter table public.routes
  add column origin text,
  add column destination text,
  add column service_registration_number text unique;


-- 4. stops: ATCO codes can be up to 12 chars — widen naptan_code from char(9) to text
-- schedule_view depends on naptan_code, so drop and recreate it around the ALTER.
drop view if exists public.schedule_view;

alter table public.stops
  alter column naptan_code type text;

create or replace view public.schedule_view as
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

grant select on public.schedule_view to anon;
grant select on public.schedule_view to authenticated;


-- 5. service_exceptions: bank holidays / exceptional added-or-removed dates per departure
create table public.service_exceptions (
  id                     uuid        primary key default gen_random_uuid(),
  timetable_departure_id uuid        not null references timetable_departures(id) on delete cascade,
  exception_date         date        not null,
  exception_type         text        not null
                           check (exception_type in ('added', 'removed')),
  -- 'removed': service does not run this date (e.g. bank holiday)
  -- 'added':   service runs on this date despite not being in days_of_week
  created_at             timestamptz not null default now(),
  unique (timetable_departure_id, exception_date)
);

grant select on public.service_exceptions to anon;
grant all    on public.service_exceptions to authenticated;

alter table public.service_exceptions enable row level security;

create policy "company_all" on public.service_exceptions
  for all to authenticated
  using (
    timetable_departure_id in (
      select td.id from timetable_departures td
      join timetables t on t.id = td.timetable_id
      join routes r     on r.id = t.route_id
      where r.company_id = current_company_id()
    )
  )
  with check (
    timetable_departure_id in (
      select td.id from timetable_departures td
      join timetables t on t.id = td.timetable_id
      join routes r     on r.id = t.route_id
      where r.company_id = current_company_id()
    )
  );

create index on public.service_exceptions (timetable_departure_id);
