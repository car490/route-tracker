-- Add single_journey flag to routes
-- When true, Early/Late timing profiles are not used and the UI hides those columns.

alter table public.routes
  add column if not exists single_journey boolean not null default false;
