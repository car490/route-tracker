-- migration_record_journey_departures.sql
--
-- Departure times, and a trip shared by the Driver and Announce Solo.
-- Idempotent; safe to re-run. Apply to dev first, then production.
-- Tests: supabase/tests/record_journey_stop_times.sql (blocks 4 and 5).
--
-- 1. Departure times (owner, 2026-10-01: recorded at every stop the bus
--    leaves, not only where it waited). shared/gps.js always knew when the
--    vehicle left a stop (75 m clear of it), but journeyStopTimes.js never
--    sent it and record_journey_stop_times() never stored it, so departed_at,
--    departure_variance_seconds and is_early_departure were empty on every
--    journey ever recorded. The function now stores departed_at. A row
--    already stored without one (saved while still at the stop, then a power
--    cut; or the other device on the bus uploaded first) has it filled in by
--    a later upload. A stored departure is never replaced and an arrival is
--    never changed: the first-recorded time still wins.
--
-- 2. compute_stop_time_variance() also runs when departed_at is filled in, so
--    the departure's lateness and "left early" are worked out then too (it
--    was BEFORE INSERT only). Its logic is unchanged.
--
-- 3. A journey completed earlier the same UK day accepts stop times. With the
--    Driver and Solo on one bus they share one journey
--    (get_or_create_manual_journey returns the same id for the same departure
--    and day). Whichever finished second was refused with "Journey ... is not
--    in progress", raised a stop_time_upload_problem alarm the dashboard
--    shows, and kept retrying from the device (found 2026-10-01 on the
--    29 September trip, whose stop times were in fact all stored). It may now
--    add the stops the first device missed and fill in missing departures,
--    nothing else. Completed on an earlier day, cancelled, or never started:
--    still refused. The entitlement check (is_jwt_journey_allowed) is still
--    the first statement, per CLAUDE.md; a duty token still only reaches its
--    own journeys. A claim-less anon key could already write to any journey
--    in progress; it can now also add missing rows to one finished today
--    (the existing legacy-key tradeoff, not widened further).

create or replace function public.record_journey_stop_times(p_journey_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_jwt_journey_allowed(p_journey_id) then
    raise exception 'This duty token does not cover journey %', p_journey_id using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.journeys j
     where j.id = p_journey_id
       and (j.status = 'in_progress'
            or (j.status = 'completed'
                and (j.completed_at at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date))
  ) then
    raise exception 'Journey % is not in progress', p_journey_id using errcode = 'insufficient_privilege';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Too many stop times in one call (% > 500)', jsonb_array_length(p_rows) using errcode = 'invalid_parameter_value';
  end if;

  -- One row per stop, the first copy in the upload: ON CONFLICT DO UPDATE
  -- refuses to touch a row twice in one statement (DO NOTHING didn't care).
  insert into public.journey_stop_times (journey_id, timetable_stop_id, arrived_at, departed_at, visit_status)
  select distinct on ((r->>'timetable_stop_id')::uuid)
         p_journey_id,
         (r->>'timetable_stop_id')::uuid,
         (r->>'arrived_at')::timestamptz,
         (r->>'departed_at')::timestamptz,
         coalesce(r->>'visit_status', 'visited')
    from jsonb_array_elements(p_rows) with ordinality as e(r, n)
   where nullif(r->>'timetable_stop_id', '') is not null
   order by (r->>'timetable_stop_id')::uuid, n
  on conflict (journey_id, timetable_stop_id) where timetable_stop_id is not null
  do update set departed_at = excluded.departed_at
   where journey_stop_times.departed_at is null
     and excluded.departed_at is not null;

  get diagnostics v_count = row_count;

  update public.stop_time_upload_problem
     set resolved_at = now()
   where journey_id = p_journey_id and resolved_at is null;

  return v_count;
end;
$$;

revoke execute on function public.record_journey_stop_times(uuid, jsonb) from public, authenticated;
grant execute on function public.record_journey_stop_times(uuid, jsonb) to anon;

drop trigger if exists trg_compute_stop_time_variance on public.journey_stop_times;
create trigger trg_compute_stop_time_variance
  before insert or update of departed_at on public.journey_stop_times
  for each row execute function public.compute_stop_time_variance();
