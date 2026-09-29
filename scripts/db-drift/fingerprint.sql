-- scripts/db-drift/fingerprint.sql
--
-- Read-only schema fingerprint used by scripts/db-drift/check.mjs to prove dev
-- and production have the same database structure and the same access rules.
-- One row per object: (kind, name, detail). Only catalog reads; no table data
-- is returned. Function, view and policy bodies are returned as md5 hashes of a
-- normalised form (comments, whitespace and a final ';' removed, lower-cased),
-- so a comment or indentation difference is not drift but any change in
-- behaviour is (lower-casing also hides a case-only change in a message text).
--
-- Deliberately NOT compared: row data (app_config values, stops, clips), cron
-- job commands (they carry the project URL), extension versions (Supabase
-- manages them), and anything outside the public schema except storage
-- policies/buckets and the realtime publication, which gate client access.
with fns as (
  select p.oid, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
rels as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
),
roles(r) as (values ('anon'), ('authenticated'), ('service_role'))
select * from (
  -- Tables and views
  select 'relation' as kind, relname as name,
         case relkind when 'r' then 'table' when 'p' then 'table' when 'v' then 'view' else 'matview' end
         || case when relkind in ('r', 'p') then ' rls=' || relrowsecurity || ' force=' || relforcerowsecurity else '' end as detail
  from rels

  union all
  -- Columns
  select 'column', c.relname || '.' || a.attname,
         format_type(a.atttypid, a.atttypmod)
         || case when a.attnotnull then ' not null' else '' end
         || coalesce(' default ' || pg_get_expr(ad.adbin, ad.adrelid), '')
  from rels c
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum

  union all
  -- Constraints (primary key, foreign key, unique, check)
  select 'constraint', c.relname || '.' || con.conname, pg_get_constraintdef(con.oid)
  from rels c join pg_constraint con on con.conrelid = c.oid

  union all
  -- Indexes
  select 'index', c.relname || '.' || i.relname,
         md5(pg_get_indexdef(i.oid))
  from rels c
  join pg_index x on x.indrelid = c.oid
  join pg_class i on i.oid = x.indexrelid

  union all
  -- View bodies
  select 'view', relname,
         md5(regexp_replace(lower(pg_get_viewdef(oid)), '\s+', '', 'g'))
  from rels where relkind in ('v', 'm')

  union all
  -- Functions: body hash plus the settings that change who they run as
  select 'function', f.sig,
         md5(replace(regexp_replace(lower(regexp_replace(pg_get_functiondef(f.oid), '--[^\n]*', '', 'g')), '\s+', '', 'g'),
                     ';$function$', '$function$'))
         || case when p.prosecdef then ' security definer' else '' end
         || coalesce(' set ' || array_to_string(p.proconfig, ','), '')
  from fns f join pg_proc p on p.oid = f.oid

  union all
  -- Triggers
  select 'trigger', c.relname || '.' || t.tgname,
         md5(pg_get_triggerdef(t.oid)) || case t.tgenabled when 'D' then ' disabled' else '' end
  from rels c join pg_trigger t on t.tgrelid = c.oid and not t.tgisinternal

  union all
  -- RLS policies (public and storage)
  select 'policy', schemaname || '.' || tablename || '.' || policyname,
         cmd || ' ' || permissive || ' to ' || array_to_string(roles, ',') || ' '
         || md5(regexp_replace(lower(coalesce(qual, '') || '|' || coalesce(with_check, '')), '\s+', '', 'g'))
  from pg_policies where schemaname in ('public', 'storage')

  union all
  -- Table privileges held by the client roles and service_role
  select 'table_grant', c.relname || ':' || r.r,
         coalesce((select string_agg(pr, ',' order by pr) from unnest(array[
           'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr
           where has_table_privilege(r.r, c.oid, pr)), 'none')
  from rels c cross join roles r

  union all
  -- Sequence privileges
  select 'sequence_grant', s.relname || ':' || r.r,
         coalesce((select string_agg(pr, ',' order by pr) from unnest(array['USAGE', 'SELECT', 'UPDATE']) pr
           where has_sequence_privilege(r.r, s.oid, pr)), 'none')
  from pg_class s cross join roles r
  where s.relnamespace = 'public'::regnamespace and s.relkind = 'S'

  union all
  -- Column-level privileges (e.g. anon's branding-only columns on companies)
  select 'column_grant', table_name || '.' || column_name || ':' || grantee,
         string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.column_privileges
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
    and not exists (
      select 1 from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = column_privileges.table_name
        and g.grantee = column_privileges.grantee and g.privilege_type = column_privileges.privilege_type)
  group by table_name, column_name, grantee

  union all
  -- Who can call each function over /rest/v1/rpc
  select 'function_grant', f.sig || ':' || r.r,
         case when has_function_privilege(r.r, f.oid, 'EXECUTE') then 'EXECUTE' else 'none' end
  from fns f cross join (values ('anon'), ('authenticated')) r(r)

  union all
  -- Default privileges: what a newly created table/function gets automatically
  -- (per-schema entries for public, and global entries that apply to every schema)
  select 'default_acl', pg_get_userbyid(d.defaclrole) || ':'
           || case when d.defaclnamespace = 0 then 'all' else 'public' end || ':'
           || d.defaclobjtype::text || ':' || a.grantee_name,
         string_agg(a.privilege_type, ',' order by a.privilege_type)
  from pg_default_acl d
  cross join lateral (
    select case when e.grantee = 0 then 'PUBLIC' else pg_get_userbyid(e.grantee) end as grantee_name, e.privilege_type
    from aclexplode(d.defaclacl) e
  ) a
  where (d.defaclnamespace = 0 or d.defaclnamespace = 'public'::regnamespace)
    and a.grantee_name in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  group by d.defaclrole, d.defaclnamespace, d.defaclobjtype, a.grantee_name

  union all
  -- Scheduled jobs (command left out: it carries the project URL)
  select 'cron_job', jobname, schedule || case when active then '' else ' inactive' end
  from cron.job

  union all
  -- Storage buckets
  select 'bucket', id, 'public=' || public
  from storage.buckets

  union all
  -- Tables whose changes are pushed to clients over Realtime
  select 'realtime', schemaname || '.' || tablename, 'published'
  from pg_publication_tables where pubname = 'supabase_realtime'

  union all
  -- Installed extensions (names only)
  select 'extension', extname, 'installed'
  from pg_extension
) all_rows
order by kind, name;
