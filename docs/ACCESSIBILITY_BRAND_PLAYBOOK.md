# CoachMate Accessibility & Brand Playbook

**Status:** company-level standard, mandatory for every CoachMate product/surface (BusOps
Driver, BusOps Announce, CoachMate Ops Dashboard, and anything built after this document).
Referenced from the root `CLAUDE.md` so it applies by default to all future design and
engineering work in this repo — not an opt-in guideline.

**Why this exists:** PSVAR and the PSV (Accessible Information) Regulations are what's
driving the current audio/visual next-stop feature set (see `CLAUDE.md` → PSVAIR announcement
audio, `docs/TODO.md` → PSVAIR 2026 compliance). But the passengers those regulations protect
— people who are blind, partially sighted, D/deaf, hard of hearing, or have a cognitive or
mobility impairment — don't stop needing accessible design the moment they get off a
regulation's page. This playbook takes the same standard PSVAIR forces onto the announcement
system and applies it as a **core value** across everything CoachMate designs: brand, colour,
typography, iconography, motion, audio, and written content, for drivers, ops staff, and
passengers alike. It is company-level, not per-product, so a new BusOps surface inherits it on
day one instead of retrofitting it later.

---

## 1. Regulatory & standards baseline (UK)

These are the actual instruments and bodies this playbook draws from. Where CoachMate isn't
legally bound by one (e.g. it isn't a public sector body), we still treat it as the baseline —
many operator customers run local-authority home-to-school and DRT contracts where it *does*
apply to the commissioning body, and it's simply good practice.

- **Public Service Vehicles Accessibility Regulations 2000 (PSVAR), as amended** — physical
  vehicle accessibility: wheelchair spaces, contrasting handrails/steps, priority seating.
- **PSV (Accessible Information) Regulations 2023** — the regulation that actually mandates
  on-board audible **and** visible next-stop/destination information. Phased deadlines:
  most operators by October 2025, final deadline (older vehicles, chassis first used
  1973–2014) October 2026 — see `docs/TODO.md`. This is the direct legal driver of
  `pcv-dashboard/busops/driver/src/announcements.js` and the onboard sign.
- **Equality Act 2010** — the anticipatory "reasonable adjustments" duty for service
  providers. It applies to the driver PWA, the onboard sign, and the ops dashboard exactly as
  much as it applies to the vehicle itself: a booking system or driver tool that a disabled
  employee or passenger can't use is a service failure, not just a UX nit.
- **Public Sector Bodies (Websites and Mobile Applications) (No. 2) Accessibility Regulations
  2018** — mandates WCAG 2.2 AA for public sector digital services. Not directly binding on a
  private operator, but it's the reason **WCAG 2.2 Level AA** is the UK's de facto digital
  accessibility bar, and it's the standard the GOV.UK Design System itself is built to.
  CoachMate adopts WCAG 2.2 AA as its own minimum bar for the same reason GOV.UK does.
- **RNIB clear print guidance** — minimum 12pt (~16px on screen) body text, sans-serif, left
  aligned, 4.5:1 minimum contrast, avoid italics/justified text for body copy.
- **RNID guidance on accessible information** — never make audio the *only* channel; always
  pair it with a visible/text equivalent; plain English over jargon.
- **Colour Blind Awareness (UK)** — roughly 1 in 12 men and 1 in 200 women in the UK have a
  colour vision deficiency, overwhelmingly red-green. Never let colour alone carry meaning.

None of this is exotic — WCAG 2.2 AA is the same bar GOV.UK holds itself to, and PSVAIR is
already the reason this codebase has an announcements pipeline. This playbook just says: hold
the rest of the product to the same bar.

---

## 2. Core values

1. **Audio is never the only channel.** Every announcement, alert, or status change that's
   spoken must also appear as text/visuals somewhere reachable at the same moment — this is
   already how PSVAIR AV works (`speak()` + the onboard sign), and it's the standard the rest
   of the product should meet too (e.g. `diversionAlert.js` alerts, wake-lock warnings).
2. **Colour is never the only signal.** Status, severity, and state must be legible in
   greyscale — pair colour with a label, icon, or shape. (The driver PWA's on-time/late/early
   states already do this via `#status-label` text, not colour alone — keep that pattern
   everywhere, including new dashboard status badges.)
3. **Text meets WCAG 2.2 AA contrast, full stop.** 4.5:1 for body/UI text, 3:1 for large text
   (≥24px, or ≥19px bold) and for the borders of interactive UI components (inputs, focus
   rings, toggle states). See §4 for exact numbers against our own tokens.
4. **Plain English, short sentences.** Aim for content a reader with no technical or transport
   background can act on first read — driver-facing UI in particular is often read at a glance,
   mid-task, sometimes stationary at a stop under time pressure.
5. **Nothing flashes more than 3 times a second** (WCAG 2.3.1) — relevant to any future
   dashboard live-tracking animation, onboard sign transition, or alert banner.
6. **This is a company-level default, not a per-product opt-in.** Every new BusOps surface
   starts from this playbook; deviations need a documented reason, not silence.

---

## 3. Colour

### 3.1 Rules

- Body/UI text: **≥ 4.5:1** against its background (WCAG 1.4.3).
- Large text (≥24px regular, or ≥19px/~14pt bold): **≥ 3:1**.
- Non-text UI components — input borders, focus indicators, icon-only buttons, chart strokes —
  **≥ 3:1** against adjacent colour (WCAG 1.4.11).
- Never use colour alone to distinguish state (on-time/late/early, pass/fail, active/inactive).
  Always add a text label, icon, or pattern.
- Don't rely on red/green as the *only* differentiator anywhere two states must be told apart
  at a glance (the ~1-in-12 UK men with red-green colour vision deficiency, §1).
- When an operator customises `primary_color`/`accent_color` (see
  `pcv-dashboard/src/shared/ThemeProvider.jsx`, `BrandingPage.jsx`), the chosen colour must still
  clear the same 4.5:1 / 3:1 bars against the surfaces it's actually rendered on. This isn't
  optional just because it's operator-chosen — a passenger or driver using an operator-branded
  screen gets no less protection than one using CoachMate's own default theme.

### 3.2 Audit of current tokens (measured, not estimated)

> **Re-measured 2026-08-23** against `pcv-dashboard/busops/driver/style.css` and
> `pcv-dashboard/src/index.css` post-restructure — the two-tone `.cm-coach`/`.cm-mate` split
> referenced in the original audit no longer exists (dropped when the driver PWA's corner mark
> was reworded to "From PCV Technologies", 2026-08-21); `.cm-attribution` now wraps
> `.cm-powered-by` + `.cm-wordmark` only. Ratios below are freshly computed (WCAG
> relative-luminance formula) against the current shipped hex values, not carried over from the
> original audit.

| Token / usage | Foreground | Background | Ratio | WCAG 2.2 AA | Verdict |
|---|---|---|---|---|---|
| `--cm-charcoal` body text | `#242F35` | `#FFFFFF` | 13.70:1 | 4.5:1 text | ✅ pass |
| `--cm-cyan`/`--pcv-color-primary-action` as text on dark surface (driver PWA `.cm-wordmark` unwrapped, status text) | `#00B4D8` | `#242F35` | 5.56:1 | 4.5:1 text | ✅ pass |
| `--cm-cyan` as text/border **on white** (dashboard `.dm-today` numerals, `.form-input:focus` border) | `#00B4D8` | `#FFFFFF` | 2.46:1 | 4.5:1 text / 3:1 UI border | ❌ **fail** |
| White text on `--operator-accent` default fill (`.btn-primary`) | `#FFFFFF` | `#00B4D8` | 2.46:1 | 4.5:1 text | ❌ **fail** |
| `on-time` status | `#10B981` | `#1B2428` (driver PWA bg) | 6.23:1 | 4.5:1 text | ✅ pass |
| `early` status | `#F59E0B` | `#1B2428` | 7.35:1 | 4.5:1 text | ✅ pass |
| `late` status | `#EF4444` | `#242F35` (card surface) | 3.64:1 | 4.5:1 text | ❌ **fail** (this is the status most likely to matter to a driver under time pressure) |
| `sidebar-accent-tint` on `sidebar-bg` (dashboard) | `#8CDDED` | `#475569` | 4.94:1 | 4.5:1 text | ✅ pass — already deliberately tuned as its own token, see `brand-tokens.css`'s comment on `--pcv-color-sidebar-accent-tint` |
| `#app-brand` mark, `.cm-wordmark` (driver PWA footer, "PCV Technologies") | `#00B4D8` blended at 0.55 opacity → `#10788F` | `#242F35` | 2.68:1 | 4.5:1 text | ❌ **fail** |
| `#app-brand` mark, `.cm-powered-by` ("From") | `#8BA4B0` blended at 0.55 opacity → `#5D6F79` | `#242F35` | 2.62:1 | 4.5:1 text | ❌ **fail** |

Dropped from this pass (resolved, no longer applicable): the original audit's Phil Haines
Coaches gradient-logo finding — `pcv-dashboard/busops/shared/icons/icon-192.png`/`icon-512.png`
were replaced with a
neutral placeholder mark 2026-08-21 (see `docs/TODO.md`'s "Brand — placeholder app icon needs
real design"), so they're no longer the customer logo this finding was about. A *real* icon
design still needs its own contrast check once one exists — tracked in that same TODO item,
not re-added here as a colour-audit finding against an asset that no longer ships.

### 3.3 A bug worth calling out specifically

`style.css`'s `#app-brand` mark (the small "BusOps Driver · From PCV Technologies" attribution
fixed to the driver PWA's corner) wraps its `.cm-wordmark`/`.cm-powered-by` text in a
`.cm-attribution { opacity: 0.55 }` container. That's the *exact* bug already found and fixed
in the dashboard's equivalent mark — see the comment on `.sidebar-coachmate` in
`pcv-dashboard/src/index.css` ("No wrapper opacity here (used to be 0.55) — it compounded...
dropping the effective contrast well below AA"). The driver PWA's own mark still has it: the
wrapper opacity drops both text elements below AA (see the two rows above). Removing the
wrapper opacity — mirroring the dashboard's existing fix, with hierarchy carried by font-size
alone instead — would bring both to 4.5:1+ (5.56:1 / 5.24:1 unwrapped). Logged as a
remediation item rather than changed here — this playbook pass is about establishing the
standard, not patching the product.

### 3.4 Remaining findings — tracked in `docs/TODO.md`

The default `--cm-cyan`/`--operator-accent` (`#00B4D8`) fails AA when used as **text or a thin
UI border directly on a white/light surface** — `.btn-primary` (white text on cyan fill),
`.dm-today` numerals, and `.form-input:focus`'s border/box-shadow. It's fine as a background
under white text only if darkened, fine as text only on the dark charcoal surface, and fine as
a large decorative fill. Because `--operator-accent` is also operator-customisable
(`BrandingPage.jsx`), this isn't a one-line fix — it needs either a second "accessible on
light" token used specifically in those three spots (the same pattern already used once for
`--pcv-color-sidebar-accent-tint`, §3.2), or contrast validation added to the branding colour
picker so an operator can't save a non-compliant accent in the first place. Logged as a
remediation item rather than reflowed here, since it touches operator-facing theme behaviour
and deserves its own review. Same treatment for the `late` status colour (3.64:1, just under
the 4.5:1 bar) and the driver PWA's `#app-brand` attribution mark (§3.3).

---

## 4. Typography

- Minimum body text size: **16px** (RNIB clear print baseline, ~12pt). Never go below 11px
  except for genuinely decorative micro-labels that duplicate information available elsewhere
  at full size (e.g. a version-number footer).
- Sans-serif only for UI and body copy — CoachMate's `Plus Jakarta Sans` already satisfies this
  everywhere it's used; keep it as the one brand typeface rather than introducing a second.
- Left-align body text. Never justify.
- Avoid italics for body copy (harder to read for low-vision and dyslexic users).
- Line height ≥ 1.4 for body text (already the case: driver PWA `style.css`
  `body { line-height: 1.4 }`, `pcv-dashboard/src/index.css` `body { line-height: 1.5 }` —
  keep both).
- Uppercase is acceptable only for short (1–3 word) labels (`.badge`, `.stat-label`,
  `.form-section-label` all qualify today) — never for sentences or paragraphs; long runs of
  capitals are measurably harder to read.
- Respect user font-size preferences: don't hard-cap font-size in a way that blocks browser/OS
  zoom or OS-level text-size accessibility settings (WCAG 1.4.4 — text must reflow up to 200%
  without loss of content).

## 5. Iconography, status & motion

- Every status indicator (on-time/late/early, journey state, alert severity) must carry a text
  label or icon in addition to colour. This is already true of the driver PWA's status card —
  hold every new status UI (dashboard badges, onboard sign states, future features) to the same
  bar, not just colour-coded pills.
- Icon-only buttons need an accessible name (`aria-label` or equivalent) and must meet the 3:1
  non-text contrast rule against their background.
- No content may flash more than 3 times per second (WCAG 2.3.1) — applies to any future
  attention-getting animation on the onboard sign or dashboard alerts.
- Animations/transitions should respect `prefers-reduced-motion` where they're purely
  decorative.

## 6. Audio & announcements (PSVAIR-driven, extended as the house standard)

- **Never audio-only.** Every spoken announcement has a visible equivalent at the same moment
  — this is already the AV pairing PSVAIR requires, and the same rule now applies to anything
  else that plays a sound (alerts, wake-lock warnings): if it beeps, it must also be legible.
- Plain English sentence structure for announcement text — one variable slot per sentence
  (already the pattern in `pcv-dashboard/busops/driver/src/announcements.js` /
  `scripts/generate-announcement-audio.mjs`); don't stack multiple pieces of information into
  one spoken sentence.
- Pre-rendered neural TTS (current approach) over live `speechSynthesis` wherever possible —
  more consistent pacing and clarity for hard-of-hearing passengers relying on lip-reading the
  visible display in parallel with the audio.
- Queue, don't interrupt (`speak()`'s existing behaviour) — a cut-off announcement is worse
  than a slightly delayed one for anyone relying on it as their primary information channel.

## 7. Onboard signage (BusOps Announce)

- Text must be legible at the mounted viewing distance and the tablet's real brightness range,
  not just in a design mockup — verify against RNIB's 4.5:1 minimum under typical daylight
  glare, not only indoor lighting.
- Never depend on the sign as the *only* channel for information that's also spoken — the
  reverse of §6's rule, for D/deaf and hard-of-hearing passengers who rely on the sign alone.
- High-contrast layout by default; avoid low-contrast "premium" dark-on-dark treatments for
  this specific surface even where they might be acceptable elsewhere in the brand.

## 8. Logo & brand mark rules

- A brand mark must remain legible (3:1 minimum for its dominant fill against its background)
  at every size it's actually deployed at, including the smallest — a favicon/app-icon size,
  not just the hero size in a pitch deck.
- Provide (or require from any operator supplying their own logo) a solid-colour or
  high-contrast alternate lockup for use in constrained/high-contrast contexts (status bar
  icons, print, high-contrast OS modes) — worth checking against §3.1's rules once a real
  platform mark exists (see below).
- Never let a brand mark be the sole way state or identity is communicated — CoachMate's own
  product identity (BusOps Driver / Announce / Ops Dashboard) should always be paired with text,
  which it already is (`#app-brand`, sidebar footer).
- The platform's own default app icon/PWA icon should be a neutral CoachMate mark, not a
  specific customer's uploaded logo — **resolved 2026-08-21**: `pcv-dashboard/busops/shared/
  icons/icon-192.png`/`icon-512.png` (driver PWA) were replaced with a neutral placeholder,
  no longer the Phil Haines Coaches customer logo this section originally flagged. The
  placeholder isn't a designed asset though — commissioning a real platform mark, and giving it
  a proper contrast/alternate-lockup check per this section once it exists, is tracked in
  `docs/TODO.md`'s "Brand — placeholder app icon needs real design".

## 9. Content & language

- Plain English. Avoid transport-industry jargon in anything passenger- or driver-facing
  (reserve terms like "duty card", "leg", "geofence" for ops/internal tooling where the
  audience already knows them).
- Write instructions as direct actions ("Tap to select your service") not passive description.
- Keep sentences short — a driver reading mid-task, or a passenger under time pressure at a
  stop, should get the full meaning from the first clause.

---

## 10. Definition of done — accessibility checklist

Add this to the mental checklist for any new UI, exactly like a test pass, before calling a
feature finished:

- [ ] Every text/background colour pairing checked against §3.1's ratios (use a contrast
      checker — don't eyeball it; §3.2 shows why that goes wrong).
- [ ] No state, severity, or status communicated by colour alone.
- [ ] Body text ≥ 16px, sans-serif, left-aligned, not italic, not justified.
- [ ] Any new audio/alert has a simultaneous visible/text equivalent.
- [ ] Any new animation respects the 3-flashes-per-second limit and, where decorative,
      `prefers-reduced-motion`.
- [ ] Icon-only controls have an accessible name.
- [ ] If the change touches operator-configurable branding (`BrandingPage.jsx` or similar),
      the configurable colour still has to clear the same bars — flag it if the UI doesn't yet
      enforce that (see §3.4).

## 11. Governance

- This document lives at `docs/ACCESSIBILITY_BRAND_PLAYBOOK.md` and is referenced from the
  root `CLAUDE.md`, so it's loaded as project context for every session working in this repo —
  company-level, applying to all three surfaces and any future one.
- Known gaps against it are tracked as checklist items in `docs/TODO.md` rather than left
  implicit — see "Accessibility & branding playbook — follow-ups" there.
- When operator-level branding customisation is extended, contrast validation against this
  playbook's rules should be built into the picker UI itself (§3.4), not left to manual review.
