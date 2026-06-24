-- Replace the app.supabase_url DB-level setting (required ALTER DATABASE SET,
-- which Supabase's pooled/restricted roles can't run) with a plain settings
-- table read by the NAPTAN trigger function and weekly cron job.
--
-- Per-environment step: insert the project URL row once per project —
-- not a secret, safe to commit as a value, but the row itself is inserted
-- per-environment since the URL differs:
--   insert into public.app_config (key, value) values ('supabase_url', '<https://PROJECT_REF.supabase.co>')
--   on conflict (key) do update set value = excluded.value, updated_at = now();

create table if not exists public.app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- Internal-only config, never exposed via PostgREST: no anon/authenticated
-- grants, RLS enabled with no policies (default-deny for any non-owner role).
alter table public.app_config enable row level security;

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
  select array_agg(c) into _new_counties
  from unnest(NEW.service_counties) c
  where c <> all(OLD.service_counties);

  if _new_counties is null or array_length(_new_counties, 1) = 0 then
    return NEW;
  end if;

  select decrypted_secret into _token
  from vault.decrypted_secrets
  where name = 'naptan_import_token'
  limit 1;

  if _token is null then
    raise warning 'naptan_import_token not found in vault — new counties not imported automatically. Run import-naptan.js manually.';
    return NEW;
  end if;

  select value into _url from public.app_config where key = 'supabase_url';

  if _url is null then
    raise warning 'app_config.supabase_url not set — new counties not imported automatically. Run import-naptan.js manually.';
    return NEW;
  end if;

  perform net.http_post(
    url     => _url || '/functions/v1/naptan-import',
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

do $$
begin
  if exists (select 1 from cron.job where jobname = 'naptan-weekly-refresh') then
    perform cron.unschedule('naptan-weekly-refresh');
  end if;
end;
$$;

select cron.schedule(
  'naptan-weekly-refresh',
  '0 2 * * 0',
  $$
  select net.http_post(
    url     => (select value from public.app_config where key = 'supabase_url') || '/functions/v1/naptan-import',
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
