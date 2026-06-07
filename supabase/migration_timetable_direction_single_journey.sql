-- Add 'Morning' and 'Afternoon' to the timetables direction check constraint
-- so that single-journey routes can be saved.
alter table timetables
  drop constraint timetables_direction_check;

alter table timetables
  add constraint timetables_direction_check
  check (direction in ('Outbound', 'Inbound', 'Circular', 'Morning', 'Afternoon'));
