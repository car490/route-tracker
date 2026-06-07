-- Update traffic_area values to match current DVSA/TC area names.
-- DROP constraint first — otherwise UPDATEs to new values are rejected by the old constraint.

alter table public.companies
  drop constraint if exists companies_traffic_area_check;

update companies set traffic_area = 'North East of England'                where traffic_area = 'Northern';
update companies set traffic_area = 'North West of England'                where traffic_area = 'North Western';
update companies set traffic_area = 'East of England'                      where traffic_area in ('Eastern', 'East Midlands');
update companies set traffic_area = 'West of England'                      where traffic_area = 'Western';
update companies set traffic_area = 'Wales'                                where traffic_area = 'Welsh';
update companies set traffic_area = 'London and the South East of England' where traffic_area = 'South Eastern and Metropolitan';
update companies set traffic_area = 'Scotland'                             where traffic_area = 'Scottish';
-- West Midlands is unchanged

alter table public.companies
  add constraint companies_traffic_area_check
  check (traffic_area in (
    'North East of England',
    'North West of England',
    'East of England',
    'West Midlands',
    'West of England',
    'London and the South East of England',
    'Wales',
    'Scotland'
  ));
