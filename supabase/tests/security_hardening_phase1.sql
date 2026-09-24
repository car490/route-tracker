-- supabase/tests/security_hardening_phase1.sql
--
-- Verification for supabase/migration_security_hardening_phase1.sql.
-- Read-only except block 2, which raises 'rollback' so nothing is kept.
-- Run with: psql <connection> -f supabase/tests/security_hardening_phase1.sql

-- 1. anon reads only the branding columns of companies.
do $$
declare
  v_bad text;
begin
  if has_table_privilege('anon', 'public.companies', 'SELECT') then
    raise exception 'FAIL: anon still has table-wide SELECT on companies';
  end if;
  select string_agg(attname, ', ') into v_bad
    from pg_attribute
   where attrelid = 'public.companies'::regclass and attnum > 0 and not attisdropped
     and has_column_privilege('anon', 'public.companies', attname, 'SELECT')
     and attname not in ('id', 'name', 'logo_path', 'primary_color', 'accent_color');
  if v_bad is not null then
    raise exception 'FAIL: anon can read non-branding companies columns: %', v_bad;
  end if;
  if not has_column_privilege('anon', 'public.companies', 'name', 'SELECT')
     or not has_column_privilege('anon', 'public.companies', 'logo_path', 'SELECT') then
    raise exception 'FAIL: anon lost the branding columns the PWA/sign need';
  end if;
  if not has_table_privilege('authenticated', 'public.companies', 'SELECT') then
    raise exception 'FAIL: authenticated (dashboard) lost SELECT on companies';
  end if;
  raise notice 'PASS: companies anon access limited to branding columns';
end $$;

-- 2. As anon: the PWA's and sign's real queries still work; a sensitive
--    column is refused.
do $$
declare
  v_name text;
begin
  set local role anon;
  select name into v_name from public.companies limit 1;
  perform id, name, logo_path, accent_color from public.companies limit 1;
  begin
    perform operator_licence_number from public.companies limit 1;
    raise exception 'FAIL: anon could read operator_licence_number';
  exception when insufficient_privilege then
    raise notice 'PASS: anon refused operator_licence_number';
  end;
  raise exception 'rollback';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- 3. The unguarded two-argument link_announce_device is gone.
do $$
begin
  if to_regprocedure('public.link_announce_device(uuid, uuid)') is not null then
    raise exception 'FAIL: link_announce_device(uuid, uuid) still exists';
  end if;
  raise notice 'PASS: two-argument link_announce_device dropped';
end $$;

-- 4. Trigger-only clip functions are not callable by client roles.
do $$
begin
  if has_function_privilege('anon', 'public.enqueue_service_clips_for_timetables(uuid[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enqueue_service_clips_for_timetables(uuid[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.fn_announcement_clip_enqueue_on_timetable_stops_change()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_announcement_clip_enqueue_on_timetable_stops_change()', 'EXECUTE') then
    raise exception 'FAIL: client roles can still execute trigger-only clip functions';
  end if;
  raise notice 'PASS: clip enqueue functions not client-executable';
end $$;
