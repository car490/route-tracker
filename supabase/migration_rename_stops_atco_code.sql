-- ============================================================
-- Renames stops.naptan_code -> stops.atco_code.
--
-- The column has always held the NaPTAN ATCO code (the unique national
-- identifier, joined against naptan_stops.atco_code in display_name()) —
-- never naptan_stops.naptan_code, which is a shorter, separate code printed
-- on physical stop flags and can be null. The old column name made that
-- easy to misread as "the naptan_code column joins to naptan_stops on
-- naptan_code" (it doesn't). Renaming for clarity; no behavior change.
--
-- schedule_view and display_name() both reference the column by name in
-- their bodies, so both are dropped/recreated around the rename.
-- ============================================================

drop view if exists public.schedule_view;

alter table public.stops
  rename column naptan_code to atco_code;

create or replace function public.display_name(s stops)
returns text
language sql
stable
as $$
  select coalesce(
    s.announcement_name,
    (select n.locality_name || ', ' || n.common_name ||
       case when n.indicator is not null and n.indicator <> '' then ' (' || n.indicator || ')' else '' end
     from naptan_stops n
     where n.atco_code = s.atco_code),
    s.name
  )
$$;

grant execute on function public.display_name(stops) to anon, authenticated;

create or replace view public.schedule_view with (security_invoker = true) as
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
    s.atco_code,
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
    display_name(s.*)    as display_name,
    -- PSVAIR 2026: true when journey_type includes a requires_bods journey type
    -- (registered local bus services) — drives the PWA's announcement engine.
    exists (
      select 1 from journey_types jt
      where jt.name = any(r.journey_type) and jt.requires_bods
    )                    as psvair_in_scope,
    s.id                 as stop_id
  from timetable_stops     ts
  join stops               s  on s.id  = ts.stop_id
  join timetables          t  on t.id  = ts.timetable_id
  join timetable_departures td on td.timetable_id = t.id
  join routes              r  on r.id  = t.route_id
  order by r.service_code, td.departure_time, ts.sequence;

grant select on public.schedule_view to anon;
grant select on public.schedule_view to authenticated;
