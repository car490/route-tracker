-- Security hardening, phase 0 (2026-09-23 security scan).
--
-- Context: Supabase Auth signup is open on dev AND production
-- (/auth/v1/settings -> disable_signup=false), so anyone with an email
-- address can become an `authenticated` user with no employee row. Every
-- `to authenticated using (true)` policy and every RPC that only checks
-- `auth.role() = 'authenticated'` is therefore reachable by the public.
-- This migration closes those. Idempotent; safe to re-run.

-- 1. Prod-only drift: journey_stop_times had an extra anon INSERT policy
--    (`anon_upload_stop_times`) that checked is_journey_in_progress() only.
--    Policies are OR'd, so it bypassed the JWT scoping in `anon_insert`
--    entirely -- even a correctly-scoped driver token could write stop times
--    to ANY in-progress journey. It exists in no repo file (dev never had it).
drop policy if exists "anon_upload_stop_times" on public.journey_stop_times;

-- 2. stops: global table, so tenancy can't be expressed as company_id. Until
--    it can, require a real ops employee to insert, and allow no client-side
--    UPDATE at all (the dashboard never updates stops; NaPTAN import and
--    stops.announcement_name edits use service_role / SQL). stops.name and
--    announcement_name feed the spoken PSVAIR announcement clips, so an open
--    UPDATE let any signed-up user rewrite what every operator's buses say.
--    KNOWN REMAINING GAP: any ops user of ANY company can still insert a stop.
drop policy if exists "auth_insert" on public.stops;
drop policy if exists "auth_update" on public.stops;
drop policy if exists "ops_insert" on public.stops;
create policy "ops_insert" on public.stops
  for insert to authenticated
  with check (current_employee_role() in ('super_user', 'ops_manager'));

-- 3. journey_types / term_dates: global reference data, never written by any
--    app (dashboard and PWA only read them). term_dates decides which school
--    departures run, so open ALL was a cross-tenant service-integrity hole.
--    Now read-only to clients; change via SQL / service_role like other config.
drop policy if exists "auth_all" on public.journey_types;
drop policy if exists "auth_read" on public.journey_types;
create policy "auth_read" on public.journey_types
  for select to authenticated using (true);
revoke insert, update, delete on public.journey_types from authenticated;

drop policy if exists "auth_all" on public.term_dates;
drop policy if exists "auth_read" on public.term_dates;
create policy "auth_read" on public.term_dates
  for select to authenticated using (true);
revoke insert, update, delete on public.term_dates from authenticated;

-- 4. generate_duty_token(): signed a duty JWT in Postgres for ANY journey_ids
--    / driver_id with only an `authenticated` role check -- no ownership
--    check, unlike its Vercel twin /api/sign-token (which validates every id
--    through the caller's RLS). Nothing calls it (the dashboard uses
--    /api/sign-token), so remove it rather than duplicate the checks.
drop function if exists public.generate_duty_token(uuid[], text, uuid);

-- 5. announcement_coverage_gap: anon INSERT was `with check (true)`, i.e.
--    unauthenticated row spam into an ops-facing alert table. Scope it like
--    journey_events. (Still passes for a claim-less legacy anon key -- see the
--    is_jwt_journey_allowed() fallthrough; that is a separate, planned change.)
drop policy if exists "announcement_coverage_gap_anon_insert" on public.announcement_coverage_gap;
create policy "announcement_coverage_gap_anon_insert"
  on public.announcement_coverage_gap
  for insert to anon
  with check (is_jwt_journey_allowed(journey_id));

-- 6. Functions that must not be callable through /rest/v1/rpc. By default
--    Postgres grants EXECUTE to PUBLIC, which anon inherits, so revoke from
--    PUBLIC too. No anon policy uses the two helpers (checked against
--    pg_policies), and authenticated policies still can.
revoke execute on function public.fn_naptan_import_on_county_change() from public, anon, authenticated;

revoke execute on function public.current_company_id()    from public, anon;
revoke execute on function public.current_employee_role() from public, anon;
grant  execute on function public.current_company_id()    to authenticated, service_role;
grant  execute on function public.current_employee_role() to authenticated, service_role;
