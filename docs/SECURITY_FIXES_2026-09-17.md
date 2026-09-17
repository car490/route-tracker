# Security Fixes — issue/fix worklist for `docs/SECURITY_REVIEW_2026-09-17.md`

Source report: `docs/SECURITY_REVIEW_2026-09-17.md` (merged to `develop` in PR #56,
commit `cae7d55`). Each item below was independently re-verified against the current
`origin/develop` source (line numbers may drift a little from the original report but
point at the same code) before a fix was proposed — do not re-litigate whether the
finding is real, only how to close it.

Work items are independent and can be picked up in any order except where a
"Depends on" note says otherwise. Each item is scoped to one vertical slice /
surface so it can be assigned and reviewed separately. **Write the failing
test first for every item** (TDD), then implement.

Governance for whoever picks these up:
- Apply any SQL fix to the dev Supabase project (`cgcbfgceputvdvhzrgio`) first, confirm
  with the accompanying test, then apply the same migration to production
  (`nwhayupsvcelyiwltdqo`) per `CLAUDE.md` → "DB migrations".
- New migration files go in `supabase/migration_<description>.sql` (flat naming, not the
  abandoned `supabase/migrations/` timestamp folder) and must also be folded into
  `supabase/schema.sql` so a fresh reset stays in sync.
- Don't widen scope beyond the fix described — no refactors, no unrelated cleanup.

---

## Item 1 — CRITICAL: Vercel API routes accept any non-empty `Authorization` header

**Files:** `pcv-dashboard/api/sign-token.js`, `pcv-dashboard/api/sign-announce-token.js`,
`pcv-dashboard/api/send-duty-email.js`

**Issue:** All three handlers do only:
```js
const authHeader = req.headers['authorization']
if (!authHeader) return res.status(401).json({ error: 'Unauthorized' })
```
This never verifies the header is a real Supabase session token — any string
(`Authorization: x`) passes. Once past that check, the caller-supplied body is trusted
outright:
- `sign-token.js` mints a driver duty-card JWT for **any** `journey_ids`/`driver_id` the
  caller names, valid 24h.
- `sign-announce-token.js` mints a **100-year** device JWT for any `device_id`/`company_id`
  the caller names.
- `send-duty-email.js` sends an email via Resend to any `to` address the caller names,
  using the server's paid API key.

