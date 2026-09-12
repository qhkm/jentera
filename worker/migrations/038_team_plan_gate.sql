-- The plan gate at session resolution. A staff membership counts only while
-- the business is on the team plan: when a business leaves the plan its
-- staff lose access and the owner keeps everything, and when it returns the
-- memberships are still there.
--
-- verifySession runs outside any tenant transaction, and `business` is
-- RLS-protected, so it cannot read the plan itself. Like the other
-- security-definer helpers, this returns one small fact for one id and
-- nothing else.
create or replace function public.business_plan(p_business uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select b.plan from public.business as b where b.id = p_business
$$;

revoke all on function public.business_plan(uuid) from public;
grant execute on function public.business_plan(uuid) to aisar_app;
