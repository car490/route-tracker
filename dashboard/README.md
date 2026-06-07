# Route Tracker Dashboard

React + Vite ops dashboard.

## Runtime targets

- Local UI: `http://localhost:5173`
- Local GraphHopper: `http://127.0.0.1:8989`
- Cloud UI: Vercel deployment
- Cloud DB: Supabase (already in use)
- Future routing target: VPS-hosted GraphHopper behind HTTPS

## Environment files

- `.env.example`: local starter values and keys used by this project
- `.env.local`: developer machine overrides (not committed)
- `.env.production.example`: production stub for Vercel / cloud setup

## Local development

1. Install dependencies.
2. Run `npm run dev:safe` for prompt-before-kill port handling, or `npm run dev` to force-kill port 5173.
3. Open `http://localhost:5173`.
4. Validate routing wiring via `http://localhost:5173/api/directions-diagnostics`.

## Production stubs

Files under `deploy/` are scaffolding for cloud routing cutover:

- `deploy/graphhopper-vps.stub.md`: VPS routing checklist and integration notes
- `deploy/docker-compose.graphhopper.stub.yml`: container skeleton for GraphHopper runtime

## Vercel environment checklist

Required server-side values:

- `GRAPHHOPPER_URL`
- `GRAPHHOPPER_PROFILE` (default target: `pcv`)
- `SUPABASE_JWT_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM`

Required client-side values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_OS_PLACES_API_KEY`
- `VITE_ORS_API_KEY`

After changes, redeploy and verify diagnostics endpoint:

- `/api/directions-diagnostics` returns `urlConfigured: true`
- `/api/directions-diagnostics` returns `health.ok: true`
