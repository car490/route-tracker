```markdown
# Fleet data subsystem for non‑local route planner (Agent spec)

## 1. Context and purpose

**System type:**
Non‑local service **route and timetable planner** (private hire, schools, tours, contracts, rail replacement, express, etc.).

**This subsystem's purpose:**
- Auto‑collect bus/coach **fleet details** from open data (primarily MOT + manufacturer specs).
- Pre‑populate vehicle records for an operator.
- Allow the operator to **review, correct, and override** any field.
- Always use **operator‑confirmed** values in planning logic.

**Not in scope (explicitly):**
- No compliance engine.
- No tachograph / drivers' hours enforcement.
- No DVSA‑style monitoring.
- No legal validation of operator licences.

---

## 2. High‑level architecture

### 2.1 Core idea

1. **Auto‑collected layer** — immutable, re‑ingested from open data.
2. **Operator override layer** — editable by operator, never overwritten by ingestion.
3. **Canonical view** — merged view used by the planner, where operator overrides always win.

### 2.2 Technology

- **Database:** Supabase PostgreSQL.
- **External data:**
  - MOT bulk / API (vehicle identity + basic attributes).
  - Manufacturer spec sheets (dimensions, seating, weights, etc.).
- **Domain anchor:** Operator data already present, keyed by **operator_licence_number** (from VOL).

---

## 3. Database schema

### 3.1 Existing table (reference)

Assume an existing `operators` table:

```sql
CREATE TABLE operators (
    operator_licence_number VARCHAR PRIMARY KEY,
    operator_name TEXT NOT NULL,
    trading_name TEXT,
    traffic_area TEXT,
    status TEXT,
    authorised_vehicles INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);
```

Agent: **do not modify** this table; only reference it.

---

### 3.2 `vehicles_raw` — auto‑collected data

**Responsibility:** Store all data obtained automatically from MOT and manufacturer specs.
**Characteristics:**
- Overwritten on re‑ingestion.
- Never edited by operators.
- Full raw payload retained for audit.

```sql
CREATE TABLE vehicles_raw (
    reg VARCHAR PRIMARY KEY,
    make TEXT,
    model TEXT,
    body_type TEXT,
    fuel_type TEXT,
    vehicle_category TEXT,
    first_use_date DATE,
    length_mm INTEGER,
    width_mm INTEGER,
    height_mm INTEGER,
    seats INTEGER,
    weight_gvw INTEGER,
    emissions_class TEXT,
    source JSONB, -- raw MOT + spec payload
    collected_at TIMESTAMP DEFAULT NOW()
);
```

**Rules:**
- `reg` must be normalised to uppercase, no spaces.
- On re‑ingestion, **upsert** by `reg`.
- `source` must contain enough data to reconstruct the mapping logic if needed.

---

### 3.3 `vehicles_operator` — operator overrides

**Responsibility:** Store only fields that the operator has explicitly confirmed or changed.
**Characteristics:**
- Never overwritten by ingestion.
- One row per registration that the operator has touched.
- Tied to a specific operator via `operator_licence_number`.

```sql
CREATE TABLE vehicles_operator (
    reg VARCHAR PRIMARY KEY REFERENCES vehicles_raw(reg) ON DELETE CASCADE,
    operator_licence_number VARCHAR REFERENCES operators(operator_licence_number),
    seats_override INTEGER,
    length_mm_override INTEGER,
    width_mm_override INTEGER,
    height_mm_override INTEGER,
    weight_gvw_override INTEGER,
    emissions_class_override TEXT,
    accessible_override BOOLEAN,
    luggage_capacity_override INTEGER,
    notes TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);
