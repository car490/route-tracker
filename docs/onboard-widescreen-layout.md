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
- Keep the existing vertical layout as the default (works for the Fire HD 10 and normal browser preview windows)
- No JS detection needed — the layout switches automatically based on actual display geometry

### `onboard.js`

- `renderTubeTrack` gains awareness of layout mode: in the 16:3 layout, dots render as a vertical column with labels to the right instead of a horizontal strip with labels below
- No other logic changes — GPS, geofence, announcements, and Supabase code are untouched

---

## Rollout Sequence

1. Restructure `onboard.html` DOM into the three-column zone structure
2. Add the `@media (min-aspect-ratio: 4/1)` CSS block in `onboard.css` with the grid layout and vh font sizes
3. Update `renderTubeTrack` in `onboard.js` to render the vertical dot column when in wide mode
4. Test at browser window sized to ~2560×480 (zoom out), then at the normal Fire HD 10 size to confirm the fallback layout is undisturbed
5. No changes to `src/gps.js`, `src/announcements.js`, `src/engine.js`, or any Supabase schema
