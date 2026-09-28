-- generate-announcement-clip (service_role) reads timetable_stops to render
-- Ben only for stops a timetable uses (migration_announce_voice_safeguards.sql).
-- Idempotent; safe to re-run.
--
-- Found 2026-09-28 on the first production Ben run: every job failed with
-- "timetable_stops check failed" because production's public schema gives
-- service_role no default privileges (CLAUDE.md, "grant service_role
-- explicitly"), while dev's default privileges already covered it. Read-only:
-- the function never writes this table.
grant select on public.timetable_stops to service_role;
