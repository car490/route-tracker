-- Lets the client supply the journey id up front, so a manual-selection
-- start made while offline (no route to Supabase — e.g. the Driver joined
-- only to the Controller's isolated AP with no SIM yet) can use the exact
-- same journey_id locally (tracking, the Driver->Controller push feed,
-- journey_events writes) as the one that eventually lands in the database,
-- with zero reconciliation once the pending-start queue
-- (src/localStore.js's getPendingJourneyStarts) syncs later. See
-- manualSelection.js for the client side.
--
-- IMPORTANT: the function this migration replaces has drifted from the repo
-- history — the original 20260722120000 migration file only ever declared
-- (p_timetable_departure_id, p_journey_date), but the live function on both
-- Supabase projects (checked directly via SQL, 2026-08-25) has long since
-- gained a third param, p_vehicle_id uuid default null, with vehicle
-- validation and a vehicle_id insert column — none of that ever landed in a
-- migration file (see feedback_adhoc_schema_changes in memory for the
-- general pattern this project has hit before). This migration is written
-- against that real, live definition (pulled via pg_get_functiondef), not
-- the stale file, so it doesn't silently drop vehicle attribution.
--
-- Backward compatible: p_journey_id defaults to null, in which case
-- coalesce falls through to gen_random_uuid() exactly as the implicit
-- column default did before — every existing call site (with or without a
-- vehicle) behaves identically either way.
--
-- Does NOT touch p_journey_date's server-clock default (still deliberately
-- not client-suppliable — see the original migration's comment on why:
-- compliance-relevant, never trust a tablet's local clock). A journey
-- started offline just before midnight and synced after still gets
-- correctly get-or-created against whatever "today" is on the server at
-- sync time — a rare, accepted edge case, not solved here.
--
-- Get-or-create semantics are unchanged: the ON CONFLICT/fallback-lookup
-- below is still the sole arbiter of "does this journey already exist" —
-- a client-supplied id is only ever used for a genuinely new insert. If a
-- journey for this departure+date already exists by the time an offline
-- start syncs (e.g. ops or another device created it first), the existing
-- row's real id is returned instead, exactly as before this migration —
-- the client-supplied id is silently not used in that case.

-- Postgres identifies functions by name + parameter types, so a bare
-- `create or replace` with a different signature would leave the old
-- 3-arg version as a second, stale overload rather than replacing it —
-- drop it explicitly so exactly one version of this function exists.
drop function if exists get_or_create_manual_journey(uuid, date, uuid);
drop function if exists get_or_create_manual_journey(uuid, date);

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
