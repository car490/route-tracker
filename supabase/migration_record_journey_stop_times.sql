-- record_journey_stop_times(): the one way the Driver PWA and Announce Solo
-- save a trip's arrival times. Idempotent; safe to re-run.
--
-- Found 2026-09-29 on the first production run: no stop time had been stored
-- on production since 14 July, or on dev since 1 September. Both apps wrote
-- journey_stop_times directly with "skip duplicates" so a retried upload
-- couldn't double up:
--   - Driver PWA: POST with Prefer: resolution=ignore-duplicates (since
--     2026-08-23). For the anon role PostgREST turns that into
--     INSERT ... ON CONFLICT (id) DO NOTHING, which Postgres refuses ("new row
--     violates row-level security policy") unless the caller may also read the
--     table, and anon may not.
--   - Announce Solo: supabase-js upsert(onConflict 'journey_id,timetable_stop_id',
--     ignoreDuplicates). That doesn't match journey_stop_times_timetable_unique,
--     a partial index (WHERE timetable_stop_id IS NOT NULL), so Postgres
--     rejected it outright (42P10) before any permission check.
-- Both apps then kept the trip queued on the device and retried forever.
--
-- This function does the insert itself, against the partial unique index, and
-- makes the same two checks the anon_insert policy makes (the journey is in
-- progress; the caller's duty token, if it has journey_ids, includes it). That
-- follows the rule in CLAUDE.md for anon-callable SECURITY DEFINER RPCs that
-- take an id: check entitlement as the first thing in the body. It gives anon
-- no read access to journey_stop_times.
--
-- Rows are always stored under p_journey_id, whatever journey_id they carry,
-- and rows with no timetable_stop_id are ignored (waypoint rows are not
-- written by either app). Returns how many rows were newly stored; a retry of
-- rows already stored returns 0 and is not an error.

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
  if not public.is_journey_in_progress(p_journey_id) then
    raise exception 'Journey % is not in progress', p_journey_id using errcode = 'insufficient_privilege';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Too many stop times in one call (% > 500)', jsonb_array_length(p_rows) using errcode = 'invalid_parameter_value';
  end if;

  insert into public.journey_stop_times (journey_id, timetable_stop_id, arrived_at, visit_status)
  select p_journey_id,
         (r->>'timetable_stop_id')::uuid,
         (r->>'arrived_at')::timestamptz,
         coalesce(r->>'visit_status', 'visited')
    from jsonb_array_elements(p_rows) as r
   where nullif(r->>'timetable_stop_id', '') is not null
  on conflict (journey_id, timetable_stop_id) where timetable_stop_id is not null do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- The Driver PWA and Announce Solo only (both run as anon, with or without a
-- signed duty/device token). Dashboard users never record stop times.
revoke execute on function public.record_journey_stop_times(uuid, jsonb) from public, authenticated;
grant execute on function public.record_journey_stop_times(uuid, jsonb) to anon;
