-- Add vehicles_authorised from DVSA VOL dataset
alter table public.companies
  add column if not exists vehicles_authorised int;
