-- Migration: reset_journey() — reset a journey to Scheduled in one transaction
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-09-24
--
-- Why: the dashboard's Reset button made three separate REST calls (delete
-- journey_events, delete journey_stop_times, update journeys). If one failed
-- part-way — much more likely from the new phone page on patchy mobile data —
-- the journey was left half-cleared: its stop times gone but still marked
-- Completed, or the other way round. A function body runs as one transaction,
-- so now it either all happens or none of it does.
--
-- Security: SECURITY INVOKER on purpose, not definer. Every statement runs as
-- the calling dashboard user, so the existing "company_all" RLS policies on
-- journeys/journey_events/journey_stop_times do the company scoping exactly as
-- they did for the three REST calls — nothing new is exposed. A journey id
-- from another company is simply invisible and returns false. Only
-- `authenticated` may execute it; PUBLIC's default execute grant is revoked so
-- the anon key (the driver PWA) can't call it at all.

create or replace function public.reset_journey(p_journey_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- RLS hides other companies' journeys, so this is also the ownership check.
  perform 1 from journeys where id = p_journey_id;
  if not found then
    return false;
  end if;

  delete from journey_events     where journey_id = p_journey_id;
  delete from journey_stop_times where journey_id = p_journey_id;

  update journeys
     set status = 'scheduled', started_at = null, completed_at = null
   where id = p_journey_id;

  return found;
end;
$$;

revoke execute on function public.reset_journey(uuid) from public, anon;
grant  execute on function public.reset_journey(uuid) to authenticated;
