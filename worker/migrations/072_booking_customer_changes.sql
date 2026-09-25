-- Customer self-service for Bookings. A customer proves possession of the
-- booking reference and WhatsApp number, then receives a short-lived opaque
-- session. Tokens are stored only as SHA-256 hashes.

alter table booking add column if not exists customer_cancelled_at timestamptz;
alter table booking add column if not exists rescheduled_from_id uuid;
alter table booking add column if not exists rescheduled_to_id uuid;

alter table booking drop constraint if exists booking_rescheduled_from_fk;
alter table booking add constraint booking_rescheduled_from_fk
  foreign key (business_id, rescheduled_from_id) references booking (business_id, id);
alter table booking drop constraint if exists booking_rescheduled_to_fk;
alter table booking add constraint booking_rescheduled_to_fk
  foreign key (business_id, rescheduled_to_id) references booking (business_id, id);
alter table booking drop constraint if exists booking_rescheduled_distinct_check;
alter table booking add constraint booking_rescheduled_distinct_check check (
  (rescheduled_from_id is null or rescheduled_from_id <> id) and
  (rescheduled_to_id is null or rescheduled_to_id <> id)
);

create table if not exists booking_customer_session (
  business_id uuid not null,
  token_hash  text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  booking_id  uuid not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  primary key (business_id, token_hash),
  foreign key (business_id, booking_id) references booking (business_id, id) on delete cascade
);
create index if not exists booking_customer_session_expiry
  on booking_customer_session (business_id, expires_at);
alter table booking_customer_session enable row level security;
alter table booking_customer_session force row level security;
drop policy if exists booking_customer_session_tenant on booking_customer_session;
create policy booking_customer_session_tenant on booking_customer_session
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update, delete on booking_customer_session to aisar_app;
revoke truncate, references, trigger on booking_customer_session from aisar_app;
