# RouteTracker — Claude Code instructions

## Project overview
Real-time bus route timing PWA for Phil Haines Coaches drivers, plus an ops back-office dashboard.
- **Driver PWA**: `route-tracker/public/` (vanilla JS, deployed to GitHub Pages)
- **Ops dashboard**: `route-tracker/dashboard/` (React + Vite, deployed to Vercel)
- **Supabase backend**: schema at `route-tracker/supabase/schema.sql`

See memory files for full project state, deploy URLs, and phase roadmap.

---

## Supabase: table creation rules

**Every `CREATE TABLE` must be immediately followed by explicit GRANT statements.**

From 2026-05-30, Supabase no longer auto-grants new tables to the Data API. Any table
created without a GRANT is invisible to supabase-js, PostgREST, and the driver PWA.
`ALTER DEFAULT PRIVILEGES` is set on the live DB as a safety net, but explicit GRANTs
are still required in every migration file for clarity and correctness on fresh resets.

### Standard pattern (authenticated-only table)
```sql
create table public.my_table ( ... );

grant select on public.my_table to anon;
grant all    on public.my_table to authenticated;
```

### When anon also needs INSERT (e.g. PWA writes without a login session)
```sql
create table public.my_table ( ... );

grant select        on public.my_table to anon;
grant insert        on public.my_table to anon;        -- RLS controls which rows
grant all           on public.my_table to authenticated;
```

Always follow the GRANT with the appropriate RLS policy. GRANT gives table-level
access; RLS restricts it to the correct rows.

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

- The Git repo root is `route-tracker/` — **not** `route-tracker/public/`.
- PWA source files live in `route-tracker/public/`; before committing, copy changed
  files to the repo root (e.g. `index.html`, `src/`, `sw.js`).
- Dashboard is a separate Vite project in `route-tracker/dashboard/`; Vercel deploys
  from that directory automatically on push.
- `.git` persists between sessions — no need to re-init.

---

## Architecture

- **Dashboard**: Vertical Slice Architecture — feature folders (`features/staff/`,
  `features/journeys/`, etc.) with shared Supabase client in `shared/` or `lib/`.
  Introduce VSA alongside the first Phase 4 slice, not as a standalone refactor.
- **PWA**: file-per-concern (no VSA); keep it flat and simple.
- `staff.name` is a **single field** — never `first_name`/`last_name`.
- `stops` are **global** (no `company_id`); `stop_type` lives on `timetable_stops`.
- OSRM directions must use **scheduled stop coordinates**, never live GPS position.
