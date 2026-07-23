# 16:3 Ultra-Wide Onboard Sign — Layout Design

## The Key Constraint

A 16:3 ratio is **extremely wide and short** — roughly 5.3:1. On a 28" panel that works out to approximately 2560 × 480 px (or similar). This is far more like a bus destination board or a scrolling airport-style flight board than a conventional tablet screen. The available vertical space is about the height of four lines of large text. Every design decision flows from that.

---

## Zone Layout — Horizontal Three-Column Grid

The screen is divided into three locked columns, sized by content criticality:

```
┌──────────┬──────────────────────────────────────┬──────────────────┐
│  ROUTE   │         STOP INFORMATION             │  PROGRESS STRIP  │
│  BADGE   │                                      │                  │
│   18%    │              58%                     │      24%         │
└──────────┴──────────────────────────────────────┴──────────────────┘
```

### Left Column — Route Badge (≈18% width)

- Service code in a large bordered box (mono font, same style as now) filling most of the column height
- Operator name below it (one line, very small)
- The brand mark (`BUSHUB.NextStop`) anchored to the bottom of this column

### Centre Column — Stop Information (≈58% width)

- **Top strip (≈20% of column height):** destination arrow line — `→ GRANTHAM` in uppercase, subdued weight, single line
- **Main hero (≈55%):** `THIS STOP` label + stop name in the largest font that fits without wrapping — this is the dominant glance-from-10-metres element
- **Lower strip (≈25%):** `NEXT STOP` label + next stop name at ~60% of the hero font size, in the subdued ink-soft colour
- No map — the height is insufficient to show meaningful cartographic content
- `WAIT HERE / depart at HH:MM` dashed-border banner replaces the next-stop strip when early-wait is active

### Right Column — Tube-Track Progress (≈24% width)

- The existing tube-track strip rendered **vertically** (top = first stop, bottom = current direction of travel)
- Show 3–4 stops: 1 past, current (pulsing green dot), 2 future
- Labels to the right of each dot, truncated with ellipsis
- A vertical line connects the dots
- Left border divider separates this column from the centre

---

## Typography Scale

All `vh`-based so it scales cleanly whether the display is 480 px or 720 px tall.

| Element | Size |
|---|---|
| Service code | `14vh` (nearly full height) |
| THIS STOP name | `10vh` |
| NEXT STOP name | `6vh` |
| Labels (THIS STOP / NEXT STOP) | `2.2vh` |
| Tube-track stop labels | `2vh` |
| Destination bar | `2.5vh` |

---

## Colour and Style

Inherits the existing e-paper aesthetic from `onboard.css` unchanged:

- Cream background `#ECEAE2`, near-black ink `#1A1A18`
- No gradients or shadows — hard borders, weight and text carry meaning
- Only animation: the pulsing green dot on confirmed stop arrival (unchanged)
- Column divider: `4px solid var(--ep-line)` — same weight as the current topbar border

---

## No Map Panel

At 16:3 the height is too small for a useful map. Even a 240 px tall Leaflet map shows almost no spatial context. The tube-track strip is the spatial metaphor and serves that role better at this ratio. A map could be a timed modal overlay in a future iteration — not a permanent panel.

---

## What Changes in Each File

### `onboard.html`

- Restructure `#onboard-sign` from a vertical `flex-direction: column` to a three-column CSS grid: `grid-template-columns: 18fr 58fr 24fr`
- Move service code into the left column, destination into the centre column top strip — the `#sign-topbar` wrapper is retired
- Add a `#sign-progress` wrapper in the right column for the vertical tube-track

### `onboard.css`

- Add a `@media (min-aspect-ratio: 4/1)` block that activates the three-column grid and the vh font scales above
- The block also needs full overrides for `#tube-track` (today's `height: 15vh` is sized for the horizontal strip — the vertical column needs to fill the right column's height) and its `::before` connector line (today's `left/right` absolute positioning draws a horizontal line — the vertical layout needs `top/bottom` instead), plus `.tube-node` flex-direction row→column. This is more than a font-size swap.
- Carry forward the `.sign-hero-value` overflow/ellipsis handling (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`) into the wide-mode hero rules — long stop names still need to clip rather than wrap or overflow the centre column
- `#onboard-brand` stays exactly as it is today (`position: fixed; left: 2rem; bottom: 1.1rem`, bottom-left of the viewport) — no change needed, since that fixed position already lands in the left column's footprint
- Keep the existing vertical layout as the default (works for the Fire HD 10 and normal browser preview windows)
- No JS detection needed — the layout switches automatically based on actual display geometry

### `onboard.js`

- `renderTubeTrack` checks `matchMedia('(min-aspect-ratio: 4/1)').matches` inline, fresh on every call — no cached value, no `change` listener. Updates only happen every ~10-15s (GPS poll cadence), so the check is effectively free, and checking live means resizing the browser window during manual testing (rollout step 4) flips the layout immediately with no reload needed.
- When wide, the index window changes from today's symmetric 2-past/2-future to 1-past/2-future (per Zone Layout above) — this is an actual change to the `centerIndex - 2 … centerIndex + 2` loop bounds in `renderTubeTrack`, not just a rendering/orientation change.
- Visual orientation itself (row vs column, connector-line direction) is CSS's job via the same breakpoint — JS doesn't need to branch on that.
- No other logic changes — GPS, geofence, announcements, and Supabase code are untouched

---

## Rollout Sequence

1. Restructure `onboard.html` DOM into the three-column zone structure
2. Add the `@media (min-aspect-ratio: 4/1)` CSS block in `onboard.css` with the grid layout and vh font sizes
3. Update `renderTubeTrack` in `onboard.js` to render the vertical dot column when in wide mode
4. Test at browser window sized to ~2560×480 (zoom out), including a long stop name (e.g. "Grantham, Wetherby Road") to confirm it clips rather than wraps or overflows; then at the normal Fire HD 10 size to confirm the fallback layout is undisturbed
5. No changes to `src/gps.js`, `src/announcements.js`, `src/engine.js`, or any Supabase schema
