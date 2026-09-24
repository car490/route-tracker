-- Announcement clip source indicator and retry cap
-- (docs/ANNOUNCE-VOICE-PLAN.md step 3). Idempotent; safe to re-run.

-- How each clip was made. `voice` already exists ('en-GB-RyanNeural', or
-- 'elevenlabs:<voice id>' for Ben). Null for clips rendered before this.
alter table public.announcement_clips add column if not exists model          text;
alter table public.announcement_clips add column if not exists voice_settings jsonb;
alter table public.announcement_clips add column if not exists loudness_lufs  numeric(5,2);
alter table public.announcement_clips add column if not exists true_peak_db   numeric(5,2);

-- Retry cap: generate-announcement-clip stops retrying a job after
-- MAX_JOB_ATTEMPTS failures, so a bad key or a clip that can't be levelled
-- can't spend ElevenLabs credits in a loop. Failed rows stay queryable here.
alter table public.announcement_clip_jobs add column if not exists attempts        int not null default 0;
alter table public.announcement_clip_jobs add column if not exists last_error      text;
alter table public.announcement_clip_jobs add column if not exists last_attempt_at timestamptz;
