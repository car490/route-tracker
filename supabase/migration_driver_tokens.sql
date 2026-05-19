-- Migration: driver identity tokens (signed JWTs in duty card URLs)
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-05-19
--
-- Adds is_jwt_journey_allowed() helper and tightens the three anon write policies
-- on journey_events and journey_stop_times to honour the journey_ids claim in
-- driver tokens. Backwards-compatible: the legacy anon key (no journey_ids claim)
-- continues to work unchanged.

-- 1. Helper function: returns true when the JWT has no journey_ids claim (legacy
--    anon key) or when the given journey_id appears in the claim.
create or replace function is_jwt_journey_allowed(j_id uuid)
returns boolean
language sql stable security definer
as $$
  select
    auth.jwt()->>'journey_ids' is null
    or j_id = any(
      array(select jsonb_array_elements_text(auth.jwt()->'journey_ids'))::uuid[]
    )
$$;

grant execute on function is_jwt_journey_allowed(uuid) to anon;

-- 2. Rebuild the three anon write policies to add the journey-scope check.
drop policy if exists "anon_gps_fix"  on journey_events;
drop policy if exists "anon_incident" on journey_events;
drop policy if exists "anon_insert"   on journey_stop_times;

create policy "anon_gps_fix" on journey_events
  for insert to anon
  with check (
    event_type = 'gps_fix'
    and is_journey_in_progress(journey_id)
    and is_jwt_journey_allowed(journey_id)
  );

create policy "anon_incident" on journey_events
  for insert to anon
  with check (
    event_type = 'incident'
    and is_journey_in_progress(journey_id)
    and is_jwt_journey_allowed(journey_id)
  );

create policy "anon_insert" on journey_stop_times
  for insert to anon
  with check (
    is_journey_in_progress(journey_id)
    and is_jwt_journey_allowed(journey_id)
  );
