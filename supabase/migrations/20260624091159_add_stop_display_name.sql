-- Computed "<locality>, <landmark> (<indicator>)" display name for stops,
-- derived from naptan_stops via stops.naptan_code. Falls back to stops.name
-- when there's no NAPTAN match (e.g. stops outside imported counties).

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

-- get_duty_card's last_stop_name also switches to the derived display name.
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
