-- A sprite asking the control plane for its own configuration has to be
-- identified before any tenant is known: it presents a derived runtime
-- credential whose only tenant-shaped claim is the rider id
-- (`aisar-b-<20 hex>`, `agent_runtime.provider_name`). Resolving that to a
-- business id is therefore a lookup that must run *outside* withTenant, where
-- RLS scopes every tenant table to nothing.
--
-- SECURITY DEFINER, and deliberately narrow: ids in, one id out. It returns
-- no row content, so a route cannot turn it into a cross-tenant read the way
-- a plain select would if the policy were relaxed instead. Everything after
-- this call happens under withTenant for the business it returns. Precedent:
-- routine_due_targets in 022, runtime_drift_targets in 018/019.
create or replace function public.runtime_business_for_rider(
  p_provider_name text
)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select r.business_id
    from public.agent_runtime as r
   where r.provider = 'fly-sprite'
     and r.provider_name = p_provider_name
     and r.deleted_at is null
$$;

revoke all on function public.runtime_business_for_rider(text) from public;
grant execute on function public.runtime_business_for_rider(text) to aisar_app;

comment on function public.runtime_business_for_rider(text) is
  'Rider id (agent_runtime.provider_name) to business id, for authenticating a '
  'runtime before any tenant is known. SECURITY DEFINER because RLS hides the '
  'row from aisar_app outside withTenant. Returns an id and nothing else.';

-- What configuration the sprite last told us it had applied. Compared for
-- equality against the document the control plane would render now, so drift
-- is visible without waking anything: null means it has never reported, which
-- is every runtime until the release that starts fetching.
alter table public.agent_runtime
  add column if not exists observed_config_version text;

comment on column public.agent_runtime.observed_config_version is
  'Version hash of the config document the runtime last applied, as reported '
  'at readiness. Null until a runtime runs a bundle that fetches config.';
