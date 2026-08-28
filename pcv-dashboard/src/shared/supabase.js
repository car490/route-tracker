import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

export const supabase = createClient(SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)

// Which Supabase project this build is actually talking to -- shown in
// Layout.jsx's sidebar so it's never ambiguous which data you're looking
// at/changing. cgcbfgceputvdvhzrgio is the dev project (route-tracker-dev);
// anything else (including an unset/misconfigured URL) is treated as
// production, since that's the safer default to warn about.
export const IS_DEV_SUPABASE = SUPABASE_URL?.includes('cgcbfgceputvdvhzrgio') ?? false
