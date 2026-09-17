# Focused Security Review — 2026-09-17

Repository: `/home/runner/work/route-tracker/route-tracker`

## Scope reviewed

- Application architecture
- Auth/session handling
- Server/API entry points
- Database access and authorization model
- Secrets/config handling
- External network calls
- File handling
- Dangerous patterns (command execution, SQL injection, insecure deserialization, client-side trust, missing authorization)

---

## Architecture and trust boundaries

### Surfaces

1. **Ops Dashboard (React/Vite)**  
   `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/src`
2. **Driver PWA (Vanilla JS)**  
   `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/driver`
3. **Onboard Sign (Vanilla JS)**  
   `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/announce`
4. **Controller relay server (Node + WS)**  
   `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/announce/mele-server`

### Backend components

- Supabase PostgREST + RPC + RLS model in:
  `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql`
- Supabase Edge Functions:
  - `/home/runner/work/route-tracker/route-tracker/supabase/functions/dvsa-vol-lookup/index.ts`
  - `/home/runner/work/route-tracker/route-tracker/supabase/functions/naptan-import/index.ts`
  - `/home/runner/work/route-tracker/route-tracker/supabase/functions/generate-announcement-clip/index.ts`
- Vercel API routes:
  - `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/api/sign-token.js`
  - `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/api/sign-announce-token.js`
  - `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/api/send-duty-email.js`
  - `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/api/directions.js`
  - `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/api/directions-diagnostics.js`

---

## Auth/session handling assessment

- Dashboard uses Supabase auth session flow in app shell (`exchangeCodeForSession`, `getSession`, auth state listener):  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/src/App.jsx:31-57`
- Dashboard login/reset flows call Supabase auth APIs directly:  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/src/features/auth/Login.jsx:18-36`  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/src/features/auth/ResetPassword.jsx:21-27`
- Driver app uses URL token (`?token=`) as bearer for Supabase REST/RPC calls:  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/driver/src/supabaseApi.js:7-19`
- Duty links include token query string:  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/src/features/journeys/DutyCardsPage.jsx:47-50`
- Announce setup stores long-lived tokens in `localStorage`:  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/driver/src/announceLink.js:69-74`  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/announce/src/announceDeviceSetup.js:13-19`

**Observation:** session/JWT models are clear, but some server/API and RPC controls rely on weak gating (detailed in findings).

---

## Server/API entry points assessment

### Vercel API routes

- `sign-token` checks only presence of Authorization header, then signs caller-provided payload (`journey_ids`, `driver_id`):  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/api/sign-token.js:30-40`
- `sign-announce-token` checks only header presence, then signs caller-provided `device_id`, `company_id`, `vehicle_id`:  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/api/sign-announce-token.js:42-53`
- `send-duty-email` checks only header presence, then uses server API key to send email:  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/api/send-duty-email.js:10-11` and `26-40`
- `directions` has no auth and proxies caller data to GraphHopper upstream:  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/api/directions.js:22-46`

### Controller HTTP/WS relay

- Static file serve includes traversal guard (good):  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/announce/mele-server/server.mjs:119-120`
- WS endpoints require shared token (good), but token is static bearer model:  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/announce/mele-server/announceRelay.mjs:53-59`

---

## Database access and authorization model assessment

- Core RLS helpers exist (`current_company_id`, `current_employee_role`, `is_journey_in_progress`, `is_jwt_journey_allowed`):  
  `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:762-868`
- Strong authenticated company-scoped policies exist for many business tables:  
  `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:1986-2120`
- Some anon access is intentionally broad:
  - companies read: `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:1965`
  - routes/timetables/departures/stops read: `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:1964,1966-1969`
  - schedule view grant: `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:2227`
- `schedule_view` is `security_invoker` (good choice for RLS consistency):  
  `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:1894`

**High-risk area:** multiple `SECURITY DEFINER` RPCs are granted to `anon` and mutate state without validating caller claims inside function body (see findings #2).

---

## Secrets/config management assessment

- Public frontend keys are intentionally publishable (expected):  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/src/shared/supabase.js:3-5`  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/driver/src/config.js:30-36`
- Server secrets accessed via env vars in API routes:  
  - `SUPABASE_JWT_SECRET`: `sign-token.js:37`, `sign-announce-token.js:49`
  - `RESEND_API_KEY`: `send-duty-email.js:17`
- Edge functions validate internal bearer token patterns (good):  
  `/home/runner/work/route-tracker/route-tracker/supabase/functions/naptan-import/index.ts:44-47`  
  `/home/runner/work/route-tracker/route-tracker/supabase/functions/generate-announcement-clip/index.ts:67-70`

---

## External network calls

- Driver directions uses public OSRM API:  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/driver/src/directions.js:31-35`
- Dashboard geocoding/search uses Nominatim:
  - `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/src/shared/api/osPlaces.js:4-7`
  - `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/src/features/route-planner/PlannerMap.jsx:97`
- Dashboard map tiles from OSM:  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/src/features/tracking/LiveTracking.jsx:62-63`
- Edge functions call CKAN/OpenCage/Azure:
  - `/home/runner/work/route-tracker/route-tracker/supabase/functions/dvsa-vol-lookup/index.ts:44,61`
  - `/home/runner/work/route-tracker/route-tracker/supabase/functions/naptan-import/index.ts:154-156,181-183`
  - `/home/runner/work/route-tracker/route-tracker/supabase/functions/generate-announcement-clip/index.ts:194-207`

---

## File handling assessment

- Company logo upload/remove via Supabase Storage:
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/src/features/company/CompanyModal.jsx:181-193`
- Storage policies correctly path-scope uploads/deletes to company folder and role:  
  `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:2290-2312`
