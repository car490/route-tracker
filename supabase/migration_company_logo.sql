-- Add logo_path to companies and create company-logos storage bucket

alter table public.companies
  add column if not exists logo_path text;

-- Public bucket: logos served without auth (sidebar display)
insert into storage.buckets (id, name, public)
values ('company-logos', 'company-logos', true)
on conflict (id) do nothing;

-- Anyone can download logos
create policy "logo_public_read" on storage.objects
  for select
  using (bucket_id = 'company-logos');

-- Authenticated users may upload into their own company's folder only
create policy "logo_company_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = current_company_id()::text
  );

-- Authenticated users may replace their own company's logo
create policy "logo_company_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = current_company_id()::text
  );

-- Authenticated users may delete their own company's logo
create policy "logo_company_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = current_company_id()::text
  );
