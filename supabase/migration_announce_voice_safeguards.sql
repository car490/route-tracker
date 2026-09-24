-- Credit safeguards for the ElevenLabs "Ben" voice
-- (docs/ANNOUNCE-VOICE-PLAN.md step 4). Idempotent; safe to re-run.

-- 1. Usage log: one row per successful ElevenLabs call, so the drain can
--    enforce a daily character cap. Service role only.
create table if not exists public.elevenlabs_usage (
  id         bigint generated always as identity primary key,
  key        text        not null,
  chars      int         not null check (chars > 0),
  created_at timestamptz not null default now()
);
create index if not exists elevenlabs_usage_created_at_idx on public.elevenlabs_usage (created_at);

revoke all on public.elevenlabs_usage from anon, authenticated;
grant select, insert on public.elevenlabs_usage to service_role;
alter table public.elevenlabs_usage enable row level security;
-- No policies: default-deny for every role except the owner and service_role (which bypasses RLS).

-- 2. Daily cap, per environment. '0' pauses all Ben rendering. The drain
--    (service_role) needs to read app_config; clients still can't.
insert into public.app_config (key, value) values ('elevenlabs_daily_char_cap', '6000')
on conflict (key) do nothing;
-- Read-only: dev's default privileges had also given service_role write
-- access, which nothing uses (production never had it).
revoke insert, update, delete, truncate on public.app_config from service_role;
grant select on public.app_config to service_role;

-- 3. One place that words and queues a stop's approach/departure clips.
--    p_only_missing: queue only keys with no clip (and no pending job) in the
--    current voice, so routine timetable saves don't flood the queue.
create or replace function public.enqueue_stop_clips(p_stop_ids uuid[], p_only_missing boolean)
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
  select k.key, k.text, v_voice
  from (
    select s.id, coalesce(s.spoken_name, public.announcement_speech_name(public.display_name(s.*))) as name
    from public.stops s
    where s.id = any(p_stop_ids)
  ) st
  cross join lateral (values
    ('approach/'  || st.id, 'This is '          || st.name || '.'),
    ('departure/' || st.id, 'The next stop is ' || st.name || '.')
  ) as k(key, text)
  where not p_only_missing
     or (not exists (select 1 from public.announcement_clips c where c.key = k.key and c.voice = v_voice)
         and not exists (select 1 from public.announcement_clip_jobs j where j.key = k.key and j.voice = v_voice));
end;
$$;

revoke execute on function public.enqueue_stop_clips(uuid[], boolean) from public, anon, authenticated;

-- Stop trigger: same behaviour as before (always re-queue both clips), now via the helper.
create or replace function public.fn_announcement_clip_enqueue_on_stop_change()
returns trigger
language plpgsql
security definer
as $$
declare
  v_ids uuid[];
begin
  perform public.enqueue_stop_clips(array[NEW.id], false);

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

-- Timetable trigger: also queue clips for stops that have just started being
-- used and have no clip in the current voice (the drain only renders Ben for
-- stops a timetable uses, so this is how a newly used stop gets its Ben clip).
create or replace function public.fn_announcement_clip_enqueue_on_timetable_stops_change()
returns trigger
language plpgsql
security definer
as $$
declare
  v_ids   uuid[];
  v_stops uuid[];
begin
  if TG_OP = 'INSERT' then
    select array_agg(distinct timetable_id) into v_ids from new_rows;
    select array_agg(distinct stop_id) into v_stops from new_rows;
  elsif TG_OP = 'DELETE' then
    select array_agg(distinct timetable_id) into v_ids from old_rows;
  else
    select array_agg(distinct timetable_id) into v_ids
    from (select timetable_id from new_rows union select timetable_id from old_rows) changed;
    select array_agg(distinct stop_id) into v_stops from new_rows;
  end if;

  if v_ids is not null then
    perform public.enqueue_service_clips_for_timetables(v_ids);
  end if;
  if v_stops is not null then
    perform public.enqueue_stop_clips(v_stops, true);
  end if;
  return null;
end;
$$;

revoke execute on function public.fn_announcement_clip_enqueue_on_timetable_stops_change() from public, anon, authenticated;
