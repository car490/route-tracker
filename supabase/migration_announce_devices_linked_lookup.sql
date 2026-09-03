-- Migration: Fix Announce Lite paired-mode push -- driver-side linked-device lookup
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-08-27
--
-- fetchLinkedAnnounceDeviceId() (driver/src/announceDeviceLinkApi.js) needs to look
-- up whether a linked Announce device exists for a vehicle, as a plain anon caller
-- with no JWT claims (manual-selection driver devices carry none). The only anon
-- RLS policy on announce_devices ("device_self", migration_announce_devices.sql)
-- requires the caller to already carry that exact device's own device_id claim,
-- which the driver obviously doesn't have -- so the direct REST SELECT this used
-- always returned zero rows under RLS, and paired-mode's schedule/state push never
-- fired. Found live 2026-08-27 testing against a real linked device: last_seen_at
-- updated (from the link RPC) but latest_schedule/latest_state stayed null through
-- a full journey start.
--
-- Same fix pattern as link_announce_device/unlink_announce_device: a narrow
-- SECURITY DEFINER RPC that returns only the id, not the row's schedule/state
-- contents -- not a broader anon SELECT policy, which would let any anon caller
-- read latest_schedule/latest_state for any company's vehicle by guessing a
-- vehicle_id (cross-tenant leak of live operational data).

create or replace function public.get_linked_announce_device_id(
  p_vehicle_id uuid
) returns uuid
language sql security definer
stable
as $$
  select id from public.announce_devices
  where vehicle_id = p_vehicle_id and link_state = 'linked'
  limit 1;
$$;

grant execute on function public.get_linked_announce_device_id(uuid) to anon;