```

**Rules:**
- `operator_licence_number` is required when creating a row.
- No automatic updates from external data.
- All changes must update `updated_at`.

---

### 3.4 `vehicles_canonical` — merged view

**Responsibility:** Provide a single, queryable view of each vehicle as used by the planner.
**Characteristics:**
- Read‑only view (or materialized view if needed).
- Operator overrides take precedence over raw data.

```sql
CREATE VIEW vehicles_canonical AS
SELECT
    r.reg,
    o.operator_licence_number,
    COALESCE(o.seats_override, r.seats) AS seats,
    COALESCE(o.length_mm_override, r.length_mm) AS length_mm,
    COALESCE(o.width_mm_override, r.width_mm) AS width_mm,
    COALESCE(o.height_mm_override, r.height_mm) AS height_mm,
    COALESCE(o.weight_gvw_override, r.weight_gvw) AS weight_gvw,
    COALESCE(o.emissions_class_override, r.emissions_class) AS emissions_class,
    o.accessible_override,
    o.luggage_capacity_override,
    r.make,
    r.model,
    r.body_type,
    r.fuel_type,
    r.vehicle_category,
    r.first_use_date,
    r.collected_at
FROM vehicles_raw r
LEFT JOIN vehicles_operator o ON r.reg = o.reg;
```

**Usage:**
- All route planning, vehicle assignment, and feasibility checks must query `vehicles_canonical`, not the underlying tables directly.

---

## 4. Ingestion and update flows

### 4.1 Operator onboarding: registration capture

**Goal:** Collect a list of registrations for a given operator.

**Agent tasks:**
1. Provide API endpoints / UI hooks to:
   - Add a single registration.
   - Bulk add registrations (CSV, textarea, etc.).
2. Normalise registrations (uppercase, strip spaces).
3. For each registration:
   - Ensure a row exists in `vehicles_raw` (create placeholder if external data not yet fetched).
   - Optionally create a row in `vehicles_operator` with `operator_licence_number` set.

**Constraints:**
- Do not infer operator from MOT; operator is explicitly chosen/confirmed by the user.

---

### 4.2 External data ingestion (MOT + manufacturer specs)

**Goal:** Populate/refresh `vehicles_raw` for known registrations.

**Agent tasks:**
1. For each `reg` in `vehicles_raw`:
   - Fetch MOT data.
   - Extract: `make`, `model`, `body_type`, `fuel_type`, `vehicle_category`, `first_use_date`, any available emissions info.
2. Map `make`/`model`/`body_type` to manufacturer spec tables (to be defined separately) to obtain:
   - `length_mm`, `width_mm`, `height_mm`, `seats`, `weight_gvw`, `emissions_class` (if not from MOT).
3. Upsert into `vehicles_raw`:
   - Overwrite all non‑key fields.
   - Update `collected_at`.
   - Store full raw payload in `source`.

**Constraints:**
- Never touch `vehicles_operator` in this process.
- If mapping fails, leave fields `NULL` and rely on operator input.

---

### 4.3 Operator review and edit

**Goal:** Let the operator correct or override any field.

**Agent tasks:**
1. Build API / UI that reads from `vehicles_canonical` and displays:
   - Registration, make, model, body type, fuel type.
   - Seats, length, width, height, weight, emissions, accessibility, luggage capacity.
2. When the operator edits a field:
   - Upsert into `vehicles_operator` for that `reg` and `operator_licence_number`.
   - Only write the override fields that changed.
   - Update `updated_at`.

**Rules:**
- `vehicles_canonical` must immediately reflect the change (view semantics).
- Operator can clear an override (set override column to `NULL`) to fall back to raw data.

---

## 5. Usage in route planning

### 5.1 Required fields for feasibility

The planner should use `vehicles_canonical` to obtain:

- `seats` — for capacity planning.
- `length_mm`, `width_mm`, `height_mm` — for route geometry and restrictions.
- `weight_gvw` — for weight‑restricted roads.
- `emissions_class` and `fuel_type` — for CAZ/LEZ logic.
- `accessible_override` — for PSVAR‑sensitive work.
- `luggage_capacity_override` — for tours/airport work.

### 5.2 Non‑goals

- Do not block routes based on VOL licence status.
- Do not attempt to validate legal compliance.
- Do not infer or enforce driver hours.

---

## 6. Governance and safety constraints

**Agent must:**

- Treat `vehicles_raw` as **system‑managed** and `vehicles_operator` as **user‑managed**.
- Never overwrite operator overrides from ingestion.
- Keep all external data mapping logic deterministic and reproducible (log mapping decisions in `source` if needed).
- Avoid storing any secrets or credentials in the database schema or logs.
- Keep all migrations idempotent and reversible.

---

## 7. Deliverables for this subsystem

The agent should produce:

1. **SQL migrations** for:
   - `vehicles_raw`
   - `vehicles_operator`
   - `vehicles_canonical` view

2. **Ingestion logic** (language/framework agnostic description is fine, but must be precise) for:
   - Populating `vehicles_raw` from MOT + manufacturer specs.

3. **API contracts** for:
   - Adding registrations for an operator.
   - Listing fleet for an operator (from `vehicles_canonical`).
   - Editing vehicle fields (writing to `vehicles_operator`).

4. **Basic test cases**:
   - When no overrides exist, canonical values equal raw values.
   - When overrides exist, canonical values equal overrides.
   - Re‑ingestion updates `vehicles_raw` but does not change canonical values where overrides exist.

This spec is complete for building the fleet data subsystem that auto‑collects, pre‑populates, and lets operators correct their fleet details for use in a non‑local route and timetable planner.
```

