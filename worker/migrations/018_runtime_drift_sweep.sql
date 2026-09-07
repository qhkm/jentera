/* ============================================================
   Least-authority, fairly paginated fleet drift enumeration.

   Cron has no tenant GUC, so the application role needs one narrow
   SECURITY DEFINER function to enumerate maintenance targets through RLS.
   It intentionally returns identifiers only: agent_runtime also contains
   encrypted runner, Hermes, and model credentials.
   ============================================================ */

drop function if exists public.runtime_drift_targets();

create or replace function public.runtime_drift_targets(
  p_current_release text,
  p_after_business_id uuid default null,
  p_limit integer default 25,
  p_stuck_after interval default interval '15 minutes'
)
returns table (
  runtime_id uuid,
  business_id uuid,
  repair_episode text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select ar.id,
         ar.business_id,
         md5(ar.id::text || ':' || extract(epoch from ar.updated_at)::text || ':' ||
             coalesce(ar.status, '') || ':' || p_current_release) as repair_episode
    from public.agent_runtime as ar
   where ar.deleted_at is null
     and (p_after_business_id is null or ar.business_id > p_after_business_id)
     and (
       (
         ar.status in ('ready', 'cold', 'idle', 'busy', 'error')
         and (
           ar.desired_release is distinct from p_current_release
           or ar.observed_release is distinct from p_current_release
           or ar.status = 'error'
         )
       )
       or (
         ar.status in ('provisioning', 'upgrading')
         and ar.updated_at <= pg_catalog.now() - p_stuck_after
       )
     )
   order by ar.business_id
   limit greatest(1, least(p_limit, 100))
$$;

revoke all on function public.runtime_drift_targets(text, uuid, integer, interval) from public;
grant execute on function public.runtime_drift_targets(text, uuid, integer, interval) to aisar_app;
