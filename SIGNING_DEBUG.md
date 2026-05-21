# JWT Signing Debug — Session Handoff

## What we're trying to do
Duty Cards page generates a signed 24h HS256 JWT per driver, embedded in the duty card URL
(`?duties=uuid1,uuid2&token=<jwt>`). The token carries `driver_name`, `driver_id`,
`journey_ids`, and `role:anon`. The PWA uses it as a Bearer header; RLS scopes anon writes
to the driver's own journeys via `is_jwt_journey_allowed()`.

---

## Root problem
The browser **cannot call the Supabase Edge Function** `generate-duty-token` directly.
`fetch()` throws "Failed to fetch" — not a CORS error, not an auth error, the request
never leaves the browser. The exact cause is unknown but is likely a browser extension
or network-level block on `/functions/v1/` paths. Everything else on the same Supabase
domain (`/rest/v1/`, Realtime) works fine.

---

## What we ruled out (do not re-investigate these)

| Theory | Evidence |
|---|---|
| Edge Function not deployed | ACTIVE, confirmed via Management API |
| Network unreachable | PowerShell POST returns 401 (function ran) |
| CORS misconfigured | OPTIONS returns `Access-Control-Allow-Origin: *` with all needed headers |
| `verify_jwt: true` blocking OPTIONS preflight | Changed to `verify_jwt: false` — POST still throws |
| Supabase JS SDK wrapping a session error | Replaced `supabase.functions.invoke` with raw `fetch()` — same "Failed to fetch" |
| Vercel CSP header blocking the request | Only HSTS on Vercel response, no CSP |
| DB RPC via `current_setting('app.settings.jwt_secret')` | PostgREST in this Supabase version does NOT set that GUC. Only `app.settings.jwt_exp` is set at DB level. |
| pg_net to call Edge Function from DB | `pg_net` / `http` / `pgsodium` not installed on this project |
| JWT secret via Management API | Not exposed by any API endpoint; secrets endpoint returns hashes only |

---

## Current solution (deployed, WORKING ✓)

A **Vercel serverless function** at `/api/sign-token` acts as a same-origin proxy:

```
Browser → POST /api/sign-token  (same-origin, no CORS)
                  ↓  server-side fetch
          Supabase Edge Function  (no browser restrictions)
                  ↓
          { token: "eyJ..." }
```

**Files:**
- `dashboard/api/sign-token.js` — Vercel function; receives auth header + body from dashboard, forwards to Edge Function, returns `{ token }`
- `dashboard/src/features/journeys/DutyCardsPage.jsx` — calls `/api/sign-token` instead of Edge Function directly

**Last commit:** `2e61116` — *"Add Vercel serverless proxy for JWT signing"*

---

## How it was fixed (2026-05-21)

1. Vercel proxy was running but the Edge Function was crashing with `DataError: Key length is zero`
   because `SUPABASE_JWT_SECRET` was never set as an Edge Function secret.
2. The legacy JWT secret is found at: **Supabase Dashboard → Settings → API → JWT Signing Keys →
   "Legacy JWT secret (still used)" → Reveal**. This is what PostgREST still uses to verify JWTs.
3. Supabase rejects secrets with the `SUPABASE_` prefix — named it `JWT_SECRET` instead.
4. Updated Edge Function to read `Deno.env.get('JWT_SECRET')` (commit `14f509f`).
5. Set `JWT_SECRET` = legacy JWT secret value in Edge Functions secrets via Dashboard.

---

## If the Vercel proxy also fails

Check these things in order:

1. **Did Vercel pick up the `api/` directory?**  
   Vercel should auto-detect `dashboard/api/sign-token.js` as a serverless function.  
   Check the Vercel deployment logs — does it list the function being built?  
   If not, a `vercel.json` at `dashboard/` root may be needed to register it.

2. **Are the env vars available in the serverless function?**  
   The function reads `process.env.VITE_SUPABASE_URL` and `process.env.VITE_SUPABASE_ANON_KEY`.  
   These are already set in Vercel (used by the Vite build). Verify they're available to
   the Functions runtime too (Vercel dashboard → Settings → Environment Variables).

3. **Error from the proxy itself?**  
   The error display in the UI now shows the actual response body, so the message will
   be specific (e.g. `HTTP 401`, `Unauthorized`, `fetch failed: ...`).

---

## If we need to abandon the Edge Function entirely

The DB RPC (`generate_duty_token`) is already deployed in the live DB and works correctly —
it just can't find the JWT secret. The fix is to seed the secret into the DB:

```sql
ALTER DATABASE postgres SET "app.settings.jwt_secret" = '<secret>';
```

The JWT secret is **not** accessible via the Management API. The user needs to find it in
the Supabase Dashboard. In the current UI it is at:

> **supabase.com/dashboard/project/nwhayupsvcelyiwltdqo/settings/api**  
> Scroll to **"JWT Settings"** → click **"Reveal"**

If that section doesn't exist, try the direct URL above — the user previously couldn't
find it by navigating the sidebar, but may not have tried the direct URL.

Once the secret is known, run the `ALTER DATABASE` above via the Supabase SQL Editor,
then switch `DutyCardsPage.jsx` back to `supabase.rpc('generate_duty_token', {...})`
and check that `data` (not `data.token`) is returned.

---

## State of all related DB objects

| Object | Status |
|---|---|
| Edge Function `generate-duty-token` | Deployed, ACTIVE, `verify_jwt: false` |
| DB function `public.generate_duty_token(uuid[], text, uuid)` | Deployed, needs `app.settings.jwt_secret` to be set |
| DB function `public.is_jwt_journey_allowed(uuid)` | Live, used by all anon RLS write policies |
| `app.settings.jwt_secret` GUC | **NOT set** in this Supabase project |
| `app.settings.jwt_exp` GUC | Set to `3600` at DB level |
