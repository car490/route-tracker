-- Add multi-tenant branding columns to companies
-- slug: URL-safe identifier for the company (used in future public tracking pages)
-- primary_color: sidebar/header colour — defaults to CoachMate Tarmac Charcoal
-- accent_color:  button/highlight colour — defaults to CoachMate Signal Cyan

alter table public.companies
  add column if not exists slug          text unique,
  add column if not exists primary_color text not null default '#242F35',
  add column if not exists accent_color  text not null default '#00B4D8';

-- ── Storage: system-assets bucket ─────────────────────────────────────────────
-- Stores CoachMate core icons, SVGs, and "Powered by" badges.
insert into storage.buckets (id, name, public)
values ('system-assets', 'system-assets', true)
on conflict (id) do nothing;

-- Public read — no auth required
create policy "system_assets_public_read" on storage.objects
  for select
  using (bucket_id = 'system-assets');

-- ── Storage: operator-assets bucket ───────────────────────────────────────────
-- Stores company-uploaded logos. Replaces / supplements company-logos bucket.
insert into storage.buckets (id, name, public)
values ('operator-assets', 'operator-assets', true)
on conflict (id) do nothing;

-- Public read — logos are served without auth (sidebar display)
create policy "operator_assets_public_read" on storage.objects
  for select
  using (bucket_id = 'operator-assets');

-- super_user and ops_manager may upload into their own company's folder
create policy "operator_assets_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'operator-assets'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() in ('super_user', 'ops_manager')
  );

-- super_user and ops_manager may replace their own company's logo
create policy "operator_assets_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'operator-assets'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() in ('super_user', 'ops_manager')
  );

-- super_user and ops_manager may delete their own company's logo
create policy "operator_assets_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'operator-assets'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() in ('super_user', 'ops_manager')
  );
