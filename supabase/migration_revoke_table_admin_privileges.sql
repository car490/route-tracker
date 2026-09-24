-- Revoke table-admin privileges from the client roles (security hardening
-- follow-up, 2026-09-24).
--
-- `grant all on ... to authenticated` (schema.sql) and Supabase's own default
-- privileges hand anon and authenticated every table privilege, not just the
-- DML the apps use. The extras are:
--   TRUNCATE   -- empties a table and is NOT subject to RLS
--   MAINTAIN   -- PG17: VACUUM/ANALYZE/REINDEX/CLUSTER/REFRESH and LOCK TABLE
--   TRIGGER    -- create triggers on the table
--   REFERENCES -- create foreign keys pointing at the table
-- PostgREST exposes none of these, so today they are only reachable with a
-- direct database login as one of these roles. Nothing in the apps, Edge
-- Functions or scripts uses them. service_role is left as it is.
--
-- SELECT/INSERT/UPDATE/DELETE grants are untouched; RLS still gates those.
-- Idempotent; safe to re-run.

-- 1. Every existing table, view and materialized view in public.
revoke truncate, references, trigger, maintain
  on all tables in schema public from anon, authenticated;

-- 2. Tables created later by migrations (owned by postgres) must not get
--    them back through the default privileges.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;
