-- Migration: announcement coverage gap alerts
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-09-16
--
-- Phase 3 of docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md ("never synthesize"). Gives the
-- journey-start preflight check and the live per-stop playback path somewhere to
-- persist a "loud" ops-facing signal when a PSVAIR announcement clip isn't
-- confirmed present, replacing what would otherwise be a silent console.warn.
-- No dashboard UI reads this yet -- rows are queryable directly (Supabase
-- Studio/SQL) until a fast-follow wires up pcv-dashboard/src/features/audio-config/.
--
-- anon-insertable because the driver PWA has no login session at all today
-- (see CLAUDE.md's "Public client config" note) -- same trust model as
-- journey_events/diversion_alert_event. Revisit this insert policy once the
-- planned PWA/driver-device login work lands; at that point this can likely
-- move to an authenticated-device-scoped check instead of `with check (true)`.
--
-- vehicle_id and device_id are both nullable, and exactly which is set
-- depends on which surface recorded the gap: Driver/Lite always has a real
-- vehicle_id; an Announce Solo device running its own autopilot
-- (announce_devices.gps_source = 'internal') is deliberately *not* linked to
-- a vehicle at all -- that's what distinguishes it from Lite -- so it
-- reports its own announce_devices.id instead. journey_id is the one column
-- always populated, on every surface.

create table public.announcement_coverage_gap (
  id           uuid primary key default gen_random_uuid(),
  journey_id   uuid not null references public.journeys(id),
  vehicle_id   uuid references public.vehicles(id),
  device_id    uuid references public.announce_devices(id),
  driver_id    uuid references public.employees(id), -- null on the cab-device bridge and on Solo
  stage        text not null check (stage in ('journey_start', 'live_stop')),
  missing_keys text[] not null,
  detected_at  timestamptz not null default now(),

  constraint announcement_coverage_gap_has_source
    check (vehicle_id is not null or device_id is not null)
);

create index on public.announcement_coverage_gap (journey_id);
create index on public.announcement_coverage_gap (vehicle_id);
create index on public.announcement_coverage_gap (device_id);
create index on public.announcement_coverage_gap (detected_at);

grant insert on public.announcement_coverage_gap to anon;
grant all    on public.announcement_coverage_gap to authenticated;

alter table public.announcement_coverage_gap enable row level security;

-- Read: any authenticated employee (ops visibility), scoped to their own
-- company via whichever of vehicle_id/device_id this row carries -- same
-- company_select pattern as diversion_alert_event, just branched two ways.
create policy "announcement_coverage_gap_company_select"
  on public.announcement_coverage_gap
  for select
  to authenticated
  using (
    (vehicle_id is not null and vehicle_id in (select id from public.vehicles where company_id = current_company_id()))
    or
    (device_id is not null and device_id in (select id from public.announce_devices where company_id = current_company_id()))
  );

-- Insert: anon (driver PWA / Solo), unrestricted -- no JWT/company context
-- available to check against, same posture as journey_events' anon_gps_fix.
create policy "announcement_coverage_gap_anon_insert"
  on public.announcement_coverage_gap
  for insert
  to anon
  with check (true);
