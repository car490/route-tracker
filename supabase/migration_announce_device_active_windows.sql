-- Migration: BusOps Announce Solo — active-window scheduling
-- Apply in Supabase SQL Editor (Settings → SQL Editor → New query)
-- Date: 2026-09-01
--
-- A Solo device's idle loop (announceSoloAutopilot.js) previously polled its
-- own GPS every 5s, 24/7, whenever no journey was active — real battery/data
-- cost with no benefit outside the vehicle's actual operating hours. This
-- adds a per-device active-window schedule (which days/times it's allowed to
-- wake and poll at all) — see scheduleAutopilot.js's isWithinActiveWindow.
--
-- Same shape as employees' own employee_availability table: day_of_week
-- 0=Mon..6=Sun, window_start/window_end, window_end > window_start (a split
-- day — e.g. a morning school run and an afternoon return run with a dead
-- gap between — is two rows, not one midnight-wrapping window, exactly like
-- a SPLITSHIFT employee's two availability rows).
--
-- A device with zero rows here never wakes at all — same conservative
-- default an empty candidate_departure_ids list already gives it. For beta,
-- rows are inserted directly via SQL (no dashboard UI yet), same as
-- candidate_departure_ids/match_window_before_min/match_window_after_min/
-- terminus_radius_m already are.

create table if not exists public.announce_device_active_windows (
  id                  uuid primary key default gen_random_uuid(),
  announce_device_id  uuid not null references public.announce_devices(id) on delete cascade,
  day_of_week         smallint not null check (day_of_week between 0 and 6),
  window_start        time not null,
  window_end          time not null,
  check (window_end > window_start)
);

create index if not exists announce_device_active_windows_device_id_idx
  on public.announce_device_active_windows (announce_device_id);

grant select on public.announce_device_active_windows to anon;
grant all    on public.announce_device_active_windows to authenticated;

alter table public.announce_device_active_windows enable row level security;

-- Ops (dashboard login): full CRUD scoped to the parent device's company.
create policy "company_all" on public.announce_device_active_windows
  for all to authenticated
  using (
    announce_device_id in (
      select id from public.announce_devices where company_id = current_company_id()
    )
  )
  with check (
    announce_device_id in (
      select id from public.announce_devices where company_id = current_company_id()
    )
  );

-- Announce device (anon): may read only its own windows, same device_id
-- JWT-claim scoping as announce_devices' own device_self policy.
create policy "device_self" on public.announce_device_active_windows
  for select to anon
  using (announce_device_id = (auth.jwt() ->> 'device_id')::uuid);
