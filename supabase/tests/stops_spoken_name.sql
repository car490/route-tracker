-- supabase/tests/stops_spoken_name.sql
--
-- stops.spoken_name: a speech-only pronunciation override
-- (supabase/migration_stops_spoken_name.sql, docs/ANNOUNCE-VOICE-PLAN.md step 1).
-- Same forced-rollback DO-block pattern as announcement_service_clips.sql: no
-- test data persists regardless of pass/fail.
--
-- Run with: psql <connection> -f supabase/tests/stops_spoken_name.sql
--
-- The rules under test:
--   * spoken_name changes what is SAID, never what the sign SHOWS
--     (display_name() ignores it) or the clip KEY (keys come from display_name,
--     because that is what the driver PWA and Solo pass to clipKeysFor()).
--   * setting, changing or clearing it re-queues the stop's clips, which is
--     what marks an already-approved recording stale.
--   * it is used verbatim (a respelling may be deliberate), and a blank value
--     is refused rather than silently producing "This is ."

-- 1. The column exists and refuses a blank value.
do $$
declare
  v_stop uuid;
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'stops' and column_name = 'spoken_name') then
    raise exception 'FAIL: stops.spoken_name does not exist';
  end if;

  insert into stops (name, lat, lon) values ('Test Blank Spoken', 52.0, -0.1) returning id into v_stop;
  begin
    update stops set spoken_name = '   ' where id = v_stop;
    raise exception 'FAIL: a blank spoken_name was accepted';
  exception when check_violation then
    null;
  end;

  raise notice 'PASS: spoken_name exists and refuses blank values';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then null; else raise; end if;
end $$;

-- 2. Setting spoken_name re-queues approach/departure with the spoken text,
--    verbatim, and leaves display_name (the sign) alone.
do $$
declare
  v_stop uuid;
begin
  insert into stops (name, lat, lon) values ('Happisburgh, Church (opp)', 52.0, -0.1) returning id into v_stop;

  update stops set spoken_name = 'Haze-bruh, Church' where id = v_stop;

  if not exists (select 1 from announcement_clip_jobs
                 where key = 'approach/' || v_stop and text = 'This is Haze-bruh, Church.') then
    raise exception 'FAIL: setting spoken_name did not queue the approach clip with the spoken text';
  end if;
  if not exists (select 1 from announcement_clip_jobs
                 where key = 'departure/' || v_stop and text = 'The next stop is Haze-bruh, Church.') then
    raise exception 'FAIL: setting spoken_name did not queue the departure clip with the spoken text';
  end if;
  if (select public.display_name(s.*) from stops s where s.id = v_stop) <> 'Happisburgh, Church (opp)' then
    raise exception 'FAIL: spoken_name changed display_name, so it would change the sign';
  end if;

  raise notice 'PASS: spoken_name drives the spoken text only';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then null; else raise; end if;
end $$;

-- 3. Clearing spoken_name re-queues the clips with the display name again
--    (annotations stripped, as before this feature).
do $$
declare
  v_stop uuid;
begin
  insert into stops (name, lat, lon, spoken_name)
  values ('Leominster, Corn Square (adj)', 52.0, -0.1, 'Lemster, Corn Square') returning id into v_stop;

  delete from announcement_clip_jobs where key in ('approach/' || v_stop, 'departure/' || v_stop);
  update stops set spoken_name = null where id = v_stop;

  if not exists (select 1 from announcement_clip_jobs
                 where key = 'approach/' || v_stop and text = 'This is Leominster, Corn Square.') then
    raise exception 'FAIL: clearing spoken_name did not re-queue the clip with the display name';
  end if;

  raise notice 'PASS: clearing spoken_name falls back to the display name';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then null; else raise; end if;
end $$;

-- 4. A timetable's final stop: the route-start sentence uses the spoken name,
--    but its key is still built from the display name (what clipKeysFor uses).
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
  values (v_company_id, 'S994X', array['fixed']) returning id into v_route_id;
  insert into timetables (route_id, name, direction)
  values (v_route_id, 'Test Outbound', 'Outbound') returning id into v_tt_id;
  insert into stops (name, lat, lon) values ('Test Origin', 52.0, -0.1) returning id into v_first;
  insert into stops (name, lat, lon) values ('Alnwick, Bondgate', 52.0, -0.1) returning id into v_last;
  insert into timetable_stops (timetable_id, stop_id, sequence, stop_type, offset_standard) values
    (v_tt_id, v_first, 1, 'timing_point', 0),
    (v_tt_id, v_last,  2, 'timing_point', 5);

  update stops set spoken_name = 'Annick, Bondgate' where id = v_last;

  if not exists (select 1 from announcement_clip_jobs
                 where key = 'service/s994x__alnwick-bondgate'
                   and text = 'This is an S994X to Annick, Bondgate.') then
    raise exception 'FAIL: route-start job should say the spoken name under the display-name key';
  end if;

  raise notice 'PASS: route-start uses spoken text with the display-name key';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then null; else raise; end if;
end $$;
