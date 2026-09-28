-- supabase/tests/revoke_table_admin_privileges.sql
--
-- Verification for supabase/migration_revoke_table_admin_privileges.sql.
-- Read-only checks, plus one TRUNCATE attempt inside a block that raises
-- 'rollback' at the end so nothing is kept even if the revoke is missing.
-- Run with: psql <connection> -f supabase/tests/revoke_table_admin_privileges.sql

-- 1. No public table/view grants TRUNCATE, REFERENCES, TRIGGER or MAINTAIN
--    to anon or authenticated.
do $$
declare
  v_bad text;
begin
  select string_agg(r.rolname || ':' || c.relname || ':' || p.priv, ', ')
    into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) r(rolname)
    cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(priv)
   where n.nspname = 'public'
     and c.relkind in ('r', 'v', 'm', 'p', 'f')
     and has_table_privilege(r.rolname, c.oid, p.priv);
  if v_bad is not null then
    raise exception 'FAIL: client roles still hold table-admin privileges: %', v_bad;
  end if;
  raise notice 'PASS: no table-admin privileges for anon/authenticated';
end $$;

-- 2. postgres's default privileges for public no longer hand them out
--    (D = TRUNCATE, x = REFERENCES, t = TRIGGER, m = MAINTAIN).
do $$
declare
  v_acl text;
begin
  select string_agg(a::text, ' ')
    into v_acl
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral unnest(d.defaclacl) a
   where n.nspname = 'public'
     and d.defaclobjtype = 'r'
     and d.defaclrole = 'postgres'::regrole
     and (a::text like 'anon=%' or a::text like 'authenticated=%')
     and split_part(split_part(a::text, '=', 2), '/', 1) ~ '[Dxtm]';
  if v_acl is not null then
    raise exception 'FAIL: default privileges still grant table-admin privileges: %', v_acl;
  end if;
  raise notice 'PASS: default privileges clean';
end $$;

-- 3. The apps' normal access is untouched: authenticated can still
--    select/insert/update/delete journeys, anon can still read stops.
do $$
begin
  if not (has_table_privilege('authenticated', 'public.journeys', 'SELECT,INSERT,UPDATE,DELETE')
          and has_table_privilege('anon', 'public.stops', 'SELECT')) then
    raise exception 'FAIL: normal DML/SELECT grants were removed';
  end if;
  raise notice 'PASS: normal grants intact';
end $$;

-- 4. TRUNCATE as authenticated is refused outright.
do $$
begin
  set local role authenticated;
  begin
    truncate public.term_dates;
    raise exception 'FAIL: authenticated could truncate term_dates';
  exception when insufficient_privilege then
    raise notice 'PASS: truncate refused for authenticated';
  end;
  raise exception 'rollback';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;
