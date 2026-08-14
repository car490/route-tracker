-- ============================================================
-- Adds stops.announcement_name — an optional override for display_name()
-- when a stop's NaPTAN-composed name is too long for the onboard sign's
-- 22mm-minimum text, or unclear when spoken by PSVAIR announcements.
--
-- Null everywhere by default; no admin UI yet (flagged as a follow-up) —
-- set directly via SQL for whichever stops need it, e.g.:
--   update stops set announcement_name = 'High Street'
--     where id = '...';
-- ============================================================

alter table public.stops add column if not exists announcement_name text;

create or replace function public.display_name(s stops)
returns text
language sql
stable
as $$
  select coalesce(
    s.announcement_name,
    (select n.locality_name || ', ' || n.common_name ||
       case when n.indicator is not null and n.indicator <> '' then ' (' || n.indicator || ')' else '' end
     from naptan_stops n
     where n.atco_code = s.naptan_code),
    s.name
  )
$$;

grant execute on function public.display_name(stops) to anon, authenticated;
