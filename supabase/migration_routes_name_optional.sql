-- The Route Wizard (and the Routes page's Add/Edit Route form before it) label
-- "Name" as optional, but the column was still NOT NULL — inserting with a blank
-- name violated the constraint. Name is a human-friendly label on top of the
-- required, unique service_code; it's fine for it to be absent.

alter table routes alter column name drop not null;
