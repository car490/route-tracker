-- Phase 2: RLS policies for authenticated ops dashboard users
-- Run once in the Supabase SQL editor (after schema.sql)

-- Authenticated users (ops managers logged in via Supabase Auth) get full access to all tables.
-- The existing anon_read policies on routes/timetables/timetable_stops/companies remain in place
-- so the driver PWA can still fetch schedules without logging in.

create policy "auth_all" on companies       for all to authenticated using (true) with check (true);
create policy "auth_all" on drivers         for all to authenticated using (true) with check (true);
create policy "auth_all" on vehicles        for all to authenticated using (true) with check (true);
create policy "auth_all" on routes          for all to authenticated using (true) with check (true);
create policy "auth_all" on timetables      for all to authenticated using (true) with check (true);
create policy "auth_all" on timetable_stops for all to authenticated using (true) with check (true);
create policy "auth_all" on journeys        for all to authenticated using (true) with check (true);
create policy "auth_all" on journey_events  for all to authenticated using (true) with check (true);

-- Allow authenticated users to query the schedule_view
grant select on schedule_view to authenticated;
