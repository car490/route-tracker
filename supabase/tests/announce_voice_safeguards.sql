-- supabase/tests/announce_voice_safeguards.sql
--
-- Credit safeguards for the Ben voice (supabase/migration_announce_voice_safeguards.sql,
-- docs/ANNOUNCE-VOICE-PLAN.md step 4). Forced-rollback blocks: nothing persists.
-- Run with: psql <connection> -f supabase/tests/announce_voice_safeguards.sql

-- 1. The usage log exists, is invisible to client roles, and the drain (service_role) can write it.
do $$
begin
  if to_regclass('public.elevenlabs_usage') is null then
    raise exception 'FAIL: elevenlabs_usage does not exist';
  end if;
  if has_table_privilege('anon', 'public.elevenlabs_usage', 'SELECT')
     or has_table_privilege('authenticated', 'public.elevenlabs_usage', 'SELECT') then
    raise exception 'FAIL: client roles can read elevenlabs_usage';
  end if;
  if not has_table_privilege('service_role', 'public.elevenlabs_usage', 'INSERT')
     or not has_table_privilege('service_role', 'public.elevenlabs_usage', 'SELECT') then
    raise exception 'FAIL: service_role cannot use elevenlabs_usage';
  end if;
  raise notice 'PASS: usage log';
end $$;

-- 2. The daily cap is configured and readable by the drain, but app_config stays hidden from clients.
do $$
begin
  if not exists (select 1 from app_config where key = 'elevenlabs_daily_char_cap') then
    raise exception 'FAIL: app_config has no elevenlabs_daily_char_cap';
  end if;
  if not has_table_privilege('service_role', 'public.app_config', 'SELECT') then
    raise exception 'FAIL: service_role cannot read app_config';
  end if;
  if has_table_privilege('service_role', 'public.app_config', 'UPDATE') then
    raise exception 'FAIL: service_role should only read app_config';
  end if;
  if has_table_privilege('anon', 'public.app_config', 'SELECT')
     or has_table_privilege('authenticated', 'public.app_config', 'SELECT') then
    raise exception 'FAIL: client roles can read app_config';
  end if;
  raise notice 'PASS: daily cap config';
end $$;

-- 3. Adding a stop to a timetable queues its approach/departure clips when it
--    has no clip in the current voice, and doesn't when it already has one.
do $$
declare
  v_company_id uuid;
  v_voice      text;
  v_route_id   uuid;
  v_tt_id      uuid;
  v_new        uuid;
  v_has        uuid;
  v_last       uuid;
begin
  select id into v_company_id from companies limit 1;
  select coalesce((select value from app_config where key = 'announcement_voice'), 'en-GB-RyanNeural') into v_voice;

  insert into routes (company_id, service_code, journey_type)
  values (v_company_id, 'S993X', array['fixed']) returning id into v_route_id;
  insert into timetables (route_id, name, direction)
  values (v_route_id, 'Test Outbound', 'Outbound') returning id into v_tt_id;
  insert into stops (name, lat, lon) values ('Test Newly Used Stop', 52.0, -0.1) returning id into v_new;
  insert into stops (name, lat, lon) values ('Test Already Voiced Stop', 52.0, -0.1) returning id into v_has;
  insert into stops (name, lat, lon) values ('Test Last Stop', 52.0, -0.1) returning id into v_last;

  -- v_has already has clips in the current voice; v_new has none.
  delete from announcement_clip_jobs where key in ('approach/' || v_new, 'departure/' || v_new, 'approach/' || v_has, 'departure/' || v_has);
  insert into announcement_clips (key, storage_path, hash, text, voice) values
    ('approach/' || v_has,  'approach/' || v_has || '.mp3',  'x', 'This is Test Already Voiced Stop.', v_voice),
    ('departure/' || v_has, 'departure/' || v_has || '.mp3', 'x', 'The next stop is Test Already Voiced Stop.', v_voice);

  insert into timetable_stops (timetable_id, stop_id, sequence, stop_type, offset_standard) values
    (v_tt_id, v_new,  1, 'timing_point', 0),
    (v_tt_id, v_has,  2, 'timing_point', 5),
    (v_tt_id, v_last, 3, 'timing_point', 10);

  if (select count(*) from announcement_clip_jobs where key in ('approach/' || v_new, 'departure/' || v_new)) <> 2 then
    raise exception 'FAIL: adding a stop with no clip in the current voice should queue its 2 clips';
  end if;
  if exists (select 1 from announcement_clip_jobs where key in ('approach/' || v_has, 'departure/' || v_has)) then
    raise exception 'FAIL: a stop that already has clips in the current voice was queued again';
  end if;
  if not exists (select 1 from announcement_clip_jobs
                 where key = 'approach/' || v_new and text = 'This is Test Newly Used Stop.' and voice = v_voice) then
    raise exception 'FAIL: queued approach job has the wrong wording or voice';
  end if;

  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'PASS: newly used stops are queued, voiced ones are not'; else raise; end if;
end $$;
