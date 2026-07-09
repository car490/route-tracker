-- ============================================================
-- RouteTracker v2  —  Schema
-- Redesigned for normalisation, scalability, and multi-tenancy
-- Run on a fresh Supabase project (Settings → Database → Reset database)
-- ============================================================


-- ── Companies ────────────────────────────────────────────────────────────────
-- Top of the ownership tree. Every other record is scoped to a company.

create table companies (
  id                        uuid        primary key default gen_random_uuid(),
  name                      text        not null,
  trading_name              text,
  companies_house_number    char(8)     unique,                    -- nullable: sole traders have none
  operator_licence_number   text        not null unique,           -- PSV licence: required for all operators
  traffic_area              text        not null
                              check (traffic_area in (
                                'North East of England',
                                'North West of England',
                                'East of England',
                                'West Midlands',
                                'West of England',
                                'London and the South East of England',
                                'Wales',
                                'Scotland'
                              )),
  status                    text        not null default 'pending'
                              check (status in ('pending', 'active', 'suspended')),
  -- Central operations location (main depot / registered office)
  address_line_1            text,
  address_line_2            text,
  city                      text,
  postcode                  text,
  lat                       float8,
  lon                       float8,
  -- From DVSA VOL dataset
  vehicles_authorised       int,
  email                     text,
  -- BODS: National Operator Code assigned by Traveline/DfT (mandatory for BODS publishing)
  noc_code                  char(4)     unique,
  -- Logo stored in Supabase Storage bucket 'operator-assets' at path {company_id}/logo.*
  logo_path                 text,
  -- County names used to build the NAPTAN import bounding box via OpenCage.
  -- Multiple counties supported for operators whose routes cross county lines.
  service_counties          text[]      not null default '{}',
  -- Multi-tenant branding ("The Wrap")
  -- slug: URL-safe identifier used in future public tracking pages (e.g. 'phil-haines-coaches')
  slug                      text        unique,
  -- Sidebar/header colour — defaults to CoachMate Tarmac Charcoal
  primary_color             text        not null default '#242F35',
  -- Button/highlight colour — defaults to CoachMate Signal Cyan
  accent_color              text        not null default '#00B4D8',
  created_at                timestamptz not null default now()
);


-- ── Drivers' hours rules ──────────────────────────────────────────────────────
-- Static reference table — values are set by regulation, not by the operator.
-- All time values in minutes. NULL = no statutory limit / not applicable to this regime.
-- Must be defined before employees as employees.hours_rule references it.

create table drivers_hours_rules (
  id                           text     primary key,
  label                        text     not null,
  max_daily_driving_mins       smallint,
  max_daily_duty_spread_mins   smallint,
  max_continuous_driving_mins  smallint,
  min_break_mins               smallint,
  break_can_be_split           boolean  not null default false,
  min_split_break_mins         smallint,
  min_daily_rest_mins          smallint,
  max_weekly_driving_mins      smallint,
  min_weekly_rest_mins         smallint,
  max_fortnightly_driving_mins smallint,
  notes                        text
);

grant select on drivers_hours_rules to anon;
grant select on drivers_hours_rules to authenticated;

alter table drivers_hours_rules enable row level security;

create policy "anon_read" on drivers_hours_rules for select to anon using (true);
create policy "auth_read" on drivers_hours_rules for select to authenticated using (true);

insert into drivers_hours_rules
  (id, label,
   max_daily_driving_mins, max_daily_duty_spread_mins,
   max_continuous_driving_mins, min_break_mins, break_can_be_split, min_split_break_mins,
   min_daily_rest_mins,
   max_weekly_driving_mins, min_weekly_rest_mins, max_fortnightly_driving_mins,
   notes)
values
(
  'DOMESTIC_GB', 'Domestic GB (PSV)',
  600, 960, 330, 30, true, 15, 600, null, null, null,
  'Applies to PSV operations within Great Britain. Break may be taken as two separate periods of at least 15 minutes each.'
),
(
  'AETR', 'AETR (International)',
  540, null, 270, 45, true, 15, 660, 3360, 2700, 5400,
  'Applies to international passenger transport to/from AETR signatory countries. Daily driving extendable to 600 mins twice per week. Daily rest reducible to 540 mins up to 3 times between weekly rests.'
),
(
  'EXEMPT', 'Exempt (Community/Permit)',
  null, null, null, null, false, null, null, null, null, null,
  'S19/S22 permit services where drivers are not required to hold PCV entitlement. Statutory drivers hours rules do not apply.'
);


-- ── Employees ─────────────────────────────────────────────────────────────────
-- Covers all roles: drivers (no dashboard login) and ops/admin (auth_user_id set).
-- Platform-level admin (us) operates via the Supabase service role, not this table.

