# Branding consolidation plan

> **Paths below updated 2026-08-23** for the `pcv-dashboard/busops/{driver,
> announce}` restructure (`dashboard/` → `pcv-dashboard/`, driver PWA → `pcv-
> dashboard/busops/driver/`, onboard sign → `pcv-dashboard/busops/announce/`)
> — this plan predates that move. **Item 4/step 5 (hardcoded operator name)
> is now done** — verified 2026-08-23, no "Phil Haines Coaches" literal
> remains in any `.jsx`/`.html` file; `fetchCompanyName()` in
> `supabaseApi.js` already covers this. Items 1–3 and 5 (bucket mismatch,
> unused `system-assets` bucket, orphaned root PNGs, static PWA icons) are
> still open — verified live on `develop` the same day.

## Problem

Branding assets (logos, brand colours, and the operator's name text) live in five
different places with no single source of truth, and two of those places actively
disagree with each other:

1. **Two logo storage buckets in play for the same field.** `companies.logo_path`
   is documented (`supabase/schema.sql:42`) as living in `operator-assets`, and
   `pcv-dashboard/src/features/settings/BrandingPage.jsx` writes there. But
   `pcv-dashboard/src/shared/components/Layout.jsx:115` and
   `pcv-dashboard/src/features/company/CompanyModal.jsx:6` still point `BUCKET` at the
   legacy `company-logos` bucket. Since both code paths write to the *same*
   `companies.logo_path` column but different buckets, uploading a logo via
   `CompanyModal` and viewing it via `Layout`/`BrandingPage` (or vice versa) 404s.
   This isn't cosmetic — it's a live bug.
2. **A third, unused bucket** (`system-assets`) exists in schema for CoachMate's
   own core brand assets but nothing populates or reads it yet.
3. **Two orphaned static PNGs at repo root** — `CompanyLogo.png` and
   `PhilHainesCoaches.png` — aren't referenced anywhere in code (confirmed via
   repo-wide grep). Dead weight, possibly someone's forgotten manual upload.
4. ~~**Hardcoded operator name text**~~ — **done, 2026-08-23**: driver PWA,
   dashboard title, and auth pages all source the operator name dynamically now
   (`fetchCompanyName()` in `supabaseApi.js`). No further action needed here.
5. **CoachMate's own PWA install icons** (`pcv-dashboard/busops/shared/icons/*.png`,
   `pcv-dashboard/public/pwa-*.png`) are static, git-tracked, referenced from
   `manifest.json` / `pcv-dashboard/vite.config.js` — this part is *already* correct
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
| PWA installable icons / favicons (OS-level app icon, not in-app UI) | Static git files: `pcv-dashboard/busops/shared/icons/*.png` (driver PWA), `pcv-dashboard/public/pwa-*.png` (dashboard) | `manifest.json`, `pcv-dashboard/vite.config.js` — **stays static, out of scope**, see below |
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
- Add a small shared helper (`pcv-dashboard/src/shared/brandAssets.js` or similar)
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

### 5. ~~Replace hardcoded operator name text with dynamic lookups~~ — done, 2026-08-23
Driver PWA picker/NDC markup and the dashboard auth pages now source the
operator name at runtime via `fetchCompanyName()` (`supabaseApi.js`) rather
than a literal string. Onboard sign (`pcv-dashboard/busops/announce/
onboard.html`/`src/onboard.js`) was already correct before this plan was
written and served as the reference pattern. No remaining action here —
left in this doc for the historical record of what "done" means for this
item.

### 6. Verify
- Manually create/switch between two companies in dev Supabase, confirm each
  sees its own logo/colours/name with no bucket 404s, and that the login page
  (pre-auth) shows CoachMate branding, not the last company's.
- Run existing test suites (`cd pcv-dashboard/busops && npm test && npx vitest run`,
  `cd pcv-dashboard && npm test`) — no logic changes expected to break these, but
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
- Moving PWA installable icons (`pcv-dashboard/busops/shared/icons/*.png`,
  `pcv-dashboard/public/pwa-*.png`) into Supabase Storage — see rationale above.
- Per-operator PWA install icons (i.e. white-labelling the installable app icon
  itself, not just in-app chrome) — bigger feature, not implied by "tidy up",
  flag separately if wanted.
