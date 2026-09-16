-- Production payment lifecycle, separate from the deferred 051 trigger pilot.
alter table business add column if not exists stripe_billing_review boolean not null default false;

create table if not exists billing_payment_adjustment (
  source_id text primary key,
  business_id uuid not null references business(id) on delete cascade,
  invoice_id text not null references billing_payment(invoice_id),
  charge_id text not null,
  kind text not null check (kind in ('refund', 'dispute')),
  created_at timestamptz not null default now()
);
alter table billing_payment_adjustment enable row level security;
alter table billing_payment_adjustment force row level security;
drop policy if exists tenant on billing_payment_adjustment;
create policy tenant on billing_payment_adjustment
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert on billing_payment_adjustment to aisar_app;
revoke update, delete on billing_payment_adjustment from aisar_app;

create or replace function public.billing_business_for_payment_intent(p_intent text) returns uuid
language sql stable security definer set search_path = pg_catalog, public, pg_temp
as $$ select business_id from public.billing_payment where payment_intent_id = p_intent $$;
revoke all on function public.billing_business_for_payment_intent(text) from public;
grant execute on function public.billing_business_for_payment_intent(text) to aisar_app;

-- Claims and entitlement changes commit in the same tenant transaction.
alter table stripe_event enable row level security;
alter table stripe_event force row level security;
drop policy if exists tenant on stripe_event;
create policy tenant on stripe_event
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert on stripe_event to aisar_app;
revoke update, delete on stripe_event from aisar_app;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='stripe_event_business_fk'
    and conrelid='public.stripe_event'::regclass) then
    alter table stripe_event add constraint stripe_event_business_fk foreign key (business_id)
      references business(id) on delete cascade;
  end if;
end $$;
