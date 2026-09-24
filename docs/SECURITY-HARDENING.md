# Security hardening ledger

Started 2026-09-23 from a full scan of `origin/develop` (`03d5dee`) plus the Supabase security
advisors on both projects. This file is the single place that says what is fixed, what is only
fixed on dev, and what is still open. Update it in the same PR as any change that moves an item.

Status words are literal: **Live** = verified on production. **Dev only** = applied and tested on
dev, not yet on production. **In PR** = code merged nowhere yet. **Open** = nothing done.

## Framework (four steps)

1. Identity: replace/scope static secrets and tokens.
2. Network: segment edge / compute / data, default-deny ingress, restrict egress.
3. Supply chain: dependency and secret scanning that blocks a PR.
4. Logging: central, tamper-resistant security logs.

This stack has no IAM/VPC/CloudTrail (Supabase + Vercel + Cloudflare + a bus Controller + one
Hetzner VPS), so each step is mapped onto what actually exists below.

## Findings

| # | Finding | Sev | Status |
|---|---|---|---|
| 0 | Supabase Auth signup is open on dev **and** prod (dev also auto-confirms email), so anyone is an `authenticated` user. Amplifies every item below. | High | **Open: owner decision** (disable signup in Auth settings; users are then created by invite) |
| 1 | `generate_duty_token()` RPC signed JWTs for any journey ids with no ownership check | High | **Live** 2026-09-24 (dropped; unused, `/api/sign-token` is the real path) |
| 2 | `stops` INSERT/UPDATE open to any authenticated user; `stops.name`/`announcement_name` drive spoken PSVAIR clips | High | **Live** 2026-09-24 (INSERT needs ops role; no client UPDATE). **Known gap:** any company's ops user can still insert a stop (stops are global) |
| 2b | `journey_types` / `term_dates` writable by any authenticated user (term dates control which school departures run) | High | **Live** 2026-09-24 (read-only) |
| 2c | **Prod-only drift:** extra `anon_upload_stop_times` policy bypassed JWT scoping on `journey_stop_times`; exists in no repo file | High | **Live** 2026-09-24 (dropped on prod; dev never had it) |
| 3 | Claim-less anon key passes every `is_jwt_*_allowed()` check (documented compat tradeoff) | High | **Open** (needs a date to retire the legacy no-token flow) |
| 4 | No security headers on Vercel or Cloudflare | Med | In PR (`vercel.json`, `busops/_headers`). CSP is Report-Only on purpose; see below |
| 5 | `/api/directions` open proxy; `/api/directions-diagnostics` open, leaks env var names/host | Med | In PR (auth required, waypoint cap, coordinate validation) |
| 6 | `send-duty-email`: unvalidated `url` (phishing link from company sender), spoofable From name | Med | In PR |
| 7 | `announcement_coverage_gap` anon insert was `with check (true)` | Med | **Live** 2026-09-24 (scoped by `is_jwt_journey_allowed`; still passes for a claim-less key, see #3) |
| 8 | Controller relay: token in query string, non-constant-time compare, binds 0.0.0.0, one fleet-wide token | Med | **Open** |
| 9 | Announce device tokens live 100 years; revocation is SQL-only; `sign-announce-token` does not verify `vehicle_id` belongs to the company | Med | **Open** |
| 10 | Dependencies: `ws` high, `sharp`/`wrangler`/`js-yaml`/`browserslist` high, `react-router` moderate | Med | In PR (`npm audit fix`; all HIGH cleared). Remaining moderates need breaking majors: `react-router` (SSR/hydration + link redirect; this is a client-side SPA) and `vitest` (dev-only) |
| 11 | Anon-executable `SECURITY DEFINER` helpers / trigger function via `/rest/v1/rpc` | Low-Med | **Live** 2026-09-24 for `current_company_id`, `current_employee_role`, `fn_naptan_import_on_county_change`; the `is_jwt_*` helpers must stay anon-callable |
| 12 | 30 live functions have a mutable `search_path` (schema.sql sets it for some, so live DB has drifted) | Low-Med | **Open** (needs per-function testing; do not bulk-alter blind) |
| 13 | Leaked-password protection off (both projects) | Low | **Open** (Auth dashboard toggle) |
| 14 | `mele-server` has no lockfile, so the Controller's `npm install` is unpinned and unauditable | Low-Med | **Open** |
| 15 | Edge Function bearer comparisons not constant-time | Low | **Open** |
| 16 | `companies` is fully anon-readable (licence no., email, address) | Low | **Open** (decide what the driver PWA and sign genuinely need, then column-grant) |

## Step 3 (supply chain): in PR
`.github/workflows/ci.yml` now has a `supply-chain` job (npm audit at high+, Trivy vuln + secret
scan at HIGH/CRITICAL) that both deploy jobs wait on. Third-party actions are pinned to commit
SHAs and the workflow token is `contents: read`. Not done: Dependabot config, pinning the two
`wrangler deploy` steps, per-job permissions if a job later needs to write.

## Step 1 (identity): plan
- `SUPABASE_JWT_SECRET` is one symmetric secret that mints every duty/announce token. Highest
  value item: move to Supabase asymmetric signing keys, or at minimum keep signing server-side.
- Split the shared `AZURE_SPEECH_KEY` (dev and prod share one today) and rotate.
- `naptan_import_token` / `CALLER_AUTH_TOKEN` are the legacy service-role JWT. Replace with a
  purpose-specific secret so a leak of the cron token is not a leak of the service role.
- Scope `CLOUDFLARE_API_TOKEN` to Workers deploy on the one account/Worker; scope the Resend key
  to sending on one domain. (Both need checking in their dashboards; not verifiable from here.)
- Per-device `DRIVER_PUSH_TOKEN` instead of one for the fleet.

## Step 2 (network): plan
No private network exists to segment; the boundary is RLS + grants + exposed schemas.
Actionable: Vercel firewall/rate limits and Cloudflare WAF rules, Supabase network restrictions on
the direct Postgres port, default-deny inbound on the Hetzner GraphHopper VPS, and verify ufw and
hotspot-only binding on the Controller.

## Step 4 (logging): plan
Supabase log retention is short and there is no CloudTrail equivalent. Options: Vercel log drains,
Cloudflare Logpush (paid), an app-level `security_events` table (token minting, device pairing and
revocation, stop edits) and an object-locked bucket for immutability. This has a running cost, so
it is a proportionality decision for the owner.

## CSP
`Content-Security-Policy-Report-Only` is set on both surfaces, not enforced. BusOps Announce's sign
connects to the Bus Controller over `ws://` on the local network, so an enforced strict
`connect-src` could blank a bus display. Browse both apps with the console open, fix real
violations, then switch the header name to `Content-Security-Policy`.

## Applying the DB migration to production: done
`supabase/migration_security_hardening_phase0.sql` is applied on **dev** (tested by
`supabase/tests/security_hardening_phase0_rls.sql`) and on **production** (2026-09-24, run by the
owner in the Supabase SQL Editor). Verified on production afterwards against `pg_policies`,
function ACLs and table grants: `anon_upload_stop_times` gone, `stops.ops_insert` in place with no
UPDATE policy, `journey_types`/`term_dates` read-only, `generate_duty_token` dropped, the coverage-gap
insert scoped, and the three helpers no longer anon-executable. The only production login is an
ops manager, so dashboard stop creation still works.

Small follow-up noticed while verifying: `authenticated` still holds `TRUNCATE` (and `REFERENCES`,
`TRIGGER`) on `journey_types`/`term_dates`, as on most tables via Supabase's default grants.
`TRUNCATE` bypasses RLS, but PostgREST does not expose it, so it is only reachable with a direct
database login. Worth a schema-wide `revoke truncate ... from anon, authenticated` in a later phase.

Test gap to know about: the "driver-level employee cannot insert a stop" block skips when the DB
has no driver with a linked login (dev has none), so that one path was not exercised on dev.
