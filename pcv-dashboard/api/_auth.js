import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

// Verifies the caller's bearer token is a real, current Supabase session and
// returns a Supabase client authenticated AS that user, so every query made
// with it is subject to that user's own RLS policies. Returns null if the
// token is missing/invalid/expired.
export async function authenticate(req) {
  const token = req.headers['authorization']?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data: { user }, error } = await anon.auth.getUser(token)
  if (error || !user) return null

  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  return { user, supabase: asUser }
}
