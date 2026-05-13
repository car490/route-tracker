-- Add contact fields to staff for duty card delivery
-- Apply in Supabase SQL Editor

alter table staff add column if not exists email text;
alter table staff add column if not exists phone text;
