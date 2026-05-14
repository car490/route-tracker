-- Replace the flat email/phone columns with a proper contacts table.
-- Apply in Supabase SQL Editor.
-- Safe to run whether or not migration_staff_contact.sql was previously applied.

-- Drop flat columns added by migration_staff_contact.sql (no-op if not present)
alter table staff drop column if exists email;
alter table staff drop column if exists phone;

-- ── staff_contacts ─────────────────────────────────────────────────────────
-- Multiple contact methods per staff member; exactly one may be primary.

create table if not exists staff_contacts (
  id          uuid        primary key default gen_random_uuid(),
  staff_id    uuid        not null references staff(id) on delete cascade,
  type        text        not null check (type in ('email', 'phone')),
  value       text        not null,
  is_primary  boolean     not null default false,
  created_at  timestamptz not null default now()
);

-- Enforce at most one primary contact per staff member
create unique index if not exists staff_contacts_one_primary
  on staff_contacts (staff_id)
  where is_primary = true;

alter table staff_contacts enable row level security;

-- Authenticated ops users can manage contacts for staff in their company
create policy "company_staff_contacts" on staff_contacts
  for all to authenticated
  using (
    exists (
      select 1 from staff s
      join staff me on me.company_id = s.company_id
        and me.auth_user_id = auth.uid()
      where s.id = staff_contacts.staff_id
    )
  )
  with check (
    exists (
      select 1 from staff s
      join staff me on me.company_id = s.company_id
        and me.auth_user_id = auth.uid()
      where s.id = staff_contacts.staff_id
    )
  );

-- Explicit grants for Supabase Data API.
-- Required from 2026-10-30 for existing projects (2026-05-30 for new ones).
-- Without these, staff_contacts will become invisible to supabase-js / PostgREST
-- once Supabase removes the auto-grant behaviour.
grant select on public.staff_contacts to anon;
grant all on public.staff_contacts to authenticated;
