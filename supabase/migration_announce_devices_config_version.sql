-- Cheap config-change detection for Announce Lite devices (BusOps).
--
-- Previously a device's config (testing_mode, gps_source,
-- candidate_departure_ids, match windows, terminus_radius_m, vehicle_id,
-- link_state) was read once at boot and never rechecked -- a dashboard edit
-- had no effect on an already-running tablet until someone rebooted it (see
-- announceLiteFeed.js's former "decided once, not hot-switched mid-session"
-- comment). deviceStateSync.js's hasRowChanged() now drives live
-- reconciliation off this column: a single integer comparison rather than a
-- full row diff, and the same one-column-plus-trigger shape any future
-- device's own table (PA amp/ticketing/APC -- see docs/HARDWARE.md §10,
-- none built yet) can reuse without new architecture.
alter table public.announce_devices
  add column if not exists config_version int not null default 1;

create or replace function public.bump_announce_device_config_version()
returns trigger
language plpgsql
as $$
begin
  if (
    new.testing_mode            is distinct from old.testing_mode or
    new.gps_source               is distinct from old.gps_source or
    new.candidate_departure_ids is distinct from old.candidate_departure_ids or
    new.match_window_before_min is distinct from old.match_window_before_min or
    new.match_window_after_min  is distinct from old.match_window_after_min or
    new.terminus_radius_m       is distinct from old.terminus_radius_m or
    new.vehicle_id               is distinct from old.vehicle_id or
    new.link_state                is distinct from old.link_state
  ) then
    new.config_version := old.config_version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists announce_devices_bump_config_version on public.announce_devices;
create trigger announce_devices_bump_config_version
  before update on public.announce_devices
  for each row execute function public.bump_announce_device_config_version();

-- Self-reported liveness -- previously last_seen_at was only ever touched
-- by Driver-invoked RPCs (update_announce_device_state/link_announce_device/
-- unlink_announce_device/end_announce_device_journey), so a standalone
-- ("internal" gps_source) device -- which never calls any of those -- had no
-- way to report it was alive at all. Every device now writes this itself on
-- a heartbeat interval (see deviceStateSync.js's startHeartbeat, wired in by
-- announceLiteFeed.js), independent of mode or of anything else pushing
-- through it. Scoped by the device's own JWT claim, same pattern as the
-- device_self SELECT policy -- no device id parameter, so a device can only
-- ever report on itself.
create or replace function public.report_device_heartbeat()
returns boolean
language plpgsql security definer
as $$
declare
  v_device_id uuid := (auth.jwt() ->> 'device_id')::uuid;
begin
  if v_device_id is null then
    return false;
  end if;
  update public.announce_devices
  set last_seen_at = now()
  where id = v_device_id;
  return found;
end;
$$;

grant execute on function public.report_device_heartbeat() to anon;
