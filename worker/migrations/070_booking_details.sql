-- Customer-facing context for the public booking flow.
alter table booking_settings
  add column if not exists location text
  check (location is null or char_length(location) between 1 and 160);

alter table booking_service
  add column if not exists description text
  check (description is null or char_length(description) between 1 and 240);

comment on column booking_settings.location is
  'Customer-facing venue or meeting instructions shown before a request is sent.';
comment on column booking_service.description is
  'Short customer-facing explanation of what the service includes.';
