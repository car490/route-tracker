-- Manual-selection/cab-device active-journey recovery (BusOps Driver).
-- CAB-DEVICE-SETUP.md's kiosk devices, and any driver device using the
-- manual-selection fallback, previously had no way to recover an
-- in-progress journey after a reload/crash -- main.js's init() always
-- landed on "No duty assigned" regardless of live state. This RPC lets the
-- device ask "is there already an active journey for my commissioned
-- vehicle" on boot, mirroring get_duty_card's row shape (same columns) so
-- the driver PWA can reuse its existing stop-confirm picker flow rather
-- than needing a second code path. Reuses get_duty_card itself rather than
-- duplicating its joins -- this only has to find the right journey_id(s).
--
-- Deliberately does not attempt to derive the driver's current stop --
-- see activeJourneyRecovery.js's header comment for why the confirm step
-- stays manual (GPS ambiguity near closely-spaced stops/shared termini,
-- stale recovery state, no human check on a PSVAIR-facing surface).
create or replace function public.get_active_manual_journey(p_vehicle_id uuid)
returns table (
  journey_id             uuid,
  driver_id              uuid,
  vehicle_id              uuid,
  status                 text,
  started_at             timestamptz,
  completed_at           timestamptz,
  driver_name            text,
  vehicle_registration   text,
  service_code           text,
  route_name             text,
  timetable_name         text,
  direction               text,
  timetable_departure_id uuid,
  first_stop_time        text,
  last_stop_name         text,
  notes                  text,
  primary_color          text,
  accent_color           text
)
language sql
stable security definer
as $$
  select * from public.get_duty_card(
    array(
      select id from public.journeys
      where vehicle_id = p_vehicle_id
        and status = 'in_progress'
      order by started_at desc nulls last
      limit 1
    )
  )
$$;

grant execute on function public.get_active_manual_journey(uuid) to anon;
