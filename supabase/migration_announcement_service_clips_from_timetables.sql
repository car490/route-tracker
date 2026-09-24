-- Migration: ROUTE_START clips keyed by each timetable's final stop, not routes.destination
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-09-24
--
-- Why: the driver PWA showed "Audio not fully ready" at the start of every
-- journey. The route-start clip ("This is an S116S to Donington, Cowley
-- Academy.") never existed on either environment: the old enqueue trigger
-- built it from routes.destination, a BODS description field that is empty
-- on every real route -- so it silently no-op'd. The app never reads that
-- field anyway: the driver PWA (main.js) and Announce Solo
-- (announceSoloAutopilot.js) both pass the journey's final stop's
-- display_name as `destination` to clipKeysFor(ROUTE_START), exactly as
-- scripts/generate-announcement-audio.mjs always has. One route can end at
-- more than one place (S125T runs to Boston College and to Weston The
-- Chequers), so this can't be a route-level value at all.
--
-- What this does:
--   1. Shared helpers for the speech-name/slug/key rules, so the three
--      trigger functions below can't drift from each other. Speech names now
--      strip every "(...)" indicator, matching clipKeysFor()'s
--      stripSpeechAnnotations() and the local generator -- previously SQL
--      only stripped a trailing one. No stop on dev or production had a
--      non-trailing indicator when this was written, so no existing stop
--      clip's wording changes.
--   2. Statement-level triggers on timetable_stops: one job per affected
--      timetable per statement, for its current highest-sequence stop. The
--      dashboard saves a timetable as delete-all then one bulk insert
--      (saveRouteTimetableStops.js), so intermediate stops never get a clip.
--   3. The stops trigger also re-enqueues ROUTE_START for every timetable
--      that stop ends; the routes trigger now re-enqueues on a service_code
--      change and no longer reads routes.destination.
--   4. Backfill: one job per existing timetable. The drain cron renders them
--      (20 per 5 minutes); the Edge Function dedupes jobs sharing a key.

-- ── 1. Helpers ─────────────────────────────────────────────────────────────────

-- Mirrors stripSpeechAnnotations() in shared/announcementAudio.js.
create or replace function public.announcement_speech_name(p_name text)
returns text
language sql
immutable
as $$
  select regexp_replace(p_name, '\s*\([^)]*\)', '', 'g')
$$;

-- Mirrors slug() in shared/announcementAudio.js.
create or replace function public.announcement_clip_slug(p_text text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(p_text), '[^a-z0-9]+', '-', 'g'))
$$;

-- Mirrors clipKeysFor(ROUTE_START) in shared/announcementAudio.js.
create or replace function public.announcement_service_clip_key(p_service_code text, p_destination text)
returns text
language sql
immutable
as $$
  select 'service/' || public.announcement_clip_slug(p_service_code)
      || '__' || public.announcement_clip_slug(public.announcement_speech_name(p_destination))
$$;

