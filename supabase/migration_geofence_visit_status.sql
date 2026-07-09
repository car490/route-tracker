-- Migration: support the geofence rejoin-after-detour fix
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-07-09
--
-- The driver app can now infer that a timing point was bypassed (road closure
-- detour, or a GPS gap) instead of stalling progress tracking forever. That
-- means a journey_stop_times row can exist without a real arrival timestamp,
-- so arrived_at must become nullable, and we need a status column to record
-- why. See schema.sql's journey_stop_times comment for the full status list.

alter table journey_stop_times alter column arrived_at drop not null;

alter table journey_stop_times
  add column visit_status text not null default 'visited'
    check (visit_status in ('visited', 'skipped_signal', 'skipped_detour', 'pending'));

-- Guard the variance trigger against skipped stops (arrived_at is null for them —
-- nothing to compute variance against).
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
