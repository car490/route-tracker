-- migration_naptan_stops.sql
-- Adds naptan_stops reference table and naptan_near_point RPC.
-- Apply in Supabase SQL Editor.
--
-- naptan_stops holds raw NAPTAN bus stop data (updated weekly via import-naptan.js).
-- It is a global read-only reference table — separate from the operational stops table.
-- When a planner picks a NAPTAN stop, the stops table gets a row with naptan_code set.

create table if not exists naptan_stops (
  atco_code     text        primary key,         -- ATCO code (unique national identifier)
  naptan_code   text,                            -- NaPTAN code (shorter, printed on flags)
  common_name   text        not null,            -- e.g. "Sleaford Bus Station"
  locality_name text,                            -- e.g. "Sleaford"
  street        text,                            -- e.g. "Southgate"
  indicator     text,                            -- e.g. "Stop A", "opp", "adj"
  bearing       text,                            -- e.g. "N", "SE"
  lat           float8      not null,
  lon           float8      not null,
  stop_type     text        not null default 'BCT',
  status        text        not null default 'active',
  updated_at    timestamptz not null default now()
);

-- Bounding-box index for coordinate proximity queries
create index if not exists naptan_stops_coords_idx on naptan_stops (lat, lon);

grant select on public.naptan_stops to anon, authenticated;

alter table public.naptan_stops enable row level security;

create policy "naptan_public_read" on public.naptan_stops
  for select using (true);


-- ── naptan_near_point ─────────────────────────────────────────────────────────
-- Returns active bus stops within p_radius_m metres of a coordinate.
-- Uses a bounding-box pre-filter then exact Haversine distance check.
-- Called from the route planner after pin-drop or address selection.

create or replace function naptan_near_point(
  p_lat      float8,
  p_lon      float8,
  p_radius_m float8 default 5
)
returns table (
  atco_code    text,
  common_name  text,
  locality_name text,
  indicator    text,
  lat          float8,
  lon          float8,
  distance_m   float8
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
