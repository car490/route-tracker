-- Migration: link_announce_device() caller-authorization fix
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-09-15
--
-- Phase 0 of docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md's implementation checklist.
--
-- link_announce_device() is security definer and granted to anon (the
-- Driver PWA has no login, ever, so this is the same anon-only trust model
-- as the rest of that app). It previously checked only that the target
-- device and vehicle shared a company_id with *each other* -- never that
-- the caller had any legitimate relationship to either. Since the anon key
-- is public and shared across every company on this Supabase project,
-- anyone holding it could link any device to any vehicle, as long as that
-- device and vehicle already happened to share a company_id. Nothing in
-- the client calls this RPC today (announceDeviceLinkApi.js's
-- linkAnnounceDevice() is unused dead code as of this writing), so this
-- fix has no existing caller to migrate.
--
-- Fix: add a pairing_secret to each announce_devices row, generated at
-- creation (a uuid, same convention as this table's own id column). The
-- caller of link_announce_device() must now present the target device's
-- pairing_secret; a missing or wrong value is rejected before either the
-- Solo-commissioning guard or the company check runs, so an unauthorized
-- caller can't use this RPC's error messages to probe a device's state.
-- Whatever driver-side linking UI eventually gets built (see
-- AnnounceDeviceLinkPage.jsx's dashboard-side registration flow for the
-- precedent) will need to plumb this secret through -- not attempted here,
-- out of scope for this DB-level fix.

alter table public.announce_devices
  add column if not exists pairing_secret uuid not null default gen_random_uuid();

drop function if exists public.link_announce_device(uuid, uuid, boolean);

create or replace function public.link_announce_device(
  p_device_id      uuid,
  p_vehicle_id     uuid,
  p_pairing_secret uuid,
  p_force          boolean default false
) returns boolean
language plpgsql security definer
as $$
declare
  v_device_company  uuid;
  v_device_secret   uuid;
  v_candidate_count int;
  v_vehicle_company uuid;
begin
  select company_id, cardinality(candidate_departure_ids), pairing_secret
    into v_device_company, v_candidate_count, v_device_secret
  from public.announce_devices where id = p_device_id;

  if v_device_company is null then
    raise exception 'announce device % not found', p_device_id;
  end if;

  if p_pairing_secret is null or p_pairing_secret <> v_device_secret then
    raise exception 'announce device % pairing secret does not match', p_device_id;
  end if;

  if v_candidate_count > 0 and not p_force then
    raise exception
      'announce device % is commissioned as Solo (has candidate_departure_ids) -- pass p_force := true to link it anyway',
      p_device_id;
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

grant execute on function public.link_announce_device(uuid, uuid, uuid, boolean) to anon;
