-- ============================================================
-- Phase 4 — Excursions migration
-- Run in Supabase SQL Editor on the live database.
-- ============================================================

-- Add notes column to journeys (used as title/description for ad-hoc jobs)
alter table journeys add column if not exists notes text;

-- Passenger list for excursion journeys (optional per excursion)
create table if not exists excursion_passengers (
  id          uuid        primary key default gen_random_uuid(),
  journey_id  uuid        not null references journeys(id) on delete cascade,
  name        text        not null,
  phone       text,
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_excursion_passengers_journey_id on excursion_passengers (journey_id);

-- RLS
alter table excursion_passengers enable row level security;

create policy "company_all" on excursion_passengers
  for all to authenticated
  using (
    journey_id in (select id from journeys where company_id = current_company_id())
  )
  with check (
    journey_id in (select id from journeys where company_id = current_company_id())
  );

-- Grants (required — Supabase Data API change effective 2026-05-30 for new tables)
grant select on public.excursion_passengers to anon;
grant all    on public.excursion_passengers to authenticated;
