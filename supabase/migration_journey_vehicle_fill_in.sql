-- migration_journey_vehicle_fill_in.sql
--
-- A journey started without a bus takes the bus of the next device that
-- asks for it. Idempotent; safe to re-run. Apply to dev first, then
-- production. Tests: supabase/tests/get_or_create_manual_journey_vehicle.sql.
--
-- Found 2026-10-02: on 1 October Announce Solo started the 07:27 S125S
-- before the Driver did and sent no bus, so the journey was stored with
-- none. The Driver then asked for the same departure carrying SN06JVZ, but
-- get_or_create_manual_journey() only uses p_vehicle_id when it makes a new
-- journey, so the bus was ignored. Solo now sends its own bus too
-- (announceSoloAutopilot.js); this covers either device starting first.
--
-- Only when the existing journey has no bus (never replaces one), only while
-- it is scheduled or in progress, and only for a caller whose duty token
-- covers that journey (is_jwt_journey_allowed, the CLAUDE.md rule for an
-- anon RPC that changes a row by id; a claim-less legacy key falls through
-- to true, the existing tradeoff). p_vehicle_id is already checked against
-- the departure's own company. Otherwise unchanged: same signature, same
-- return, same grants.

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

    -- The journey already existed (the other device on the bus started it).
    -- If it has no bus yet, take this caller's: Announce Solo used to start
    -- journeys without one, so a Solo-first start left the Driver's bus
    -- ignored (found 2026-10-02, 1 Oct 07:27 S125S). Never replaces a bus,
    -- only while the journey is scheduled or running, and only for a caller
    -- entitled to that journey (CLAUDE.md: is_jwt_journey_allowed for an
    -- anon RPC that changes a row). p_vehicle_id was checked against the
    -- departure's company above.
    if p_vehicle_id is not null and v_journey_id is not null
       and public.is_jwt_journey_allowed(v_journey_id) then
      update journeys
         set vehicle_id = p_vehicle_id
       where id = v_journey_id
         and vehicle_id is null
         and status in ('scheduled', 'in_progress');
    end if;
  end if;

  return query select v_journey_id;
end;
$$;

grant execute on function get_or_create_manual_journey(uuid, date, uuid, uuid) to anon;