---

## Reality check against this codebase (2026-07-01)

Before treating the spec above as buildable as-is, note where it diverges from what actually exists:

- **`operators` doesn't exist as such** — our tenant table is `companies` (`supabase/schema.sql:11`), which already has `operator_licence_number` and `traffic_area`. Use `companies` wherever the spec says `operators`.
- **`vehicles` already exists** (`supabase/schema.sql:173`) as a single flat, company-scoped table with manual CRUD (`dashboard/src/features/vehicles/VehiclesPage.jsx`). It is *not* split into raw/override/canonical layers.
- **The spec's `vehicles_raw`/`vehicles_operator` are keyed globally by `reg` only** — no `company_id`. That's incompatible with our multi-tenant model as written (only one company could ever hold override data for a given registration). Needs a composite key fix if we bring in an override table at all.
- **"MOT" data doesn't cover full-size coaches.** The public DVSA MOT History API only covers vehicles on the standard MOT scheme (cars, vans, minibuses ≤8 passenger seats). Full-size coaches/buses (9+ seats) go through DVSA's separate PSV Annual Test scheme, which has no equivalent public per-vehicle API.
- **"Manufacturer spec sheets" aren't a real, defined data source** — no open dataset gives dimensions/seats/GVW by registration or by make+model for PSVs. The spec punts on this ("to be defined separately").

## Decisions made (2026-07-01)

1. **Auto-collect source:** DVLA Vehicle Enquiry Service (VES) API for identity fields (make, colour, fuel type, year of manufacture, MOT/tax status). Covers all registered vehicles including full-size PSVs. Does **not** provide body_type or dimensions.
2. **Spec data (dimensions/seats/GVW):** investigate a commercial vehicle-data API before committing to a manual seed table — coverage/cost unconfirmed, needs a research spike first.
3. **Architecture:** lighter integration, not the full 3-layer model. Keep the existing `vehicles` table and `VehiclesPage.jsx` as the primary interface. Add a global reg-keyed cache table for auto-collected data, plus provenance columns (`source`, `auto_populated_at`) on `vehicles` itself. No formal `vehicles_operator` override table — the operator edits `vehicles` directly, same as today, but fields can be pre-filled from the cache.
4. **API credentials:** none currently configured anywhere in the repo (checked `dashboard/.env*` and schema/migrations — no VES/DVLA/MOT keys exist). Registering for API access is a blocking first step.

## Status: PARKED (2026-07-02)

