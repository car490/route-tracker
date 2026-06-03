import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHmac } from 'crypto'
import { buildGHBody, normaliseGHResponse } from './api/_graphhopper.js'

// Local-dev middleware: handles /api/directions when GRAPHHOPPER_URL is set.
// In production the equivalent logic runs in dashboard/api/directions.js (Vercel).
function localDirectionsApi() {
  const ghBase = process.env.GRAPHHOPPER_URL
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
              body: JSON.stringify(buildGHBody(coordinates, vehicle)),
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

function localSignTokenApi() {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) return { name: 'local-sign-token-api' }

  function base64url(str) {
    return Buffer.from(str, 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  }

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

export default defineConfig({
  plugins: [react(), localDirectionsApi(), localSignTokenApi()],
})
