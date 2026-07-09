-- ============================================================
-- RouteTracker v2  —  Seed data
-- Run AFTER schema.sql on a fresh Supabase project.
--
-- Contains only reference/lookup data needed for the app to function.
-- Operational data (routes, timetables, stops, employees etc.) should
-- be created via the dashboard after setup.
-- NAPTAN stops: run supabase/scripts/import-naptan.js separately.
-- ============================================================


-- ── Journey types ─────────────────────────────────────────────────────────────

insert into public.journey_types (name, sort_order, requires_bods) values
  ('Local Bus',         1, true),
  ('Open Door Schools', 2, true),
  ('Contract Schools',  3, false),
  ('Private Hire',      4, false),
  ('Excursion',         5, false),
  ('Tour',              6, false),
  ('Other Contract',    7, false)
on conflict (name) do update
  set sort_order    = excluded.sort_order,
      requires_bods = excluded.requires_bods;


-- ── Term dates ────────────────────────────────────────────────────────────────
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
  ('2027-28', 'Term 6', '2028-06-05', '2028-07-21')
on conflict (academic_year, term_name) do update
  set start_date = excluded.start_date,
      end_date   = excluded.end_date;


-- ── Drivers hours rules ───────────────────────────────────────────────────────

insert into public.drivers_hours_rules (
  id, label,
  max_daily_driving_mins, max_daily_duty_spread_mins,
  max_continuous_driving_mins, min_break_mins,
  break_can_be_split, min_split_break_mins,
  min_daily_rest_mins, max_weekly_driving_mins,
  min_weekly_rest_mins, max_fortnightly_driving_mins,
  notes
) values
  (
    'DOMESTIC_GB', 'Domestic GB (PSV)',
    600, 960, 330, 30, true, 15, 600, null, null, null,
    'Applies to PSV operations within Great Britain. Break may be taken as two separate periods of at least 15 minutes each.'
  ),
  (
    'AETR', 'AETR (International)',
    540, null, 270, 45, true, 15, 660, 3360, 2700, 5400,
    'Applies to international passenger transport to/from AETR signatory countries. Daily driving extendable to 600 mins twice per week. Daily rest reducible to 540 mins up to 3 times between weekly rests.'
  ),
  (
    'EXEMPT', 'Exempt (Community/Permit)',
    null, null, null, null, false, null, null, null, null, null,
    'S19/S22 permit services where drivers are not required to hold PCV entitlement. Statutory drivers hours rules do not apply.'
  )
on conflict (id) do update
  set label                        = excluded.label,
      max_daily_driving_mins       = excluded.max_daily_driving_mins,
      max_daily_duty_spread_mins   = excluded.max_daily_duty_spread_mins,
      max_continuous_driving_mins  = excluded.max_continuous_driving_mins,
      min_break_mins               = excluded.min_break_mins,
      break_can_be_split           = excluded.break_can_be_split,
      min_split_break_mins         = excluded.min_split_break_mins,
      min_daily_rest_mins          = excluded.min_daily_rest_mins,
      max_weekly_driving_mins      = excluded.max_weekly_driving_mins,
      min_weekly_rest_mins         = excluded.min_weekly_rest_mins,
      max_fortnightly_driving_mins = excluded.max_fortnightly_driving_mins,
      notes                        = excluded.notes;


-- ── Company ───────────────────────────────────────────────────────────────────

insert into companies (id, name, trading_name, operator_licence_number, traffic_area, status, service_counties) values
  ('00000000-0000-0000-0000-000000000001',
   'Phil Haines Coaches',
   'PHIL HAINES COACHES LTD',
   'PF1135558',
   'East of England',
   'active',
   array['Lincolnshire'])
on conflict (id) do update
  set service_counties = excluded.service_counties;
