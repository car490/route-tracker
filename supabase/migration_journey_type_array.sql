-- migration_journey_type_array.sql
-- Convert routes.journey_type from scalar text to text[]
-- so a route can belong to more than one journey type category.
-- Apply in Supabase SQL Editor.

-- 1. Widen the column – wrap every existing single value in an array.
alter table public.routes
  alter column journey_type type text[]
  using array[journey_type];

-- 2. Drop the old scalar check constraint.
alter table public.routes
  drop constraint if exists routes_journey_type_check;

-- 3. Ensure the array is never empty.
alter table public.routes
  add constraint routes_journey_type_nonempty
  check (array_length(journey_type, 1) > 0);

-- 4. Validate every element against the allowed set.
alter table public.routes
  add constraint routes_journey_type_valid
  check (journey_type <@ array[
    'Local Bus',
    'Open Door Schools',
    'Contract Schools',
    'Private Hire',
    'Excursion',
    'Tour',
    'Other Contract'
  ]::text[]);
