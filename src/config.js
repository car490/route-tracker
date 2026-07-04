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

export const IS_DEV = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export const SUPABASE_URL = IS_DEV
  ? 'https://cgcbfgceputvdvhzrgio.supabase.co'
  : 'https://nwhayupsvcelyiwltdqo.supabase.co';

export const SUPABASE_KEY = IS_DEV
  ? 'sb_publishable_LZVX8fASyDG8UtMp3eeRJQ_SBxpCa54'
  : 'sb_publishable_gij_rPjr2EJrcv0W9sU-Ow_C3nNqGcn';
