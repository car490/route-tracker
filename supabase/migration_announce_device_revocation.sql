-- Per-device revocation for the Announce onboard-sign device token. That
-- token deliberately carries a 100-year exp (Supabase Realtime rejects a
-- token with no exp at all) with no other expiry mechanism -- until now,
-- the only way to stop a single leaked/compromised device from using its
-- token was rotating the shared JWT secret for every device on the fleet
-- at once. See docs/SECURITY_FIXES_2026-09-17.md Item 4(b). Do NOT change
-- the 100-year exp itself -- out of scope here, and intentional.

-- 1. Nullable revocation timestamp -- null (the default) means "not
--    revoked"; set directly via SQL for now, no admin UI (same precedent
--    as stops.announcement_name).
alter table public.announce_devices add column revoked_at timestamptz;

-- 2. Rebuild is_jwt_device_allowed() to AND a revocation check onto all
--    three existing branches (branches themselves unchanged).
create or replace function is_jwt_device_allowed(p_device_id uuid)
returns boolean
language sql stable security definer
as $$
  select
    not exists (
      select 1 from public.announce_devices
      where id = p_device_id and revoked_at is not null
    )
    and case
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

-- 3. Rebuild the device_self policy to also require the device isn't
--    revoked -- same drop/create pattern migration_driver_tokens.sql used
--    to rebuild an existing policy.
drop policy if exists "device_self" on public.announce_devices;

create policy "device_self" on public.announce_devices
  for select to anon
  using (id = (auth.jwt() ->> 'device_id')::uuid and revoked_at is null);
