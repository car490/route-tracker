-- ── Vehicle dimensions ───────────────────────────────────────────────────────
-- Adds physical dimensions to vehicles for bus/coach-aware route planning.
-- Used by the Route Planner to pass vehicle restrictions to OpenRouteService.
-- Applied: 2026-05-17

alter table vehicles
  add column if not exists height_metres  float8,
  add column if not exists width_metres   float8,
  add column if not exists length_metres  float8;
