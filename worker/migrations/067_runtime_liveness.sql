-- Knowing a computer is down before the owner does.
--
-- `agent_runtime.status` is written when something succeeds and never when
-- anything stops, so it records the last good moment rather than the present.
-- On 2026-09-23 three sprites had been unreachable since 18 September while
-- their rows read `error`, `error` and `upgrading` — and a fourth read `ready`
-- about a host whose filesystem Fly had already condemned.
--
-- These columns answer a different question from `status`: not "what last
-- worked" but "when did we last actually look, and what did we see". `status`
-- keeps its present meaning and every existing reader is unaffected.
--
-- Nothing acts on these yet. docs/plans/2026-09-23-runtime-liveness.md sets
-- the thresholds from a week of collected outcomes, because the one number in
-- hand — five of seven prewarms failing at exactly the old 8000 ms budget —
-- argues strongly against guessing.

alter table public.agent_runtime
  add column if not exists last_checked_at timestamptz,
  add column if not exists last_check_outcome text,
  add column if not exists unhealthy_since timestamptz;

comment on column public.agent_runtime.last_checked_at is
  'When a liveness probe last completed, whatever it found. Distinct from last_ready_at, which only moves on success.';
comment on column public.agent_runtime.last_check_outcome is
  'What that probe saw: reachable | unreachable | corrupt | skipped.';
comment on column public.agent_runtime.unhealthy_since is
  'First probe of the current unhealthy run. Null while reachable. Age of an outage, not its count.';

-- Only a bounded vocabulary, so a typo cannot quietly become a new state that
-- nothing branches on.
alter table public.agent_runtime
  drop constraint if exists agent_runtime_last_check_outcome_known;
alter table public.agent_runtime
  add constraint agent_runtime_last_check_outcome_known
  check (last_check_outcome is null
         or last_check_outcome in ('reachable', 'unreachable', 'corrupt', 'skipped'));

-- Finding the stale ones must not scan the fleet.
create index if not exists agent_runtime_unhealthy_since_idx
  on public.agent_runtime (unhealthy_since)
  where unhealthy_since is not null and deleted_at is null;

-- The cron has no tenant, so a plain select from aisar_app is RLS-filtered to
-- zero rows and the sweep would probe nothing forever. Same reason and same
-- shape as runtime_drift_targets (018/019) and routine_due_targets (022).
--
-- It returns only what a probe needs to make a request and write back a
-- result. No secrets, no release, no error text: a diagnostic must not become
-- a way to read tenant data from an untenanted path.
create or replace function public.runtime_liveness_targets(
  p_limit integer default 100
)
returns table (
  runtime_id uuid,
  business_id uuid,
  provider text,
  provider_name text,
  provider_url text,
  last_checked_at timestamptz,
  unhealthy_since timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select r.id, r.business_id, r.provider, r.provider_name, r.provider_url,
         r.last_checked_at, r.unhealthy_since
    from public.agent_runtime as r
   where r.deleted_at is null
     and r.provider_url is not null
   -- Longest unlooked-at first, so a fleet larger than one page still gets
   -- every sprite covered rather than the same head of the list each time.
   order by r.last_checked_at asc nulls first, r.id
   limit greatest(1, least(p_limit, 500))
$$;

revoke all on function public.runtime_liveness_targets(integer) from public;
grant execute on function public.runtime_liveness_targets(integer) to aisar_app;

-- Writing the result back needs the same untenanted path. Deliberately
-- narrow: it sets only the three columns above and can neither touch
-- `status` nor reach any other table.
create or replace function public.record_runtime_liveness(
  p_runtime_id uuid,
  p_outcome text,
  p_now timestamptz default now()
)
returns void
language sql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  update public.agent_runtime
     set last_checked_at = p_now,
         last_check_outcome = p_outcome,
         -- Starts on the first bad probe and holds until a good one, so the
         -- column is the age of an outage rather than a count of failures.
         unhealthy_since = case
           when p_outcome = 'reachable' then null
           when unhealthy_since is null then p_now
           else unhealthy_since
         end
   where id = p_runtime_id
     and deleted_at is null
     and p_outcome in ('reachable', 'unreachable', 'corrupt', 'skipped')
$$;

revoke all on function public.record_runtime_liveness(uuid, text, timestamptz) from public;
grant execute on function public.record_runtime_liveness(uuid, text, timestamptz) to aisar_app;
