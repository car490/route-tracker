-- migration_drivers_hours_rules.sql
-- Adds drivers_hours_rules lookup table and hours_rule column on employees.
-- Apply in Supabase SQL Editor.

-- ── 1. drivers_hours_rules ────────────────────────────────────────────────────
-- Static reference table — values come from regulation, not operator config.
-- All time values in minutes. NULL = no statutory limit / not applicable.

CREATE TABLE drivers_hours_rules (
  id                           text     PRIMARY KEY,
  label                        text     NOT NULL,
  -- Daily limits
  max_daily_driving_mins       smallint,
  max_daily_duty_spread_mins   smallint,
  -- Continuous driving before mandatory break
  max_continuous_driving_mins  smallint,
  min_break_mins               smallint,
  break_can_be_split           boolean  NOT NULL DEFAULT false,
  min_split_break_mins         smallint,  -- minimum per portion when split
  -- Rest between duties
  min_daily_rest_mins          smallint,
  -- Weekly
  max_weekly_driving_mins      smallint,
  min_weekly_rest_mins         smallint,
  -- Fortnightly (AETR only)
  max_fortnightly_driving_mins smallint,
  notes                        text
);

GRANT SELECT ON drivers_hours_rules TO anon;
GRANT SELECT ON drivers_hours_rules TO authenticated;

ALTER TABLE drivers_hours_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON drivers_hours_rules
  FOR SELECT TO anon USING (true);

CREATE POLICY "auth_read" ON drivers_hours_rules
  FOR SELECT TO authenticated USING (true);

-- ── 2. Seed ───────────────────────────────────────────────────────────────────

INSERT INTO drivers_hours_rules
  (id, label,
   max_daily_driving_mins, max_daily_duty_spread_mins,
   max_continuous_driving_mins, min_break_mins, break_can_be_split, min_split_break_mins,
   min_daily_rest_mins,
   max_weekly_driving_mins, min_weekly_rest_mins, max_fortnightly_driving_mins,
   notes)
VALUES
(
  'DOMESTIC_GB',
  'Domestic GB (PSV)',
  600,   -- 10 hours daily driving
  960,   -- 16 hours duty spread
  330,   -- 5.5 hours continuous driving
  30,    -- 30-minute break
  true,
  15,    -- each portion ≥ 15 minutes when split
  600,   -- 10 hours daily rest (safe default)
  null,  -- no statutory weekly driving cap
  null,  -- weekly rest not prescribed under domestic rules
  null,  -- fortnightly limit not applicable
  'Applies to PSV operations within Great Britain. Break may be taken as two separate periods of at least 15 minutes each.'
),
(
  'AETR',
  'AETR (International)',
  540,   -- 9 hours daily driving (extendable to 600, max twice/week)
  null,  -- duty spread not prescribed by AETR
  270,   -- 4.5 hours continuous driving
  45,    -- 45-minute break
  true,
  15,    -- split: first portion ≥ 15 min, second ≥ 30 min
  660,   -- 11 hours daily rest (reducible to 540, max 3×/week)
  3360,  -- 56 hours weekly driving
  2700,  -- 45 hours weekly rest (reducible to 1440, twice per fortnight)
  5400,  -- 90 hours fortnightly driving
  'Applies to international passenger transport to/from AETR signatory countries. Daily driving extendable to 600 mins twice per week. Daily rest reducible to 540 mins up to 3 times between weekly rests.'
),
(
  'EXEMPT',
  'Exempt (Community/Permit)',
  null, null, null, null, false, null, null, null, null, null,
  'S19/S22 permit services where drivers are not required to hold PCV entitlement. Statutory drivers hours rules do not apply.'
);

-- ── 3. Add hours_rule to employees ────────────────────────────────────────────

ALTER TABLE employees
  ADD COLUMN hours_rule text NOT NULL DEFAULT 'DOMESTIC_GB'
    REFERENCES drivers_hours_rules(id);
