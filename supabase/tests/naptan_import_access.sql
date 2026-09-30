-- supabase/tests/naptan_import_access.sql
--
-- Verification for supabase/migration_naptan_import_service_role.sql: what the
-- naptan-import Edge Function (service-role key) needs, and nothing more on
-- companies. Read-only; run on dev and production.
-- Run with: psql <connection> -f supabase/tests/naptan_import_access.sql
--
-- Why this exists (2026-09-29): the weekly NaPTAN refresh returned 401 on every
-- run (wrong caller credential); fixing that exposed that service_role could not
-- read companies.service_counties, which the refresh needs.
do $$
begin
  if not has_column_privilege('service_role', 'public.companies', 'service_counties', 'SELECT') then
    raise exception 'FAIL: service_role cannot read companies.service_counties (NaPTAN refresh)';
  end if;
  if has_column_privilege('service_role', 'public.companies', 'operator_licence_number', 'SELECT')
     or has_column_privilege('service_role', 'public.companies', 'email', 'SELECT') then
    raise exception 'FAIL: service_role can read more of companies than the refresh needs';
  end if;
  if not (has_table_privilege('service_role', 'public.naptan_stops', 'SELECT')
          and has_table_privilege('service_role', 'public.naptan_stops', 'INSERT')
          and has_table_privilege('service_role', 'public.naptan_stops', 'UPDATE')) then
    raise exception 'FAIL: service_role cannot read/upsert naptan_stops';
  end if;
  raise notice 'PASS: service_role has exactly what naptan-import needs';
end $$;
