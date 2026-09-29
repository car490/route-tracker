-- stop_time_upload_problem: tells ops when the server refused a trip's stop
-- times. Idempotent; safe to re-run.
--
-- Follow-up to migration_record_journey_stop_times.sql (2026-09-29). For ten
-- weeks every Driver/Solo upload was refused and nobody knew: the Driver told
-- the driver "will sync automatically", both apps kept the trip queued and
-- retried in silence, and ops had nothing to look at. A refusal (the server
-- answered and said no, as opposed to no signal) now:
--   - on the Driver, tells the driver to tell the office;
--   - on both Driver and Solo, calls report_stop_time_upload_problem() once
--     per queued trip, which the dashboard's Journeys page shows as a warning
--     on that journey.
-- The trip stays queued on the device either way, so nothing is lost; if a
-- later retry is accepted, record_journey_stop_times() marks the problem
-- resolved and the warning goes away.
--
-- One open problem per journey (a later report updates it), so a device can't
-- fill the table. The devices write only through the function (anon has no
-- grant on the table); company_id comes from the journey, never the caller.

create table if not exists public.stop_time_upload_problem (
  id          uuid        primary key default gen_random_uuid(),
  journey_id  uuid        not null references public.journeys(id) on delete cascade,
  company_id  uuid        not null references public.companies(id) on delete cascade,
  source      text        not null check (source in ('driver', 'solo')),
  http_status integer,
  reason      text        not null default '' check (char_length(reason) <= 500),
  row_count   integer     not null default 0 check (row_count >= 0),
  reported_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists stop_time_upload_problem_open_unique
  on public.stop_time_upload_problem (journey_id) where resolved_at is null;
create index if not exists stop_time_upload_problem_company_idx
  on public.stop_time_upload_problem (company_id, reported_at);

-- Revoke first: this schema's default privileges would otherwise hand anon
-- SELECT and authenticated ALL (incl. TRUNCATE, which RLS doesn't gate).
revoke all on public.stop_time_upload_problem from anon, authenticated;
grant select on public.stop_time_upload_problem to authenticated;

alter table public.stop_time_upload_problem enable row level security;

drop policy if exists "company_select" on public.stop_time_upload_problem;
create policy "company_select" on public.stop_time_upload_problem
  for select to authenticated
  using (company_id = current_company_id());

-- Called by the Driver PWA and Announce Solo (anon) when an upload of a
-- trip's stop times is refused. Same entitlement check as the other
-- anon-callable journey RPCs, first. A journey id that doesn't exist records
-- nothing.
create or replace function public.report_stop_time_upload_problem(
  p_journey_id  uuid,
  p_source      text,
  p_http_status integer,
  p_reason      text,
  p_row_count   integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_jwt_journey_allowed(p_journey_id) then
    raise exception 'This duty token does not cover journey %', p_journey_id using errcode = 'insufficient_privilege';
  end if;
  if p_source is null or p_source not in ('driver', 'solo') then
    raise exception 'p_source must be driver or solo' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.stop_time_upload_problem (journey_id, company_id, source, http_status, reason, row_count)
  select j.id, j.company_id, p_source, p_http_status, left(coalesce(p_reason, ''), 500), greatest(coalesce(p_row_count, 0), 0)
    from public.journeys j
   where j.id = p_journey_id
  on conflict (journey_id) where resolved_at is null do update
     set source      = excluded.source,
         http_status = excluded.http_status,
         reason      = excluded.reason,
         row_count   = excluded.row_count,
         reported_at = now();
end;
$$;

revoke execute on function public.report_stop_time_upload_problem(uuid, text, integer, text, integer) from public, authenticated;
grant execute on function public.report_stop_time_upload_problem(uuid, text, integer, text, integer) to anon;

-- record_journey_stop_times(), unchanged except the last step: an accepted
-- upload resolves any open problem for that journey.
create or replace function public.record_journey_stop_times(p_journey_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_jwt_journey_allowed(p_journey_id) then
    raise exception 'This duty token does not cover journey %', p_journey_id using errcode = 'insufficient_privilege';
  end if;
  if not public.is_journey_in_progress(p_journey_id) then
    raise exception 'Journey % is not in progress', p_journey_id using errcode = 'insufficient_privilege';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Too many stop times in one call (% > 500)', jsonb_array_length(p_rows) using errcode = 'invalid_parameter_value';
  end if;

  insert into public.journey_stop_times (journey_id, timetable_stop_id, arrived_at, visit_status)
  select p_journey_id,
         (r->>'timetable_stop_id')::uuid,
         (r->>'arrived_at')::timestamptz,
         coalesce(r->>'visit_status', 'visited')
    from jsonb_array_elements(p_rows) as r
   where nullif(r->>'timetable_stop_id', '') is not null
  on conflict (journey_id, timetable_stop_id) where timetable_stop_id is not null do nothing;

  get diagnostics v_count = row_count;

  update public.stop_time_upload_problem
     set resolved_at = now()
   where journey_id = p_journey_id and resolved_at is null;

  return v_count;
end;
$$;

revoke execute on function public.record_journey_stop_times(uuid, jsonb) from public, authenticated;
grant execute on function public.record_journey_stop_times(uuid, jsonb) to anon;
