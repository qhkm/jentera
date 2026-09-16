-- Payment evidence after integration migration 053. No usage-credit promise.
alter table business add column if not exists stripe_paid_through timestamptz;
create unique index if not exists idx_business_stripe_subscription
  on business (stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists billing_checkout (
  id uuid primary key,
  business_id uuid not null references business(id) on delete cascade,
  payer_user_id uuid not null references app_user(id),
  price_id text not null,
  plan text not null check (plan in ('pro', 'team')),
  interval text not null check (interval in ('month', 'year')),
  stripe_session_id text unique,
  url text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists billing_payment (
  invoice_id text primary key,
  business_id uuid not null references business(id) on delete cascade,
  subscription_id text not null,
  customer_id text not null,
  payment_intent_id text not null unique,
  payer_user_id uuid not null references app_user(id),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency = 'myr'),
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  created_at timestamptz not null default now()
);
-- Intent only; delivery is a separate, disabled phase with eligibility rechecks.
create table if not exists billing_appreciation_outbox (
  business_id uuid primary key references business(id) on delete cascade,
  payer_user_id uuid not null references app_user(id),
  invoice_id text not null references billing_payment(invoice_id),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
do $$ declare t text; begin
  foreach t in array array['billing_checkout', 'billing_payment', 'billing_appreciation_outbox'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant on %I', t);
    execute format('create policy tenant on %I using (business_id = nullif(current_setting(''app.business_id'', true), '''')::uuid) with check (business_id = nullif(current_setting(''app.business_id'', true), '''')::uuid)', t);
  end loop;
end $$;
grant select, insert, update on billing_checkout to aisar_app;
grant select, insert on billing_payment, billing_appreciation_outbox to aisar_app;
revoke update, delete on billing_payment, billing_appreciation_outbox from aisar_app;
create or replace function public.billing_business_for_checkout(p_session text) returns uuid
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$ select business_id from public.billing_checkout where stripe_session_id = p_session $$;
revoke all on function public.billing_business_for_checkout(text) from public;
grant execute on function public.billing_business_for_checkout(text) to aisar_app;
