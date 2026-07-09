-- Migration: term_dates reference table for auto-filling school-contract
-- departure date ranges in the Route Wizard / Departures card.
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-07-09
--
-- Part of the in-progress Route Wizard feature (develop, not yet on master) —
-- dev-only for now, same as migration_routes_name_optional.sql.

create table public.term_dates (
  id            uuid        primary key default gen_random_uuid(),
  academic_year text        not null,          -- e.g. '2025-26'
  term_name     text        not null,          -- e.g. 'Term 1'
  start_date    date        not null,
  end_date      date        not null,
  created_at    timestamptz not null default now(),
  check (end_date >= start_date),
  unique (academic_year, term_name)
);

grant select on public.term_dates to anon;
grant all    on public.term_dates to authenticated;

alter table public.term_dates enable row level security;

create policy "anon_read" on public.term_dates
  for select to anon using (true);

create policy "auth_all" on public.term_dates
  for all to authenticated using (true) with check (true);

-- Lincolnshire County Council published term dates, six-term model (each term
-- already excludes half-term breaks). Source:
-- https://www.lincolnshire.gov.uk/school-attendance/school-term-times
insert into public.term_dates (academic_year, term_name, start_date, end_date) values
  ('2025-26', 'Term 1', '2025-09-04', '2025-10-23'),
  ('2025-26', 'Term 2', '2025-11-03', '2025-12-19'),
  ('2025-26', 'Term 3', '2026-01-06', '2026-02-13'),
  ('2025-26', 'Term 4', '2026-02-23', '2026-04-02'),
  ('2025-26', 'Term 5', '2026-04-21', '2026-05-22'),
  ('2025-26', 'Term 6', '2026-06-01', '2026-07-22'),
  ('2026-27', 'Term 1', '2026-09-03', '2026-10-23'),
  ('2026-27', 'Term 2', '2026-11-02', '2026-12-18'),
  ('2026-27', 'Term 3', '2027-01-05', '2027-02-12'),
  ('2026-27', 'Term 4', '2027-02-22', '2027-03-25'),
  ('2026-27', 'Term 5', '2027-04-14', '2027-05-28'),
  ('2026-27', 'Term 6', '2027-06-07', '2027-07-21'),
  ('2027-28', 'Term 1', '2027-09-06', '2027-10-22'),
  ('2027-28', 'Term 2', '2027-11-01', '2027-12-17'),
  ('2027-28', 'Term 3', '2028-01-05', '2028-02-11'),
  ('2027-28', 'Term 4', '2028-02-21', '2028-03-31'),
  ('2027-28', 'Term 5', '2028-04-19', '2028-05-26'),
  ('2027-28', 'Term 6', '2028-06-05', '2028-07-21');
