/* ============================================================
   Per-rider model-spend ledger for the model proxy.

   The proxy (worker/src/routes/model.ts) verifies runtime-facing
   `sk-jentera-v1.…` credentials and meters every completion against
   the signed $5/month ceiling embedded in the credential. This table
   is that meter's backing store — an upsert keyed by (rider_id,
   month), where rider_id is the already-pseudonymous runtime name
   (aisar-b-…, a one-way hash of the business id).

   RLS is enabled and identity-agnostic on purpose: the table holds
   only a pseudonymous rider id and a dollar figure — no tenant data
   to isolate. If tenant data is ever added here, RLS must be reworked
   around business_id instead.
   ============================================================ */

create table if not exists public.fmcv_rider_spend (
  rider_id        text        not null,
  month           text        not null,
  spend_usd_cents integer     not null default 0 check (spend_usd_cents >= 0),
  updated_at      timestamptz not null default now(),
  primary key (rider_id, month)
);

create index if not exists idx_fmcv_rider_spend_month
  on public.fmcv_rider_spend (month, rider_id);

alter table public.fmcv_rider_spend enable row level security;

drop policy if exists fmcv_rider_spend_select on public.fmcv_rider_spend;
create policy fmcv_rider_spend_select on public.fmcv_rider_spend
  for select to aisar_app
  using (true);

drop policy if exists fmcv_rider_spend_insert on public.fmcv_rider_spend;
create policy fmcv_rider_spend_insert on public.fmcv_rider_spend
  for insert to aisar_app
  with check (true);

drop policy if exists fmcv_rider_spend_update on public.fmcv_rider_spend;
create policy fmcv_rider_spend_update on public.fmcv_rider_spend
  for update to aisar_app
  using (true)
  with check (true);

revoke all on public.fmcv_rider_spend from public;
grant select, insert, update on public.fmcv_rider_spend to aisar_app;

comment on table public.fmcv_rider_spend is
  'Model-spend ledger for runtime-facing jentera credentials (sk-jentera-v1). '
  'No-PII/no-tenant-data table: RLS is enabled with identity-agnostic '
  'policies; if tenant data is ever added here, rework RLS around business_id.';
