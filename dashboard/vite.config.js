import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
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
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return { name: 'local-sign-token-api' }

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
        req.on('end', async () => {
          try {
            const body = JSON.parse(raw)
            const upstream = await fetch(
              `${supabaseUrl}/functions/v1/generate-duty-token`,
              {
                method: 'POST',
                headers: {
                  'Content-Type':  'application/json',
                  'Authorization': req.headers['authorization'] ?? '',
                  'apikey':        anonKey,
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(15000),
              }
            )
            const text = await upstream.text()
            let data
            try { data = JSON.parse(text) } catch {
              res.statusCode = upstream.status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `Edge Function returned non-JSON: ${text.slice(0, 200)}` }))
              return
            }
            res.statusCode = upstream.status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
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
