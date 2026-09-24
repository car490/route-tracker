-- supabase/tests/announcement_clip_review.sql
--
-- Review of Ben clips from the dashboard (supabase/migration_announcement_clip_review.sql,
-- docs/ANNOUNCE-VOICE-PLAN.md step 5). Forced-rollback blocks: nothing persists.
-- Identity: dashboard users are impersonated as `authenticated` with
-- request.jwt.claims.sub set to an employee's auth_user_id.
-- PRECONDITION: an employee with a login and access_level super_user or
-- ops_manager. Block 3 also needs a driver-level login; it SKIPs if none.
-- Run with: psql <connection> -f supabase/tests/announcement_clip_review.sql

-- 1. The review log and both functions exist; nothing is reachable without a login.
do $$
begin
  if to_regclass('public.announcement_clip_reviews') is null then
    raise exception 'FAIL: announcement_clip_reviews does not exist';
  end if;
  if has_table_privilege('anon', 'public.announcement_clip_reviews', 'SELECT')
     or has_table_privilege('authenticated', 'public.announcement_clip_reviews', 'SELECT') then
    raise exception 'FAIL: the review log is directly readable by client roles';
  end if;
  if has_function_privilege('anon', 'public.review_announcement_clip(text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.announcement_voice_status()', 'EXECUTE') then
    raise exception 'FAIL: anon can call the review functions';
  end if;
  if not has_function_privilege('authenticated', 'public.review_announcement_clip(text, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.announcement_voice_status()', 'EXECUTE') then
    raise exception 'FAIL: dashboard users cannot call the review functions';
  end if;
  raise notice 'PASS: review surface locked down';
end $$;

-- 2. An ops user sees an unreviewed Ben clip, approves its current version,
--    then sees it reviewed. An old version (wrong hash) is refused.
do $$
declare
  v_user   uuid;
  v_status jsonb;
  v_clip   jsonb;
begin
  select auth_user_id into v_user from employees
   where auth_user_id is not null and access_level in ('super_user', 'ops_manager') limit 1;
  if v_user is null then raise exception 'FAIL: no ops login to test with'; end if;

  insert into announcement_clips (key, storage_path, hash, text, voice)
  values ('approach/00000000-0000-0000-0000-00000000test', 'approach/00000000-0000-0000-0000-00000000test.mp3',
          'reviewhash000001', 'This is Test Review Stop.', 'elevenlabs:eUlIljct4YrEQRcEqrii');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  v_status := public.announcement_voice_status();
  select c into v_clip from jsonb_array_elements(v_status->'clips') c
   where c->>'key' = 'approach/00000000-0000-0000-0000-00000000test';
  if v_clip is null or (v_clip->>'reviewed')::boolean then
    raise exception 'FAIL: new Ben clip should be listed as unreviewed (got %)', v_clip;
  end if;
  if v_status->'usage'->>'cap' is null then
    raise exception 'FAIL: status is missing the daily cap';
  end if;

  begin
    perform public.review_announcement_clip('approach/00000000-0000-0000-0000-00000000test', 'oldversion000000');
    raise exception 'FAIL: approving an old version was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform public.review_announcement_clip('approach/00000000-0000-0000-0000-00000000test', 'reviewhash000001');
  v_status := public.announcement_voice_status();
  select c into v_clip from jsonb_array_elements(v_status->'clips') c
   where c->>'key' = 'approach/00000000-0000-0000-0000-00000000test';
  if not (v_clip->>'reviewed')::boolean or v_clip->>'reviewed_by' is null then
    raise exception 'FAIL: approved clip not shown as reviewed with a reviewer (got %)', v_clip;
  end if;

  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'PASS: review flow'; else raise; end if;
end $$;

-- 3. A driver-level login can't see the status or approve anything.
do $$
declare
  v_user uuid;
begin
  select auth_user_id into v_user from employees
   where auth_user_id is not null and access_level not in ('super_user', 'ops_manager') limit 1;
  if v_user is null then
    raise notice 'SKIP: no driver-level login to test with';
    return;
  end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  begin
    perform public.announcement_voice_status();
    raise exception 'FAIL: a driver-level login could read the clip status';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  raise exception 'rollback';
exception
  when others then
    if sqlerrm = 'rollback' then raise notice 'PASS: drivers refused'; else raise; end if;
end $$;
