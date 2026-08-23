-- ── Vehicle journey types + vehicle on manual journeys ────────────────────────
-- Two changes to support the Driver PWA's manual-selection flow (no ops-issued
-- duty card — see mele-server/TEMP-LAPTOP.md, src/manualSelection.js) attaching a
-- real vehicle instead of leaving journeys.vehicle_id permanently null. See
-- docs/TODO.md "Manual-selection flow — no vehicle/driver on the journey".
--
-- 1. vehicles.journey_types text[] — same shape as employees.journey_types and
--    routes.journey_type, so a vehicle can be tagged 'Local Bus' etc. No admin
--    UI existed for this before (see dashboard's VehiclesPage.jsx for the pills
--    added alongside this migration). No CHECK against the journey_types
--    lookup table — same as the two existing columns it mirrors, validated at
--    the application layer only.
-- 2. get_or_create_manual_journey() gains an optional p_vehicle_id, validated
--    against the departure's own company (anon could otherwise pass any
--    vehicle UUID it can guess/enumerate), and now inserts it. The Driver PWA
--    commissions a vehicle once per device (src/vehicleSetup.js, persisted to
--    localStorage — same one-time pattern as announceLink.js's Pi setup) and
--    passes it on every manual journey start from then on.
-- 3. A new anon SELECT policy on vehicles, scoped to active 'Local Bus'
--    vehicles only — the Driver PWA's vehicle picker needs to read the fleet
--    list itself (there was no anon policy on vehicles at all before this;
--    the existing "company_all" policy is authenticated-only).
-- Applied: 2026-08-14

alter table vehicles
  add column if not exists journey_types text[] not null default '{}';

create policy "anon_read_local_bus" on vehicles
  for select to anon
  using (status = 'active' and 'Local Bus' = any(journey_types));

DROP FUNCTION IF EXISTS public.get_or_create_manual_journey(uuid, date);

create or replace function get_or_create_manual_journey(
  p_timetable_departure_id uuid,
  p_journey_date date default current_date,
  p_vehicle_id uuid default null
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

  insert into journeys (company_id, timetable_departure_id, journey_date, status, vehicle_id)
  values (v_company_id, p_timetable_departure_id, p_journey_date, 'scheduled', p_vehicle_id)
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

grant execute on function get_or_create_manual_journey(uuid, date, uuid) to anon;
