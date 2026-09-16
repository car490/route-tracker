-- supabase/tests/announcement_clips_rls.sql
--
-- Server-side announcement clip pipeline (Phase 1 of
-- docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md) -- announcement_clips/
-- announcement_clip_jobs RLS, and the stops/routes enqueue triggers.
-- Self-contained SQL: each block runs inside a DO $$ ... $$ that's forced to
-- roll back (via an unhandled/forced exception), so no test data persists
-- regardless of pass/fail.
--
-- Run with: psql <connection> -f supabase/tests/announcement_clips_rls.sql
--
-- Expected to FAIL (table/functions don't exist yet) until
-- supabase/migration_announcement_clips.sql has been applied -- the "red"
-- half of TDD for this migration.

-- 1. article_for() must match announceStates.js's articleFor() on
-- representative service codes (letter-led is exact; digit-led matches on
-- the first spoken word, which is all the JS vowel-sound check ever reads).
do $$
declare
  v_cases jsonb := '[
    ["S125S", "an"], ["S116T", "an"], ["A1", "an"], ["X5", "an"],
    ["B7",  "a"],  ["T9", "a"], ["42", "a"], ["8", "an"], ["1", "a"],
    ["18", "an"], ["100", "a"], ["", "a"], [null, "a"]
  ]'::jsonb;
  v_case jsonb;
  v_code text;
  v_expected text;
  v_actual text;
begin
  for v_case in select * from jsonb_array_elements(v_cases)
  loop
    v_code := v_case ->> 0;
    v_expected := v_case ->> 1;
    v_actual := public.article_for(v_code);
    if v_actual <> v_expected then
      raise exception 'FAIL: article_for(%) = % (expected %)', coalesce(v_code, 'null'), v_actual, v_expected;
    end if;
  end loop;
  raise notice 'PASS: article_for() matches announceStates.js articleFor() on all cases';
end $$;

-- 2. anon/authenticated can SELECT announcement_clips (public_read) but
-- cannot write to it -- only the draining Edge Function (service_role) may.
do $$
begin
  set local role anon;
  perform 1 from public.announcement_clips limit 1;
  raise notice 'PASS: anon can select announcement_clips';

  begin
    insert into public.announcement_clips (key, storage_path, hash, text, voice)
    values ('test/should-fail', 'x', 'x', 'x', 'x');
    raise exception 'FAIL: anon was able to insert into announcement_clips';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anon correctly cannot insert into announcement_clips';
  end;

  reset role;

  set local role authenticated;
  perform 1 from public.announcement_clips limit 1;
  raise notice 'PASS: authenticated can select announcement_clips';

  begin
    insert into public.announcement_clips (key, storage_path, hash, text, voice)
    values ('test/should-fail', 'x', 'x', 'x', 'x');
    raise exception 'FAIL: authenticated was able to insert into announcement_clips';
  exception
    when insufficient_privilege then
      raise notice 'PASS: authenticated correctly cannot insert into announcement_clips';
  end;

  reset role;
end $$;

-- 3. announcement_clip_jobs must be completely inaccessible to anon/
-- authenticated -- explicit REVOKE (see migration's comment: this project's
-- default privileges grant these roles blanket access to every new table,
-- so REVOKE, not the absence of a GRANT, is what actually blocks them).
do $$
begin
  set local role anon;
  begin
    perform 1 from public.announcement_clip_jobs limit 1;
    raise exception 'FAIL: anon was able to select announcement_clip_jobs';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anon correctly cannot select announcement_clip_jobs';
  end;

  begin
    insert into public.announcement_clip_jobs (key, text, voice) values ('x', 'x', 'x');
    raise exception 'FAIL: anon was able to insert into announcement_clip_jobs';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anon correctly cannot insert into announcement_clip_jobs';
  end;
  reset role;

  set local role authenticated;
  begin
    perform 1 from public.announcement_clip_jobs limit 1;
    raise exception 'FAIL: authenticated was able to select announcement_clip_jobs';
  exception
    when insufficient_privilege then
      raise notice 'PASS: authenticated correctly cannot select announcement_clip_jobs';
  end;

  begin
    insert into public.announcement_clip_jobs (key, text, voice) values ('x', 'x', 'x');
    raise exception 'FAIL: authenticated was able to insert into announcement_clip_jobs';
  exception
    when insufficient_privilege then
      raise notice 'PASS: authenticated correctly cannot insert into announcement_clip_jobs';
  end;
  reset role;
