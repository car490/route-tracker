-- generate-announcement-clip drain cron.
--
-- Prerequisite, if not already done for naptan-import (same secret is
-- reused here -- see supabase/migration_naptan_trigger.sql's own header):
--
--   select vault.create_secret('<service_role_key>', 'naptan_import_token');
--
-- The service role key is in: Supabase Dashboard -> Settings -> API -> service_role
--
-- Also set these Edge Function secrets (Supabase Dashboard -> Edge Functions
-- -> generate-announcement-clip -> Secrets):
--   AZURE_SPEECH_KEY, AZURE_SPEECH_REGION
--
-- Until both of the above are set, this cron still fires on schedule but
-- every call fails harmlessly (401 with no vault secret, or a 500 from the
-- function itself with no Azure secrets) -- jobs just keep accumulating in
-- announcement_clip_jobs unprocessed, same "safe to leave half-wired" state
-- migration_announcement_clips.sql's own header describes.
--
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_net  with schema extensions;
create extension if not exists pg_cron with schema extensions;

-- Every 5 minutes, capped batch (see the Edge Function's own DEFAULT_BATCH_SIZE
-- and docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md's "cap the scheduled drain's batch
-- size per cycle" decision) -- a burst of stop/route changes (e.g. a future
-- bulk NaPTAN-driven update) trickles out across several cycles instead of
-- firing one uncapped burst at Azure.
select cron.schedule(
  'announcement-clip-drain',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     => (select value from public.app_config where key = 'supabase_url') || '/functions/v1/generate-announcement-clip',
    headers => jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'naptan_import_token' limit 1
      )
    ),
    body    => jsonb_build_object('batch_size', 20)
  );
  $$
);