**Impact:** anyone who can reach these endpoints (they're public Vercel functions) can
mint valid long-lived credentials for journeys/devices they don't own, or use the
project's email budget as an open relay.

**Fix:**
1. Verify the bearer token is a real, current Supabase session before touching the body:
   ```js
   import { createClient } from '@supabase/supabase-js'
   const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
   const token = authHeader?.replace(/^Bearer\s+/i, '')
   const { data: { user }, error } = await supabase.auth.getUser(token)
   if (error || !user) return res.status(401).json({ error: 'Unauthorized' })
   ```
2. Authorize the specific resource against that user's own company, not just "logged in":
   - `sign-token.js`: look up the caller's `employees` row (by `auth_user_id = user.id`) to
     get their `company_id`, then confirm every id in `journey_ids` belongs to a `journeys`
     row with that `company_id` (reject the whole request if any doesn't). Confirm
     `driver_id` is an employee in the same company.
   - `sign-announce-token.js`: confirm the caller's `company_id` equals the requested
     `company_id`, and that `device_id` (if present) belongs to an `announce_devices` row
     with that `company_id`.
   - `send-duty-email.js`: confirm the caller's company owns the journey/driver the duty
     card `url` refers to before sending.
3. Add basic per-caller rate limiting (a Supabase table with a unique constraint on
   `(user_id, minute_bucket)` is enough — Vercel functions are stateless, so an in-memory
   limiter won't work across invocations) and log each call (`user.id`, resource ids,
   timestamp) for audit.

**Additional finding surfaced while fixing this file (not in the original report):**
`send-duty-email.js` interpolates `driver_name`, `company_name`/`sender`, and `url`
directly into the email's HTML body with no escaping (lines 33-34). Since `driver_name`
and `company_name` are operator-entered data, this is HTML injection into an email a real
driver receives. Escape all three the same way `main.js`'s `notesHtml` already does
(`&`/`<`/`>` entity-encode) before interpolating.

**Tests to add first:**
- `pcv-dashboard/api/sign-token.test.js` (new): request with a bogus header → 401; request
  with a valid session for company A naming a journey belonging to company B → 403/error,
  no token returned.
- Equivalent tests for `sign-announce-token.js` and `send-duty-email.js`.

---

## Item 2 — CRITICAL: anon-callable `SECURITY DEFINER` RPCs don't check ownership

**File:** `supabase/schema.sql`

**Issue:** `start_journey(p_journey_id)`, `complete_journey(p_journey_id)`,
`update_announce_device_state(p_device_id, ...)`, `end_announce_device_journey(p_device_id)`,
and `unlink_announce_device(p_device_id)` are all `security definer`, granted to `anon`,
and mutate the row matching the id parameter with **no check that the caller is entitled to
that id** — the id is just trusted from the request body. This is despite the codebase
already having the right pattern twice over:
- `is_jwt_journey_allowed(j_id)` exists specifically to check a journey id against the
  caller's `journey_ids` JWT claim, but `start_journey`/`complete_journey` don't call it.
- `report_device_heartbeat()` derives `device_id` from `auth.jwt()->>'device_id'` instead
  of trusting a parameter — the three announce-device RPCs above don't follow that
  precedent because, per their own comments, they're called *by the driver device*, whose
  JWT carries `journey_ids`, not `device_id`.

**Impact:** any anon-key holder who knows or guesses a `journey_id`/`device_id` (both plain
UUIDs, and `journey_id`s are visible in duty-card URLs today per Item 4) can start/complete
someone else's journey, or blank/unlink someone else's Announce device — a straightforward
denial-of-service against another company's live service.

**Fix (SQL migration, `supabase/migration_harden_anon_rpc_ownership.sql`, mirrored into
`schema.sql`):**
1. `start_journey`/`complete_journey`: add the existing check at the top of the function
   body:
   ```sql
   if not is_jwt_journey_allowed(p_journey_id) then
     raise exception 'journey % not permitted for this token', p_journey_id;
   end if;
   ```
   This is a no-op for the legacy/manual-selection anon key (no `journey_ids` claim →
   `is_jwt_journey_allowed` already returns true), so it doesn't break that flow — it only
   closes the gap for tokens that *do* carry a `journey_ids` claim.
2. `update_announce_device_state`, `end_announce_device_journey`, `unlink_announce_device`:
   these are called by the *driver* token, which carries `journey_ids` not `device_id`, so
   `report_device_heartbeat`'s claim-substitution pattern doesn't directly apply. Add a new
   helper next to `is_jwt_journey_allowed` and call it from all three:
   ```sql
   -- True when p_device_id's vehicle is the vehicle of one of the caller's journey_ids,
   -- or when the caller's token carries no journey_ids claim (legacy anon key).
   create or replace function is_jwt_device_allowed(p_device_id uuid)
   returns boolean
   language sql stable security definer
   as $$
     select
       auth.jwt()->>'journey_ids' is null
       or exists (
         select 1
         from public.announce_devices d
         join public.journeys j on j.vehicle_id = d.vehicle_id
         where d.id = p_device_id
           and j.id = any(
             array(select jsonb_array_elements_text(auth.jwt()->'journey_ids'))::uuid[]
           )
       )
   $$;

   grant execute on function is_jwt_device_allowed(uuid) to anon;
   ```
   then guard each of the three functions the same way as step 1, using
   `is_jwt_device_allowed(p_device_id)`.

**Depends on:** none, but pairs naturally with Item 4 (shorter-lived/less-guessable ids
reduce how exploitable this stays even after the ownership check lands).

**Tests to add first:** `supabase/tests/rpc_ownership_rls.sql` (new, following the existing
`supabase/tests/*_rls.sql` pattern) — as a token scoped to journey A's `journey_ids`, call
`start_journey`/`complete_journey`/the three device RPCs against journey/device B and assert
they raise/return false; assert they still succeed for journey/device A; assert a
legacy-shaped anon token (no `journey_ids` claim) still works for both, matching current
manual-selection behaviour.

---

## Item 3 — HIGH: unescaped data interpolated into `innerHTML`

**Files:** `pcv-dashboard/busops/driver/src/main.js` (duty-card rendering),
`pcv-dashboard/busops/driver/src/ui.js` (`renderLog`/stop-list rows),
`pcv-dashboard/busops/driver/src/directions.js` (turn-by-turn panel),
`pcv-dashboard/src/features/journeys/JourneysPage.jsx` (printable journey report)

**Issue:** Operator-entered/database-sourced strings (`stop.name`, `j.service_code`,
`j.timetable_name`, `j.vehicle_registration`, `toStop.name`, `step.name`, incident
`metadata.description`/`category`/`near_stop`, driver/vehicle names) are written straight
into `innerHTML`/template-literal HTML with no escaping. `main.js`'s own `notesHtml` already
shows the fix pattern exists in the same file (`.replace(/&/g,'&amp;')...`) but isn't
applied consistently.

**Impact:** any of these fields being set to a `<script>`/`<img onerror=...>` payload
(e.g. a NaPTAN-imported stop name, an admin-entered incident description, a vehicle
registration typed in the dashboard) executes in the driver PWA or dashboard context —
stored XSS, not requiring the attacker to be a normal end user of the PWA itself.

**Fix:**
1. Add one small shared escaping helper rather than repeating the four-way `.replace`
   inline (it already exists ad hoc in `main.js` — promote it):
   - PWA-side: `pcv-dashboard/busops/shared/escapeHtml.js` (new, tiny, no deps) exporting
     `escapeHtml(str)`; import it in `main.js`, `ui.js`, `directions.js`.
   - Dashboard-side: same helper (or reuse `pcv-dashboard/src/shared/` if an equivalent
     already exists — check before adding a duplicate) imported into `JourneysPage.jsx`.
2. Wrap every data-derived value listed above with `escapeHtml(...)` at the point it's
   interpolated. Static/hardcoded markup (`<button class="...">`) does not need escaping —
   only values that originate from the DB or user input.
3. Prefer converting to `textContent`/DOM node construction over `innerHTML` where the
   surrounding markup is simple enough (e.g. `ui.js`'s `renderLog` rows) — escaping is the
   minimum fix, DOM construction is the more robust one; use judgement per call site rather
   than a blanket rewrite.

**Tests to add first:** for each touched render function, a test that passes a stop/route
name containing `<img src=x onerror=alert(1)>` and asserts the rendered DOM has no
`<img>` element / the text renders literally (Vitest + `jsdom`, co-located per the PWA's
`driver/src/*.test.js` convention; dashboard side follows its own existing
`JourneysPage`-adjacent test conventions if any exist, otherwise co-located Vitest).

---

## Item 4 — HIGH: long-lived / URL-exposed bearer tokens

**Files:** `pcv-dashboard/api/sign-announce-token.js` (100-year device JWT),
`pcv-dashboard/src/features/journeys/DutyCardsPage.jsx` (duty token in URL query string),
`pcv-dashboard/busops/driver/src/supabaseApi.js` (driver token read from URL and used as
bearer)

**Issue:**
- The announce device token intentionally never expires in practice (100-year `exp`) — the
  code comment explains this is because Supabase Realtime rejects a token with no `exp` at
  all, not that a 100-year lifetime was the intended tradeoff.
- Duty-card links carry the driver's 24h bearer token in the URL query string
  (`?token=...`), which lands in browser history, proxy/server access logs, and anywhere
  the link is shared (e.g. pasted into a message).

**Impact:** a leaked device token is a permanent credential with no practical
revocation path short of rotating the shared `SUPABASE_JWT_SECRET` (which invalidates
every token, not just one). A leaked duty-card URL grants 24h of that driver's journey
access to whoever sees the link/log entry.

**Fix (scoped — don't try to solve full token rotation as part of this pass):**
1. Add a `revoked_at`/`token_version` column to `announce_devices` (nullable timestamp or
   incrementing int) and check it in `is_jwt_device_allowed` (Item 2) /
   `device_self`'s RLS policy so an operator can invalidate one device's token from the
   dashboard without rotating the shared secret for everyone else. This turns "100-year
   token" into "100-year token, individually revocable" — the pragmatic fix given Realtime's
   hard `exp` requirement documented in the code comment.
2. For duty-card links: on load, `DutyCardsPage`'s consumer (the driver PWA) should read
   the token from the URL once, exchange it into `sessionStorage` (not `localStorage` —
   session-scoped, cleared on tab close), and immediately replace the URL via
   `history.replaceState` to strip the `?token=` query string so it never lands in browser
   history past that first load. Keep the token's 24h server-side lifetime as-is; this fix
   is about reducing where the token value ends up, not shortening it further (a duty card
   genuinely needs to work for the whole shift).

**Depends on:** Item 2's `is_jwt_device_allowed` helper is a natural place to also check the
new revocation column, so land Item 2 first if both are picked up together — not a hard
blocker if done separately.

**Tests to add first:** a dashboard test that revoking a device (setting `revoked_at`) makes
a previously-valid device token fail the `device_self` RLS check; a PWA test that after
`main.js`'s URL-token consumption, `location.search` no longer contains `token=`.

---

## Item 5 — MEDIUM: broad anon reads + unconstrained anon insert

**File:** `supabase/schema.sql`

**Issue:** `companies`, `routes`, `timetables`, `timetable_departures`, `timetable_stops`,
`stops`, and `schedule_view` are all anon-readable with `using (true)` / a blanket
`grant select ... to anon` — deliberate, since the driver PWA has no login (see CLAUDE.md).
Separately, `announcement_coverage_gap` accepts anon inserts with `with check (true)` — no
constraint tying the inserted row to a real vehicle/device.

**Impact:** the broad reads are an accepted, documented tradeoff (no-login PWA) and are
**not** being asked to change here — re-litigating that would contradict CLAUDE.md's
"anon: read-only access to schedule data" design. The one concrete gap is the
`announcement_coverage_gap` anon insert: any anon-key holder can flood that table with
arbitrary rows (any `vehicle_id`/`device_id`, real or not), since nothing checks the ids
exist or belong to anything.

**Fix:** narrow the anon insert policy to require the referenced id actually exists:
```sql
create policy "announcement_coverage_gap_anon_insert"
  on public.announcement_coverage_gap
  for insert
  to anon
  with check (
    (vehicle_id is not null and vehicle_id in (select id from public.vehicles))
    or
    (device_id is not null and device_id in (select id from public.announce_devices))
  );
```
This still allows any anon caller to log a gap (needed — that's the whole point of the
table, an unauthenticated PWA reporting a missing clip), but stops it accepting rows for
ids that don't exist, which is the cheap part of the abuse surface. Add a periodic cleanup
job (or a `created_at` retention query in the existing ops tooling) if unbounded row growth
from a misbehaving-but-real device becomes a problem — out of scope for this pass, just
flagging it per the original report's suggestion.

**Tests to add first:** `supabase/tests/announcement_coverage_gap_rls.sql` — anon insert
with a real `vehicle_id` succeeds; anon insert with a random UUID `vehicle_id` is rejected.

---

## Item 6 — LOW: dev static server has no path-traversal guard

**File:** `pcv-dashboard/busops/server.js`

**Issue:** `filePath = path.join(__dirname, urlPath)` is passed straight to `fs.readFile`
with no check that the resolved path stays under `__dirname`. `busops/announce/mele-server/server.mjs`
already has the right guard for its own static serving (referenced in the report) — this
file doesn't.

**Impact:** low in practice (this is the local-only dev server per CLAUDE.md, `node
server.js` on `localhost:8080`, never the production path — GitHub Pages/Cloudflare Workers
serve production), but a `..`-laden request could read arbitrary files if this were ever
exposed beyond localhost by accident.

**Fix:** mirror the existing guard from `mele-server/server.mjs:119-120`:
```js
const filePath = path.join(__dirname, urlPath);
const root = path.resolve(__dirname);
if (!path.resolve(filePath).startsWith(root + path.sep)) {
  res.writeHead(403); res.end('Forbidden'); return;
}
```
Place this check immediately after the existing `filePath` computation, before the
`fs.readFile` call.

**Tests to add first:** a test hitting the server with `GET /../../../../etc/passwd`-style
paths (URL-encoded, since raw `..` may not survive `req.url` unchanged — test both) and
asserting a 403/404 rather than file contents.

---

## Suggested pick-up order

Matches the original report's remediation order, since the risk ranking still holds after
verification: **1 → 2 → 3 → 4 → 5 → 6**. Items 1-3 are the ones with a real, demonstrated
exploit path today; 4-6 are hardening.
