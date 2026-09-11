-- Web push subscriptions: one row per browser that asked to be notified.
--
-- The endpoint is the push service's URL for that browser and is unique
-- across the whole table, not per tenant: the same browser keeps the same
-- endpoint whoever signs in, so a second account on a shared device must
-- not silently take over the first account's row. RLS hides the other
-- tenant's row, the insert conflicts, and the route answers 409 so the
-- browser drops that subscription and takes a fresh endpoint.
--
-- p256dh is the browser's uncompressed P-256 public key (65 bytes) and
-- auth its 16-byte secret, both base64url without padding: 87 and 22
-- characters. The worker encrypts every payload to them (RFC 8291).
create table if not exists push_subscription (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references business(id) on delete cascade,
  user_id      uuid not null references app_user(id) on delete cascade,
  endpoint     text not null unique
               check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  p256dh       text not null check (char_length(p256dh) = 87),
  auth         text not null check (char_length(auth) = 22),
  user_agent   text check (char_length(user_agent) <= 300),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_push_subscription_recipient
  on push_subscription (business_id, user_id);

alter table push_subscription enable row level security;
alter table push_subscription force row level security;
drop policy if exists push_subscription_tenant on push_subscription;
create policy push_subscription_tenant on push_subscription
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
