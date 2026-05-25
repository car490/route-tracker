-- Restrict logo storage writes to super_user only

drop policy if exists "logo_company_insert" on storage.objects;
drop policy if exists "logo_company_update" on storage.objects;
drop policy if exists "logo_company_delete" on storage.objects;

create policy "logo_company_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() = 'super_user'
  );

create policy "logo_company_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() = 'super_user'
  );

create policy "logo_company_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_employee_role() = 'super_user'
  );
