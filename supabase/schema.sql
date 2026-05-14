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
                                'Northern',
                                'North Western',
                                'West Midlands',
                                'Eastern',
                                'Welsh',
                                'Western',
                                'South Eastern and Metropolitan',
                                'East Midlands',
                                'Scottish'
                              )),
  status                    text        not null default 'pending'
                              check (status in ('pending', 'active', 'suspended')),
  created_at                timestamptz not null default now()
);


-- ── Staff ─────────────────────────────────────────────────────────────────────
-- Covers all roles: drivers (no dashboard login) and ops/admin (auth_user_id set).
-- Platform-level admin (us) operates via the Supabase service role, not this table.

create table staff (
  id              uuid        primary key default gen_random_uuid(),
  company_id      uuid        not null references companies(id) on delete cascade,
  auth_user_id    uuid        unique references auth.users(id) on delete set null,
  name            text        not null,
  role            text        not null
                    check (role in ('super_user', 'ops_manager', 'driver')),
  created_at      timestamptz not null default now()
);


-- ── Staff contacts ────────────────────────────────────────────────────────────
-- Multiple contact methods per staff member; exactly one may be primary.
-- Added via migration_staff_contacts_table.sql — included here for completeness.

create table staff_contacts (
  id          uuid        primary key default gen_random_uuid(),
  staff_id    uuid        not null references staff(id) on delete cascade,
  type        text        not null check (type in ('email', 'phone')),
  value       text        not null,
  is_primary  boolean     not null default false,
  created_at  timestamptz not null default now()
);

create unique index staff_contacts_one_primary
  on staff_contacts (staff_id)
  where is_primary = true;


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
  status            text        not null default 'active'
                      check (status in ('active', 'off_road', 'disposed')),
  created_at        timestamptz not null default now()
);


-- ── Stops (global — not company-scoped) ───────────────────────────────────────
-- Physical bus stops shared across all companies and routes.
-- naptan_code reserved for Phase 5 BODS integration.
-- Only super_user staff may create or modify stops (enforced by RLS).

create table stops (
  id              uuid        primary key default gen_random_uuid(),
  name            text        not null,
  lat             float8      not null,
  lon             float8      not null,
  naptan_code     char(9)     unique,
  is_depot        boolean     not null default false,
  created_at      timestamptz not null default now()
);


-- ── Routes ────────────────────────────────────────────────────────────────────

create table routes (
  id              uuid        primary key default gen_random_uuid(),
  company_id      uuid        not null references companies(id) on delete cascade,
  service_code    text        not null,
  name            text        not null,
  journey_type    text        not null
                    check (journey_type in (
                      'Local Bus',
                      'Open Door Schools',
                      'Contract Schools',
                      'Private Hire',
                      'Excursion',
                      'Tour',
                      'Other Contract'
                    )),
  created_at      timestamptz not null default now(),
  unique (company_id, service_code)
);


-- ── Timetables ────────────────────────────────────────────────────────────────
-- A specific scheduled variant of a route (e.g. Morning Outbound, Afternoon Inbound).

create table timetables (
  id              uuid        primary key default gen_random_uuid(),
  route_id        uuid        not null references routes(id) on delete cascade,
  period          text        not null
                    check (period in (
                      'Early Morning',
                      'Morning',
                      'Midday',
                      'Afternoon',
                      'Evening',
                      'Night',
                      'All Day'
                    )),
  direction       text        not null
                    check (direction in ('Outbound', 'Inbound', 'Circular')),
  valid_from      date,
  valid_to        date,
  days_of_week    int[]       not null default '{1,2,3,4,5}',
  created_at      timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);


-- ── Timetable stops ───────────────────────────────────────────────────────────
-- The ordered list of stops for a timetable.
-- stop_type = 'timing_point' : shown in driver app with scheduled time, GPS arrival tracked.
-- stop_type = 'routing_point': used for map/directions only, not shown in timing list.
-- scheduled_time is required for timing points; optional for routing points.

create table timetable_stops (
  id              uuid        primary key default gen_random_uuid(),
  timetable_id    uuid        not null references timetables(id) on delete cascade,
  stop_id         uuid        not null references stops(id),
  sequence        int         not null,
  stop_type       text        not null
                    check (stop_type in ('timing_point', 'routing_point')),
  scheduled_time  time,
  created_at      timestamptz not null default now(),
  unique (timetable_id, sequence),
  check (stop_type = 'routing_point' or scheduled_time is not null)
);


