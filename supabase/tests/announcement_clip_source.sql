-- supabase/tests/announcement_clip_source.sql
--
-- Source indicator and retry cap for announcement clips
-- (supabase/migration_announcement_clip_source.sql, docs/ANNOUNCE-VOICE-PLAN.md step 3).
-- Read-only except block 2, which raises 'rollback' so nothing is kept.
-- Run with: psql <connection> -f supabase/tests/announcement_clip_source.sql

-- 1. announcement_clips records how each clip was made; jobs carry a retry count.
do $$
declare
  v_missing text;
begin
  select string_agg(c, ', ') into v_missing
    from unnest(array['model', 'voice_settings', 'loudness_lufs', 'true_peak_db']) c
   where not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'announcement_clips' and column_name = c);
  if v_missing is not null then
    raise exception 'FAIL: announcement_clips is missing %', v_missing;
  end if;
  select string_agg(c, ', ') into v_missing
    from unnest(array['attempts', 'last_error', 'last_attempt_at']) c
   where not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'announcement_clip_jobs' and column_name = c);
  if v_missing is not null then
    raise exception 'FAIL: announcement_clip_jobs is missing %', v_missing;
  end if;
  raise notice 'PASS: source and retry columns exist';
end $$;

-- 2. A new job starts at 0 attempts; the enqueue triggers need no change.
do $$
declare
  v_stop uuid;
  v_attempts int;
begin
  insert into stops (name, lat, lon) values ('Test Source Stop', 52.0, -0.1) returning id into v_stop;
  select attempts into v_attempts from announcement_clip_jobs where key = 'approach/' || v_stop;
  if v_attempts is distinct from 0 then
    raise exception 'FAIL: a new job should start at 0 attempts (got %)', v_attempts;
  end if;
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'PASS: new jobs start at 0 attempts'; else raise; end if;
end $$;

-- 3. Jobs (with their error text) stay invisible to client roles.
do $$
begin
  if has_table_privilege('anon', 'public.announcement_clip_jobs', 'SELECT')
     or has_table_privilege('authenticated', 'public.announcement_clip_jobs', 'SELECT') then
    raise exception 'FAIL: client roles can read announcement_clip_jobs';
  end if;
  raise notice 'PASS: jobs not client-readable';
end $$;
