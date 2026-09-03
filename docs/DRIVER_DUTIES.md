# Driver Duties & Drivers'-Hours Compliance (Agent spec)

## 1. Context and purpose

Driver ↔ journey ↔ vehicle allocation today is entirely manual: `DutyCardsPage.jsx`'s
weekly grid lets an ops user set `driver_id`/`vehicle_id` directly on `journeys` rows,
with no check against drivers'-hours rules, no sickness/leave awareness, and no
record of who changed what. This doc scopes the work to make that allocation
rule-aware and safely reassignable — the single highest-stakes piece of which is
drivers'-hours compliance (tachograph/WTD rules): get it wrong and a driver can pick
up a real infringement.

**This subsystem's purpose (v1):**
- Validate a driver's assigned journeys for a day (and surrounding days, for rest and
  weekly limits) against their `drivers_hours_rules` regime, using **scheduled**
  times — before a duty is published, not after the fact.
- Track sickness/absence so unavailable drivers can't be allocated.
- Give ops an easy-to-read roster view (drivers × days) with compliance status
  visible at a glance, and let them reassign quickly.
- Record who changed an allocation and when.

**Explicitly not in scope for v1** (see §11–12 for why, and when to revisit):
- No live/automatic tachograph data ingestion — see the TruTac blocker in §5.
- No optimizing auto-assignment solver — v1 validates and flags; it doesn't solve.
- No payroll/holiday-accrual calculation — absence tracking here is for
  allocation-blocking only.
- No AETR/EU-rules correctness guarantee — GB domestic (`DOMESTIC_GB`) is the
  correctness target for v1; AETR/EXEMPT stay wired through but untested.

