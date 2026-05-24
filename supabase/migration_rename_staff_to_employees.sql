-- migration_rename_staff_to_employees.sql
-- Renames the staff and staff_contacts tables to employees and employee_contacts.
-- Updates the staff_id column, helper functions, and dependent RLS policies.
--
-- Apply via Supabase SQL Editor or Management API.

-- 1. Rename tables
alter table public.staff          rename to employees;
alter table public.staff_contacts rename to employee_contacts;

-- 2. Rename staff_id column in employee_contacts
alter table public.employee_contacts rename column staff_id to employee_id;

-- 3. Rename unique index (Postgres does not rename indexes on table rename)
alter index if exists staff_contacts_one_primary rename to employee_contacts_one_primary;

-- 4. Recreate current_company_id — body referenced the old table name
create or replace function current_company_id()
returns uuid
language sql stable security definer
as $$
  select company_id from employees where auth_user_id = auth.uid() limit 1
$$;

-- 5. Create current_employee_role (replaces current_staff_role)
create or replace function current_employee_role()
returns text
language sql stable security definer
as $$
  select role from employees where auth_user_id = auth.uid() limit 1
$$;

-- 6. Recreate protect_last_super_user — body referenced the old table name
create or replace function protect_last_super_user()
returns trigger
language plpgsql
as $$
begin
  if old.role = 'super_user' and (tg_op = 'DELETE' or new.role != 'super_user') then
    if (
      select count(*) from employees
      where company_id = old.company_id
        and role = 'super_user'
        and id != old.id
    ) = 0 then
      raise exception 'A company must retain at least one super_user.';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- 7. Recreate protect_vehicle_status — called current_staff_role()
create or replace function protect_vehicle_status()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status and current_employee_role() != 'super_user' then
    raise exception 'Only a super_user can change vehicle status.';
  end if;
  return new;
end;
$$;

-- 8. Drop the old current_staff_role function (now superseded by current_employee_role)
drop function if exists current_staff_role();

-- 9. Recreate stops policies that called current_staff_role()
drop policy if exists "super_user_insert" on stops;
drop policy if exists "super_user_update" on stops;

create policy "super_user_insert" on stops
  for insert to authenticated
  with check (current_employee_role() = 'super_user');

create policy "super_user_update" on stops
  for update to authenticated
  using (current_employee_role() = 'super_user');

-- 10. Recreate employee_contacts policy (old body referenced staff/staff_id)
drop policy if exists "company_staff_contacts" on employee_contacts;

create policy "company_employee_contacts" on employee_contacts
  for all to authenticated
  using (
    exists (
      select 1 from employees e
      join employees me on me.company_id = e.company_id
        and me.auth_user_id = auth.uid()
      where e.id = employee_contacts.employee_id
    )
  )
  with check (
    exists (
      select 1 from employees e
      join employees me on me.company_id = e.company_id
        and me.auth_user_id = auth.uid()
      where e.id = employee_contacts.employee_id
    )
  );
