import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { createHmac } from 'crypto'
import { readFileSync } from 'fs'
import { buildGHBody, normaliseGHResponse } from './api/_graphhopper.js'

const APP_VERSION = readFileSync(
  new URL('../VERSION', import.meta.url),
  'utf8',
).trim()

function firstNonEmpty(...values) {
  return values.find(v => typeof v === 'string' && v.trim().length > 0)
}

function firstNonEmptyEntry(candidates) {
  for (const [key, value] of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return { key, value: value.trim() }
    }
  }
  return null
}

// Local-dev middleware: handles /api/directions when GRAPHHOPPER_URL is set.
// In production the equivalent logic runs in dashboard/api/directions.js (Vercel).
function localDirectionsApi(ghBase, ghProfile) {
  if (!ghBase) return { name: 'local-directions-api' }

  return {
    name: 'local-directions-api',
    configureServer(server) {
      server.middlewares.use('/api/directions', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        let raw = ''
        req.on('data', chunk => { raw += chunk })
        req.on('end', async () => {
          try {
            const { coordinates, vehicle } = JSON.parse(raw)

            const upstream = await fetch(`${ghBase}/route`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(buildGHBody(coordinates, vehicle, ghProfile)),
              signal: AbortSignal.timeout(15000),
            })

            const data = await upstream.json()

            if (!upstream.ok) {
              res.statusCode = upstream.status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: data.message ?? `Routing error ${upstream.status}` }))
              return
            }

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(normaliseGHResponse(data)))
          } catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: e.message }))
          }
        })
      })
    },
  }
}

function localDirectionsDiagnosticsApi(env) {
  return {
    name: 'local-directions-diagnostics-api',
    configureServer(server) {
      server.middlewares.use('/api/directions-diagnostics', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        const urlEntry = firstNonEmptyEntry([
          ['GRAPHHOPPER_URL', env.GRAPHHOPPER_URL],
          ['GH_URL', env.GH_URL],
          ['GRAPHHOPPER_API_URL', env.GRAPHHOPPER_API_URL],
          ['VITE_GRAPHHOPPER_URL', env.VITE_GRAPHHOPPER_URL],
          ['VITE_GH_URL', env.VITE_GH_URL],
        ])

        const profileEntry = firstNonEmptyEntry([
          ['GRAPHHOPPER_PROFILE', env.GRAPHHOPPER_PROFILE],
          ['GH_PROFILE', env.GH_PROFILE],
          ['VITE_GRAPHHOPPER_PROFILE', env.VITE_GRAPHHOPPER_PROFILE],
          ['VITE_GH_PROFILE', env.VITE_GH_PROFILE],
        ])

        const profile = profileEntry?.value ?? 'pcv'
        let urlHost = null
        if (urlEntry?.value) {
          try {
            urlHost = new URL(urlEntry.value).host
          } catch {
            urlHost = '(invalid URL)'
          }
        }

        let health = {
          attempted: false,
          ok: false,
          status: null,
          error: null,
        }

        if (urlEntry?.value) {
          health.attempted = true
          try {
            const upstream = await fetch(`${urlEntry.value}/route`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                points: [[-0.1, 51.5], [-0.12, 51.51]],
                profile,
                points_encoded: false,
                instructions: false,
              }),
              signal: AbortSignal.timeout(5000),
            })
            health.ok = upstream.ok
            health.status = upstream.status
          } catch (err) {
            health.error = err?.message ?? 'Unknown probe error'
          }
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({
          graphhopper: {
            urlConfigured: Boolean(urlEntry),
            urlSource: urlEntry?.key ?? null,
            urlHost,
            profile,
            profileSource: profileEntry?.key ?? 'default',
            health,
          },
        }))
      })
    },
  }
}

function base64url(str) {
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function localSignTokenApi(secret) {
  return {
    name: 'local-sign-token-api',
    configureServer(server) {
      server.middlewares.use('/api/sign-token', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        let raw = ''
        req.on('data', chunk => { raw += chunk })
        req.on('end', () => {
          if (!secret) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'SUPABASE_JWT_SECRET not configured in .env.local' }))
            return
          }
          try {
            const { journey_ids, driver_name, driver_id } = JSON.parse(raw)
            if (!Array.isArray(journey_ids) || journey_ids.length === 0) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'journey_ids required' }))
              return
            }

            const header  = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
            const now     = Math.floor(Date.now() / 1000)
            const payload = base64url(JSON.stringify({
              iss:         'supabase',
              role:        'anon',
              driver_name: driver_name ?? 'Driver',
              driver_id,
              journey_ids,
              iat:         now,
              exp:         now + 86400,
            }))
            const sig = createHmac('sha256', secret)
              .update(`${header}.${payload}`)
              .digest('base64')
              .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ token: `${header}.${payload}.${sig}` }))
          } catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: e.message }))
          }
        })
      })
    },
  }
}

function localSendDutyEmailApi(resendApiKey, resendFrom) {
  return {
    name: 'local-send-duty-email-api',
    configureServer(server) {
      server.middlewares.use('/api/send-duty-email', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        let raw = ''
        req.on('data', chunk => { raw += chunk })
        req.on('end', async () => {
          if (!resendApiKey) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'RESEND_API_KEY not configured in .env.local' }))
            return
          }
          if (!resendFrom) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'RESEND_FROM not configured in .env.local' }))
            return
          }
          try {
            const { to, driver_name, date, url, company_name } = JSON.parse(raw)
            const longDate = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            })
            const fromField = company_name ? `${company_name} <${resendFrom}>` : resendFrom
            const sender = company_name ?? 'RouteTracker'
            const r = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: fromField,
                to,
                subject: `Your Duty Card — ${longDate}`,
                html: `<p>Hi ${driver_name},</p><p>Your duty card for ${longDate} is ready.</p><p><a href="${url}">View Duty Card →</a></p><p>${sender}</p>`,
                text: `Hi ${driver_name},\n\nYour duty card for ${longDate} is ready.\n\nView Duty Card: ${url}\n\n${sender}`,
              }),
            })
            const data = await r.json()
            if (!r.ok) {
              res.statusCode = r.status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: data.message ?? 'Email send failed' }))
              return
            }
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
          } catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: e.message }))
          }
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '')
  const ghBase = firstNonEmpty(
    env.GRAPHHOPPER_URL,
    env.GH_URL,
    env.GRAPHHOPPER_API_URL,
    env.VITE_GRAPHHOPPER_URL,
    env.VITE_GH_URL,
  )
  const ghProfile = firstNonEmpty(
    env.GRAPHHOPPER_PROFILE,
    env.GH_PROFILE,
    env.VITE_GRAPHHOPPER_PROFILE,
    env.VITE_GH_PROFILE,
  ) ?? 'pcv'
  return {
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['pwa-192x192.png', 'pwa-512x512.png'],
        manifest: {
          name: 'CoachMate Ops Dashboard',
          short_name: 'CoachMate',
          description: 'Ops back-office dashboard for CoachMate',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          theme_color: '#242F35',
          background_color: '#242F35',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
      }),
      localDirectionsApi(ghBase, ghProfile),
      localDirectionsDiagnosticsApi(env),
      localSignTokenApi(env.SUPABASE_JWT_SECRET),
      localSendDutyEmailApi(env.RESEND_API_KEY, env.RESEND_FROM),
    ],
  }
})
