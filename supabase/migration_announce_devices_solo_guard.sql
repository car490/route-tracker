-- supabase/migration_announce_devices_solo_guard.sql
--
-- Guards link_announce_device() against silently converting an
-- already-commissioned Solo device (candidate_departure_ids populated) into
-- Lite (driver-device) mode. Found live 2026-09-04: a Solo tablet got
-- flipped to gps_source='driver-device' with no driver device actually
-- pushing to it (linking today is a manual `select link_announce_device(...)`
-- SQL call per docs/TESTING.md §17 — there's no dashboard/PWA UI yet, so a
-- stray/mistargeted call is the likely cause) and sat waiting for a push
-- that would never arrive, with no fallback to autopilot. See
-- docs/ANNOUNCE-PRODUCT-TIERS.md and announceDeviceFeed.js's self-heal
-- watchdog (announceLiteMode.js's shouldSelfHeal) for the other half of this
-- fix — this migration stops the flip at the source; the watchdog covers a
-- deliberate p_force := true link (or any other future path) that still
-- ends up with no driver ever pushing.
--
-- Postgres resolves functions by their full argument-type signature, so
-- adding a new parameter to link_announce_device(uuid, uuid) would create a
-- second, still-unguarded overload rather than replacing it — the old
-- 2-argument signature must be dropped explicitly first.
drop function if exists public.link_announce_device(uuid, uuid);

create or replace function public.link_announce_device(
  p_device_id  uuid,
  p_vehicle_id uuid,
  p_force      boolean default false
) returns boolean
language plpgsql security definer
as $$
declare
  v_device_company uuid;
  v_candidate_count int;
  v_vehicle_company uuid;
begin
  select company_id, cardinality(candidate_departure_ids)
    into v_device_company, v_candidate_count
  from public.announce_devices where id = p_device_id;

  if v_device_company is null then
    raise exception 'announce device % not found', p_device_id;
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

grant execute on function public.link_announce_device(uuid, uuid, boolean) to anon;
