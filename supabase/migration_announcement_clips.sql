-- Migration: server-side announcement clip pipeline — tables + enqueue triggers
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-09-15
--
-- Phase 1 of docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md's implementation checklist.
-- No client changes in this migration -- this only builds the storage-side
-- tables and the triggers that keep announcement_clip_jobs in lockstep with
-- stop/route changes. The actual Azure rendering (the generate-announcement-clip
-- Edge Function + its cron drain) is a separate piece; until that's deployed,
-- rows just accumulate in announcement_clip_jobs unprocessed -- harmless.

-- ── announcement_clips: the rendered-clip manifest, server-side ────────────────
-- Mirrors today's driver/audio/announcements/manifest.json shape. Only the
-- draining Edge Function (service_role) ever writes here.

create table public.announcement_clips (
  key          text primary key,      -- e.g. 'approach/<stopId>', 'service/<code>__<dest>'
  storage_path text not null,
  hash         text not null,         -- same '<voice>|<text>' hash as today's generator
  text         text not null,
  voice        text not null,
  rendered_at  timestamptz not null default now()
);

grant select on public.announcement_clips to anon;
grant select on public.announcement_clips to authenticated;
grant all    on public.announcement_clips to service_role;

alter table public.announcement_clips enable row level security;

create policy "public_read" on public.announcement_clips
  for select to anon, authenticated
  using (true);

-- ── announcement_clip_jobs: the drain queue ─────────────────────────────────────
-- Deliberately not exposed via PostgREST at all. Only the enqueue triggers
-- below (which run as their table owner, not the caller) and the draining
-- Edge Function (service_role, which bypasses RLS) ever touch this table.
-- Closes off the Azure-cost-abuse vector a client-writable queue would open.
--
-- Two layers, found to both matter while testing this migration: this
-- Supabase project's default privileges grant anon/authenticated blanket
-- SELECT/INSERT/UPDATE/DELETE on every new public-schema table automatically
-- (confirmed via information_schema.role_table_grants -- same is true of
-- public.app_config above, despite its comment claiming "no grants"), so RLS
-- enabled with no policies is what actually blocks all row access, not the
-- absence of a GRANT. That alone is sufficient (a SELECT under RLS-deny
-- silently returns zero rows; an INSERT/UPDATE with no matching policy
-- raises a genuine RLS-violation error) -- but this table also gets an
-- explicit REVOKE, as defense-in-depth: if RLS were ever accidentally
-- disabled here, the REVOKE alone still blocks anon/authenticated outright
-- rather than silently falling back to "everyone can read/write everything."

create table public.announcement_clip_jobs (
  id           uuid primary key default gen_random_uuid(),
  key          text not null,
  text         text not null,
  voice        text not null,
  requested_at timestamptz not null default now()
);

create index announcement_clip_jobs_key_idx on public.announcement_clip_jobs (key);

revoke all on public.announcement_clip_jobs from anon, authenticated;
grant all on public.announcement_clip_jobs to service_role;

alter table public.announcement_clip_jobs enable row level security;

