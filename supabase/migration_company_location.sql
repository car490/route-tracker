-- Add central operations location fields to companies
-- Columns are nullable: existing rows do not require a value.

alter table public.companies
  add column if not exists address_line_1  text,
  add column if not exists address_line_2  text,
  add column if not exists city            text,
  add column if not exists postcode        text,
  add column if not exists lat             float8,
  add column if not exists lon             float8;
