# RouteTracker — Claude Code instructions

## Project overview
Real-time bus route timing PWA for Phil Haines Coaches drivers, plus an ops back-office dashboard.
- **Driver PWA**: `route-tracker/src/` (vanilla JS, no build step, deployed to GitHub Pages
  directly from the repo root — `index.html` loads `src/main.js`)
- **Ops dashboard**: `route-tracker/dashboard/` (React + Vite, deployed to Vercel)
- **Supabase backend**: schema at `route-tracker/supabase/schema.sql`

See memory files for full project state, deploy URLs, and phase roadmap.

---

## Supabase: table creation rules

**Every `CREATE TABLE` must have GRANT statements, RLS enable, and RLS policies.** Tables without explicit GRANTs are invisible to supabase-js/PostgREST (changed 2026-05-30). RLS must be enabled on every table.

**Important ordering rule**: If a policy references a helper function (`current_company_id()`, `current_employee_role()`, etc.), the policy **must** come after the function definition. Put simple `using (true)` policies inline with the table. Defer any policy that calls a helper to the main RLS block at the bottom of the file (after all helper functions). Add a comment `-- RLS policy added after helper functions below` as a placeholder.

### Standard pattern (authenticated-only table)
```sql
create table public.my_table ( ... );

grant select on public.my_table to anon;
grant all    on public.my_table to authenticated;

alter table public.my_table enable row level security;

create policy "company_all" on public.my_table
  for all to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());
```

### When anon also needs INSERT (e.g. PWA writes without a login session)
```sql
create table public.my_table ( ... );

grant select on public.my_table to anon;
grant insert on public.my_table to anon;
grant all    on public.my_table to authenticated;
```

Always follow GRANTs with the appropriate RLS policy.

---

## Supabase: schema.sql hygiene

- `route-tracker/supabase/schema.sql` is the authoritative full schema. Every new table
  and function must be added here so a fresh DB reset needs only `schema.sql + seed.sql`.
- Migration files (e.g. `migration_*.sql`) are applied on top of schema.sql for
  incremental changes to the live DB. Keep them so there is an audit trail.
- Helper functions called by RLS policies must be defined **before** the policies that
  use them — order matters in a single-pass SQL script.
- Use `SECURITY DEFINER` on any function called from an anon RLS policy so the function
  runs with the permissions of its owner, not the anon role.

---

## Git / deploy workflow

### Branches
- `develop` — all active development; **always start here**
- `main` — production; merge from `develop` only when tested and approved

### Environments
| Layer | Develop | Production |
|---|---|---|
| **Dashboard** | Vercel preview URL (auto on every push to `develop`) | `route-tracker-iota.vercel.app` (auto on merge to `main`) |
| **PWA** | Local server (`server.js`) — hits dev Supabase automatically | GitHub Pages (deploy from `main`) |
| **Supabase** | `cgcbfgceputvdvhzrgio` (`route-tracker-dev`) | `nwhayupsvcelyiwltdqo` (production) |

### Environment switching
- **Dashboard**: `dashboard/.env.development` holds dev Supabase URL/key; Vite's dev server picks
  it up automatically. Vercel production build ignores this file and uses Vercel's own env vars.
- **PWA**: `src/main.js` detects `localhost`/`127.0.0.1` at runtime and switches Supabase project.
  No build step needed.

### Starting Dev (Local)
`node scripts/dev-all.mjs` starts all three local services in one terminal:
driver PWA (`server.js`, :8080), dashboard dev server (`dashboard/`, :5173), and
local GraphHopper (`graphhopper/`, :8989). It kills anything already bound to
those ports first, so it's always safe to re-run after a crashed process —
no manual cleanup needed. Ctrl-C stops all three together.

### Committing
- Commit at logical checkpoints — when a feature or fix is complete and working.
- Always commit before applying a DB migration.
- Always commit at end of session, even if WIP (prefix message with `wip:`).
- The Git repo root is `route-tracker/` — **not** `route-tracker/public/`.
- PWA source files live in `route-tracker/public/`; before committing, copy changed
  files to the repo root (e.g. `index.html`, `src/`, `sw.js`).
- Dashboard is a separate Vite project in `route-tracker/dashboard/`; Vercel deploys
  from that directory automatically on push.
- `.git` persists between sessions — no need to re-init.

