# PCV Technologies — brand hub

This is the canonical source of truth for PCV Technologies' company and product identity.
It is the single place that defines the brand; other docs and product-level notes (e.g.
`coachmate-branding-summary.md`) should **link here** rather than restate values, so the two
never drift apart.

**See [`ACCESSIBILITY_BRAND_PLAYBOOK.md`](ACCESSIBILITY_BRAND_PLAYBOOK.md) for the
company-level accessibility and brand standard** — colour contrast, typography, iconography,
and audio/visual rules that apply to this brand and to every CoachMate surface. This document
is the visual identity (colours, tokens, logo); the playbook is the rulebook everything here
(and every future brand asset) is measured against.

## Company & product hierarchy

```
PCV Technologies  (company — pcvtechnologies.co.uk)
  └─ PCV Dashboard   (mandatory umbrella product — every customer gets this,
     regardless of which product modules they've signed up for)
       ├─ BusOps      (first product module — BusOps Driver PWA + BusOps
       │  Announce onboard sign)
       └─ CoachMate   (reserved for a future product module — no code yet)
            └─ per-operator branding  (each customer/tenant can recolour their
               own instance — existing `companies.primary_color` /
               `accent_color` / `logo_path`, applied via `ThemeProvider.jsx`)
```

**Status note:** "PCV Dashboard" is the `pcv-dashboard/` app. Its user-facing wordmarks
(browser tab title, PWA manifest name/short_name/description in `pcv-dashboard/vite.config.js`
and `pcv-dashboard/index.html`, the login screen, the sidebar mark in `Layout.jsx`) were
repositioned from "CoachMate Ops Dashboard" to "PCV Dashboard" on 2026-08-21. The repo's folder
structure was later restructured (2026-08-21) to mirror this hierarchy directly: `dashboard/`
was renamed to `pcv-dashboard/`, and `busops/` and `coachmate/` now live inside it as product
folders (see `CLAUDE.md` for the full path map). The npm package name (`coachmate-dashboard`)
remains an internal identifier, left unchanged. See `CLAUDE.md` for current implementation
status.

Company/employee/vehicle management, settings, and other product-agnostic ops functionality
belong in PCV Dashboard. BusOps and future product modules (CoachMate) are surfaced *inside*
it, not as standalone apps with their own separate identity.

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
  (`busops/driver/index.html`/`busops/announce/onboard.html`/`pcv-dashboard/index.html`) —
  `brand-tokens.css` only names the family, it doesn't fetch it;
  `pcv-dashboard/busops/tests/brandTokens.test.js` /
  `pcv-dashboard/src/shared/brandTokens.test.js` guard those three links against naming a
  different family than the token.

### Accessible surface palette

Approved 2026-09-08 (user-supplied, pre-vetted for contrast against pure-black `#000000` text)
— fills the "surface/background" gap noted below, at least for one real consumer so far. Each
swatch's ratio is against literal black text, not `ink`/`#242F35` above — a stricter pairing,
deliberately chosen where the "black text mandated" requirement applies (currently just the
onboard sign, see below).

| Hex | Contrast vs. black text | WCAG 2.2 AA (4.5:1 text) | In use |
|---|---|---|---|
| `#E3DADF` | 15.36:1 | ✅ pass | not yet adopted |
| `#BAD9D5` | 13.97:1 | ✅ pass | not yet adopted |
| `#BED6DF` | 13.87:1 | ✅ pass | not yet adopted |
| `#D8E2F5` | 16.12:1 | ✅ pass | not yet adopted |
| `#F9FAF4` | 20.01:1 | ✅ pass | **onboard sign main background** (`--ep-paper` in `busops/announce/onboard.css`), paired with `--ep-ink: #000000` |

The other four are available as future surface/background tokens for other surfaces (dashboard
cards, driver PWA) — adopt by adding a named role here and in `brand-tokens.css` when a real
product need picks one, per the "don't silently fill" convention below.

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

**Gap, not silently filled:** general success/warning/error states aren't established anywhere
in the codebase today. Rather than invent values here, they're left undefined until a real
product need defines them — add them to both this table and `brand-tokens.css` together when
that happens, don't let them diverge. Surface/background got a first real answer 2026-09-08 —
see "Accessible surface palette" above — but it's a per-consumer CSS token in each product's own
stylesheet (`--ep-paper`, etc.) rather than a `brand-tokens.css` role yet, since only the onboard
sign has picked one so far; promote it to a shared role here once a second surface adopts one of
the remaining four.

### Logo

**Not yet designed as a real asset.** The app icons (`busops/shared/icons/*.png`,
`pcv-dashboard/public/pwa-*.png`) are a plain generated placeholder (PCV Charcoal background,
"CM" in PCV Cyan) — not a designed
logo, just enough to stop a specific operator's own logo shipping in shared source code (see
`docs/TODO.md`). Until a real logo exists, product UIs should use text wordmarks per the
attribution convention below.

## Attribution convention

Product-facing surfaces (footers, about screens, login/reset screens, etc.) credit the company
as a small strapline beneath the product wordmark, reading:

> From PCV Technologies

Applied today on all three brand marks: the driver PWA's `#app-brand`
(`busops/driver/index.html`/`style.css`), the onboard sign's `#onboard-brand`
(`busops/announce/onboard.html`/`onboard.css`), and the dashboard's `.app-brand`
(`Layout.jsx`/`pcv-dashboard/src/index.css`) — plus their mirror in `demo.html`. See
`coachmate-branding-summary.md` for other hardcoded strings that still need updating (e.g.
"Phil Haines Coaches").

## Token file

The literal, reusable CSS custom properties for the palette and semantic roles above live in
[`brand-tokens.css`](../pcv-dashboard/busops/shared/brand-tokens.css) at
`pcv-dashboard/busops/shared/` — copy/import-ready for any current or future PCV Technologies
product. It lives there (not under `docs/`) because it's real, shipped code: the driver PWA's
Cloudflare Workers deploy excludes `docs/` (dev/reference material only) via `.assetsignore`, so
a token file the PWA actually imports at runtime can't be parked there. `busops/shared/` — rather
than `busops/driver/` or `busops/announce/` individually — is deliberate too: it's the one thing
both BusOps surfaces genuinely share, alongside the favicon and (for scope reasons —
see `CLAUDE.md`) `service-worker.js` itself. It is wired into `busops/driver/style.css`,
`busops/announce/onboard.css`, and `pcv-dashboard/src/index.css` via `@import`;
`pcv-dashboard/vite.config.js` and `supabase/schema.sql` read/duplicate its values where a CSS
import isn't possible (build-time manifest generation, SQL column defaults, the Google Fonts
`<link>` URLs) — see the comment at the top of `brand-tokens.css` for details on keeping those
in sync.
