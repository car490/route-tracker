-- ============================================================
-- PSVAIR 2026 (Public Service Vehicles Accessible Information
-- Regulations 2023) — live audio/visual next-stop announcements.
--
-- Adds psvair_in_scope to schedule_view: true when the route's
-- journey_type includes a journey_types row with requires_bods = true
-- (registered local bus services — the same category PSVAIR applies to).
-- No new tables; the driver PWA reads this flag to decide whether to
-- run the announcement engine for a given departure.
-- ============================================================

drop view if exists schedule_view;

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
    display_name(s.*)    as display_name,
    exists (
      select 1 from journey_types jt
      where jt.name = any(r.journey_type) and jt.requires_bods
    )                    as psvair_in_scope
  from timetable_stops     ts
  join stops               s  on s.id  = ts.stop_id
  join timetables          t  on t.id  = ts.timetable_id
  join timetable_departures td on td.timetable_id = t.id
  join routes              r  on r.id  = t.route_id
  order by r.service_code, td.departure_time, ts.sequence;

grant select on schedule_view to anon;
grant select on schedule_view to authenticated;
