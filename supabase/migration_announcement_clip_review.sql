-- Review of Ben (ElevenLabs) clips from the dashboard
-- (docs/ANNOUNCE-VOICE-PLAN.md step 5). Idempotent; safe to re-run.
--
-- Ben clips play as soon as they're rendered; review happens afterwards
-- (John, 2026-09-24). A review approves one specific version of a clip (its
-- hash), so a re-rendered clip shows as unreviewed again. Clips are global
-- (stops have no company), so any ops manager or super user may review.

create table if not exists public.announcement_clip_reviews (
  id          bigint generated always as identity primary key,
  key         text        not null,
  hash        text        not null,
  reviewed_by uuid        not null references public.employees(id),
  reviewed_at timestamptz not null default now()
);
create index if not exists announcement_clip_reviews_key_hash_idx on public.announcement_clip_reviews (key, hash);

-- Read and written only through the two functions below.
revoke all on public.announcement_clip_reviews from anon, authenticated;
grant select on public.announcement_clip_reviews to service_role;
alter table public.announcement_clip_reviews enable row level security;

-- Everything the "Announcement Clips" dashboard page shows, in one call:
-- Ben clips with their review state, queue items needing attention, and
-- today's ElevenLabs character use against the cap. Ops roles only.
create or replace function public.announcement_voice_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
begin
  if coalesce(public.current_employee_role(), '') not in ('super_user', 'ops_manager') then
    raise exception 'Only an ops manager or super user can review announcement clips';
  end if;

  return jsonb_build_object(
    'voice', (select value from public.app_config where key = 'announcement_voice'),
    'usage', jsonb_build_object(
      'today_chars', (select coalesce(sum(chars), 0) from public.elevenlabs_usage where created_at >= v_day_start),
      'month_chars', (select coalesce(sum(chars), 0) from public.elevenlabs_usage
                      where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'),
      'cap',         (select value from public.app_config where key = 'elevenlabs_daily_char_cap')
    ),
    'clips', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', c.key, 'text', c.text, 'storage_path', c.storage_path, 'hash', c.hash,
               'rendered_at', c.rendered_at, 'loudness_lufs', c.loudness_lufs, 'true_peak_db', c.true_peak_db,
               'reviewed', r.reviewed_at is not null, 'reviewed_at', r.reviewed_at, 'reviewed_by', r.reviewer)
             order by (r.reviewed_at is not null), c.rendered_at desc)
      from public.announcement_clips c
      left join lateral (
        select rv.reviewed_at, e.name as reviewer
        from public.announcement_clip_reviews rv
        join public.employees e on e.id = rv.reviewed_by
        where rv.key = c.key and rv.hash = c.hash
        order by rv.reviewed_at desc limit 1
      ) r on true
      where c.voice like 'elevenlabs:%'
    ), '[]'::jsonb),
    'attention', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', j.key, 'text', j.text, 'voice', j.voice, 'attempts', j.attempts,
               'last_error', j.last_error, 'last_attempt_at', j.last_attempt_at)
             order by j.last_attempt_at desc)
      from public.announcement_clip_jobs j
      where j.last_error is not null
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.announcement_voice_status() from public, anon;
grant execute on function public.announcement_voice_status() to authenticated;

-- Approve the current version of one Ben clip. Refuses an old version (the
-- hash must match what's stored now), a non-Ben clip, and non-ops users.
create or replace function public.review_announcement_clip(p_key text, p_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid;
begin
  if coalesce(public.current_employee_role(), '') not in ('super_user', 'ops_manager') then
    raise exception 'Only an ops manager or super user can review announcement clips';
  end if;
  select id into v_employee from public.employees where auth_user_id = auth.uid() limit 1;

  if not exists (select 1 from public.announcement_clips
                 where key = p_key and hash = p_hash and voice like 'elevenlabs:%') then
    raise exception 'This clip has changed since the page was loaded (or is not a Ben clip); reload and listen again';
  end if;

  insert into public.announcement_clip_reviews (key, hash, reviewed_by) values (p_key, p_hash, v_employee);
end;
$$;

revoke execute on function public.review_announcement_clip(text, text) from public, anon;
grant execute on function public.review_announcement_clip(text, text) to authenticated;