- Controller static serving has path traversal defense:  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/announce/mele-server/server.mjs:119-120`
- Dev static server lacks equivalent guard (see finding #6):  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/server.js:35-39`

---

## Dangerous pattern review

- **Command execution:** present in dev/demo scripts and controller audio playback. No direct user input to shell found in reviewed runtime paths.
  - Safe process args in audio player:  
    `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/announce/mele-server/audioPlayer.mjs:42`
- **SQL injection:** no clear SQLi in app code reviewed; Supabase client/RPC usage is mostly structured.
- **Insecure deserialization:** JSON parsing is wrapped with try/catch in WS handlers (good):  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/announce/mele-server/announceRelay.mjs:68-74`  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/announce/src/onboard.js:687-691`
- **Client-side trust of user data:** significant in HTML sinks and server routes (findings #1 and #3).
- **Missing authorization checks:** key issue in API routes and anon-granted RPCs (findings #1 and #2).

---

## Prioritized issues and recommended fixes

## 1) CRITICAL — Vercel API routes trust any non-empty Authorization header

**Evidence**
- `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/api/sign-token.js:30-40`
- `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/api/sign-announce-token.js:42-53`
- `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/api/send-duty-email.js:10-11,26-40`

**Risk**
- Unauthorized token minting (duty/device JWTs) and unauthorized email sending/spam.

**Fix**
- Verify bearer token with Supabase auth admin or JWT verification.
- Authorize requested resources against caller identity/company before signing or sending.
- Add rate limiting and audit logging for all three endpoints.

## 2) CRITICAL — `SECURITY DEFINER` RPCs callable by `anon` can mutate arbitrary rows by ID

**Evidence**
- `start_journey`: `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:871-882`
- `complete_journey`: `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:885-896`
- `update_announce_device_state`: `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:1639-1657`
- `end_announce_device_journey`: `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:1667-1683`
- `unlink_announce_device`: `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:1760-1775`

**Risk**
- Unauthorized state changes and denial-of-service if IDs are guessed/obtained.

**Fix**
- Enforce ownership in function body using `auth.jwt()` claim checks (`journey_ids`, `driver_id`, `device_id`, company constraints).
- Minimize anon execute grants; prefer authenticated context where possible.

## 3) HIGH — XSS risk from `innerHTML`/template interpolation with data-derived values

**Evidence**
- `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/driver/src/main.js:924-935`
- `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/driver/src/ui.js:48-52,84`
- `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/driver/src/directions.js:117-123,129-133`
- `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/src/features/journeys/JourneysPage.jsx:214-229,230-265`

**Risk**
- Stored/reflected script execution through stop names, incident metadata, route text, etc.

**Fix**
- Replace dynamic HTML string construction with safe DOM construction + `textContent`.
- If HTML formatting is unavoidable, sanitize with strict allowlist.

## 4) HIGH — Long-lived or URL-exposed bearer tokens increase compromise window

**Evidence**
- 100-year announce JWT lifetime:  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/api/sign-announce-token.js:18,30`
- Duty token in URL:
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/src/features/journeys/DutyCardsPage.jsx:47-50`
- Driver token consumed from query and used as bearer:
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/driver/src/supabaseApi.js:7-19`

**Risk**
- Token leakage via URL logs/history/screenshots/XSS with long-term replay value.

**Fix**
- Use short-lived tokens and rotation/revocation.
- Exchange one-time URL code for short session token; strip URL immediately after consumption.
- Prefer non-persistent storage for sensitive tokens where practical.

## 5) MEDIUM — Broad anon reads and unconstrained anon insert create data exposure/spam surface

**Evidence**
- `companies` anon read `using (true)`:  
  `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:1965`
- Broad anon read grants on route/timetable structures:
  `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:1964,1966-1969,2227`
- `announcement_coverage_gap` anon insert `with check (true)`:
  `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:1882-1886`

**Risk**
- Unnecessary data scraping and table pollution by anonymous clients.

**Fix**
- Restrict anon reads to strictly required fields via RPC/view.
- Add claim-based checks and/or server-side mediated write path for anon insert.
- Add write throttling and cleanup/abuse detection.

## 6) LOW — Dev static server missing path traversal mitigation

**Evidence**
- `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/server.js:35-39`

**Risk**
- If accidentally exposed outside local dev, path traversal could read unintended files.

**Fix**
- Add `path.resolve` + root prefix validation (same pattern already used in controller server).

---

## Positive controls worth keeping

- `schedule_view` uses `security_invoker`:  
  `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql:1894`
- Controller static serving path traversal guard exists:  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/announce/mele-server/server.mjs:119-120`
- WS message JSON parsing is defensive with parse failure handling:  
  `/home/runner/work/route-tracker/route-tracker/pcv-dashboard/busops/announce/mele-server/announceRelay.mjs:68-74`

---

## Suggested remediation order

1. Lock down Vercel API route authZ/authN (`sign-token`, `sign-announce-token`, `send-duty-email`).
2. Add claim checks inside anon-callable `SECURITY DEFINER` RPCs and reduce anon grants.
3. Remove unsafe `innerHTML`/template write paths.
4. Reduce token lifetime and URL token exposure.
5. Tighten anon RLS policies where not operationally required.
6. Harden dev static server path handling.
