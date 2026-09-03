import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

export const supabase = createClient(SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)

// Which Supabase project this build is actually talking to -- shown in
// Layout.jsx's sidebar so it's never ambiguous which data you're looking
// at/changing. cgcbfgceputvdvhzrgio is the dev project (route-tracker-dev);
// anything else (including an unset/misconfigured URL) is treated as
// production, since that's the safer default to warn about.
export const IS_DEV_SUPABASE = SUPABASE_URL?.includes('cgcbfgceputvdvhzrgio') ?? false

// Origin the driver PWA / Announce app is served from, for building links
// (duty cards, journeys, Announce install links) that point at it from the
// dashboard. Cloudflare Workers (driver-dev/driver.pcvtechnologies.co.uk) is
// the live target for both dev and prod as of the cutover the week of
// 2026-08-25 -- GitHub Pages (car490.github.io) is never used outside a
// local machine now. Must track IS_DEV_SUPABASE, not just
// import.meta.env.DEV -- a deployed dev/preview dashboard build (e.g.
// Vercel preview on `develop`) still has import.meta.env.DEV === false, so
// without this a "dev" dashboard would generate links pointing at prod
// (prod Supabase) -- the two Supabase projects don't share
// company/vehicle/device rows, so a dev-generated link opened against the
// prod build silently can't find its own data.
export const PWA_BASE = import.meta.env.DEV
  ? 'http://localhost:8080'
  : IS_DEV_SUPABASE
    ? 'https://driver-dev.pcvtechnologies.co.uk'
    : 'https://driver.pcvtechnologies.co.uk'
