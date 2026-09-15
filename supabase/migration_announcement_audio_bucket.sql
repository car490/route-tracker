-- Migration: announcement-audio Storage bucket
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-09-15
--
-- Phase 1 of docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md's implementation checklist.
-- Follows the exact same pattern as company-logos/operator-assets/system-assets
-- (public bucket, explicit `<bucket>_public_read` SELECT policy even though
-- `public: true` already allows it, no anon/authenticated write policies at
-- all) except this bucket has NO write policies whatsoever, not even a
-- company-scoped authenticated one -- only the generate-announcement-clip
-- Edge Function (service_role, which bypasses RLS) ever writes here.

insert into storage.buckets (id, name, public)
values ('announcement-audio', 'announcement-audio', true)
on conflict (id) do nothing;

create policy "announcement_audio_public_read" on storage.objects
  for select to public
  using (bucket_id = 'announcement-audio');
