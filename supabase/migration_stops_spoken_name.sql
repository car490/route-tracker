-- stops.spoken_name: speech-only pronunciation override
-- (docs/ANNOUNCE-VOICE-PLAN.md step 1). Idempotent; safe to re-run.
--
-- stops.announcement_name already overrides the name, but for the sign AND
-- speech together (display_name() reads it). A respelling such as
-- "Haze-bruh" for Happisburgh must change only what is said, so it needs its
-- own column. Used verbatim when set (no annotation stripping: a respelling
-- is deliberate). Clip KEYS still come from display_name(), because that is
-- what the driver PWA and Announce Solo pass to clipKeysFor().
-- Set directly via SQL for now, like announcement_name (no client UPDATE on
-- stops since migration_security_hardening_phase0.sql).

alter table public.stops add column if not exists spoken_name text;

alter table public.stops drop constraint if exists stops_spoken_name_not_blank;
alter table public.stops add constraint stops_spoken_name_not_blank
  check (spoken_name is null or length(trim(spoken_name)) > 0);

comment on column public.stops.spoken_name is
  'Speech-only name for announcement clips (e.g. a pronunciation respelling). Never shown on the sign. Null = speak display_name().';

-- Route-start sentence: spoken name of the final stop when set; key unchanged.
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
      || ' to ' || coalesce(last_stop.spoken, public.announcement_speech_name(last_stop.dest)) || '.',
    v_voice
  from (
    select distinct on (t.id) r.service_code, public.display_name(s.*) as dest, s.spoken_name as spoken
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

revoke execute on function public.enqueue_service_clips_for_timetables(uuid[]) from public, anon, authenticated;

-- approach/departure sentences: spoken name when set.
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
  v_name := coalesce(NEW.spoken_name, public.announcement_speech_name(display_name(NEW)));
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

revoke execute on function public.fn_announcement_clip_enqueue_on_stop_change() from public, anon, authenticated;

-- Fire on spoken_name changes too (re-queueing is what marks a clip stale).
drop trigger if exists trg_announcement_clip_enqueue_on_stop_change on public.stops;
create trigger trg_announcement_clip_enqueue_on_stop_change
  after insert or update of announcement_name, name, atco_code, spoken_name
  on public.stops
  for each row
  execute function public.fn_announcement_clip_enqueue_on_stop_change();
