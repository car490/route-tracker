import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function base64url(data: Uint8Array): string {
  let str = ''
  for (const byte of data) str += String.fromCharCode(byte)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const header = base64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body   = base64url(enc.encode(JSON.stringify(payload)))
  const input  = `${header}.${body}`
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(input)))
  return `${input}.${base64url(sig)}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { journey_ids, driver_name, driver_id } = await req.json()
    if (!Array.isArray(journey_ids) || journey_ids.length === 0) {
      return new Response(JSON.stringify({ error: 'journey_ids required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const jwtSecret = Deno.env.get('JWT_SECRET')
    if (!jwtSecret) {
      return new Response(JSON.stringify({ error: 'JWT_SECRET not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const now = Math.floor(Date.now() / 1000)
    const token = await signJWT(
      {
        iss:         'supabase',
        role:        'anon',
        driver_name: driver_name ?? 'Driver',
        driver_id:   driver_id ?? null,
        journey_ids,
        iat:         now,
        exp:         now + 86400,
      },
      jwtSecret
    )

    return new Response(JSON.stringify({ token }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
