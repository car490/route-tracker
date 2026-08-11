-- ============================================================
-- Adds stop_id (the global stops.id, not the per-timetable
-- timetable_stop_id) to schedule_view.
--
-- Needed for pre-rendered PSVAIR announcement audio: clips are keyed
-- by the physical stop, not by timetable row, so the same stop visited
-- by several routes reuses one clip instead of being re-rendered per
-- route. New column must be appended at the end of the select list —
-- CREATE OR REPLACE VIEW requires existing columns to keep their name/
-- order/type, but allows appending.
-- ============================================================

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
    )                    as psvair_in_scope,
    s.id                 as stop_id
  from timetable_stops     ts
  join stops               s  on s.id  = ts.stop_id
  join timetables          t  on t.id  = ts.timetable_id
  join timetable_departures td on td.timetable_id = t.id
  join routes              r  on r.id  = t.route_id
  order by r.service_code, td.departure_time, ts.sequence;

grant select on schedule_view to anon;
grant select on schedule_view to authenticated;