create table employees (
  id              uuid        primary key default gen_random_uuid(),
  company_id      uuid        not null references companies(id) on delete cascade,
  auth_user_id    uuid        unique references auth.users(id) on delete set null,
  name            text        not null,
  access_level    text        not null
                    check (access_level in ('super_user', 'ops_manager', 'driver')),
  job_role        text        check (job_role  in ('DRIVER', 'OPS', 'OFFICE')),
  status          text        not null default 'AVAILABLE'
                    check (status in ('AVAILABLE', 'UNAVAILABLE')),
  work_type       text        check (work_type in ('FTE', 'SPLITSHIFT', 'TEMP')),
  hours_rule      text        not null default 'DOMESTIC_GB'
                    references drivers_hours_rules(id),
  journey_types   text[]      not null default '{}',
  created_at      timestamptz not null default now()
);


-- ── Employee contacts ─────────────────────────────────────────────────────────
-- Multiple contact methods per employee; exactly one may be primary.
-- Added via migration_staff_contacts_table.sql — included here for completeness.

create table employee_contacts (
  id          uuid        primary key default gen_random_uuid(),
  employee_id uuid        not null references employees(id) on delete cascade,
  type        text        not null check (type in ('email', 'phone')),
  value       text        not null,
  is_primary  boolean     not null default false,
  created_at  timestamptz not null default now()
);

create unique index employee_contacts_one_primary
  on employee_contacts (employee_id)
  where is_primary = true;


-- ── Employee availability ─────────────────────────────────────────────────────
-- One row per time window per working day.
-- FTE: one row per day.  SPLITSHIFT: two rows per day (AM + PM window).
-- day_of_week: 0 = Monday … 6 = Sunday (ISO week order).

create table employee_availability (
  id            uuid      primary key default gen_random_uuid(),
  employee_id   uuid      not null references employees(id) on delete cascade,
  day_of_week   smallint  not null check (day_of_week between 0 and 6),
  window_start  time      not null,
  window_end    time      not null,
  check (window_end > window_start)
);

create index on employee_availability (employee_id);


-- ── Vehicles ──────────────────────────────────────────────────────────────────
-- UK registrations are nationally unique — not scoped to company.
-- status may only be changed by a super_user (enforced by trigger below).

create table vehicles (
  id                uuid        primary key default gen_random_uuid(),
  company_id        uuid        not null references companies(id) on delete cascade,
  registration      text        not null unique,
  fleet_number      text,
  make              text,
  model             text,
  year              smallint,
  vehicle_type      text        not null
                      check (vehicle_type in (
                        'Minibus',
                        'Midi Coach',
                        'Full Size Coach',
                        'Single Decker Bus',
                        'Double Decker'
                      )),
  fuel_type         text        not null
                      check (fuel_type in (
                        'Diesel',
                        'Petrol',
                        'Electric',
                        'Hybrid',
                        'Hydrogen'
                      )),
  seating_capacity  int,
  height_metres     float8,                                -- overall vehicle height (m) — used by route planner
  width_metres      float8,                                -- overall vehicle width (m)
  length_metres     float8,                                -- overall vehicle length (m)
  status            text        not null default 'active'
                      check (status in ('active', 'off_road', 'disposed')),
  created_at        timestamptz not null default now()
);


-- ── Stops (global — not company-scoped) ───────────────────────────────────────
-- Physical bus stops shared across all companies and routes.
-- naptan_code reserved for Phase 5 BODS integration.
-- Only super_user employees may create or modify stops (enforced by RLS).

create table stops (
  id              uuid        primary key default gen_random_uuid(),
  name            text        not null,
  lat             float8      not null,
  lon             float8      not null,
  naptan_code     text        unique,   -- NaPTAN ATCO code (up to 12 chars)
  is_depot        boolean     not null default false,
  created_at      timestamptz not null default now()
);


-- ── NAPTAN reference data ─────────────────────────────────────────────────────
-- Raw NAPTAN bus stop data, updated weekly via supabase/scripts/import-naptan.js.
-- Global read-only reference — separate from the operational stops table.
-- The route planner queries naptan_near_point() after pin-drop/address selection.

create table naptan_stops (
  atco_code     text        primary key,
  naptan_code   text,
  common_name   text        not null,
  locality_name text,
  street        text,
  indicator     text,
  bearing       text,
  lat           float8      not null,
  lon           float8      not null,
  stop_type     text        not null default 'BCT',
  status        text        not null default 'active',
  updated_at    timestamptz not null default now()
);

create index naptan_stops_coords_idx on naptan_stops (lat, lon);

grant select on public.naptan_stops to anon, authenticated;
grant all    on public.naptan_stops to service_role;

-- Computed "<locality>, <landmark> (<indicator>)" display name for a stop,
-- derived from naptan_stops via stops.naptan_code. Falls back to stops.name
-- when there's no NAPTAN match (e.g. stops outside imported counties).
-- Exposed via PostgREST as a computed column: select=name,display_name
create or replace function public.display_name(s stops)
returns text
language sql
stable
as $$
  select coalesce(
    (select n.locality_name || ', ' || n.common_name ||
       case when n.indicator is not null and n.indicator <> '' then ' (' || n.indicator || ')' else '' end
     from naptan_stops n
     where n.atco_code = s.naptan_code),
    s.name
  )
$$;

grant execute on function public.display_name(stops) to anon, authenticated;


