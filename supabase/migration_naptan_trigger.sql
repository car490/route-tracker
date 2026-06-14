-- NAPTAN import trigger + weekly cron job.
--
-- Prerequisites (run once per environment in the SQL editor — NOT in migrations,
-- as the service role key must never be committed to git):
--
--   select vault.create_secret('<service_role_key>', 'naptan_import_token');
--
-- The service role key is in: Supabase Dashboard → Settings → API → service_role
--
-- Also set the OPENCAGE_API_KEY Edge Function secret:
--   Supabase Dashboard → Edge Functions → naptan-import → Secrets
--
-- ─────────────────────────────────────────────────────────────────────────────

-- Store the project URL as a DB-level setting (not secret, safe to commit).
-- Replace with the correct URL for each environment when applying.
-- Dev:  alter database postgres set "app.supabase_url" = 'https://cgcbfgceputvdvhzrgio.supabase.co';
-- Prod: alter database postgres set "app.supabase_url" = 'https://nwhayupsvcelyiwltdqo.supabase.co';

-- ── Enable required extensions ────────────────────────────────────────────────

create extension if not exists pg_net    with schema extensions;
create extension if not exists pg_cron   with schema extensions;

-- ── Trigger function ──────────────────────────────────────────────────────────

create or replace function public.fn_naptan_import_on_county_change()
returns trigger
language plpgsql
security definer
as $$
declare
  _new_counties  text[];
  _token         text;
  _url           text;
begin
  -- Find counties added (in NEW but not in OLD)
  select array_agg(c) into _new_counties
  from unnest(NEW.service_counties) c
  where c <> all(OLD.service_counties);

  -- Nothing added — nothing to do
  if _new_counties is null or array_length(_new_counties, 1) = 0 then
    return NEW;
  end if;

  -- Read service role key from vault
  select decrypted_secret into _token
  from vault.decrypted_secrets
  where name = 'naptan_import_token'
  limit 1;

  if _token is null then
    raise warning 'naptan_import_token not found in vault — new counties not imported automatically. Run import-naptan.js manually.';
    return NEW;
  end if;

  _url := current_setting('app.supabase_url', true) || '/functions/v1/naptan-import';

  -- Fire-and-forget async HTTP call via pg_net
  perform net.http_post(
    url     => _url,
    headers => jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || _token
    ),
    body    => jsonb_build_object(
      'counties', _new_counties,
      'mode',     'add'
    )::text
  );

  raise notice 'NAPTAN import triggered for counties: %', _new_counties;
  return NEW;
end;
$$;

-- ── Trigger on companies ──────────────────────────────────────────────────────

drop trigger if exists trg_naptan_import_on_county_change on public.companies;

create trigger trg_naptan_import_on_county_change
  after update of service_counties
  on public.companies
  for each row
  when (NEW.service_counties <> OLD.service_counties)
  execute function public.fn_naptan_import_on_county_change();

-- ── Weekly full refresh via pg_cron ──────────────────────────────────────────
-- Runs every Sunday at 02:00 UTC.
-- Re-imports all counties from companies.service_counties to pick up
-- any changes in the live NAPTAN dataset.

select cron.schedule(
  'naptan-weekly-refresh',
  '0 2 * * 0',
  $$
  select net.http_post(
    url     => current_setting('app.supabase_url', true) || '/functions/v1/naptan-import',
    headers => jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'naptan_import_token' limit 1
      )
    ),
    body    => '{"mode":"refresh"}'
  );
  $$
);
