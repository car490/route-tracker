-- migration_employee_fields.sql
-- Adds job_role, status, work_type to employees.
-- Renames role → access_level.
-- Creates employee_availability table for auto-assignment.
-- Apply in Supabase SQL Editor.

-- ── 1. Rename role → access_level ────────────────────────────────────────────
ALTER TABLE employees RENAME COLUMN role TO access_level;

-- ── 2. Update helper functions to reference access_level ─────────────────────
CREATE OR REPLACE FUNCTION current_employee_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT access_level FROM employees WHERE auth_user_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION protect_last_super_user()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF old.access_level = 'super_user' AND (tg_op = 'DELETE' OR new.access_level != 'super_user') THEN
    IF (
      SELECT count(*) FROM employees
      WHERE company_id = old.company_id
        AND access_level = 'super_user'
        AND id != old.id
    ) = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last super_user from a company';
    END IF;
  END IF;
  RETURN new;
END;
$$;

-- ── 3. Add new columns to employees ──────────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN job_role   text CHECK (job_role  IN ('DRIVER', 'OPS', 'OFFICE')),
  ADD COLUMN status     text NOT NULL DEFAULT 'AVAILABLE'
                             CHECK (status IN ('AVAILABLE', 'UNAVAILABLE')),
  ADD COLUMN work_type  text CHECK (work_type IN ('FTE', 'SPLITSHIFT', 'TEMP'));

-- ── 4. employee_availability ──────────────────────────────────────────────────
-- One row per time window per day.
-- SPLITSHIFT employees have two rows per working day (AM + PM window).
-- day_of_week: 0 = Monday … 6 = Sunday (ISO week order).

CREATE TABLE employee_availability (
  id            uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid      NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  day_of_week   smallint  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  window_start  time      NOT NULL,
  window_end    time      NOT NULL,
  CHECK (window_end > window_start)
);

CREATE INDEX ON employee_availability (employee_id);

GRANT SELECT ON employee_availability TO anon;
GRANT ALL    ON employee_availability TO authenticated;

ALTER TABLE employee_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_employee_availability" ON employee_availability
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      JOIN employees me ON me.company_id = e.company_id
        AND me.auth_user_id = auth.uid()
      WHERE e.id = employee_availability.employee_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      JOIN employees me ON me.company_id = e.company_id
        AND me.auth_user_id = auth.uid()
      WHERE e.id = employee_availability.employee_id
    )
  );
