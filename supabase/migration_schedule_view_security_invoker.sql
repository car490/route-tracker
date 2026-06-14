-- schedule_view was implicitly SECURITY DEFINER (PostgreSQL default), which
-- caused it to bypass RLS on the underlying tables. An authenticated user from
-- one company could therefore read another company's schedule data through this
-- view. Switching to SECURITY INVOKER makes the view check RLS as the calling
-- role, so the company-scoped policies on routes / timetables / timetable_stops
-- etc. apply correctly.
--
-- Anon behaviour is unchanged: the anon_read policies on all underlying tables
-- use (true), so anonymous callers (driver PWA) still see all rows.

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
    r.journey_type
  from timetable_stops     ts
  join stops               s  on s.id  = ts.stop_id
  join timetables          t  on t.id  = ts.timetable_id
  join timetable_departures td on td.timetable_id = t.id
  join routes              r  on r.id  = t.route_id
  order by r.service_code, td.departure_time, ts.sequence;
