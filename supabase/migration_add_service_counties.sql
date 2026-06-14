-- Add service_counties to companies table.
-- Stores the county names used to determine the NAPTAN bounding box for the
-- import script. Multiple counties supported for operators whose routes cross
-- county lines. Geocoded to a bbox via OpenCage at import time.
alter table public.companies
  add column if not exists service_counties text[] not null default '{}';

-- Seed PHC's county
update public.companies
  set service_counties = array['Lincolnshire']
  where id = '00000000-0000-0000-0000-000000000001';