-- ── Journeys ──────────────────────────────────────────────────────────────────
-- An instance of a timetable running on a specific date, assigned to driver + vehicle.
-- timetable_id is nullable: ad-hoc jobs (Private Hire, Excursion, Tour) have none.
-- company_id is stored directly for efficient RLS without chasing FK joins.
-- For ad-hoc journeys, journey_type must be set directly (cannot be derived from timetable).

create table journeys (
  id              uuid        primary key default gen_random_uuid(),
  company_id      uuid        not null references companies(id) on delete cascade,
  timetable_id    uuid        references timetables(id),
  journey_date    date        not null,
  journey_type    text
                    check (journey_type in (
                      'Local Bus',
                      'Open Door Schools',
                      'Contract Schools',
                      'Private Hire',
                      'Excursion',
                      'Tour',
                      'Other Contract'
                    )),
  driver_id       uuid        references staff(id) on delete set null,
  vehicle_id      uuid        references vehicles(id) on delete set null,
  status          text        not null default 'scheduled'
                    check (status in (
                      'scheduled',
                      'in_progress',
                      'completed',
                      'cancelled'
                    )),
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  check (timetable_id is not null or journey_type is not null),
  check (completed_at is null or started_at is null or completed_at >= started_at)
);

-- A timetable can run at most once per day (cancelled journeys excluded).
create unique index journeys_no_double_booking
  on journeys (timetable_id, journey_date)
  where status != 'cancelled' and timetable_id is not null;


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
-- arrived_at  : when the vehicle reached the stop.
-- departed_at : set only when the vehicle waited at a stop before leaving.
--
-- variance_seconds and is_early flags are computed on insert by trigger:
--   negative variance = early, positive = late, null = routing point (no scheduled time).
--
-- Ops review workflow: ops dashboard filters where is_early_arrival or is_early_departure
-- and reviewed_at is null. Reviewing sets reviewed_by + reviewed_at; review_notes optional.

