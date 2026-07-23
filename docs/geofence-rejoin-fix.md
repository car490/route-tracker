# Fix: Geofence Tracking Doesn't Rejoin After Off-Route Detour

## Problem

The route progress tracker advances strictly sequentially — it only moves forward when the vehicle enters the *next expected* geofence in order. When a road closure forces a detour around one or more geofences, the vehicle never triggers the expected next geofence, so progress tracking stalls permanently, even once the vehicle is back on the original route and passing later timing points. Currently requires a manual restart from the rejoin point.

## Fix

Replace strict "next geofence only" matching with forward-searching match-and-jump logic:

1. On each ping, first check the normal case: does it match the next expected geofence (`currentIndex + 1`)? If yes, advance normally, no status change.
2. If not, search **forward only** (never backward) through remaining geofences from `currentIndex + 2` onward for a match.
3. Require **2 consecutive pings** matching the same forward geofence before committing the jump, to avoid false positives from parallel/nearby roads.
4. On confirmed match, jump `currentIndex` to the matched index. Mark all geofences between the old and new index with a status (see below) instead of leaving them `null` — `null` is ambiguous between "not yet reached," "deliberately skipped," and "data error."

## Status classification on jump

Based on `gap = matchedIndex - currentIndex`:

| Gap | Likely cause | Status |
|---|---|---|
| 1 | Normal progress | `visited` |
| 2–3 | GPS/signal dropout | `skipped_signal` |
| >3 | Genuine route detour | `skipped_detour` |

Thresholds are a starting point — tune based on typical timing-point spacing on real routes.

## Core matching logic (pseudocode)

```
function evaluatePing(ping, route, currentIndex, pendingMatch) {
  // 1. Normal case
  if (matchesGeofence(ping, route[currentIndex + 1])) {
    return { newIndex: currentIndex + 1, status: 'visited' };
  }

  // 2. Off-route: search forward only, from current+2 onward
  for (let i = currentIndex + 2; i < route.length; i++) {
    if (matchesGeofence(ping, route[i])) {
      const count = (pendingMatch?.index === i) ? pendingMatch.count + 1 : 1;

      if (count >= 2) {
        const gap = i - currentIndex;
        const status = gap <= 3 ? 'skipped_signal' : 'skipped_detour';
        return {
          newIndex: i,
          status,
          markSkipped: { from: currentIndex + 1, to: i - 1, status },
        };
      }
      return { newIndex: currentIndex, status: 'pending_confirmation', pendingMatch: { index: i, count } };
    }
  }

  return { newIndex: currentIndex, status: 'off_route', pendingMatch: null };
}
```

Notes:
- `pendingMatch` needs to persist across ping evaluations (not reset each call) to count consecutive matches.
- Reset `pendingMatch` to `null` if a ping doesn't match the pending candidate — don't let matches to different forward geofences accumulate against each other's counts.

## Schema change

Add a `visit_status` enum column to the timing-point-visit table (or equivalent), rather than relying on `null`:

```sql
CREATE TYPE visit_status AS ENUM ('visited', 'skipped_signal', 'skipped_detour', 'pending');

ALTER TABLE <timing_point_visits_table>
  ADD COLUMN visit_status visit_status NOT NULL DEFAULT 'pending';
```

- Existing `null`/unvisited rows should default to `pending`.
- Keep the raw GPS ping log untouched regardless of status — needed if actual detour path ever needs backfilling for reporting.

## Downstream consideration

Duty card / coverage reporting views that currently assume "visited or null" will need to handle `skipped_signal` and `skipped_detour` distinctly, since they likely warrant different treatment (data quality issue vs genuine operational detour).
