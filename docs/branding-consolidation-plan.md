# Branding consolidation plan

## Problem

Branding assets (logos, brand colours, and the operator's name text) live in five
different places with no single source of truth, and two of those places actively
disagree with each other:

1. **Two logo storage buckets in play for the same field.** `companies.logo_path`
   is documented (`supabase/schema.sql:42`) as living in `operator-assets`, and
   `dashboard/src/features/settings/BrandingPage.jsx` writes there. But
   `dashboard/src/shared/components/Layout.jsx:115` and
   `dashboard/src/features/company/CompanyModal.jsx:6` still point `BUCKET` at the
   legacy `company-logos` bucket. Since both code paths write to the *same*
   `companies.logo_path` column but different buckets, uploading a logo via
   `CompanyModal` and viewing it via `Layout`/`BrandingPage` (or vice versa) 404s.
   This isn't cosmetic — it's a live bug.
2. **A third, unused bucket** (`system-assets`) exists in schema for CoachMate's
   own core brand assets but nothing populates or reads it yet.
3. **Two orphaned static PNGs at repo root** — `CompanyLogo.png` and
   `PhilHainesCoaches.png` — aren't referenced anywhere in code (confirmed via
   repo-wide grep). Dead weight, possibly someone's forgotten manual upload.
4. **Hardcoded operator name text** ("Phil Haines Coaches") instead of reading
   the company record dynamically:
   - `index.html` (driver PWA) — 5 occurrences in picker/NDC markup
   - `dashboard/index.html` — `<title>`
   - `dashboard/src/features/auth/Login.jsx`, `ResetPassword.jsx`
   - (`supabase/seed.sql` also has it, but that's seed data — fine as-is)
5. **CoachMate's own PWA install icons** (`icons/*.png`,
   `dashboard/public/pwa-*.png`) are static, git-tracked, referenced from
   `manifest.json` / `dashboard/vite.config.js` — this part is *already* correct
   and should stay static (see "Out of scope" below), it's just not documented
   as the deliberate exception it is.

`docs/coachmate-branding-summary.md` already flagged pieces of this (the
hardcoded-text issue) but not the bucket-mismatch bug or the orphaned files.
This plan supersedes it once done.

## Target: two sources of truth, deliberately kept separate

| What | Source of truth | Consumers |
|---|---|---|
| Per-operator logo + colours | `companies.logo_path` / `primary_color` / `accent_color`, files in Supabase Storage bucket **`operator-assets`** (`{company_id}/logo.{ext}`) | Dashboard sidebar (`Layout.jsx`), `BrandingPage.jsx`, `CompanyModal.jsx`, driver PWA header, onboard sign |
| CoachMate's own core brand (product wordmark, "Powered by CoachMate" badge, default/fallback logo shown before a company loads or for CoachMate-branded chrome) | Supabase Storage bucket **`system-assets`** | Login page before tenant is known, dashboard/PWA fallback state, any "Powered by" badge |
| PWA installable icons / favicons (OS-level app icon, not in-app UI) | Static git files: `icons/*.png` (driver PWA), `dashboard/public/pwa-*.png` (dashboard) | `manifest.json`, `dashboard/vite.config.js` — **stays static, out of scope**, see below |
| Operator display name in UI text | `companies.name` (or `trading_name` where set), fetched at runtime — never hardcoded | Driver PWA picker/NDC, dashboard title/auth pages, onboard sign |

Rationale for keeping PWA icons static rather than moving them into Storage: they're
read by the OS/browser at install time, need to be same-origin and
service-worker-cacheable for offline installs, and change essentially never. Object
storage buys nothing there and adds a network dependency to something that should
work offline. Everything that's genuinely dynamic (per-operator, editable via the
dashboard) belongs in Storage; everything that's fixed product chrome stays a build
artifact.

## Steps

### 1. Fix the bucket-mismatch bug (do first, it's a live defect)
- In `Layout.jsx` and `CompanyModal.jsx`, change `const BUCKET = 'company-logos'`
  to `const BUCKET = 'operator-assets'` to match `BrandingPage.jsx`.
