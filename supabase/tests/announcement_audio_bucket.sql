-- supabase/tests/announcement_audio_bucket.sql
--
-- announcement-audio Storage bucket (Phase 1 of
-- docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md) -- checks bucket config and policy
-- shape directly via pg_policies rather than round-tripping real objects,
-- since storage.objects rows need real upload metadata to insert.
--
-- Run with: psql <connection> -f supabase/tests/announcement_audio_bucket.sql

do $$
begin
  if not exists (
    select 1 from storage.buckets where id = 'announcement-audio' and public = true
  ) then
    raise exception 'FAIL: announcement-audio bucket missing or not public';
  end if;
  raise notice 'PASS: announcement-audio bucket exists and is public';
end $$;

do $$
declare
  v_select_count int;
  v_write_count  int;
begin
  select count(*) into v_select_count
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and cmd = 'SELECT'
    and qual like '%''announcement-audio''%';

  if v_select_count < 1 then
    raise exception 'FAIL: no SELECT policy scoped to the announcement-audio bucket';
  end if;

  -- No insert/update/delete policy should exist for this bucket at all --
  -- not even company-scoped for authenticated, unlike company-logos/
  -- operator-assets. Only service_role (which bypasses RLS) may write.
  select count(*) into v_write_count
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and cmd in ('INSERT', 'UPDATE', 'DELETE')
    and (
      qual like '%''announcement-audio''%'
      or with_check like '%''announcement-audio''%'
    );

  if v_write_count > 0 then
    raise exception 'FAIL: found % write polic(y/ies) scoped to announcement-audio -- expected none', v_write_count;
  end if;

  raise notice 'PASS: announcement-audio has a public SELECT policy and zero write policies';
end $$;
