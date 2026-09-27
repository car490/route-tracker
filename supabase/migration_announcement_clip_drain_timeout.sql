-- Give the clip drain call time to finish (docs/ANNOUNCE-VOICE-PLAN.md step 3).
-- Idempotent: cron.schedule with an existing job name updates that job.
--
-- pg_net's default timeout is 5 s. A Ben (ElevenLabs) render takes longer:
-- the API call plus levelling, re-encoding and re-checking. The function still
-- finished, but every run logged a timeout in net._http_response, which would
-- hide real errors. 60 s covers a full batch (at most 3 Ben renders).
-- Like the original (migration_announcement_clip_drain_cron.sql), this job is
-- environment config, not part of schema.sql.
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
    body    => jsonb_build_object('batch_size', 20),
    timeout_milliseconds => 60000
  );
  $$
);
