-- supabase/migration_announce_device_candidate_company_check.sql
--
-- An Announce device may only carry its own company's departures in
-- candidate_departure_ids. Added 2026-10-03 with the Dashboard's Solo set-up
-- (pcv-dashboard/src/features/vehicles/SoloSetupModal.jsx), which made that
-- column editable by any dashboard user rather than by SQL only.
--
-- Why a trigger: candidate_departure_ids is a uuid array (no foreign key is
-- possible), and every company's timetable_departures are readable by anon,
-- so a dashboard user could otherwise point their own sign at another
-- company's departure id; the sign would then start journeys on it
-- (get_or_create_manual_journey). The company_all RLS policy only checks the
-- device row's own company_id, not what the array points at.
--
-- security definer + fixed search_path: the check must see every departure
-- (to tell "another company's" from "unknown") regardless of the caller's
-- RLS, and must not be steered by the caller's search_path.
--
-- Checked on insert, and on update of the array or of company_id (moving a
-- device to another company re-checks what it carries). An empty array is
-- always allowed. Existing rows on dev were checked before applying: none
-- breaks the rule. Verified by supabase/tests/announce_device_candidate_company.sql.

create or replace function public.check_announce_device_candidates()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bad uuid;
begin
  select c into v_bad
  from unnest(new.candidate_departure_ids) as c
  where not exists (
    select 1
    from public.timetable_departures td
    join public.timetables t on t.id = td.timetable_id
    join public.routes r     on r.id = t.route_id
    where td.id = c and r.company_id = new.company_id
  )
  limit 1;

  if v_bad is not null then
    raise exception 'departure % is not one of this company''s departures', v_bad
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.check_announce_device_candidates() from public;

drop trigger if exists announce_devices_check_candidates on public.announce_devices;
create trigger announce_devices_check_candidates
  before insert or update of candidate_departure_ids, company_id on public.announce_devices
  for each row execute function public.check_announce_device_candidates();