- Before flipping the switch, write a one-off Node script (pattern per
  `supabase/scripts/`) to copy any existing objects from `company-logos` to
  `operator-assets` under the same `{company_id}/logo.*` path, so no existing
  operator's logo goes missing.

### 2. Retire the legacy `company-logos` bucket
- New migration file `supabase/migration_retire_company_logos_bucket.sql`
  (flat naming per current convention) that drops the `logo_public_read`,
  `logo_company_insert/update/delete` policies and, once confirmed empty,
  the bucket itself.
- Apply to dev first, verify, then production — per the existing DB migration
  workflow in `CLAUDE.md`.
- Update `supabase/schema.sql` to remove the `company-logos` bucket block
  entirely (keep it as authoritative full-schema, per hygiene rules).

### 3. Populate `system-assets` and wire up a CoachMate fallback
- Upload CoachMate's own logo/wordmark and any "Powered by" badge into
  `system-assets` (manual, via Supabase dashboard or a small seed script).
- Add a small shared helper (`dashboard/src/shared/brandAssets.js` or similar)
  that returns the `system-assets` public URL for a given asset name, so
  "CoachMate default logo" has exactly one code path, mirroring how
  `operator-assets` URLs are built today.

### 4. Delete orphaned root files
- Remove `CompanyLogo.png` and `PhilHainesCoaches.png` from repo root — confirmed
  unreferenced. If either is actually wanted as a canonical source asset, upload
  it into the matching Storage bucket first (`system-assets` if it's CoachMate's
  own mark, `operator-assets/{company_id}/` if it's a real operator logo) and
  delete from git either way — assets don't belong in the repo tree once Storage
  is the source of truth.

### 5. Replace hardcoded operator name text with dynamic lookups
- Driver PWA (`index.html` picker/NDC markup): source the company name the same
  way the app already sources schedule data — from the Supabase-backed config /
  `schedule.json` fallback — rather than a literal string in markup.
- Dashboard `Login.jsx` / `ResetPassword.jsx`: these render *before* a company is
  known (no session yet), so they should show the **CoachMate** brand (from
  `system-assets` / a constant), not a specific operator's name — this is a
  product decision, not a bug, but the current hardcoded "Phil Haines Coaches"
  is wrong regardless since a second operator's user would see the wrong brand.
- `dashboard/index.html` `<title>`: switch to a generic default (`CoachMate Ops
  Dashboard`) since it can't know the tenant before JS runs; set the per-company
  title at runtime via `document.title` from `ThemeProvider.jsx` once the company
  loads, same place colours are already applied.
- Onboard sign is already correct (`onboard.html` title is generic
  "CoachMate Onboard Display", `src/onboard.js` already falls back to a CoachMate
  default when no `--operator-accent` is set) — use this as the reference pattern
  for the other two surfaces.

### 6. Verify
- Manually create/switch between two companies in dev Supabase, confirm each
  sees its own logo/colours/name with no bucket 404s, and that the login page
  (pre-auth) shows CoachMate branding, not the last company's.
- Run existing test suites (`npm test`, `npm run test:vitest`,
  `cd dashboard && npm test`) — no logic changes expected to break these, but
  bucket name is referenced in `Layout.jsx`/`CompanyModal.jsx` so check nothing
  in dashboard tests hardcodes `company-logos`.

### 7. Documentation
- Delete or fold `docs/coachmate-branding-summary.md` into this file once step 5
  ships, so there's one branding doc, not two.
- Update `CLAUDE.md`'s Supabase section with a one-line pointer: "logos/brand
  assets → Storage buckets `operator-assets` (per-company) and `system-assets`
  (CoachMate core), never `bytea` columns, never hardcoded — see
  `docs/branding-consolidation-plan.md`."

## Out of scope
- Moving PWA installable icons (`icons/*.png`, `dashboard/public/pwa-*.png`)
  into Supabase Storage — see rationale above.
- Per-operator PWA install icons (i.e. white-labelling the installable app icon
  itself, not just in-app chrome) — bigger feature, not implied by "tidy up",
  flag separately if wanted.