This doc is the deliberate continuation of what `docs/VOL.md` (the parked fleet-data
subsystem spec) explicitly excluded from its own scope ("No compliance engine. No
tachograph / drivers' hours enforcement.").

---

## 2. What already exists — read this before writing any migration

A lot of the data model the user asked for is already in place. Don't recreate it.

- **`drivers_hours_rules`** (`supabase/schema.sql:63`) already models GB/AETR/EXEMPT
  regimes numerically: `max_daily_driving_mins`, `max_daily_duty_spread_mins`,
  `max_continuous_driving_mins`, `min_break_mins` (+ split-break rules),
  `min_daily_rest_mins`, `max_weekly_driving_mins`, `min_weekly_rest_mins`,
  `max_fortnightly_driving_mins`. This **is** "Tacho WTD Type" — no new column
  needed, just a rules engine that reads it (§6).
- **`employees`** (`schema.sql:116`) already has `work_type` (`FTE` / `SPLITSHIFT` /
  `TEMP` — `TEMP` is functionally the "AdHoc" flag) and `hours_rule` (FK into
  `drivers_hours_rules`, defaults `'DOMESTIC_GB'`). `status` is a blunt
  `AVAILABLE`/`UNAVAILABLE` toggle with no date range or reason — that's the gap
  §7 fills.
- **`vehicles`** (`schema.sql:173`) already has `seating_capacity` (column exists
  but is **not exposed in `VehiclesPage.jsx`'s form** — fix while touching this
  file) and a `journey_types text[]` (multi-select eligibility, used to gate the
  PWA's vehicle picker). No seatbelts flag, no single "default" journey type.
- **`journeys`** (`schema.sql:472`) is the atomic allocation unit: `driver_id`,
  `vehicle_id`, `journey_date`, `started_at`/`completed_at`, plus a link to
  `timetable_departures` (for scheduled times) or `journey_waypoints` (ad-hoc work).
  There is **no first-class "duty" row** — a duty is implicitly "all journeys for one
  driver on one date". Keep it that way; a new duty table would duplicate data
  that's already here and risk drifting out of sync.
- **`DutyCardsPage.jsx`** (`dashboard/src/features/journeys/`) is the existing
  weekly-grid interaction pattern (driver × date, assign per departure, generate a
  signed duty-card link). The new roster view (§8) should extend this pattern, not
  invent a new one.
- **`generate_duty_token()` / `get_duty_card()`** (`schema.sql:766`, `:966`) already
  sign and serve a driver's journeys for the day — the passwordless auth model
  (see project convention: no login screens, ever) that any new UI must respect.

---

## 3. Decisions made (2026-08-19)

1. **Tacho vendor in use:** TruTac.
2. **TruTac access method:** unconfirmed at time of writing — could be an API, a
   scheduled export, or manual-only. **Do not assume an API exists.** Treat this as
   an open blocker (§5), same posture as `VOL.md`'s DVLA VES registration blocker —
   that one turned out to be a hard stop after looking like a simple registration
   step, so verify before building anything Phase 5 depends on.
3. **Rules scope:** GB domestic (`DOMESTIC_GB`) is the correctness priority. AETR
   and EXEMPT rows stay in `drivers_hours_rules` and the engine should read them
   generically (not hardcode `DOMESTIC_GB`), but they are not the tested/certified
   target for v1.
4. **Architecture:** compliance checking starts from **scheduled/planned** journey
   times, independent of whether TruTac ever gets wired in. TruTac (§10) adds a
   second, independent check against **actual** driven time later — the two checks
   are complementary, not sequential dependencies. This means Phases 1–4 (the
   preventive engine, absence tracking, roster view) can all ship with real value
   before the TruTac blocker is resolved.

---

## 4. Migration file convention — important

Per `CLAUDE.md`: **new migrations go in `supabase/migration_<description>.sql`**
(flat, descriptive naming), not `supabase/migrations/<timestamp>_<description>.sql`.
That timestamped folder exists from an abandoned June 2026 convention attempt — do
not add new files there. Every new table needs GRANT + RLS per `CLAUDE.md`'s
standard pattern (`grant select on ... to anon; grant all on ... to authenticated;
alter table ... enable row level security;` + a `company_all` policy scoped via
`current_company_id()`), and `supabase/schema.sql` must be updated so a fresh reset
stays complete. If a policy calls a helper function (`current_company_id()` etc.),
it must be added to the main RLS block at the bottom of `schema.sql`, after the
helper functions — not inline.

---

## 5. Open questions / blockers

- **TruTac access method (blocks Phase 5 only).** Need to confirm with
  whoever administers TruTac today: does it expose an API, a scheduled
  export/report file, or is retrieval manual-only? This determines whether Phase 5
  is a polling integration or a periodic file-upload-and-parse flow (same shape as
  the CSV-import pattern already used elsewhere in this project). **Do not start
  Phase 5 without this answer** — re-check status before resuming, same discipline
  as `VOL.md`'s "don't restart Phase 0 without re-checking VES registration" note.
- Does TruTac's infringement/hours data key by driver card number, employee
  reference, or something else? Needed to map TruTac records back to `employees.id`
  — likely needs a new `employees.trutac_driver_ref` column, TBD once access method
  is known.
- Confirm whether TruTac's terms of service permit this integration use case at all
  before investing build time (same caution as VOL.md raised for VES).

---

## 6. Rules engine (Phase 2 — the core of this doc)

**Goal:** given a driver and a date, determine whether their scheduled journeys
comply with their `drivers_hours_rules` regime, and surface *which* rule failed.

**Approach — a Postgres function**, e.g.:

```sql
create or replace function public.check_duty_compliance(
  p_driver_id uuid,
  p_date      date
)
returns table (
  rule_id   text,
  rule_label text,
  passed    boolean,
  limit_mins integer,
  actual_mins integer,
  detail    text
)
language plpgsql
stable
as $$
  -- 1. Load the driver's hours_rule row from drivers_hours_rules.
  -- 2. Pull that driver's journeys for p_date (scheduled start/end per journey —
  --    from timetable_departures for timetabled work, journey_waypoints for
  --    ad-hoc work), plus the prior day (daily rest check) and the ISO week
  --    (weekly/fortnightly driving checks).
  -- 3. Compute per-day: total scheduled driving minutes (sum of journey scheduled
  --    durations), duty spread (first journey start to last journey end), longest
  --    continuous block before a gap >= min_break_mins.
  -- 4. Compare each computed value against the matching drivers_hours_rules
  --    column; emit one row per rule checked (pass or fail), not just an overall
  --    boolean, so the UI can say *which* limit is breached.
$$;
```

**Known simplification — document this in code comments, don't hide it:** a
journey's full scheduled duration is treated as driving time for this calculation.
In reality a journey may include standing/layover time at a terminus that isn't
"driving" in the tachograph sense. This is an acceptable v1 approximation for a
*preventive* check on planned schedules — it errs toward flagging too much, not too
little. §10 (TruTac) is what eventually validates against real recorded driving
time; don't try to make the scheduled-time check perfectly precise before that
exists.

**Where it's called:**
- Inline in the roster view (§8) when ops assigns/edits `journeys.driver_id` —
  warn before save, don't silently block (ops may have a legitimate reason to
  override, e.g. known short duty).
- As a standing report across all drivers for a given week, so infringement risk is
  visible without editing anything.

---

## 7. Absence / sickness (Phase 3)

New table, date-ranged (not a same-day-only toggle like today's `employees.status`):

```sql
create table public.employee_absences (
  id           uuid        primary key default gen_random_uuid(),
  employee_id  uuid        not null references employees(id) on delete cascade,
  start_date   date        not null,
  end_date     date        not null,
  type         text        not null check (type in ('sickness', 'annual_leave', 'unpaid', 'other')),
  status       text        not null default 'approved'
                 check (status in ('pending', 'approved', 'rejected')),
  notes        text,
  created_by   uuid        references employees(id),
  created_at   timestamptz not null default now(),
  check (end_date >= start_date)
);
```

Standard GRANT + RLS per §4. A driver on an approved absence overlapping a
proposed duty date must block/flag that allocation the same way a rules-engine
failure does — surface it in the same warning path in the roster view, not a
separate, easy-to-miss indicator.

---

## 8. Roster view (Phase 4)

New dashboard page: drivers × days grid, one row per driver, one column per day,
cells showing that driver's duty for the day colour-coded by `check_duty_compliance`
result (green/amber/red) and absence status. Click-to-reassign inline, building on
`DutyCardsPage.jsx`'s existing week-grid pattern rather than a new interaction
model. New VSA feature slice under `dashboard/src/features/` (consistent with the
existing `employees`/`vehicles`/`journeys` slices), or added to the `journeys`
slice alongside `DutyCardsPage` — build agent's call based on how much shared state
it ends up needing.

**Note:** this grid is a roster/wall-planner layout, not a data table — it is
exempt from the dashboard's usual "≤5 columns, no horizontal scroll" table-layout
rule (that rule targets record-listing tables like `EmployeesPage`/`VehiclesPage`,
not a 7-column-by-N-driver-rows planner view).

---

## 9. Vehicle attribute additions (Phase 1, small)

```sql
alter table public.vehicles
  add column seatbelts boolean not null default false,
  add column default_journey_type text;
```

`default_journey_type` is a single preferred value (distinct from the existing
`journey_types text[]` eligibility list) — e.g. a coach tagged eligible for both
Tours and Private Hire but *usually* run as Tours. No CHECK constraint against the
journey-types lookup table, matching the existing `journey_types`/`routes` columns'
precedent (validated at the application layer only). Also: expose the existing
`seating_capacity` column in `VehiclesPage.jsx`'s form — it's in the schema already
but missing from the UI.

---

## 10. Audit trail (Phase 1)

```sql
create table public.duty_allocation_audit (
  id           uuid        primary key default gen_random_uuid(),
  journey_id   uuid        not null references journeys(id) on delete cascade,
  changed_by   uuid        references employees(id),
  field        text        not null check (field in ('driver_id', 'vehicle_id')),
  old_value    uuid,
  new_value    uuid,
  changed_at   timestamptz not null default now()
);
```

Written by a trigger on `journeys` (`driver_id`/`vehicle_id` update) rather than
relying on every UI call site to remember to log it — a trigger can't be bypassed by
a future code path that edits `journeys` directly.

---

## 11. TruTac ingestion (Phase 5 — blocked, see §5)

**Goal (once unblocked):** import *actual* driven time / recorded infringements
from TruTac and compare against the same `drivers_hours_rules` regime, independent
of the planned-schedule check in §6. This is what catches a driver who ran over in
practice even though their roster looked compliant on paper (traffic delays, a
driver working while not on a scheduled journey, etc.).

Do not design the ingestion shape (file-import vs API-poll) until §5's blocker is
resolved — guessing wrong here risks the same wasted-build-then-discover-it's-wrong
outcome `VOL.md` hit with VES. Once the access method is known, this phase should
follow the same shape as `VOL.md`'s "lighter integration" decision: a global,
provenance-tagged cache table populated by ingestion, read-only to the app, with
`employees.trutac_driver_ref` (or equivalent) as the join key.

---

## 12. Auto-assignment (Phase 6 — future, optional)

A suggestion engine that, given open duties and available/eligible drivers,
proposes an assignment satisfying: `journey_types` match, vehicle eligibility
(seatbelts/capacity/type where relevant), §6's rules engine, §7's absence table, and
minimum rest since the driver's last duty. Stays human-approved in v1 — it suggests,
ops confirms via the roster view (§8). Do not attempt a fully automatic solver
before the preventive validation (§6) has been used in anger for a while and its
approximations (see §6's known simplification) are proven trustworthy enough to
build on.

---

## TODO

### Phase 0 — TruTac research (BLOCKED — see §5)
- [ ] Confirm TruTac's access method (API / scheduled export / manual only) with
  whoever administers it.
- [ ] Confirm TruTac's ToS permits this integration use case.
- [ ] Identify the join key TruTac uses per driver (card number, employee ref,
  etc.) and whether it maps cleanly to `employees.id`.

### Phase 1 — Schema
- [ ] `alter table vehicles add column seatbelts boolean, default_journey_type text`
  (§9), migration file per §4's naming convention.
- [ ] Surface `vehicles.seating_capacity` in `VehiclesPage.jsx`'s form (§9).
- [ ] `create table employee_absences` (§7) with standard GRANT + RLS.
- [ ] `create table duty_allocation_audit` (§10) + trigger on `journeys`.
- [ ] Update `supabase/schema.sql` with all of the above so a fresh reset stays
  complete.
- [ ] Apply to dev (`cgcbfgceputvdvhzrgio`) first, test, then production
  (`nwhayupsvcelyiwltdqo`), per `CLAUDE.md`'s DB migration workflow.

### Phase 2 — Rules engine
- [ ] Build `check_duty_compliance(driver_id, date)` (§6) — per-rule pass/fail, not
  just an overall boolean.
- [ ] Handle both timetabled journeys (`timetable_departures`) and ad-hoc journeys
  (`journey_waypoints`) when computing scheduled driving time.
- [ ] Cover daily driving, daily duty spread, continuous-driving-before-break, and
  daily rest since the previous day's last journey, at minimum, for `DOMESTIC_GB`.
- [ ] Weekly/fortnightly driving checks (relevant mainly for AETR — lower priority
  per §3's GB-first decision, but don't hardcode `DOMESTIC_GB`-only logic that would
  need a rewrite later).
- [ ] Unit tests: a known-compliant day, a known daily-driving breach, a
  known-insufficient-rest case, a split-break case.

### Phase 3 — Absence/sickness
- [ ] CRUD UI for `employee_absences`, similar pattern to
  `employee_availability`'s edit flow in `EmployeesPage.jsx`.
- [ ] Wire absence into the roster view's warning path (§8) — same visibility as a
  rules-engine failure, not a separate/easy-to-miss indicator.

### Phase 4 — Roster view
- [ ] New drivers × days grid page (§8), extending `DutyCardsPage.jsx`'s pattern.
- [ ] Colour-code cells by `check_duty_compliance` result + absence status.
- [ ] Click-to-reassign inline, calling the rules engine before save and warning
  (not silently blocking) on a violation.
- [ ] Confirm the grid's column count is a deliberate exception to the dashboard's
  ≤5-column table rule (§8) — don't let a later lint/review pass "fix" it back down.

### Phase 5 — TruTac ingestion (unblocks after Phase 0)
- [ ] Design ingestion shape once §5 is answered (file-import vs API-poll).
- [ ] Global cache table with provenance columns, `employees.trutac_driver_ref` join
  key (§11).
- [ ] Compare actual vs. planned hours; surface real infringements distinctly from
  §6's preventive warnings.

### Phase 6 — Auto-assignment (future, optional)
- [ ] Suggestion engine per §12, human-approved only.