DVLA VES registration (https://register-for-ves.dvla.gov.uk) is **not currently accepting new users** — confirmed by the user directly on gov.uk. This blocks Phase 0 entirely, since VES was the chosen auto-collect source (decision 1 above). No workaround attempted; revisit when VES registration reopens, or reconsider the source-of-truth decision at that point (e.g. re-evaluate the commercial vehicle-data API option from decision 2, which might cover identity fields too, not just dimensions).

Do not restart Phase 0 work without first re-checking VES registration status — this was the second blocker found (after "no credentials exist yet") and turned out to be a hard stop, not just an unregistered-yet gap.

---

## TODO

### Phase 0 — Research & access (BLOCKED — see Status above)
- [ ] ~~Register for a DVLA VES API key~~ — blocked: gov.uk VES registration is closed to new users as of 2026-07-02. Check again before resuming.
- [ ] Confirm VES rate limits and whether it's viable for bulk/scheduled re-ingestion across a whole fleet, or lookup-on-demand only.
- [ ] Spike: survey commercial vehicle-data APIs (e.g. UK Vehicle Data, CDL Vehicle Data, HPI-style providers) for PSV dimension/seat/GVW coverage and pricing. Confirm at least one actually returns useful data for coach/minibus body types before building anything around it — if none do, fall back to manual entry for those fields (already true today) and drop this from the auto-collect scope.
- [ ] Decide fallback behaviour if VES returns nothing for a reg (new coach import, personalised plate, etc.) — leave fields null, no error.

### Phase 1 — Schema (lighter integration)
- [ ] Add global `vehicle_data_cache` table, keyed by `reg` (uppercase, no spaces), storing whatever VES (+ spec API, if adopted) returns: make, colour, fuel_type, year_of_manufacture, mot_status, mot_expiry_date, tax_status, plus `source jsonb` (raw payload) and `collected_at`.
- [ ] No `company_id` on this cache table — it's genuinely public per-VRM data, shared across all tenants, same reasoning as the spec's global `vehicles_raw`.
- [ ] Add `source jsonb` and `auto_populated_at timestamptz` columns to the existing `vehicles` table (migration file, e.g. `migration_vehicle_auto_source.sql`) so we can show "auto-filled" vs "manually entered" provenance in the UI without a separate override table.
- [ ] Add standard GRANT + RLS to the new cache table per `CLAUDE.md` rules — likely `select` to `authenticated`, no `anon` access, since it's only used server-side/dashboard-side.
- [ ] Update `supabase/schema.sql` with the new table/columns so a fresh reset stays complete.

### Phase 2 — Ingestion
- [ ] Build a lookup function (Vercel serverless endpoint, consistent with the existing duty-card-signing pattern — see [[project_duty_signing]] memory) that takes a `reg`, calls VES, upserts into `vehicle_data_cache`, and returns the normalised result.
- [ ] Never call ingestion automatically in bulk/on a schedule initially — trigger only on-demand when an operator adds/looks up a registration, to control API usage and match "operator explicitly confirms" intent from the spec.
- [ ] Keep credentials (VES API key) in Vercel environment variables, never in the repo or client-side bundle.

### Phase 3 — Dashboard UX
- [ ] In `VehiclesPage.jsx` "Add Vehicle" flow: add a "Look up" step after registration entry — call the new lookup endpoint, pre-fill make/fuel_type/year (and vehicle_type as a best-guess if derivable) into the existing form fields, leaving them fully editable.
- [ ] Visually distinguish auto-filled fields from operator-entered ones (e.g. small "auto" badge) using the new `auto_populated_at`/`source` columns — clears once the operator edits that field.
- [ ] Handle lookup failure/no-data gracefully — form still works as pure manual entry (current behaviour), just without pre-fill.
- [ ] No changes needed to seating_capacity/dimensions auto-fill unless Phase 0's commercial API spike finds a usable source — otherwise these stay manual, as today.

### Phase 4 — Tests
- [ ] Cache upsert is idempotent (re-lookup of the same reg updates the cache row, doesn't duplicate).
- [ ] Manual edits in `vehicles` are never overwritten by a later lookup (lookup only pre-fills at Add-time, doesn't touch existing rows).
- [ ] Lookup-not-found path leaves the form fully usable.

### Open questions to resolve before Phase 1 starts
- [ ] Does VES's terms of service actually permit this use case (fleet pre-population for a SaaS product), or is it scoped to single-vehicle personal checks only? Worth a direct read of the ToS, not an assumption.
- [ ] If the commercial spec-data API spike (Phase 0) comes back empty-handed, do we want to revisit a manually curated seed table of common coach/minibus specs by make+model as a lighter-weight alternative, or drop auto-spec entirely for v1?
