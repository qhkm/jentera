/* ============================================================
   Rider spend ledger in micro-dollars.

   The cent ledger rounded every metered request up to a whole cent, so a
   0.7¢ quick reply was charged 1¢ and a $0.00042 completion was charged
   $0.01. Costs are computed in micro-USD already (modelCostMicrousd); the
   ledger now stores that figure unchanged. Existing balances are carried
   over at 10,000 micro-USD per cent.

   The cent column is deliberately kept for now: this migration runs before
   the Worker that reads the new column deploys, and the still-live Worker
   keeps reading and writing cents until it is replaced. Dropping the column
   here would 500 every model call in that window. A later migration drops
   it once no deployed writer touches it.
   ============================================================ */

alter table public.fmcv_rider_spend
  add column if not exists spend_microusd bigint not null default 0
    check (spend_microusd >= 0);

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'fmcv_rider_spend'
       and column_name = 'spend_usd_cents'
  ) then
    update public.fmcv_rider_spend
       set spend_microusd = greatest(spend_microusd, spend_usd_cents::bigint * 10000);
  end if;
end $$;

comment on column public.fmcv_rider_spend.spend_microusd is
  'Accumulated model spend for the month in micro-USD (1e-6 USD), exact per request.';