-- Enqueues one ROUTE_START job per given timetable, for its highest-sequence
-- stop. No-ops for a timetable with no stops (e.g. mid-save, after the
-- dashboard's delete and before its insert).
create or replace function public.enqueue_service_clips_for_timetables(p_timetable_ids uuid[])
returns void
language plpgsql
security definer
as $$
declare
  v_voice text;
begin
  select coalesce((select value from public.app_config where key = 'announcement_voice'), 'en-GB-RyanNeural')
    into v_voice;

  insert into public.announcement_clip_jobs (key, text, voice)
  select distinct
    public.announcement_service_clip_key(last_stop.service_code, last_stop.dest),
    'This is ' || public.article_for(last_stop.service_code) || ' ' || last_stop.service_code
      || ' to ' || public.announcement_speech_name(last_stop.dest) || '.',
    v_voice
  from (
    select distinct on (t.id) r.service_code, public.display_name(s.*) as dest
    from public.timetables t
    join public.routes r           on r.id = t.route_id
    join public.timetable_stops ts on ts.timetable_id = t.id
    join public.stops s            on s.id = ts.stop_id
    where t.id = any(p_timetable_ids)
    order by t.id, ts.sequence desc
  ) last_stop
  where last_stop.service_code is not null
    and coalesce(trim(last_stop.dest), '') <> '';
end;
$$;

revoke execute on function public.enqueue_service_clips_for_timetables(uuid[]) from public;

-- ── 2. timetable_stops triggers ────────────────────────────────────────────────
-- Postgres allows transition tables only on single-event triggers, hence
-- three triggers sharing one function.

create or replace function public.fn_announcement_clip_enqueue_on_timetable_stops_change()
returns trigger
language plpgsql
security definer
as $$
declare
  v_ids uuid[];
begin
  if TG_OP = 'INSERT' then
    select array_agg(distinct timetable_id) into v_ids from new_rows;
  elsif TG_OP = 'DELETE' then
    select array_agg(distinct timetable_id) into v_ids from old_rows;
  else
    select array_agg(distinct timetable_id) into v_ids
    from (select timetable_id from new_rows union select timetable_id from old_rows) changed;
  end if;

  if v_ids is not null then
    perform public.enqueue_service_clips_for_timetables(v_ids);
  end if;
  return null;
end;
$$;

revoke execute on function public.fn_announcement_clip_enqueue_on_timetable_stops_change() from public;

drop trigger if exists trg_announcement_clip_enqueue_on_timetable_stops_insert on public.timetable_stops;
create trigger trg_announcement_clip_enqueue_on_timetable_stops_insert
  after insert on public.timetable_stops
  referencing new table as new_rows
  for each statement
  execute function public.fn_announcement_clip_enqueue_on_timetable_stops_change();

drop trigger if exists trg_announcement_clip_enqueue_on_timetable_stops_update on public.timetable_stops;
create trigger trg_announcement_clip_enqueue_on_timetable_stops_update
  after update on public.timetable_stops
  referencing new table as new_rows old table as old_rows
  for each statement
  execute function public.fn_announcement_clip_enqueue_on_timetable_stops_change();

drop trigger if exists trg_announcement_clip_enqueue_on_timetable_stops_delete on public.timetable_stops;
create trigger trg_announcement_clip_enqueue_on_timetable_stops_delete
  after delete on public.timetable_stops
  referencing old table as old_rows
  for each statement
  execute function public.fn_announcement_clip_enqueue_on_timetable_stops_change();

-- ── 3. stops + routes triggers ─────────────────────────────────────────────────

create or replace function public.fn_announcement_clip_enqueue_on_stop_change()
returns trigger
language plpgsql
security definer
as $$
declare
  v_name  text;
  v_voice text;
  v_ids   uuid[];
begin
  v_name := public.announcement_speech_name(display_name(NEW));
  select coalesce((select value from public.app_config where key = 'announcement_voice'), 'en-GB-RyanNeural')
    into v_voice;

  insert into public.announcement_clip_jobs (key, text, voice)
  values
    ('approach/' || NEW.id,  'This is ' || v_name || '.', v_voice),
    ('departure/' || NEW.id, 'The next stop is ' || v_name || '.', v_voice);

  -- Every timetable this stop currently ends (its ROUTE_START clip names it).
  select array_agg(t.id) into v_ids
  from public.timetables t
  where (select ts.stop_id from public.timetable_stops ts
         where ts.timetable_id = t.id order by ts.sequence desc limit 1) = NEW.id;

  if v_ids is not null then
    perform public.enqueue_service_clips_for_timetables(v_ids);
  end if;

  return NEW;
end;
$$;

create or replace function public.fn_announcement_clip_enqueue_on_route_change()
returns trigger
language plpgsql
security definer
as $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from public.timetables where route_id = NEW.id;
  if v_ids is not null then
    perform public.enqueue_service_clips_for_timetables(v_ids);
  end if;
  return NEW;
end;
$$;

-- A new route has no timetables yet, and destination no longer feeds any clip.
drop trigger if exists trg_announcement_clip_enqueue_on_route_change on public.routes;
create trigger trg_announcement_clip_enqueue_on_route_change
  after update of service_code
  on public.routes
  for each row
  execute function public.fn_announcement_clip_enqueue_on_route_change();

-- ── 4. Backfill ────────────────────────────────────────────────────────────────

select public.enqueue_service_clips_for_timetables(array(select id from public.timetables));