create table journey_stop_times (
  id                          uuid        primary key default gen_random_uuid(),
  journey_id                  uuid        not null references journeys(id) on delete cascade,
  timetable_stop_id           uuid        references timetable_stops(id),
  journey_waypoint_id         uuid        references journey_waypoints(id),

  arrived_at                  timestamptz not null,
  departed_at                 timestamptz,

  arrival_variance_seconds    int,                            -- null for routing points
  departure_variance_seconds  int,                            -- null when departed_at is null or routing point

  is_early_arrival            boolean     not null default false,
  is_early_departure          boolean     not null default false,

  review_notes                text,                           -- optional ops investigation note
  reviewed_by                 uuid        references staff(id) on delete set null,
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
  if old.role = 'super_user' and (tg_op = 'DELETE' or new.role != 'super_user') then
    if (
      select count(*) from staff
      where company_id = old.company_id
        and role = 'super_user'
        and id != old.id
    ) = 0 then
      raise exception 'A company must retain at least one super_user.';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger trg_protect_last_super_user
  before update or delete on staff
  for each row execute function protect_last_super_user();

-- Only super_user may change a vehicle's status.
create or replace function protect_vehicle_status()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status and current_staff_role() != 'super_user' then
    raise exception 'Only a super_user can change vehicle status.';
  end if;
  return new;
end;
$$;

create trigger trg_protect_vehicle_status
  before update on vehicles
  for each row execute function protect_vehicle_status();

-- Compute arrival/departure variance and early flags on insert into journey_stop_times.
-- For timetabled stops: scheduled datetime = journey_date + scheduled_time (Europe/London).
-- For ad-hoc waypoints: scheduled datetime = journey_waypoints.scheduled_at.
-- Routing points have no scheduled time — variance columns remain null, flags remain false.
create or replace function compute_stop_time_variance()
returns trigger
language plpgsql
as $$
declare
  v_scheduled_at  timestamptz;
  v_stop_type     text;
begin
  if new.timetable_stop_id is not null then
    select (j.journey_date + ts.scheduled_time) at time zone 'Europe/London',
           ts.stop_type
    into   v_scheduled_at, v_stop_type
    from   timetable_stops ts
    join   journeys j on j.id = new.journey_id
    where  ts.id = new.timetable_stop_id;

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

create trigger trg_compute_stop_time_variance
  before insert on journey_stop_times
  for each row execute function compute_stop_time_variance();


-- ── Indexes ───────────────────────────────────────────────────────────────────

create index on staff_contacts    (staff_id);
create index on staff             (company_id);
create index on vehicles          (company_id);
create index on routes            (company_id);
create index on timetables        (route_id);
create index on timetable_stops   (timetable_id);
create index on timetable_stops   (stop_id);
create index on journeys          (company_id);
create index on journeys          (timetable_id);
create index on journeys          (journey_date);
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
  select company_id from staff where auth_user_id = auth.uid() limit 1
$$;

create or replace function current_staff_role()
returns text
language sql stable security definer
as $$
  select role from staff where auth_user_id = auth.uid() limit 1
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

CREATE OR REPLACE FUNCTION public.get_duty_card(journey_ids uuid[])
 RETURNS TABLE(journey_id uuid, status text, started_at timestamp with time zone, completed_at timestamp with time zone, driver_name text, vehicle_registration text, service_code text, route_name text, period text, direction text, timetable_id uuid, first_stop_time text, last_stop_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select
    j.id,
    j.status,
    j.started_at,
    j.completed_at,
    coalesce(s.name, 'Driver')                               as driver_name,
    coalesce(v.registration, 'Unknown')                      as vehicle_registration,
    r.service_code,
    r.name                                                   as route_name,
    t.period,
    t.direction,
    t.id                                                     as timetable_id,
    to_char(
      (select ts2.scheduled_time from timetable_stops ts2
       where ts2.timetable_id = t.id order by ts2.sequence limit 1),
      'HH24:MI')                                             as first_stop_time,
    (select st.name from timetable_stops ts3
     join stops st on st.id = ts3.stop_id
     where ts3.timetable_id = t.id order by ts3.sequence desc limit 1) as last_stop_name
  from journeys j
  left join staff      s on s.id = j.driver_id
  left join vehicles   v on v.id = j.vehicle_id
  left join timetables t on t.id = j.timetable_id
  left join routes     r on r.id = t.route_id
  where j.id = any(journey_ids)
  order by array_position(journey_ids, j.id)
$function$;

grant execute on function get_duty_card(uuid[]) to anon;

-- ── Views ─────────────────────────────────────────────────────────────────────
-- Used by the driver PWA to fetch a timetable by service_code + period + direction.

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


-- ── Row Level Security ────────────────────────────────────────────────────────

alter table staff_contacts      enable row level security;
alter table companies           enable row level security;
alter table staff               enable row level security;
alter table vehicles            enable row level security;
alter table stops               enable row level security;
alter table routes              enable row level security;
alter table timetables          enable row level security;
alter table timetable_stops     enable row level security;
alter table journeys            enable row level security;
alter table journey_waypoints   enable row level security;
alter table journey_events      enable row level security;
alter table journey_stop_times  enable row level security;

-- Anon: read-only access to schedule data (driver PWA — no login required)
create policy "anon_read" on stops           for select to anon using (true);
create policy "anon_read" on companies       for select to anon using (true);
create policy "anon_read" on routes          for select to anon using (true);
create policy "anon_read" on timetables      for select to anon using (true);
create policy "anon_read" on timetable_stops for select to anon using (true);

-- Companies: authenticated users see only their own company
create policy "company_read" on companies
  for select to authenticated
  using (id = current_company_id());

-- Staff: full access within own company
create policy "company_all" on staff
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
  );

-- Anon drivers may insert incident reports for in-progress journeys
create policy "anon_incident" on journey_events
  for insert to anon
  with check (
    event_type = 'incident'
    and is_journey_in_progress(journey_id)
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

-- Stops: any authenticated user can read; only super_user can create or modify
create policy "auth_read" on stops
  for select to authenticated using (true);

create policy "super_user_insert" on stops
  for insert to authenticated
  with check (current_staff_role() = 'super_user');

create policy "super_user_update" on stops
  for update to authenticated
  using (current_staff_role() = 'super_user');


-- Staff contacts: ops users can manage contacts for staff in their own company
create policy "company_staff_contacts" on staff_contacts
  for all to authenticated
  using (
    exists (
      select 1 from staff s
      join staff me on me.company_id = s.company_id
        and me.auth_user_id = auth.uid()
      where s.id = staff_contacts.staff_id
    )
  )
  with check (
    exists (
      select 1 from staff s
      join staff me on me.company_id = s.company_id
        and me.auth_user_id = auth.uid()
      where s.id = staff_contacts.staff_id
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

grant select on schedule_view to anon;
grant select on schedule_view to authenticated;