end $$;

-- 4. Inserting a stop enqueues its approach/departure jobs with the expected
-- text (display_name() falls back to stops.name with no announcement_name/
-- naptan_stops row).
do $$
declare
  v_stop_id uuid;
  v_count   int;
begin
  insert into stops (name, lat, lon) values ('Test Stop One', 52.0, -0.1) returning id into v_stop_id;

  select count(*) into v_count from announcement_clip_jobs
  where key in ('approach/' || v_stop_id, 'departure/' || v_stop_id);

  if v_count <> 2 then
    raise exception 'FAIL: expected 2 enqueued jobs for a new stop, got %', v_count;
  end if;

  if not exists (
    select 1 from announcement_clip_jobs
    where key = 'approach/' || v_stop_id and text = 'This is Test Stop One.'
  ) then
    raise exception 'FAIL: approach job text did not match display_name()';
  end if;

  if not exists (
    select 1 from announcement_clip_jobs
    where key = 'departure/' || v_stop_id and text = 'The next stop is Test Stop One.'
  ) then
    raise exception 'FAIL: departure job text did not match display_name()';
  end if;

  raise notice 'PASS: inserting a stop enqueues correctly-worded approach/departure jobs';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test rows cleanly';
    else
      raise;
    end if;
end $$;

-- 4b. Updating announcement_name re-enqueues with the new wording, and
-- strips a trailing parenthetical indicator from spoken text.
do $$
declare
  v_stop_id uuid;
  v_count   int;
begin
  insert into stops (name, lat, lon) values ('Old Name (adj)', 52.0, -0.1) returning id into v_stop_id;

  update stops set announcement_name = 'New Speakable Name (opp)' where id = v_stop_id;

  select count(*) into v_count from announcement_clip_jobs
  where key = 'approach/' || v_stop_id and text = 'This is New Speakable Name.';

  if v_count < 1 then
    raise exception 'FAIL: updating announcement_name did not enqueue a job with the new, indicator-stripped text';
  end if;

  raise notice 'PASS: updating announcement_name enqueues a job with indicator-stripped text';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test rows cleanly';
    else
      raise;
    end if;
end $$;

-- 5. Inserting a route with a destination enqueues a service/<code>__<dest>
-- job with the correctly-articled text; no destination -> no job.
do $$
declare
  v_company_id uuid;
  v_route_id   uuid;
  v_count      int;
begin
  select id into v_company_id from companies limit 1;
  if v_company_id is null then
    raise notice 'SKIP: no company row to attach a test route to';
    return;
  end if;

  insert into routes (company_id, service_code, journey_type, destination)
  values (v_company_id, 'S999X', array['fixed'], 'Grantham (Bus Station)')
  returning id into v_route_id;

  select count(*) into v_count from announcement_clip_jobs
  where key = 'service/s999x__grantham'
    and text = 'This is an S999X to Grantham.';

  if v_count < 1 then
    raise exception 'FAIL: expected a correctly-worded, indicator-stripped ROUTE_START job for the new route';
  end if;

  insert into routes (company_id, service_code, journey_type)
  values (v_company_id, 'S998X', array['fixed']);

  if exists (select 1 from announcement_clip_jobs where key like 'service/s998x%') then
    raise exception 'FAIL: a route with no destination should not enqueue a ROUTE_START job';
  end if;

  raise notice 'PASS: route insert enqueues ROUTE_START job only when a destination is set, worded correctly';
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then
      raise notice 'Rolled back test rows cleanly';
    else
      raise;
    end if;
end $$;
