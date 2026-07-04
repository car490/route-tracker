# RouteTracker — Claude Code instructions

## Project overview
Real-time bus route timing PWA for Phil Haines Coaches drivers, plus an ops back-office dashboard.
- **Driver PWA**: `route-tracker/public/` (vanilla JS, deployed to GitHub Pages)
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
