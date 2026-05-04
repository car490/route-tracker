-- RouteTracker schema
-- Run this first in the Supabase SQL editor

-- ── Tables ───────────────────────────────────────────────────────────────────

create table companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz default now()
);

create table drivers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references companies(id) on delete cascade,
  name        text not null,
  role        text not null default 'driver'
                check (role in ('driver', 'ops_manager', 'admin')),
  created_at  timestamptz default now()
);

create table vehicles (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references companies(id) on delete cascade,
  registration  text not null,
  fleet_number  text,
  created_at    timestamptz default now()
);

create table routes (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references companies(id) on delete cascade,
  service_code  text not null,
  name          text,
  created_at    timestamptz default now(),
  unique (company_id, service_code)
);

create table timetables (
  id            uuid primary key default gen_random_uuid(),
  route_id      uuid references routes(id) on delete cascade,
  period        text not null check (period in ('am', 'pm')),
  valid_from    date,
  valid_to      date,
  days_of_week  int[] default '{1,2,3,4,5}',
  created_at    timestamptz default now()
);

create table timetable_stops (
  id              uuid primary key default gen_random_uuid(),
  timetable_id    uuid references timetables(id) on delete cascade,
  sequence        int not null,
  name            text not null,
  lat             float8 not null,
  lon             float8 not null,
  scheduled_time  time not null,
  is_depot        boolean default false,
  created_at      timestamptz default now(),
  unique (timetable_id, sequence)
);

create table journeys (
  id            uuid primary key default gen_random_uuid(),
  timetable_id  uuid references timetables(id) on delete cascade,
  journey_date  date not null,
  driver_id     uuid references drivers(id),
  vehicle_id    uuid references vehicles(id),
  status        text not null default 'scheduled'
                  check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz default now()
);

create table journey_events (
  id                  uuid primary key default gen_random_uuid(),
  journey_id          uuid references journeys(id) on delete cascade,
  event_type          text not null
                        check (event_type in (
                          'arrived', 'missed', 'gps_fix', 'early_wait',
                          'journey_started', 'journey_completed', 'incident'
                        )),
  timetable_stop_id   uuid references timetable_stops(id),
  lat                 float8,
  lon                 float8,
  occurred_at         timestamptz not null default now(),
  metadata            jsonb,
  created_at          timestamptz default now()
);

-- ── View ─────────────────────────────────────────────────────────────────────
-- Used by the driver PWA to fetch a timetable by service_code + period

create or replace view schedule_view as
  select
    ts.sequence,
    ts.name,
    ts.lat,
    ts.lon,
    ts.scheduled_time,
    ts.is_depot,
    ts.timetable_id,
    t.period,
    r.service_code
  from timetable_stops ts
  join timetables  t on t.id = ts.timetable_id
  join routes      r on r.id = t.route_id
  order by r.service_code, t.period, ts.sequence;

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table companies       enable row level security;
alter table drivers         enable row level security;
alter table vehicles        enable row level security;
alter table routes          enable row level security;
alter table timetables      enable row level security;
alter table timetable_stops enable row level security;
alter table journeys        enable row level security;
alter table journey_events  enable row level security;

-- Anon read: timetable data (no auth needed in Phase 1)
create policy "anon_read" on companies       for select to anon using (true);
create policy "anon_read" on routes          for select to anon using (true);
create policy "anon_read" on timetables      for select to anon using (true);
create policy "anon_read" on timetable_stops for select to anon using (true);

-- Grant anon access to the view
grant select on schedule_view to anon;
