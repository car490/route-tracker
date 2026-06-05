-- Add contact email address to companies
alter table public.companies add column if not exists email text;
