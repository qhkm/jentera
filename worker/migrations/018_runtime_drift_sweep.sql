/* ============================================================
   Drift-sweep cross-tenant enumeration.

   The scheduled drift sweep (worker/src/runtime/consumer.ts) must
   see EVERY sprite to publish upgrade tasks for the fleet, but the
   app role (aisar_app, deliberately nobypassrls) is tenant-scoped
   by row-level security on agent_runtime. A bare SELECT from
   aisar_app matches zero rows — app.business_id is unset in the
   cron path, so `business_id = NULL` matches nothing. That made
   the sweep publish 0 forever, silently.

   The escape hatch is a SECURITY DEFINER function owned by the
   migration role (neondb_owner in prod / owner in tests — both
   BYPASSRLS). It runs with the owner's privileges, so RLS does
   not filter its rows, while aisar_app only ever gets the small
   ordered list of business ids that actually drifted. The sweep
   still publishes each upgrade inside withTenant(), so the
   tenant boundary on the write path is untouched.

   Idempotent.
   ============================================================ */

create or replace function runtime_drift_targets()
returns setof agent_runtime
language sql
security definer
set search_path = public
as $$
  select * from agent_runtime
   where status in ('ready', 'error')
     and (desired_release <> observed_release or status = 'error')
   order by business_id
   limit 25
$$;

revoke all on function runtime_drift_targets() from public;
grant execute on function runtime_drift_targets() to aisar_app;
