-- Security hardening, phase 1 (2026-09-24). Idempotent; safe to re-run.
-- See docs/SECURITY-HARDENING.md items 16, 17 and 18.

-- 1. companies (item 16): anon could read every column, including the
--    operator licence number, Companies House number, email and address.
--    The Driver PWA and the Announce sign only read branding:
--      driver/src/supabaseApi.js       fetchCompanyName()      -> name
--      announce/src/announceDeviceFeed fetchCompanyBranding()  -> id, name, logo_path, accent_color
--    Replace the table-wide SELECT with a column list. The anon_read RLS
--    policy stays; authenticated (dashboard) access is unchanged.
revoke select on public.companies from anon;
grant select (id, name, logo_path, primary_color, accent_color) on public.companies to anon;

-- 2. Production-only drift (item 17): the original two-argument
--    link_announce_device(uuid, uuid) was never dropped on production. It is
--    anon-executable and SECURITY DEFINER but checks no pairing secret, so
--    anyone with the anon key and a device id could re-link that sign to
--    another vehicle in its company. migration_announce_devices_solo_guard.sql
--    dropped it on dev; nothing calls it (driver/src/announceDeviceLinkApi.js
--    uses the four-argument version).
drop function if exists public.link_announce_device(uuid, uuid);

-- 3. Dev-only drift (item 18): migration_announcement_service_clips_from_timetables.sql
--    revoked EXECUTE from PUBLIC only. Dev's default privileges also grant
--    EXECUTE to anon/authenticated directly, so both stayed callable through
--    /rest/v1/rpc there. Only triggers call them (as the definer), so no
--    client role needs EXECUTE.
revoke execute on function public.enqueue_service_clips_for_timetables(uuid[]) from public, anon, authenticated;
revoke execute on function public.fn_announcement_clip_enqueue_on_timetable_stops_change() from public, anon, authenticated;
