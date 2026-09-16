-- ============================================================
-- Migration: school_term_time on timetable_departures
--
-- Problem: a departure only holds one continuous valid_from/valid_to
-- window, so "runs every schoolday" for a full academic year meant
-- creating one departure per term (6/year) with identical time/days
-- and different date ranges -- rebuilt by hand every year as new
-- term_dates rows are added.
--
-- Fix: a single boolean flag on the departure. When set, "does this run
-- today" checks today's date against the term_dates table directly
-- instead of relying on days_of_week/valid_from/valid_to to cover the
-- whole year -- one departure, permanently; a future academic year's
-- term_dates rows extend coverage automatically. days_of_week still
-- gates which weekdays it runs (school-term routes are Mon-Fri, but the
-- flag doesn't hardcode that), and valid_from/valid_to remain available
-- as optional extra bounds (e.g. "not before this vehicle is delivered").
-- INSET/staff-training days (school closed on an ordinary term-time
-- weekday) are handled the same way any other one-off closure is: a
-- 'removed' row in the existing service_exceptions table.
-- ============================================================

alter table public.timetable_departures
  add column if not exists school_term_time boolean not null default false;


-- ── Recreate schedule_view: append school_term_time at the end ────────────
-- CREATE OR REPLACE VIEW requires existing columns to keep their
-- name/order/type, so new columns must go last (see CLAUDE.md's
-- schedule_view note re: stop_id).

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
    exists (
      select 1 from journey_types jt
      where jt.name = any(r.journey_type) and jt.requires_bods
    )                    as psvair_in_scope,
    s.id                 as stop_id,
    td.school_term_time  as school_term_time
  from timetable_stops     ts
  join stops               s  on s.id  = ts.stop_id
  join timetables          t  on t.id  = ts.timetable_id
  join timetable_departures td on td.timetable_id = t.id
  join routes              r  on r.id  = t.route_id
  order by r.service_code, td.departure_time, ts.sequence;

grant select on schedule_view to anon;
grant select on schedule_view to authenticated;


-- ── Update get_or_create_manual_journey: gate on term_dates too ──────────
-- Same (days_of_week AND NOT removed) OR added shape as before, with one
-- extra AND'd condition: when school_term_time is set, today must also
-- fall inside some term_dates range.

create or replace function get_or_create_manual_journey(
  p_timetable_departure_id uuid,
  p_journey_date date default current_date,
  p_vehicle_id uuid default null,
  p_journey_id uuid default null
)
returns table (journey_id uuid)
language plpgsql
security definer
as $$
declare
  v_company_id uuid;
  v_valid boolean;
  v_journey_id uuid;
begin
  select
    r.company_id,
    (
      (
        extract(isodow from p_journey_date)::int = any(td.days_of_week)
        and (
          not td.school_term_time
          or exists (
            select 1 from term_dates tdt
            where p_journey_date between tdt.start_date and tdt.end_date
          )
        )
        and not exists (
          select 1 from service_exceptions se
          where se.timetable_departure_id = td.id
            and se.exception_date = p_journey_date
            and se.exception_type = 'removed'
        )
      )
      or exists (
        select 1 from service_exceptions se
        where se.timetable_departure_id = td.id
          and se.exception_date = p_journey_date
          and se.exception_type = 'added'
      )
    )
    and (td.valid_from is null or p_journey_date >= td.valid_from)
    and (td.valid_to is null or p_journey_date <= td.valid_to)
  into v_company_id, v_valid
  from timetable_departures td
  join timetables t on t.id = td.timetable_id
  join routes r on r.id = t.route_id
  where td.id = p_timetable_departure_id;

  if v_company_id is null then
    raise exception 'timetable_departure_id % not found', p_timetable_departure_id;
  end if;

  if not v_valid then
    raise exception 'service does not run on %', p_journey_date;
  end if;

  if p_vehicle_id is not null and not exists (
    select 1 from vehicles v where v.id = p_vehicle_id and v.company_id = v_company_id
  ) then
    raise exception 'vehicle % not found for this company', p_vehicle_id;
  end if;

  insert into journeys (id, company_id, timetable_departure_id, journey_date, status, vehicle_id)
  values (coalesce(p_journey_id, gen_random_uuid()), v_company_id, p_timetable_departure_id, p_journey_date, 'scheduled', p_vehicle_id)
  on conflict (timetable_departure_id, journey_date)
    where status != 'cancelled' and timetable_departure_id is not null
  do nothing
  returning id into v_journey_id;

  if v_journey_id is null then
    select id into v_journey_id
    from journeys
    where timetable_departure_id = p_timetable_departure_id
      and journey_date = p_journey_date
      and status != 'cancelled'
    limit 1;
  end if;

  return query select v_journey_id;
end;
$$;

grant execute on function get_or_create_manual_journey(uuid, date, uuid, uuid) to anon;
