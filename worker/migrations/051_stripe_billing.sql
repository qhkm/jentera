-- Stripe Billing (migration 051).
--
-- Stripe becomes a source of truth for the paid lifecycle. `business.plan`
-- (free | pro | team, migrations 016 + 033) stays the control-plane fact the
-- runtime reads; the Stripe webhook is now one of the things that sets it.
--
-- Ownership boundary: a Stripe customer (cus_...) maps to a business. The
-- webhook arrives with no session and no tenant, so `business` (RLS-forced)
-- is invisible to it; the security-definer helper below resolves the one id
-- it needs, in the same shape as business_plan (migration 038).
--
-- Numbered 051 deliberately: 050 is reserved by the vault-connection work on
-- main, so this must not collide with it at merge.

alter table if exists business
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_status text,
  add column if not exists stripe_current_period_end timestamptz;

-- One Stripe customer per business. Multiple NULLs are allowed by the
-- partial index, so businesses not yet in Stripe are unaffected.
create unique index if not exists idx_business_stripe_customer
  on business (stripe_customer_id)
  where stripe_customer_id is not null;

-- Webhook idempotency. Stripe redelivers an event until the endpoint answers
-- 2xx, so the same event id can arrive more than once. The id is the primary
-- key: a replay finds the row and is dropped. No tenant content lives here,
-- so it is deliberately not RLS-protected (the webhook runs outside a
-- tenant).
create table if not exists stripe_event (
  id           text primary key,
  type         text not null,
  business_id  uuid,
  processed_at timestamptz not null default now()
);

grant select, insert, delete on stripe_event to aisar_app;

-- Resolve the business behind a Stripe customer id, returning one id and
-- nothing else. security definer so it can read the RLS-forced `business`
-- table without a tenant set.
create or replace function public.business_id_for_stripe_customer(p_customer text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select b.id from public.business as b where b.stripe_customer_id = p_customer
$$;

revoke all on function public.business_id_for_stripe_customer(text) from public;
grant execute on function public.business_id_for_stripe_customer(text) to aisar_app;
