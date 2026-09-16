-- Account-level promotion history survives device changes and business scope.
-- Internal resolver returns only a boolean, never another tenant's receipts.
create or replace function public.billing_payer_has_payment(p_user uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$ select exists(select 1 from public.billing_payment where payer_user_id = p_user) $$;
revoke all on function public.billing_payer_has_payment(uuid) from public;
grant execute on function public.billing_payer_has_payment(uuid) to aisar_app;
