-- supabase/tests/announcement_speech_name.sql
--
-- Spoken text gets a space after a comma that has none, so a voice pauses
-- between "Boston" and "College" (supabase/migration_announcement_speech_comma_space.sql).
-- Speech only: the sign's display name and the clip keys must not change.
-- Forced-rollback blocks: nothing persists.
-- Run with: psql <connection> -f supabase/tests/announcement_speech_name.sql

-- 1. The speech helper adds the missing space, and only before a letter.
do $$
declare
  r record;
begin
  for r in select * from (values
    ('Boston,College',                'Boston, College'),
    ('Boston, College',               'Boston, College'),
    ('High Street (opp),Kirton',      'High Street, Kirton'),
    ('Weston,The Chequers PH',        'Weston, The Chequers PH'),
    ('Lincoln Road,Retail Park, Peterborough', 'Lincoln Road, Retail Park, Peterborough'),
    ('Unit 1,000 Estate',             'Unit 1,000 Estate')
  ) t(input, expected) loop
    if public.announcement_speech_name(r.input) <> r.expected then
      raise exception 'FAIL: announcement_speech_name(%) = %, expected %', r.input, public.announcement_speech_name(r.input), r.expected;
    end if;
  end loop;
  raise notice 'PASS: comma spacing for speech';
end $$;

-- 2. Clip keys are unchanged (the slug ignores punctuation and spaces).
do $$
begin
  if public.announcement_service_clip_key('S116S', 'Boston,College') <> 'service/s116s__boston-college' then
    raise exception 'FAIL: route-start key changed (got %)', public.announcement_service_clip_key('S116S', 'Boston,College');
  end if;
  raise notice 'PASS: keys unchanged';
end $$;

-- 3. A stop named without the space is queued with the spaced wording, while
--    its display name (the sign) keeps the original.
do $$
declare
  v_stop uuid;
begin
  insert into stops (name, lat, lon, announcement_name)
  values ('College Car Park', 52.0, -0.1, 'Boston,College') returning id into v_stop;
  if not exists (select 1 from announcement_clip_jobs
                 where key = 'departure/' || v_stop and text = 'The next stop is Boston, College.') then
    raise exception 'FAIL: departure job was not worded with the comma space';
  end if;
  if (select public.display_name(s.*) from stops s where s.id = v_stop) <> 'Boston,College' then
    raise exception 'FAIL: the sign''s display name changed';
  end if;
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'PASS: spaced wording queued, sign unchanged'; else raise; end if;
end $$;
