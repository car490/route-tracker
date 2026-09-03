-- Migration: BusOps Announce Lite/Solo tiers — announce_devices table + linking RPCs
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-08-27
-- (Lite/Solo naming split 2026-09-01 — this table predates it and was
-- already tier-neutral, no schema change needed.)
--
-- Adds the announce_devices table (one row per Lite/Solo passenger-sign
-- tablet: Controller-less, either Solo/"internal" GPS mode or Lite's
-- "driver-device"-linked mode) plus three anon-callable RPCs for the
-- device to update its pushed state and for the Driver PWA to link/unlink
-- a device to itself. See docs/ANNOUNCE-PRODUCT-TIERS.md for the full
-- product spec this implements.
--
-- Anon writes go exclusively through the RPCs below (validated inside the
-- security-definer function body), not via direct table INSERT/UPDATE +
-- RLS — same model as get_or_create_manual_journey()/start_journey(),
-- chosen because driver/announce anon callers can carry no JWT claims at
-- all (see supabaseApi.js's driverToken() fallback to the bare anon key).
-- The only anon table access is the device_self SELECT policy below, used
-- for the Announce device's own Realtime subscription to its row.

create table if not exists public.announce_devices (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  vehicle_id    uuid references public.vehicles(id) on delete set null,
  label         text,
  link_state    text not null default 'unlinked'
                  check (link_state in ('unlinked', 'linked')),
  gps_source    text not null default 'internal'
                  check (gps_source in ('internal', 'driver-device')),

  -- Linked-mode push state (Realtime contract) — this row IS the push
  -- target, no separate state table.
  latest_schedule   jsonb,
  latest_state      jsonb,
  state_updated_at  timestamptz,

  -- Solo-mode ("schedule-autopilot") commissioning — null/empty for
  -- Lite/paired-mode devices, populated for Solo ones.
  candidate_departure_ids  uuid[] not null default '{}',
  match_window_before_min  int not null default 15,
  match_window_after_min   int not null default 30,
  terminus_radius_m        int not null default 150,

  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists announce_devices_company_id_idx on public.announce_devices (company_id);
create index if not exists announce_devices_vehicle_id_idx on public.announce_devices (vehicle_id);

grant select on public.announce_devices to anon;
grant all    on public.announce_devices to authenticated;

alter table public.announce_devices enable row level security;

-- Ops (dashboard login): full CRUD scoped to their own company. Registration
-- (insert) happens from AnnounceDeviceLinkPage.jsx via this policy, not a RPC.
create policy "company_all" on public.announce_devices
  for all to authenticated
  using      (company_id = current_company_id())
  with check (company_id = current_company_id());

-- Announce device (anon): may read only its own row, scoped by the
-- device_id claim in its signed device token (see api/sign-announce-token.js).
-- Used by the Realtime postgres_changes subscription in linked mode.
create policy "device_self" on public.announce_devices
  for select to anon
  using (id = (auth.jwt() ->> 'device_id')::uuid);

-- Called by the Driver PWA (anon) when linked, to push derived schedule/state
-- to the paired Announce device. Mirrors announceLink.js's buildSchedulePayload/
-- buildStatePayload shapes — only the transport differs from Standard's
-- WebSocket push, not the message contract.
--
-- p_schedule and p_state are independently optional (coalesced against the
-- existing value, not overwritten with null) because main.js pushes them on
-- different cadences: schedule once per journey start, state on every GPS
-- fix. A state-only push must never wipe out the schedule set moments
-- earlier, and vice versa.
create or replace function public.update_announce_device_state(
  p_device_id uuid,
  p_schedule  jsonb,
  p_state     jsonb
) returns boolean
language plpgsql security definer
as $$
begin
  update public.announce_devices
  set latest_schedule  = coalesce(p_schedule, latest_schedule),
      latest_state     = coalesce(p_state, latest_state),
      state_updated_at = now(),
      last_seen_at     = now()
  where id = p_device_id;
  return found;
end;
$$;

grant execute on function public.update_announce_device_state(uuid, jsonb, jsonb) to anon;

-- Called by the Driver PWA (anon) to link an Announce device registered to
-- the same vehicle. Validates ownership inside the function body (device and
-- vehicle must share a company_id) rather than via RLS+JWT claim, since a
-- manual-selection-flow driver device may carry no JWT claims at all.
create or replace function public.link_announce_device(
  p_device_id  uuid,
  p_vehicle_id uuid
) returns boolean
language plpgsql security definer
as $$
declare
  v_device_company  uuid;
  v_vehicle_company uuid;
begin
  select company_id into v_device_company
  from public.announce_devices where id = p_device_id;

  if v_device_company is null then
    raise exception 'announce device % not found', p_device_id;
  end if;

  select company_id into v_vehicle_company
  from public.vehicles where id = p_vehicle_id;

  if v_vehicle_company is null or v_vehicle_company <> v_device_company then
    raise exception 'vehicle % not found for this device''s company', p_vehicle_id;
  end if;

  update public.announce_devices
  set link_state   = 'linked',
      gps_source   = 'driver-device',
      vehicle_id   = p_vehicle_id,
      last_seen_at = now()
  where id = p_device_id;

  return found;
end;
$$;

grant execute on function public.link_announce_device(uuid, uuid) to anon;

-- Called by the Driver PWA (anon) to unlink an Announce device — reversible
-- at any time, drops the device back to internal (self-contained) GPS mode.
create or replace function public.unlink_announce_device(
  p_device_id uuid
) returns boolean
language plpgsql security definer
as $$
begin
  update public.announce_devices
  set link_state   = 'unlinked',
      gps_source   = 'internal',
      last_seen_at = now()
  where id = p_device_id;
  return found;
end;
$$;

grant execute on function public.unlink_announce_device(uuid) to anon;
