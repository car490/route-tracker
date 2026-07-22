-- Manual Service Selection (fallback) — the one new anonymous write-path
-- into `journeys`. Follows the same SECURITY DEFINER + grant to anon
-- pattern as start_journey/complete_journey.
--
-- Security properties, all load-bearing:
--   - company_id is NEVER client-supplied. It's derived server-side from
--     p_timetable_departure_id via timetable_departures -> timetables ->
--     routes, the only chain that reaches a tenant. An anon caller stating
--     their own company_id could otherwise insert into a competitor's
--     tenant — this closes that off entirely.
--   - driver_id is left null (column default). No identity exists to
--     attribute it to in this anonymous, no-login context. Per-driver
--     attribution here is a separate, later feature (device pairing / PIN),
--     not folded into this RPC.
--   - p_journey_date defaults to current_date (server clock), not something
--     the client is required to supply — avoids trusting a tablet's local
--     clock for a compliance-relevant date.
--   - Full service-validity check before any insert: days_of_week, BOTH
--     service_exceptions types ('removed' overrides a days_of_week match,
--     'added' overrides a non-match), and valid_from/valid_to (both
--     nullable — open-ended bounds use IS NULL OR guards, not BETWEEN).
--     A request for a date the service doesn't actually run on is rejected,
--     not silently given a wrong-but-present journey row.
--   - Get-or-create uses the EXISTING journeys_no_double_booking partial
--     unique index — no new constraint invented, no race condition between
--     a separate existence check and the insert. The ON CONFLICT predicate
--     below must match that index's predicate exactly (both conditions,
--     not just the status one) or Postgres can't use it as the arbiter.
--
-- psvair_in_scope is deliberately NOT computed or returned here — that
-- would be a second, independently-maintained copy of logic that
-- schedule_view already derives per stop. The caller sources
-- psvairEnabled from fetchStopsForDeparture() instead, same as the
-- existing duty-card path (see main.js initDutyCard), so there's exactly
-- one place this gets computed.

create or replace function get_or_create_manual_journey(
  p_timetable_departure_id uuid,
  p_journey_date date default current_date
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

  insert into journeys (company_id, timetable_departure_id, journey_date, status)
  values (v_company_id, p_timetable_departure_id, p_journey_date, 'scheduled')
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

grant execute on function get_or_create_manual_journey(uuid, date) to anon;
