-- Temporarily allow any authenticated user to insert/update stops.
-- Production intent: restore super_user_insert / super_user_update policies.
drop policy if exists "super_user_insert" on stops;
drop policy if exists "super_user_update" on stops;

create policy "auth_insert" on stops
  for insert to authenticated
  with check (true);

create policy "auth_update" on stops
  for update to authenticated
  using (true);
