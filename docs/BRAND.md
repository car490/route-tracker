# PCV Technologies — brand hub

This is the canonical source of truth for PCV Technologies' company and product identity.
It is the single place that defines the brand; other docs and product-level notes (e.g.
`coachmate-branding-summary.md`) should **link here** rather than restate values, so the two
never drift apart.

## Company & product hierarchy

```
PCV Technologies  (company — pcvtechnologies.co.uk)
  └─ PCV Dashboard   (mandatory umbrella product — every customer gets this,
     regardless of which product modules they've signed up for)
       └─ CoachMate  (first product module — BusOps Driver PWA + BusOps Announce
          onboard sign; more modules expected to follow this pattern)
            └─ per-operator branding  (each customer/tenant can recolour their
               own instance — existing `companies.primary_color` /
               `accent_color` / `logo_path`, applied via `ThemeProvider.jsx`)
```

**Status note:** "PCV Dashboard" is the existing `dashboard/` app (currently titled/branded
"CoachMate Ops Dashboard" in `dashboard/vite.config.js` and `dashboard/index.html`) under a
planned repositioning — it is not yet renamed or restructured in code. This document
describes the intended direction so future work builds toward it consistently; it does not
mean the rename has happened. See `CLAUDE.md` for current implementation status.

Company/employee/vehicle management, settings, and other product-agnostic ops functionality
belong in PCV Dashboard. CoachMate and future product modules are surfaced *inside* it, not
as standalone apps with their own separate identity.

## Visual identity

Reused directly from CoachMate's existing look — no new colours invented for the company
tier.

### Raw palette

| Name | Hex | Notes |
|---|---|---|
| PCV Cyan | `#00B4D8` | Primary brand accent |
| PCV Charcoal | `#242F35` | Primary dark/ink colour |

### Typography

- **Plus Jakarta Sans** — the brand typeface, weights 400–800, stacked as
  `'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif` (`--pcv-font-sans` in
  `brand-tokens.css`). Loaded via each app's own Google Fonts `<link>`
  (`index.html`/`onboard.html`/`dashboard/index.html`) — `brand-tokens.css` only names the
  family, it doesn't fetch it; `tests/brandTokens.test.js` /
  `dashboard/src/shared/brandTokens.test.js` guard those three links against naming a
  different family than the token.

### Semantic role tokens

Products should consume **roles**, not raw hex values, so the brand can evolve without every
product needing a find-and-replace. Only roles actually established in the current codebase
are defined below — see `brand-tokens.css` for the literal CSS.

| Role | Maps to | Usage |
|---|---|---|
| `primary-action` | PCV Cyan | Buttons, links, active/selected states |
| `ink` | PCV Charcoal | Body text, headings |
| `primary-action-hover` | PCV Cyan, darkened (`#009BBF`) | Button/link hover states |
| `sidebar-accent-tint` | PCV Cyan, lightened (`#8CDDED`) | Dashboard sidebar accent — the base `primary-action` cyan only reaches ~3.1:1 contrast against the sidebar's slate background (fails WCAG AA); this tint reaches ~5.6:1 |

**Gap, not silently filled:** roles like surface/background, and general success/warning/error
states aren't established anywhere in the codebase today. Rather than invent values here,
they're left undefined until a real product need defines them — add them to both this table
and `brand-tokens.css` together when that happens, don't let them diverge.

### Logo

**Not yet designed as a real asset.** The app icons (`icons/*.png`, `dashboard/public/pwa-*.png`)
are a plain generated placeholder (PCV Charcoal background, "CM" in PCV Cyan) — not a designed
logo, just enough to stop a specific operator's own logo shipping in shared source code (see
`docs/TODO.md`). Until a real logo exists, product UIs should use text wordmarks per the
attribution convention below.

## Attribution convention

Product-facing surfaces (footers, about screens, login/reset screens, etc.) should credit the
company using the pattern:

> **[Product Name] by PCV Technologies**

e.g. "CoachMate by PCV Technologies". This is the target convention — it is not yet applied
anywhere in this repo (see `coachmate-branding-summary.md` for the current hardcoded strings
that still need updating, e.g. "Phil Haines Coaches").

## Token file

The literal, reusable CSS custom properties for the palette and semantic roles above live in
[`brand-tokens.css`](../brand-tokens.css) at the repo root — copy/import-ready for any current or
future PCV Technologies product. It lives at the repo root rather than under `docs/` because it's
real, shipped code: the driver PWA's Cloudflare Workers deploy excludes `docs/` (dev/reference
material only) via `.assetsignore`, so a token file the PWA actually imports at runtime can't be
parked there. It is wired into `style.css`, `onboard.css`, and `dashboard/src/index.css` via
`@import`; `dashboard/vite.config.js` and `supabase/schema.sql` read/duplicate its values where a
CSS import isn't possible (build-time manifest generation, SQL column defaults, the Google Fonts
`<link>` URLs) — see the comment at the top of `brand-tokens.css` for details on keeping those
in sync.
