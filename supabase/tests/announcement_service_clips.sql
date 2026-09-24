-- supabase/tests/announcement_service_clips.sql
--
-- ROUTE_START clips (service/<code>__<dest>) keyed by each timetable's final
-- stop -- supabase/migration_announcement_service_clips_from_timetables.sql.
-- Same self-contained, forced-rollback DO-block pattern as
-- announcement_clips_rls.sql: no test data persists regardless of pass/fail.
--
-- Run with: psql <connection> -f supabase/tests/announcement_service_clips.sql
--
-- The key built here must equal what shared/announcementAudio.js's
-- clipKeysFor(ROUTE_START) builds from the same final stop's display_name
-- (the driver PWA and Announce Solo both pass the last stop's display_name
-- as `destination`), otherwise the journey-start preflight reports it
-- missing forever.

-- 1. The shared helpers match clipKeysFor's slug/strip rules, including a
-- bracketed indicator that isn't at the end of the name.
do $$
begin
  if public.announcement_speech_name('High Street (opp), Kirton') <> 'High Street, Kirton' then
    raise exception 'FAIL: announcement_speech_name must strip every parenthetical, not just a trailing one (got %)',
      public.announcement_speech_name('High Street (opp), Kirton');
  end if;
  if public.announcement_clip_slug('Swineshead,Bentley''s Garage') <> 'swineshead-bentley-s-garage' then
    raise exception 'FAIL: announcement_clip_slug does not match clipKeysFor slug() (got %)',
      public.announcement_clip_slug('Swineshead,Bentley''s Garage');
  end if;
  if public.announcement_service_clip_key('S116S', 'Donington,Cowley Academy (NW-bound)') <> 'service/s116s__donington-cowley-academy' then
    raise exception 'FAIL: announcement_service_clip_key mismatch (got %)',
      public.announcement_service_clip_key('S116S', 'Donington,Cowley Academy (NW-bound)');
  end if;
  raise notice 'PASS: speech-name/slug/key helpers match clipKeysFor';
end $$;

-- 2. Saving a timetable's stops the way the dashboard does (delete all, then
-- one bulk insert) enqueues exactly one ROUTE_START job, for the stop with the
-- highest sequence, worded from its display_name -- and none for any
-- intermediate stop. A route's own destination field plays no part.
do $$
declare
  v_company_id uuid;
  v_route_id   uuid;
  v_tt_id      uuid;
  v_first      uuid;
  v_mid        uuid;
  v_last       uuid;
begin
  select id into v_company_id from companies limit 1;
  if v_company_id is null then
    raise notice 'SKIP: no company row to attach a test route to';
    return;
  end if;

  insert into routes (company_id, service_code, journey_type, destination)
  values (v_company_id, 'S997X', array['fixed'], 'Somewhere Else Entirely')
  returning id into v_route_id;
  insert into timetables (route_id, name, direction)
  values (v_route_id, 'Test Outbound', 'Outbound') returning id into v_tt_id;

  insert into stops (name, lat, lon) values ('Test First Stop', 52.0, -0.1) returning id into v_first;
  insert into stops (name, lat, lon) values ('Test Middle Stop', 52.0, -0.1) returning id into v_mid;
  insert into stops (name, lat, lon) values ('Test Final Stop (opp)', 52.0, -0.1) returning id into v_last;

  delete from timetable_stops where timetable_id = v_tt_id;
  insert into timetable_stops (timetable_id, stop_id, sequence, stop_type, offset_standard) values
    (v_tt_id, v_first, 1, 'timing_point', 0),
    (v_tt_id, v_mid,   2, 'timing_point', 5),
    (v_tt_id, v_last,  3, 'timing_point', 10);

  if not exists (
    select 1 from announcement_clip_jobs
    where key = 'service/s997x__test-final-stop' and text = 'This is an S997X to Test Final Stop.'
  ) then
    raise exception 'FAIL: bulk timetable_stops insert did not enqueue the final stop''s ROUTE_START job';
  end if;

  if exists (select 1 from announcement_clip_jobs where key like 'service/s997x%' and key <> 'service/s997x__test-final-stop') then
    raise exception 'FAIL: enqueued a ROUTE_START job for a stop other than the final one (or for routes.destination)';
  end if;

  raise notice 'PASS: timetable save enqueues exactly the final stop''s ROUTE_START job';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test rows cleanly';
    else
      raise;
    end if;
end $$;

-- 3. Renaming the stop that ends a timetable re-enqueues that timetable's
-- ROUTE_START job with the new name; changing a route's service code
-- re-enqueues under the new code.
do $$
declare
  v_company_id uuid;
  v_route_id   uuid;
  v_tt_id      uuid;
  v_first      uuid;
  v_last       uuid;
begin
  select id into v_company_id from companies limit 1;
  if v_company_id is null then
    raise notice 'SKIP: no company row to attach a test route to';
    return;
  end if;

  insert into routes (company_id, service_code, journey_type)
  values (v_company_id, 'S996X', array['fixed']) returning id into v_route_id;
  insert into timetables (route_id, name, direction)
  values (v_route_id, 'Test Outbound', 'Outbound') returning id into v_tt_id;
  insert into stops (name, lat, lon) values ('Test Start', 52.0, -0.1) returning id into v_first;
  insert into stops (name, lat, lon) values ('Test End', 52.0, -0.1) returning id into v_last;
  insert into timetable_stops (timetable_id, stop_id, sequence, stop_type, offset_standard) values
    (v_tt_id, v_first, 1, 'timing_point', 0),
    (v_tt_id, v_last,  2, 'timing_point', 5);

  update stops set announcement_name = 'Test Terminus' where id = v_last;
  if not exists (select 1 from announcement_clip_jobs where key = 'service/s996x__test-terminus'
                 and text = 'This is an S996X to Test Terminus.') then
    raise exception 'FAIL: renaming a timetable''s final stop did not re-enqueue its ROUTE_START job';
  end if;

  update stops set announcement_name = 'Test Start Renamed' where id = v_first;
  if exists (select 1 from announcement_clip_jobs where key = 'service/s996x__test-start-renamed') then
    raise exception 'FAIL: renaming a stop that does not end any timetable enqueued a ROUTE_START job';
  end if;

  update routes set service_code = 'S995X' where id = v_route_id;
  if not exists (select 1 from announcement_clip_jobs where key = 'service/s995x__test-terminus'
                 and text = 'This is an S995X to Test Terminus.') then
    raise exception 'FAIL: changing a route''s service_code did not re-enqueue its ROUTE_START job';
  end if;

  raise notice 'PASS: final-stop rename and service_code change re-enqueue ROUTE_START jobs';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test rows cleanly';
    else
      raise;
    end if;
end $$;
