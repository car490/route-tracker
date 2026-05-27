-- Allow ops_manager to upload/replace/delete company logo
-- Also adds UPDATE policy on companies so logo_path can be written back from the dashboard

-- Storage policies
drop policy if exists "logo_company_insert" on storage.objects;
drop policy if exists "logo_company_update" on storage.objects;
drop policy if exists "logo_company_delete" on storage.objects;

create policy "logo_company_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() in ('super_user', 'ops_manager')
  );

create policy "logo_company_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() in ('super_user', 'ops_manager')
  );

create policy "logo_company_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() in ('super_user', 'ops_manager')
  );

-- Companies UPDATE policy (was select-only before)
drop policy if exists "company_update" on companies;
create policy "company_update" on companies
  for update to authenticated
  using (
    id = current_company_id()
    and current_employee_role() in ('super_user', 'ops_manager')
  )
  with check (id = current_company_id());
