-- Migration: grant anon INSERT on journey_events
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-05-19
--
-- Neither migration_gps_tracking.sql nor migration_incident_rls.sql included a
-- table-level INSERT grant for the anon role. Without it, Postgres rejects GPS fix
-- and incident inserts before even evaluating the RLS policies, causing silent failures.

grant insert on public.journey_events to anon;
