-- ============================================================
-- Migration: explicit Data API grants (Supabase change 2026-05-30 / 2026-10-30)
-- Apply in Supabase SQL Editor.
-- Date: 2026-05-14
-- ============================================================
--
-- From 2026-05-30 new Supabase projects stop auto-granting new tables to the
-- Data API. From 2026-10-30 this applies to ALL projects including RouteTracker.
-- Any table created without an explicit GRANT after that date will be invisible
-- to supabase-js / PostgREST / /rest/v1/.
--
-- This migration:
--   1. Grants anon + authenticated access to staff_contacts (created 2026-05-14)
--   2. Sets ALTER DEFAULT PRIVILEGES so all future tables inherit grants
--      automatically — no need to remember to add GRANTs in each migration.
--
-- Convention going forward: every CREATE TABLE in a migration should still
-- include explicit GRANTs for clarity, even though default privileges now
-- handle it. The explicit GRANT documents intent at the point of creation.
-- ============================================================

-- 1. Explicit grants for staff_contacts (already live; catches the window
--    between table creation and the October 30 deadline).
grant select on public.staff_contacts to anon;
grant all on public.staff_contacts to authenticated;

-- 2. Future-proof: all tables created after this point inherit these grants.
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant all on sequences to authenticated;
