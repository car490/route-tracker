-- Neither Announce tier had any "journey ended" signal -- Standard's
-- Controller push (announceLink.js) just closes the socket, and paired Lite
-- just stops pushing -- so the onboard sign shows the last journey's state
-- forever until the next journey overwrites it. This RPC is Lite's half of
-- the fix: an explicit reset (not update_announce_device_state's coalesced
-- update, which deliberately never lets one column's push null out the
-- other) called from main.js's completeTrip() when a linked device exists.
create or replace function public.end_announce_device_journey(
  p_device_id uuid
) returns boolean
language plpgsql security definer
as $$
begin
  update public.announce_devices
  set latest_schedule  = null,
      latest_state     = null,
      state_updated_at = now(),
      last_seen_at     = now()
  where id = p_device_id;
  return found;
end;
$$;

grant execute on function public.end_announce_device_journey(uuid) to anon;
