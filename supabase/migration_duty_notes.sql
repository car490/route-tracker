-- Add notes column to get_duty_card return type so the PWA can display driver notes.
-- The notes column already exists on the journeys table; this just exposes it via the RPC.
-- Must DROP first because PostgreSQL won't allow changing the return type in-place.

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
    (select st.name from timetable_stops ts3
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