### DB migrations
- Apply to **dev** first via MCP plugin (project ID `cgcbfgceputvdvhzrgio`).
- After testing, apply the same migration to **production** (project ID `nwhayupsvcelyiwltdqo`).
- Keep migration files in `supabase/` for audit trail.
- Update `supabase/schema.sql` so a fresh reset only needs `schema.sql + seed.sql`.

### Release / versioning
One version number covers the whole solution (PWA + dashboard) — they release
together on the `develop` → `master` merge. Source of truth is the root
`VERSION` file.
- When merging `develop` → `master`, run `node scripts/release.mjs <major|minor|patch>`.
  This bumps `VERSION`, `dashboard/package.json`, the `service-worker.js`
  `CACHE_NAME`, and the version footer in `index.html`, and stamps a new
  `CHANGELOG.md` entry from the commits since the last tag.
- Review/tidy the auto-generated `CHANGELOG.md` entry, then commit, `git tag vX.Y.Z`,
  and push (`git push && git push --tags`).
- The dashboard reads `VERSION` at build time via Vite `define` (`__APP_VERSION__`
  in `vite.config.js`) and shows it in the sidebar footer. The PWA version is a
  plain string in `index.html`'s footer `<p>`, kept in sync by the release script.
- To check what's actually deployed where without guessing: `git tag --sort=-creatordate`
  for release history, and `git log origin/master..origin/develop` to see what's
  pending release.

---

## Architecture

- **Dashboard**: Vertical Slice Architecture — feature folders (`features/staff/`,
  `features/journeys/`, etc.) with shared Supabase client in `shared/` or `lib/`.
  Introduce VSA alongside the first Phase 4 slice, not as a standalone refactor.
- **PWA**: file-per-concern (no VSA); keep it flat and simple.
- `staff.name` is a **single field** — never `first_name`/`last_name`.
- `stops` are **global** (no `company_id`); `stop_type` lives on `timetable_stops`.
- OSRM directions must use **scheduled stop coordinates**, never live GPS position.

### Public client config (PWA)
The PWA has no build step, so there's no env-var injection like Vite's — all
dev/prod Supabase URLs and keys live in `src/config.js`, never inline in
`main.js` or elsewhere. Only ever put **anon/publishable** keys there — they
carry no privileges on their own (RLS policies are what actually gate access),
so they're safe to commit and ship to every browser regardless of where they
live in source. A `service_role` key or `SUPABASE_JWT_SECRET` must **never**
appear here — those are read from `process.env` on a server only (see
`dashboard/api/*.js` for that pattern on the dashboard side).

---

## PSVAIR announcement audio

Live `speechSynthesis` voice quality varies by device/OS and can sound
digital. The primary announcement path is now **pre-rendered Azure Neural
TTS clips**, generated offline and played back as audio files; live
`speechSynthesis` (`src/announcements.js`) is kept only as the fallback for
a clip that isn't rendered/cached yet.

- Every announcement sentence has exactly one variable slot (a stop name, or
  a service+destination pair) — so clips are rendered **per stop** and **per
  service/destination**, not per route-leg. Keyed by `stops.id` (global,
  reused across every route/timetable that visits that stop), never by
  `timetable_stop_id`.
- `schedule_view` (and `src/schedule.json`) carry `stop_id` for exactly this
  reason — if you add a column to `schedule_view`, it must go at the **end**
  of the select list (`CREATE OR REPLACE VIEW` requires existing columns to
  keep their name/order/type).
- Regenerate after any stop rename or route change, in this order:
  1. Apply any pending `schedule_view` migration to Supabase.
  2. `node scripts/generate-schedule.mjs` (refreshes `src/schedule.json`,
     including `stop_id`).
  3. `AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=... npm run generate:audio`
     (writes clips + `audio/announcements/manifest.json`; skips any clip
     whose text hash hasn't changed).
- Requires an Azure AI Speech resource (key + region, e.g. `uksouth`).
  These are **build-time secrets** for a script run locally — never commit
  them, never put them in `src/config.js` (that file is public/client-only).
  Optional `AZURE_SPEECH_VOICE` overrides the default (`en-GB-SoniaNeural`).
- `service-worker.js` precaches every clip listed in
  `audio/announcements/manifest.json` on install, so announcements still
  work offline mid-route.
- The clip-key slug logic in `src/announcements.js` (`slug()`) must stay
  identical to the one in `scripts/generate-announcement-audio.mjs` — they
  independently compute the same filename from the same `serviceCode`/
  `destination` text, there's no shared import between a browser module and
  a Node script here.
