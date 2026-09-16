// Public client config — safe to commit.
//
// These are Supabase *anon/publishable* keys, not secrets: they carry no
// privileges on their own. Row Level Security policies on each table are
// what actually control access (see supabase/schema.sql). This is the same
// trust model as a Stripe publishable key or a Firebase client config —
// it ships to every browser that loads the app either way.
//
// Never put a service_role key, SUPABASE_JWT_SECRET, or any other real
// secret here — those must only ever be read from process.env on a server
// (see dashboard/api/*.js for that pattern).

// driver-dev.pcvtechnologies.co.uk is the develop-only Cloudflare Workers
// deploy target (env.dev in wrangler.jsonc) -- it must hit dev Supabase,
// same as localhost, so that testing develop's auto-deployed code never
// touches production data. driver.pcvtechnologies.co.uk (no "-dev") is the
// production migration target and must stay on the prod branch below.
// self, not window: this module is also imported by service-worker.js
// (Phase 2 of docs/ANNOUNCEMENT-AUDIO-SYNC-PLAN.md), whose real
// ServiceWorkerGlobalScope has `self` but no `window` at all -- window.
// worked in every test because jsdom's `self` is just an alias for
// `window`, which silently hid this from the whole test suite until a
// real-device install actually threw "ServiceWorker script evaluation
// failed". `self` resolves correctly in both a normal window context and
// a worker context, so this one change covers both.
export const IS_DEV = self.location.hostname === 'localhost'
  || self.location.hostname === '127.0.0.1'
  || self.location.hostname === 'driver-dev.pcvtechnologies.co.uk';

export const SUPABASE_URL = IS_DEV
  ? 'https://cgcbfgceputvdvhzrgio.supabase.co'
  : 'https://nwhayupsvcelyiwltdqo.supabase.co';

export const SUPABASE_KEY = IS_DEV
  ? 'sb_publishable_LZVX8fASyDG8UtMp3eeRJQ_SBxpCa54'
  : 'sb_publishable_gij_rPjr2EJrcv0W9sU-Ow_C3nNqGcn';
