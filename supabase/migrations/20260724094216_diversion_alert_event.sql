-- supabase/migrations/20260724094216_diversion_alert_event.sql
--
-- Slice 2: Driver-Triggered Diversion Alert
-- Table + RLS policies. Must run after is_journey_in_progress() and
-- is_jwt_journey_allowed() (schema.sql "Helper functions" section).
--
-- Identity mechanism: drivers have no dashboard login (see the "employees"
-- comment in schema.sql — auth_user_id is only set for ops/admin), so
-- current_employee_role()/auth.uid() (used by Slice 1's vehicle_audio_config)
-- don't apply here. The Driver PWA runs as the anon role and, when reached
-- via a duty-card link, carries a signed JWT with a `driver_id` claim
-- (embedded by get_duty_card(), already read by is_jwt_journey_allowed() for
-- journey_events/journey_stop_times). This table reads that same claim
-- directly to enforce ownership.

create table if not exists public.diversion_alert_event (
  id           uuid primary key default gen_random_uuid(),
  journey_id   uuid not null references public.journeys(id),
  vehicle_id   uuid not null references public.vehicles(id),
  driver_id    uuid not null references public.employees(id),
  triggered_at timestamptz not null default now(),
  cleared_at   timestamptz
);

create index on public.diversion_alert_event (journey_id);
create index on public.diversion_alert_event (driver_id);

grant select on public.diversion_alert_event to anon;
grant insert on public.diversion_alert_event to anon;
grant update on public.diversion_alert_event to anon;
grant all    on public.diversion_alert_event to authenticated;

alter table public.diversion_alert_event enable row level security;

-- Read: any authenticated employee (ops/compliance visibility into the
-- audit trail), scoped to their own company via journey_id — same pattern
-- as journey_events' "company_all" policy.
create policy "diversion_alert_event_company_select"
  on public.diversion_alert_event
  for select
  to authenticated
  using (
    journey_id in (select id from public.journeys where company_id = current_company_id())
  );

-- Anon (driver): may see only their own alerts. Needed so the UPDATE below
-- can locate its row (Postgres requires SELECT on columns referenced in an
-- UPDATE's WHERE clause) — not a general read grant, RLS still confines it
-- to rows this driver owns.
create policy "diversion_alert_event_anon_select_own"
  on public.diversion_alert_event
  for select
  to anon
  using (driver_id = (auth.jwt() ->> 'driver_id')::uuid);

-- Insert: driver can only create an alert for THEIR OWN driver_id — taken
-- from the signed duty token's driver_id claim, never from client input —
-- and only while the journey is actually running. This ownership check is
-- the main security property of this table: a driver cannot remotely
-- trigger another vehicle's alert. A plain/legacy anon key with no
-- driver_id claim resolves to NULL here and is correctly rejected (NULL =
-- anything is never true).
create policy "diversion_alert_event_anon_insert"
  on public.diversion_alert_event
  for insert
  to anon
  with check (
    driver_id = (auth.jwt() ->> 'driver_id')::uuid
    and is_journey_in_progress(journey_id)
    and is_jwt_journey_allowed(journey_id)
  );

-- Update (for cleared_at): same ownership rule — only the triggering driver
-- can clear their own alert.
create policy "diversion_alert_event_anon_clear_own"
  on public.diversion_alert_event
  for update
  to anon
  using (driver_id = (auth.jwt() ->> 'driver_id')::uuid)
  with check (driver_id = (auth.jwt() ->> 'driver_id')::uuid);
