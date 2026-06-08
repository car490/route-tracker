-- migration_drivers_hours_rules.sql
-- Adds drivers_hours_rules lookup table and hours_rule column on employees.
-- Idempotent — safe to re-run if a previous attempt partially applied.
-- Apply in Supabase SQL Editor.

-- ── 1. drivers_hours_rules ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS drivers_hours_rules (
  id                           text     PRIMARY KEY,
  label                        text     NOT NULL,
  max_daily_driving_mins       smallint,
  max_daily_duty_spread_mins   smallint,
  max_continuous_driving_mins  smallint,
  min_break_mins               smallint,
  break_can_be_split           boolean  NOT NULL DEFAULT false,
  min_split_break_mins         smallint,
  min_daily_rest_mins          smallint,
  max_weekly_driving_mins      smallint,
  min_weekly_rest_mins         smallint,
  max_fortnightly_driving_mins smallint,
  notes                        text
);

GRANT SELECT ON drivers_hours_rules TO anon;
GRANT SELECT ON drivers_hours_rules TO authenticated;

ALTER TABLE drivers_hours_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read" ON drivers_hours_rules;
DROP POLICY IF EXISTS "auth_read" ON drivers_hours_rules;

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
ON CONFLICT (id) DO NOTHING;

-- ── 3. Add hours_rule to employees ────────────────────────────────────────────

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS hours_rule text NOT NULL DEFAULT 'DOMESTIC_GB'
    REFERENCES drivers_hours_rules(id);
