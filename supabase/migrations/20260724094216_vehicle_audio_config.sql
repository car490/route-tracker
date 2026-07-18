-- supabase/migrations/20260724094216_vehicle_audio_config.sql
--
-- Slice 1: Fixed-Volume Audio Config
-- Table + RLS policies + anon-safe read RPC. Assumes current_employee_role()
-- is already defined by an earlier migration — this file must run after it
-- (per schema.sql ordering rule).

create table if not exists public.vehicle_audio_config (
  id                  uuid primary key default gen_random_uuid(),
  vehicle_id          uuid not null references public.vehicles(id),
  ambient_reading_db  numeric not null,
  fixed_output_level  numeric not null,
  measured_at         timestamptz not null,
  measured_by         uuid not null references public.employees(id),
  notes               text,
  created_at          timestamptz not null default now()
);

-- Append-only: no update/delete policy defined at all — a new reading is a
-- new row, never an overwrite.

grant select on public.vehicle_audio_config to anon;
grant all    on public.vehicle_audio_config to authenticated;

alter table public.vehicle_audio_config enable row level security;

-- Read: any authenticated employee (dashboard staff reviewing calibration
-- history/notes). Deliberately NOT granted to anon here — the anon-held key
-- ships to every browser, and this table carries measured_by/notes. The
-- Driver PWA (which runs anon, no login) reads via the narrow
-- get_audio_config_for_vehicle() RPC below instead, same pattern as
-- is_journey_in_progress().
create policy "vehicle_audio_config_select_authenticated"
  on public.vehicle_audio_config
  for select
  to authenticated
  using (true);

-- Write: restricted to authorised roles only, per existing precedent
-- (matches the current_employee_role() in ('super_user','ops_manager')
-- pairing already used throughout schema.sql).
create policy "vehicle_audio_config_insert"
  on public.vehicle_audio_config
  for insert
  to authenticated
  with check (current_employee_role() in ('super_user', 'ops_manager'));

-- Anon-safe read for the Driver PWA: returns only vehicle_id/level/timestamp
-- for one vehicle, never notes or measured_by. security definer so it can
-- read past the RLS policy above (which intentionally excludes anon).
create or replace function public.get_audio_config_for_vehicle(p_vehicle_id uuid)
returns table (
  vehicle_id          uuid,
  fixed_output_level  numeric,
  measured_at         timestamptz
)
language sql stable security definer
as $$
  select vehicle_id, fixed_output_level, measured_at
  from public.vehicle_audio_config
  where vehicle_id = p_vehicle_id
  order by measured_at desc
$$;

grant execute on function public.get_audio_config_for_vehicle(uuid) to anon;
