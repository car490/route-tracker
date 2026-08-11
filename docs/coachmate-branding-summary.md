# CoachMate branding summary

## Current brand in place

- **Core brand colours**
  - Cyan: `#00B4D8`
  - Charcoal: `#242F35`
  - Font: `Plus Jakarta Sans`
  - Sources:
    - `/home/runner/work/route-tracker/route-tracker/style.css`
    - `/home/runner/work/route-tracker/route-tracker/dashboard/src/index.css`

- **Dashboard app branding**
  - App name: `CoachMate Ops Dashboard`
  - Short name: `CoachMate`
  - Source:
    - `/home/runner/work/route-tracker/route-tracker/dashboard/vite.config.js`

- **Multi-tenant branding already implemented**
  - Company-level `slug`, `primary_color`, `accent_color`, and `logo_path` exist on `companies`
  - Branding is applied at runtime by `ThemeProvider`
  - Sources:
    - `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql`
    - `/home/runner/work/route-tracker/route-tracker/dashboard/src/shared/ThemeProvider.jsx`

- **Branding management UI exists**
  - Branding settings page includes live preview, colour settings, logo upload, and slug editing
  - Source:
    - `/home/runner/work/route-tracker/route-tracker/dashboard/src/features/settings/BrandingPage.jsx`

- **Brand asset storage exists**
  - `system-assets` stores CoachMate core assets
  - `operator-assets` stores company-uploaded logos
  - Source:
    - `/home/runner/work/route-tracker/route-tracker/supabase/schema.sql`

## Important caveat

Some screens are still hardcoded to `Phil Haines Coaches`, so branding is not yet fully dynamic everywhere.

- Driver app examples:
  - `/home/runner/work/route-tracker/route-tracker/index.html`

- Dashboard auth examples:
  - `/home/runner/work/route-tracker/route-tracker/dashboard/src/features/auth/Login.jsx`
  - `/home/runner/work/route-tracker/route-tracker/dashboard/src/features/auth/ResetPassword.jsx`

## Bottom line

CoachMate branding is in place as the base theme, and the dashboard already supports per-operator branding, but a few UI areas still use hardcoded Phil Haines Coaches text.
