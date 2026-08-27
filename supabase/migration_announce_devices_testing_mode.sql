-- Migration: Announce Lite standalone autopilot — per-device testing_mode flag
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-08-27
--
-- Lets a standalone Announce Lite device match a candidate departure well
-- outside its normal match_window_before_min/match_window_after_min window
-- (see scheduleAutopilot.js's TESTING_TIME_SHIFT_THRESHOLD_MIN, 60+ min) and
-- start the journey with its stop schedule shifted to the current time —
-- mirrors the driver PWA's ?debug "use current time" testing toggle, but
-- automatic since a driverless device has no one to tick a checkbox. Off by
-- default so a live device never takes this path.

alter table public.announce_devices
  add column if not exists testing_mode boolean not null default false;