-- ── App config (internal) ─────────────────────────────────────────────────────
-- Small key/value settings table for SQL-side config that can't use
-- ALTER DATABASE SET (Supabase's pooled roles can't run that). Currently
-- holds 'supabase_url', read by the NAPTAN trigger/cron in migration_naptan_trigger.sql
-- to build the naptan-import Edge Function URL. Per-environment row, set manually:
--   insert into public.app_config (key, value) values ('supabase_url', 'https://PROJECT_REF.supabase.co')
--   on conflict (key) do update set value = excluded.value, updated_at = now();
-- Deliberately not exposed via PostgREST: no anon/authenticated grants,
-- RLS enabled with no policies (default-deny for any non-owner role).

create table if not exists public.app_config (
  key        text        primary key,
  value      text        not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;


-- ── Journey types lookup ──────────────────────────────────────────────────────
-- Source of truth for valid journey type values. Replaces hardcoded CHECK constraints.

create table journey_types (
  name          text    primary key,
  sort_order    integer not null default 0,
  requires_bods boolean not null default false
);

grant select on public.journey_types to anon;
grant all    on public.journey_types to authenticated;

alter table public.journey_types enable row level security;

create policy "anon_read" on public.journey_types
  for select to anon using (true);

create policy "auth_all" on public.journey_types
  for all to authenticated using (true) with check (true);


-- ── Term dates ────────────────────────────────────────────────────────────────
-- Reference data for auto-filling school-contract departure date ranges in the
-- dashboard (Route Wizard / Departures card). Seeded from Lincolnshire County
-- Council's published term dates — there is no machine-readable government
-- source for this, so update it by hand each year as new dates are published:
-- https://www.lincolnshire.gov.uk/school-attendance/school-term-times

create table term_dates (
  id            uuid        primary key default gen_random_uuid(),
  academic_year text        not null,          -- e.g. '2025-26'
  term_name     text        not null,          -- e.g. 'Term 1'
  start_date    date        not null,
  end_date      date        not null,
  created_at    timestamptz not null default now(),
  check (end_date >= start_date),
  unique (academic_year, term_name)
);

grant select on public.term_dates to anon;
grant all    on public.term_dates to authenticated;

alter table public.term_dates enable row level security;

create policy "anon_read" on public.term_dates
  for select to anon using (true);

create policy "auth_all" on public.term_dates
  for all to authenticated using (true) with check (true);


-- ── Routes ────────────────────────────────────────────────────────────────────

create table routes (
  id              uuid        primary key default gen_random_uuid(),
  company_id      uuid        not null references companies(id) on delete cascade,
  service_code    text        not null,
  name            text,
  journey_type    text[]      not null
                    check (array_length(journey_type, 1) > 0),
  single_journey  boolean     not null default false,
  -- BODS / TransXChange fields (required when journey_type requires_bods = true)
  origin                      text,       -- service description start, e.g. "Spalding"
  destination                 text,       -- service description end, e.g. "Peterborough"
  service_registration_number text        unique, -- Traffic Commissioner registration, e.g. "PC0006014:1"
  created_at      timestamptz not null default now(),
  unique (company_id, service_code)
);


-- ── Timetables ────────────────────────────────────────────────────────────────
-- A named stop-sequence pattern for a route (e.g. "Standard Outbound", "School Run Inbound").
-- Multiple departures (timetable_departures) reference each pattern; they carry
-- the departure_time, days_of_week, and timing_profile.

create table timetables (
  id              uuid        primary key default gen_random_uuid(),
  route_id        uuid        not null references routes(id) on delete cascade,
  name            text        not null,
  direction       text        not null
                    check (direction in ('Outbound', 'Inbound', 'Circular', 'Morning', 'Afternoon')),
  created_at      timestamptz not null default now()
);


-- ── Timetable stops ───────────────────────────────────────────────────────────
-- The ordered list of stops for a timetable pattern.
-- stop_type = 'timing_point' : shown in driver app with scheduled time, GPS arrival tracked.
-- stop_type = 'routing_point': used for map/directions only, not shown in timing list.
-- Times stored as offsets (minutes from departure_time) in three traffic profiles:
--   offset_standard: normal conditions
--   offset_delay:    peak / heavy traffic
--   offset_early:    light / off-peak
-- Routing points keep all three offsets NULL.
-- First stop in sequence always has offset = 0 (departure_time IS the first stop time).

create table timetable_stops (
  id              uuid        primary key default gen_random_uuid(),
  timetable_id    uuid        not null references timetables(id) on delete cascade,
  stop_id         uuid        not null references stops(id),
  sequence        int         not null,
  stop_type       text        not null
                    check (stop_type in ('timing_point', 'routing_point')),
  offset_standard int,
  offset_delay    int,
  offset_early    int,
  created_at      timestamptz not null default now(),
  unique (timetable_id, sequence),
  check (stop_type = 'routing_point' or offset_standard is not null)
);


-- ── Timetable departures ──────────────────────────────────────────────────────
-- A specific departure slot for a timetable pattern: when it runs and under which
-- traffic profile. Multiple departures can reference the same timetable pattern.
-- vehicle_journey_code: stable BODS/TransXChange identifier, unique per route.
-- timing_profile: which offset set to apply (standard / delay / early).
-- journey.timing_profile can override this per-instance.

create table timetable_departures (
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


-- ── Service exceptions ────────────────────────────────────────────────────────
-- Bank holidays and exceptional added/removed dates for a specific departure.
-- exception_type = 'removed': service does not run on this date (e.g. bank holiday).
-- exception_type = 'added':   service runs on this date despite not matching days_of_week.

create table service_exceptions (
  id                     uuid        primary key default gen_random_uuid(),
  timetable_departure_id uuid        not null references timetable_departures(id) on delete cascade,
  exception_date         date        not null,
  exception_type         text        not null
                           check (exception_type in ('added', 'removed')),
  created_at             timestamptz not null default now(),
  unique (timetable_departure_id, exception_date)
);

grant select on public.service_exceptions to anon;
grant all    on public.service_exceptions to authenticated;

create index on service_exceptions (timetable_departure_id);
-- RLS enable + policy added after helper functions below


-- ── Journeys ──────────────────────────────────────────────────────────────────
-- An instance of a timetable departure running on a specific date, assigned to driver + vehicle.
-- timetable_departure_id is nullable: ad-hoc jobs (Private Hire, Excursion, Tour) have none.
-- company_id is stored directly for efficient RLS without chasing FK joins.
-- For ad-hoc journeys, journey_type must be set directly (cannot be derived from departure).
-- timing_profile overrides the departure's default profile for this specific instance.

create table journeys (
  id                     uuid        primary key default gen_random_uuid(),
  company_id             uuid        not null references companies(id) on delete cascade,
  timetable_departure_id uuid        references timetable_departures(id),
  journey_date           date        not null,
  journey_type           text,
  timing_profile         text        check (timing_profile in ('standard', 'delay', 'early')),
  driver_id              uuid        references employees(id) on delete set null,
  vehicle_id             uuid        references vehicles(id) on delete set null,
  status                 text        not null default 'scheduled'
                           check (status in (
                             'scheduled',
                             'in_progress',
                             'completed',
                             'cancelled'
                           )),
  notes                  text,
  started_at             timestamptz,
  completed_at           timestamptz,
  created_at             timestamptz not null default now(),
  check (timetable_departure_id is not null or journey_type is not null),
  check (completed_at is null or started_at is null or completed_at >= started_at)
);

-- A departure slot can run at most once per day (cancelled journeys excluded).
create unique index journeys_no_double_booking
  on journeys (timetable_departure_id, journey_date)
  where status != 'cancelled' and timetable_departure_id is not null;


-- ── Journey waypoints ─────────────────────────────────────────────────────────
-- Itinerary for ad-hoc journeys (Private Hire, Excursion, Tour, Other Contract).
-- Each waypoint is either a timing_point (scheduled datetime, may be a known stop
-- or a free-text address) or a routing_point (via point, no time required).
-- Timetabled journeys use timetable_stops instead; this table is not used for them.

create table journey_waypoints (
  id              uuid        primary key default gen_random_uuid(),
  journey_id      uuid        not null references journeys(id) on delete cascade,
  sequence        int         not null,
  stop_id         uuid        references stops(id),     -- set if pickup is a known public stop
  name            text,                                 -- free-text when stop_id is null
  lat             float8,
  lon             float8,
  stop_type       text        not null
                    check (stop_type in ('timing_point', 'routing_point')),
  scheduled_at    timestamptz,                          -- full datetime; null for routing points
  notes           text,
  created_at      timestamptz not null default now(),
  unique (journey_id, sequence),
  check (stop_id is not null or (name is not null and lat is not null and lon is not null)),
  check (stop_type = 'routing_point' or scheduled_at is not null)
);


-- ── Journey events ────────────────────────────────────────────────────────────
-- event_type values:
--   'incident'  — driver-reported incident; ops review required.
--   'gps_fix'   — periodic GPS position from the driver PWA (every ~30 s while in_progress).
--                 lat/lon/occurred_at/metadata used; timetable_stop_id and journey_waypoint_id are null.
-- Journey start/end is captured in journeys.started_at / completed_at.
-- timetable_stop_id / journey_waypoint_id: optional location context for incidents.

create table journey_events (
  id                    uuid        primary key default gen_random_uuid(),
  journey_id            uuid        not null references journeys(id) on delete cascade,
  event_type            text        not null
                          check (event_type in ('incident', 'gps_fix')),
  timetable_stop_id     uuid        references timetable_stops(id),
  journey_waypoint_id   uuid        references journey_waypoints(id),
  lat                   float8,
  lon                   float8,
  occurred_at           timestamptz not null default now(),
  metadata              jsonb,
  created_at            timestamptz not null default now()
);


-- ── Journey stop times ────────────────────────────────────────────────────────
-- Batch-uploaded at trip end by the driver app. One row per stop per journey.
-- Covers both timing points and routing points on timetabled and ad-hoc journeys.
--
-- arrived_at    : when the vehicle reached the stop. Null for a skipped stop
--                 (visit_status = 'skipped_signal'/'skipped_detour') — the driver
--                 app never got a real geofence entry for it, only inferred it was
--                 bypassed when a later stop's geofence matched instead.
-- departed_at   : set only when the vehicle waited at a stop before leaving.
-- visit_status  : 'visited' (normal geofence entry), 'skipped_signal' (1 or fewer
--                 timing points bypassed — likely a brief GPS gap), 'skipped_detour'
--                 (2+ timing points bypassed — likely a genuine route detour),
--                 'pending' (reserved; the app never uploads a not-yet-reached stop).
--
-- variance_seconds and is_early flags are computed on insert by trigger:
--   negative variance = early, positive = late, null = routing point or skipped stop.
--
-- Ops review workflow: ops dashboard filters where is_early_arrival or is_early_departure
-- and reviewed_at is null. Reviewing sets reviewed_by + reviewed_at; review_notes optional.

create table journey_stop_times (
  id                          uuid        primary key default gen_random_uuid(),
  journey_id                  uuid        not null references journeys(id) on delete cascade,
  timetable_stop_id           uuid        references timetable_stops(id),
  journey_waypoint_id         uuid        references journey_waypoints(id),

  arrived_at                  timestamptz,
  departed_at                 timestamptz,
  visit_status                text        not null default 'visited'
                                 check (visit_status in ('visited', 'skipped_signal', 'skipped_detour', 'pending')),

  arrival_variance_seconds    int,                            -- null for routing points or skipped stops
  departure_variance_seconds  int,                            -- null when departed_at is null or routing point

  is_early_arrival            boolean     not null default false,
  is_early_departure          boolean     not null default false,

  review_notes                text,                           -- optional ops investigation note
  reviewed_by                 uuid        references employees(id) on delete set null,
  reviewed_at                 timestamptz,

  created_at                  timestamptz not null default now(),

  check (timetable_stop_id is not null or journey_waypoint_id is not null)
);

-- Each stop appears at most once per journey
create unique index journey_stop_times_timetable_unique
  on journey_stop_times (journey_id, timetable_stop_id)
  where timetable_stop_id is not null;

create unique index journey_stop_times_waypoint_unique
  on journey_stop_times (journey_id, journey_waypoint_id)
  where journey_waypoint_id is not null;


-- ── Triggers ──────────────────────────────────────────────────────────────────

-- Prevent deletion or demotion of the last super_user at a company.
create or replace function protect_last_super_user()
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

create trigger trg_protect_last_super_user
  before update or delete on employees
  for each row execute function protect_last_super_user();

-- Only super_user may change a vehicle's status.
create or replace function protect_vehicle_status()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status and current_employee_role() != 'super_user' then
    raise exception 'Only a super_user can change vehicle status.';
  end if;
  return new;
end;
$$;

create trigger trg_protect_vehicle_status
  before update on vehicles
  for each row execute function protect_vehicle_status();

-- Compute arrival/departure variance and early flags on insert into journey_stop_times.
-- For timetabled stops: scheduled datetime = journey_date + departure_time + offset (Europe/London).
--   The effective timing profile is journey.timing_profile (if set) else departure.timing_profile.
-- For ad-hoc waypoints: scheduled datetime = journey_waypoints.scheduled_at.
-- Routing points have no scheduled time — variance columns remain null, flags remain false.
-- Skipped stops (arrived_at null) also get null variance columns — nothing to compare against.
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

  if new.arrived_at is not null and v_stop_type = 'timing_point' and v_scheduled_at is not null then
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

create trigger trg_compute_stop_time_variance
  before insert on journey_stop_times
  for each row execute function compute_stop_time_variance();


-- ── Indexes ───────────────────────────────────────────────────────────────────

create index on employee_contacts (employee_id);
create index on employees         (company_id);
create index on vehicles          (company_id);
create index on routes            (company_id);
create index on timetables            (route_id);
create index on timetable_departures  (timetable_id);
create index on timetable_stops       (timetable_id);
create index on timetable_stops       (stop_id);
create index on journeys              (company_id);
create index on journeys              (timetable_departure_id);
create index on journeys              (journey_date);
create index on journeys          (driver_id);
create index on journeys          (vehicle_id);
create index on journey_waypoints  (journey_id);
create index on journey_events     (journey_id);
create index on journey_events     (occurred_at);
create index on journey_stop_times (journey_id);
create index on journey_stop_times (timetable_stop_id);
create index on journey_stop_times (is_early_arrival)  where is_early_arrival = true;
create index on journey_stop_times (is_early_departure) where is_early_departure = true;
create index on journey_stop_times (reviewed_at)       where reviewed_at is null;


-- ── Helper functions ──────────────────────────────────────────────────────────


create or replace function current_company_id()
returns uuid
language sql stable security definer
as $$
  select company_id from employees where auth_user_id = auth.uid() limit 1
$$;

create or replace function current_employee_role()
returns text
language sql stable security definer
as $$
  select access_level from employees where auth_user_id = auth.uid() limit 1
$$;

-- Used by anon RLS policies on journey_events and journey_stop_times.
-- security definer so the anon role can read journeys.status without a SELECT grant bypass.
create or replace function is_journey_in_progress(j_id uuid)
returns boolean
language sql stable security definer
as $$
  select exists (
    select 1 from journeys where id = j_id and status = 'in_progress'
  )
$$;

grant execute on function is_journey_in_progress(uuid) to anon;

-- Signs a driver duty-card JWT directly in Postgres via pgcrypto, rather than
-- relying on a separately-deployed Edge Function. Output is structurally
-- identical to the old Edge Function's JWT and is read by is_jwt_journey_allowed().
create extension if not exists pgcrypto;

create or replace function public.generate_duty_token(
  p_journey_ids  uuid[],
  p_driver_name  text,
  p_driver_id    uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  -- HS256 JWT header is a fixed constant
  v_header      text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
  v_payload     jsonb;
  v_payload_b64 text;
  v_input       text;
  v_sig         text;
  v_now         bigint;
  v_secret      text;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Unauthorized';
  end if;

  v_now    := extract(epoch from clock_timestamp())::bigint;
  v_secret := current_setting('app.settings.jwt_secret', true);

  if v_secret is null or v_secret = '' then
    raise exception 'JWT secret unavailable';
  end if;

  v_payload := jsonb_build_object(
    'iss',         'supabase',
    'role',        'anon',
    'driver_name', coalesce(p_driver_name, 'Driver'),
    'driver_id',   p_driver_id,
    'journey_ids', coalesce(
                     (select jsonb_agg(elem::text) from unnest(p_journey_ids) as elem),
                     '[]'::jsonb
                   ),
    'iat',         v_now,
    'exp',         v_now + 86400
  );

  -- base64url-encode payload (remove newlines pgcrypto adds, swap +/ → -_)
  v_payload_b64 := replace(replace(replace(
    replace(encode(convert_to(v_payload::text, 'UTF8'), 'base64'), chr(10), ''),
    '+', '-'), '/', '_'), '=', '');

  v_input := v_header || '.' || v_payload_b64;

  -- HMAC-SHA256, then base64url-encode the signature
  v_sig := replace(replace(replace(
    replace(encode(hmac(convert_to(v_input, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'base64'), chr(10), ''),
    '+', '-'), '/', '_'), '=', '');

  return v_input || '.' || v_sig;
end;
$$;

grant execute on function public.generate_duty_token(uuid[], text, uuid) to authenticated;

-- Returns true when the current JWT either carries no journey_ids claim (legacy anon key)
-- or when j_id appears in the claim. Scopes driver tokens to their own journeys only.
create or replace function is_jwt_journey_allowed(j_id uuid)
returns boolean
language sql stable security definer
as $$
  select
    auth.jwt()->>'journey_ids' is null
    or j_id = any(
      array(select jsonb_array_elements_text(auth.jwt()->'journey_ids'))::uuid[]
    )
$$;

grant execute on function is_jwt_journey_allowed(uuid) to anon;

-- Called by the driver PWA (anon) to start a journey.
create or replace function start_journey(p_journey_id uuid)
returns boolean
language plpgsql security definer
as $$
begin
  update journeys set status = 'in_progress', started_at = now()
  where id = p_journey_id and status = 'scheduled';
  return found;
end;
$$;

grant execute on function start_journey(uuid) to anon;

-- Called by the driver PWA (anon) to complete a journey.
create or replace function complete_journey(p_journey_id uuid)
returns boolean
language plpgsql security definer
as $$
begin
  update journeys set status = 'completed', completed_at = now()
  where id = p_journey_id and status = 'in_progress';
  return found;
end;
$$;

grant execute on function complete_journey(uuid) to anon;

DROP FUNCTION IF EXISTS public.get_duty_card(uuid[]);

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
   last_stop_name         text,
   notes                  text
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
    (select display_name(st.*) from timetable_stops ts3
     join stops st on st.id = ts3.stop_id
     where ts3.timetable_id = t.id order by ts3.sequence desc limit 1) as last_stop_name,
    j.notes
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


-- ── naptan_near_point ─────────────────────────────────────────────────────────
-- Returns active NAPTAN bus stops within p_radius_m metres of a coordinate.
-- Bounding-box pre-filter + exact Haversine check; no PostGIS required.

create or replace function naptan_near_point(
  p_lat      float8,
  p_lon      float8,
  p_radius_m float8 default 5
)
returns table (
  atco_code     text,
  common_name   text,
  locality_name text,
  indicator     text,
  lat           float8,
  lon           float8,
  distance_m    float8
)
language sql stable security definer
as $$
  with candidates as (
    select
      n.atco_code,
      n.common_name,
      n.locality_name,
      n.indicator,
      n.lat,
      n.lon,
      6371000.0 * 2 * asin(sqrt(
        power(sin(radians((n.lat  - p_lat) / 2)), 2) +
        cos(radians(p_lat)) * cos(radians(n.lat)) *
        power(sin(radians((n.lon - p_lon) / 2)), 2)
      )) as distance_m
    from naptan_stops n
    where n.status = 'active'
      and n.lat between p_lat - (p_radius_m / 111320.0)
                    and p_lat + (p_radius_m / 111320.0)
      and n.lon between p_lon - (p_radius_m / (111320.0 * cos(radians(p_lat))))
                    and p_lon + (p_radius_m / (111320.0 * cos(radians(p_lat))))
  )
  select atco_code, common_name, locality_name, indicator, lat, lon, distance_m
  from candidates
  where distance_m <= p_radius_m
  order by distance_m
  limit 5;
$$;

grant execute on function naptan_near_point(float8, float8, float8) to anon, authenticated;


-- ── Views ─────────────────────────────────────────────────────────────────────
-- Returns one row per (departure × stop).
-- scheduled_time is computed as departure_time + offset for the departure's timing_profile.
-- Filter by departure_id to get a specific departure's stops.
-- Filter by timetable_id to get all departures for a pattern.

create or replace view schedule_view with (security_invoker = true) as
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
    r.journey_type,
    display_name(s.*)    as display_name
  from timetable_stops     ts
  join stops               s  on s.id  = ts.stop_id
  join timetables          t  on t.id  = ts.timetable_id
  join timetable_departures td on td.timetable_id = t.id
  join routes              r  on r.id  = t.route_id
  order by r.service_code, td.departure_time, ts.sequence;


-- ── Row Level Security ────────────────────────────────────────────────────────

alter table naptan_stops             enable row level security;
alter table employee_contacts        enable row level security;
alter table employee_availability    enable row level security;
alter table companies                enable row level security;
alter table employees                enable row level security;
alter table vehicles            enable row level security;
alter table stops               enable row level security;
alter table routes              enable row level security;
alter table timetables            enable row level security;
alter table timetable_departures  enable row level security;
alter table timetable_stops       enable row level security;
alter table journeys            enable row level security;
alter table journey_waypoints   enable row level security;
alter table journey_events      enable row level security;
alter table journey_stop_times  enable row level security;

-- NAPTAN reference data: publicly readable, no writes via API
create policy "naptan_public_read" on naptan_stops for select using (true);

-- Anon: read-only access to schedule data (driver PWA — no login required)
create policy "anon_read" on stops           for select to anon using (true);
create policy "anon_read" on companies       for select to anon using (true);
create policy "anon_read" on routes               for select to anon using (true);
create policy "anon_read" on timetables           for select to anon using (true);
create policy "anon_read" on timetable_departures for select to anon using (true);
create policy "anon_read" on timetable_stops      for select to anon using (true);

-- Companies: authenticated users see only their own company
create policy "company_read" on companies
  for select to authenticated
  using (id = current_company_id());

-- Companies: super_user and ops_manager may update their own company record
create policy "company_update" on companies
  for update to authenticated
  using (
    id = current_company_id()
    and current_employee_role() in ('super_user', 'ops_manager')
  )
  with check (id = current_company_id());

-- Employees: full access within own company
create policy "company_all" on employees
  for all to authenticated
  using     (company_id = current_company_id())
  with check (company_id = current_company_id());

-- Vehicles: full access within own company
create policy "company_all" on vehicles
  for all to authenticated
  using     (company_id = current_company_id())
  with check (company_id = current_company_id());

-- Routes: full access within own company
create policy "company_all" on routes
  for all to authenticated
  using     (company_id = current_company_id())
  with check (company_id = current_company_id());

-- Timetables: scoped via route → company
create policy "company_all" on timetables
  for all to authenticated
  using (
    route_id in (select id from routes where company_id = current_company_id())
  )
  with check (
    route_id in (select id from routes where company_id = current_company_id())
  );

-- Timetable departures: scoped via timetable → route → company
create policy "company_all" on timetable_departures
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

-- Timetable stops: scoped via timetable → route → company
create policy "company_all" on timetable_stops
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

-- Journeys: company_id stored directly for efficient access
create policy "company_all" on journeys
  for all to authenticated
  using     (company_id = current_company_id())
  with check (company_id = current_company_id());

-- Journey waypoints: scoped via journey → company
create policy "company_all" on journey_waypoints
  for all to authenticated
  using (
    journey_id in (select id from journeys where company_id = current_company_id())
  )
  with check (
    journey_id in (select id from journeys where company_id = current_company_id())
  );

-- Journey events: scoped via journey → company
create policy "company_all" on journey_events
  for all to authenticated
  using (
    journey_id in (select id from journeys where company_id = current_company_id())
  )
  with check (
    journey_id in (select id from journeys where company_id = current_company_id())
  );

-- Anon drivers may insert GPS fixes for in-progress journeys (driver PWA has no auth session)
create policy "anon_gps_fix" on journey_events
  for insert to anon
  with check (
    event_type = 'gps_fix'
    and is_journey_in_progress(journey_id)
    and is_jwt_journey_allowed(journey_id)
  );

-- Anon drivers may insert incident reports for in-progress journeys
create policy "anon_incident" on journey_events
  for insert to anon
  with check (
    event_type = 'incident'
    and is_journey_in_progress(journey_id)
    and is_jwt_journey_allowed(journey_id)
  );

-- Anon drivers may insert GPS fixes and incidents for in-progress journeys.
-- INSERT grant is required in addition to the RLS policies below; without it Postgres
-- rejects the write before evaluating RLS at all.
grant insert on public.journey_events to anon;

-- Anon drivers may insert stop times at trip end (batch upload)
-- Table-level INSERT grant added in migration_anon_stop_times.sql; also set here for fresh resets.
grant insert on public.journey_stop_times to anon;

create policy "anon_insert" on journey_stop_times
  for insert to anon
  with check (
    is_journey_in_progress(journey_id)
    and is_jwt_journey_allowed(journey_id)
  );

-- Journey stop times: scoped via journey → company
-- Drivers insert (batch upload at trip end); ops can update review fields.
create policy "company_all" on journey_stop_times
  for all to authenticated
  using (
    journey_id in (select id from journeys where company_id = current_company_id())
  )
  with check (
    journey_id in (select id from journeys where company_id = current_company_id())
  );

-- Stops: any authenticated user can read, insert, or update
-- TODO: restore super_user_insert / super_user_update policies for production
create policy "auth_read" on stops
  for select to authenticated using (true);

create policy "auth_insert" on stops
  for insert to authenticated
  with check (true);

create policy "auth_update" on stops
  for update to authenticated
  using (true);


-- Employee contacts: ops users can manage contacts for employees in their own company
create policy "company_employee_contacts" on employee_contacts
  for all to authenticated
  using (
    exists (
      select 1 from employees e
      join employees me on me.company_id = e.company_id
        and me.auth_user_id = auth.uid()
      where e.id = employee_contacts.employee_id
    )
  )
  with check (
    exists (
      select 1 from employees e
      join employees me on me.company_id = e.company_id
        and me.auth_user_id = auth.uid()
      where e.id = employee_contacts.employee_id
    )
  );


-- Employee availability: same company scoping as employee_contacts
create policy "company_employee_availability" on employee_availability
  for all to authenticated
  using (
    exists (
      select 1 from employees e
      join employees me on me.company_id = e.company_id
        and me.auth_user_id = auth.uid()
      where e.id = employee_availability.employee_id
    )
  )
  with check (
    exists (
      select 1 from employees e
      join employees me on me.company_id = e.company_id
        and me.auth_user_id = auth.uid()
      where e.id = employee_availability.employee_id
    )
  );


-- service_exceptions: scoped via departure → timetable → route → company
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



-- ── Grants ────────────────────────────────────────────────────────────────────

grant usage on schema public to anon, authenticated;

-- Point-in-time grant covering all tables that exist when this schema is applied.
grant select on all tables in schema public to anon;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

-- Default privileges: any table created in a future migration inherits these grants
-- automatically. Required from 2026-05-30 (new Supabase projects) and
-- 2026-10-30 (all existing projects) — without this, new tables are invisible to
-- the Data API (supabase-js, PostgREST, /rest/v1/).
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant all on sequences to authenticated;

grant select on timetable_departures to anon;
grant all    on timetable_departures to authenticated;

grant select on schedule_view to anon;
grant select on schedule_view to authenticated;


-- ── Storage ───────────────────────────────────────────────────────────────────
-- Bucket: company-logos (legacy — kept for backwards compatibility)
-- New uploads should use operator-assets instead.

insert into storage.buckets (id, name, public)
values ('company-logos', 'company-logos', true)
on conflict (id) do nothing;

-- Anyone (including anon) can download logos
create policy "logo_public_read" on storage.objects
  for select
  using (bucket_id = 'company-logos');

-- super_user and ops_manager may upload a logo into their own company's folder
create policy "logo_company_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() in ('super_user', 'ops_manager')
  );

-- super_user and ops_manager may replace their own company's logo
create policy "logo_company_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() in ('super_user', 'ops_manager')
  );

-- super_user and ops_manager may delete their own company's logo
create policy "logo_company_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() in ('super_user', 'ops_manager')
  );

-- Bucket: system-assets — CoachMate core icons, SVGs, "Powered by" badges (public read-only)
insert into storage.buckets (id, name, public)
values ('system-assets', 'system-assets', true)
on conflict (id) do nothing;

create policy "system_assets_public_read" on storage.objects
  for select
  using (bucket_id = 'system-assets');

-- Bucket: operator-assets — company-uploaded logos (replaces company-logos for new uploads)
-- Path convention: {company_id}/logo.{ext}
insert into storage.buckets (id, name, public)
values ('operator-assets', 'operator-assets', true)
on conflict (id) do nothing;

create policy "operator_assets_public_read" on storage.objects
  for select
  using (bucket_id = 'operator-assets');

create policy "operator_assets_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'operator-assets'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() in ('super_user', 'ops_manager')
  );

create policy "operator_assets_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'operator-assets'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() in ('super_user', 'ops_manager')
  );

create policy "operator_assets_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'operator-assets'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() in ('super_user', 'ops_manager')
  );

