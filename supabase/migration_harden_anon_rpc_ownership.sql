-- Adds ownership checks to five anon-callable SECURITY DEFINER RPCs that
-- previously trusted their id parameter with no check the caller was
-- entitled to it (start_journey, complete_journey, update_announce_device_state,
-- end_announce_device_journey, unlink_announce_device). See
-- docs/SECURITY_FIXES_2026-09-17.md Item 2.

-- True when the caller's token is entitled to act on p_device_id:
--  - a device token (device_id claim) may only ever act on itself, same
--    pattern as report_device_heartbeat().
--  - a driver token (journey_ids claim, no device_id claim) may act on a
--    device only if that device's vehicle is the vehicle of one of the
--    caller's own journeys.
--  - a token with neither claim (legacy anon key) is allowed, same
--    legacy-compatibility tradeoff is_jwt_journey_allowed() already makes.
create or replace function is_jwt_device_allowed(p_device_id uuid)
returns boolean
language sql stable security definer
as $$
  select
    case
      when auth.jwt()->>'device_id' is not null then
        (auth.jwt()->>'device_id')::uuid = p_device_id
      when auth.jwt()->>'journey_ids' is not null then
        exists (
          select 1
          from public.announce_devices d
          join public.journeys j on j.vehicle_id = d.vehicle_id
          where d.id = p_device_id
            and j.id = any(
              array(select jsonb_array_elements_text(auth.jwt()->'journey_ids'))::uuid[]
            )
        )
      else true
    end
$$;

grant execute on function is_jwt_device_allowed(uuid) to anon;

create or replace function start_journey(p_journey_id uuid)
returns boolean
language plpgsql security definer
as $$
begin
  if not is_jwt_journey_allowed(p_journey_id) then
    raise exception 'journey % not permitted for this token', p_journey_id;
  end if;

  update journeys set status = 'in_progress', started_at = now()
  where id = p_journey_id and status = 'scheduled';
  return found;
end;
$$;

create or replace function complete_journey(p_journey_id uuid)
returns boolean
language plpgsql security definer
as $$
begin
  if not is_jwt_journey_allowed(p_journey_id) then
    raise exception 'journey % not permitted for this token', p_journey_id;
  end if;

  update journeys set status = 'completed', completed_at = now()
  where id = p_journey_id and status = 'in_progress';
  return found;
end;
$$;

-- Called by the Driver PWA (anon) when linked, to push derived schedule/state
-- to the paired Announce device. Mirrors announceLink.js's buildSchedulePayload/
-- buildStatePayload shapes — only the transport differs from the base
-- Announce tier's WebSocket push, not the message contract.
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
  if not is_jwt_device_allowed(p_device_id) then
    raise exception 'device % not permitted for this token', p_device_id;
  end if;

  update public.announce_devices
  set latest_schedule  = coalesce(p_schedule, latest_schedule),
      latest_state     = coalesce(p_state, latest_state),
      state_updated_at = now(),
      last_seen_at     = now()
  where id = p_device_id;
  return found;
end;
$$;

-- Called by the Driver PWA (anon) when a journey ends, so a linked Announce
-- device returns to its idle screen instead of showing the last journey's
-- state forever (confirmed gap, 2026-08-28 -- both this tier and Standard's
-- WebSocket push had no "journey ended" signal at all until now; Standard's
-- side is announceRelay.mjs's new 'complete' message type). A genuine clear,
-- not routed through update_announce_device_state's coalesce above -- that
-- function deliberately never lets a partial push wipe the other column,
-- which is exactly wrong for this explicit end-of-journey reset.
create or replace function public.end_announce_device_journey(
  p_device_id uuid
) returns boolean
language plpgsql security definer
as $$
begin
  if not is_jwt_device_allowed(p_device_id) then
    raise exception 'device % not permitted for this token', p_device_id;
  end if;

  update public.announce_devices
  set latest_schedule  = null,
      latest_state     = null,
      state_updated_at = now(),
      last_seen_at     = now()
  where id = p_device_id;
  return found;
end;
$$;

-- Called by the Driver PWA (anon) to unlink an Announce device — reversible
-- at any time, drops the device back to internal (self-contained) GPS mode.
create or replace function public.unlink_announce_device(
  p_device_id uuid
) returns boolean
language plpgsql security definer
as $$
begin
  if not is_jwt_device_allowed(p_device_id) then
    raise exception 'device % not permitted for this token', p_device_id;
  end if;

  update public.announce_devices
  set link_state   = 'unlinked',
      gps_source   = 'internal',
      last_seen_at = now()
  where id = p_device_id;
  return found;
end;
$$;