-- Both explicit service_role grants above (and announcement_clips' own,
-- further up) are required, not redundant with anon/authenticated's default
-- privileges: found 2026-09-15 while applying this migration to production
-- that production's public schema has no pg_default_acl entry for
-- service_role at all (dev's does) -- an environment divergence, not
-- something this migration created. Without the explicit grant,
-- generate-announcement-clip's service-role client hits a genuine Postgres
-- "permission denied for table", not an RLS deny -- RLS/bypass is never even
-- reached. Applied as a follow-up fix to both dev and production; folded
-- into this file so a fresh reset gets it too.

-- ── article_for(): SQL port of announceStates.js's articleFor() ────────────────
-- Needed so the server-rendered ROUTE_START clip text ("This is a/an X to
-- Y.") matches the grammar the client already computes for its own on-screen
-- text -- see that file's own comment for the "spoken sound, not spelling"
-- rule (a leading letter is read as its letter name, a leading digit run as
-- the number it spells). Faithful for the letter branch (every service code
-- in this fleet is letter-led, e.g. S116S); the digit branch only builds the
-- very first spoken word, which is all articleFor's own vowel-sound check
-- ever looks at, so this stays exact for that branch too even without
-- building the rest of the number's words out.
create or replace function public.article_for(p_service_code text)
returns text
language plpgsql
immutable
as $$
declare
  v_first  text;
  v_digits text;
  v_num    int;
  v_words  text;
  v_ones   text[] := array['zero','one','two','three','four','five','six','seven','eight','nine','ten',
                            'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  v_tens   text[] := array['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
begin
  if p_service_code is null or trim(p_service_code) = '' then
    return 'a';
  end if;

  v_first := substring(trim(p_service_code) from 1 for 1);

  if v_first ~ '[a-zA-Z]' then
    return case when upper(v_first) = any(array['A','E','F','H','I','L','M','N','O','R','S','X'])
      then 'an' else 'a' end;
  end if;

  if v_first ~ '[0-9]' then
    v_digits := substring((regexp_match(p_service_code, '^\d+'))[1] from 1 for 3);
    v_num := v_digits::int;

    if v_num < 20 then
      v_words := v_ones[v_num + 1];
    elsif v_num < 100 then
      v_words := v_tens[v_num / 10 + 1]
        || case when v_num % 10 <> 0 then '-' || v_ones[v_num % 10 + 1] else '' end;
    else
      v_words := v_ones[v_num / 100 + 1] || ' hundred';
    end if;

    -- Vowel-sound check only ever looks at the FIRST spoken word (JS splits
    -- on space/hyphen and checks index 0) -- "one hundred" and "twenty-one"
    -- must both be judged on "one"/"twenty", not the full phrase.
    declare
      v_first_word text := (regexp_split_to_array(v_words, '[\s-]'))[1];
    begin
      if v_first_word = 'one' then
        return 'a';
      end if;
      return case when v_first_word ~ '^[aeiou]' then 'an' else 'a' end;
    end;
  end if;

  return 'a';
end;
$$;

-- ── Enqueue trigger: stops (approach/<id>, departure/<id>) ─────────────────────
-- Fires on insert (new stop needs both clips) and on update of the three
-- columns display_name() actually reads. Doesn't fire on a naptan_stops-only
-- change (e.g. a bulk NaPTAN re-import correcting a locality_name) -- a real
-- gap, flagged rather than silently ignored, since display_name() falls back
-- to naptan_stops when announcement_name is unset. Left as a known limitation
-- of this migration rather than adding naptan_stops trigger coverage here.
create or replace function public.fn_announcement_clip_enqueue_on_stop_change()
returns trigger
language plpgsql
security definer
as $$
declare
  v_name  text;
  v_voice text;
begin
  v_name := regexp_replace(display_name(NEW), '\s*\([^)]*\)\s*$', '');
  select coalesce((select value from public.app_config where key = 'announcement_voice'), 'en-GB-RyanNeural')
    into v_voice;

  insert into public.announcement_clip_jobs (key, text, voice)
  values
    ('approach/' || NEW.id,  'This is ' || v_name || '.', v_voice),
    ('departure/' || NEW.id, 'The next stop is ' || v_name || '.', v_voice);

  return NEW;
end;
$$;

drop trigger if exists trg_announcement_clip_enqueue_on_stop_change on public.stops;

create trigger trg_announcement_clip_enqueue_on_stop_change
  after insert or update of announcement_name, name, atco_code
  on public.stops
  for each row
  execute function public.fn_announcement_clip_enqueue_on_stop_change();

-- Trigger functions have no business being directly RPC-callable (Postgres
-- itself refuses to invoke a `returns trigger` function outside trigger
-- context, but Postgres also grants EXECUTE to PUBLIC on every newly
-- created function by default -- which anon/authenticated inherit as
-- members of PUBLIC regardless of any per-role grant -- so revoking from
-- just anon/authenticated wasn't enough; confirmed via
-- information_schema.role_routine_grants that PUBLIC held the grant here).
-- Revoke from PUBLIC explicitly rather than rely on the trigger-type
-- restriction as the only backstop.
revoke execute on function public.fn_announcement_clip_enqueue_on_stop_change() from public;

-- ── Enqueue trigger: routes (service/<code>__<dest>) ────────────────────────────
-- ROUTE_START's key/text depend only on routes.service_code + destination
-- (both route-level, not per-departure) -- see routes' own column comments.
-- Silently no-ops when destination isn't set yet (non-BODS routes never
-- carry one -- see routes.destination's own comment, "required when
-- journey_type requires_bods = true").
create or replace function public.fn_announcement_clip_enqueue_on_route_change()
returns trigger
language plpgsql
security definer
as $$
declare
  v_voice text;
  v_dest  text;
  v_key   text;
begin
  if NEW.destination is null or trim(NEW.destination) = '' or NEW.service_code is null then
    return NEW;
  end if;

  v_dest := regexp_replace(NEW.destination, '\s*\([^)]*\)\s*$', '');

  -- Same slug rule as scripts/generate-announcement-audio.mjs / clipKeysFor():
  -- lowercase, non-alphanumeric runs collapsed to '-', trimmed.
  v_key := 'service/'
    || trim(both '-' from regexp_replace(lower(NEW.service_code), '[^a-z0-9]+', '-', 'g'))
    || '__'
    || trim(both '-' from regexp_replace(lower(v_dest), '[^a-z0-9]+', '-', 'g'));

  select coalesce((select value from public.app_config where key = 'announcement_voice'), 'en-GB-RyanNeural')
    into v_voice;

  insert into public.announcement_clip_jobs (key, text, voice)
  values (
    v_key,
    'This is ' || public.article_for(NEW.service_code) || ' ' || NEW.service_code || ' to ' || v_dest || '.',
    v_voice
  );

  return NEW;
end;
$$;

drop trigger if exists trg_announcement_clip_enqueue_on_route_change on public.routes;

create trigger trg_announcement_clip_enqueue_on_route_change
  after insert or update of service_code, destination
  on public.routes
  for each row
  execute function public.fn_announcement_clip_enqueue_on_route_change();

revoke execute on function public.fn_announcement_clip_enqueue_on_route_change() from public;
