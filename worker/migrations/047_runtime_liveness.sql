-- Is the fleet actually doing work?
--
-- On 14 September a browser pause left one runner refusing every task with
-- runtime_busy. Asks were accepted, queued, requeued until their wall-clock
-- budget expired, and exhausted — for 21 hours. Nothing anywhere said so:
-- /readyz answered healthy, the worker logged no error, the queue backlog was
-- empty, and the product showed a spinner. The owner found out from a customer.
--
-- This returns counts and ages only, never tenant content, so the minute cron
-- can assert liveness without a tenant. SECURITY DEFINER for the same reason
-- the drift sweep needs one (migration 018): the cron path has no tenant, so a
-- plain select as aisar_app is RLS-filtered to zero rows and would report a
-- perfectly idle, perfectly healthy fleet forever.
create or replace function public.runtime_liveness()
returns table (
  waiting              bigint,
  waiting_businesses   bigint,
  oldest_waiting_secs  int,
  secs_since_completion int
)
language sql
security definer
set search_path = public
as $$
  select
    count(*) filter (where status in ('queued', 'failed')),
    count(distinct business_id) filter (where status in ('queued', 'failed')),
    coalesce(
      max(extract(epoch from (now() - created_at)))
        filter (where status in ('queued', 'failed')), 0)::int,
    coalesce((
      select extract(epoch from (now() - max(completed_at)))
        from runtime_task where completed_at is not null
    ), 2147483647)::int
  from runtime_task;
$$;

revoke all on function public.runtime_liveness() from public;
grant execute on function public.runtime_liveness() to aisar_app;
