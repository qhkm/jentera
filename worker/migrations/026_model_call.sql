-- Per-call model accounting, so the shape of a run's prompt can be read
-- rather than inferred. `runtime_usage.input_tokens` is Hermes's
-- session_prompt_tokens summed over every call in a run, which cannot
-- separate the three things that make a prompt big: Hermes's fixed
-- overhead (its system prompt and tool schemas), the accumulated session
-- transcript, and tool output. Each has a different lever, so bounding the
-- loop without this breakdown is picking one by feel.
--
-- A diagnostic, not a ledger: `fmcv_rider_spend` remains the meter the $5
-- ceiling reads. Rows here are swept at 90 days.
--
-- No content is retained — counts, sizes and token totals only, keyed by
-- the pseudonymous rider id, exactly as fmcv_rider_spend is. There is
-- deliberately no business_id and no runtime_task_id: a sprite runs one
-- task at a time, so attribution is a read-time join on the rider and the
-- task's start/finish window, and this table stays free of tenant data.
create table if not exists public.model_call (
  id                 bigint generated always as identity primary key,
  rider_id           text        not null,
  model              text        not null,
  streamed           boolean     not null,
  -- false when a stream closed without ever carrying a usage chunk. Those
  -- calls are real spend the rider ledger never saw, so the count of them
  -- is the size of the metering gap.
  usage_seen         boolean     not null,
  prompt_tokens      integer     check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens  integer     check (completion_tokens is null or completion_tokens >= 0),
  cached_tokens      integer     check (cached_tokens is null or cached_tokens >= 0),
  cost_microusd      bigint      check (cost_microusd is null or cost_microusd >= 0),
  request_bytes      integer     not null,
  message_count      integer     not null,
  tool_count         integer     not null,
  system_chars       integer     not null,
  tools_chars        integer     not null,
  history_chars      integer     not null,
  last_user_chars    integer     not null,
  upstream_status    smallint    not null,
  latency_ms         integer     not null,
  created_at         timestamptz not null default now()
);

create index if not exists idx_model_call_rider_time
  on public.model_call (rider_id, created_at);

alter table public.model_call enable row level security;

drop policy if exists model_call_select on public.model_call;
create policy model_call_select on public.model_call
  for select to aisar_app
  using (true);

drop policy if exists model_call_insert on public.model_call;
create policy model_call_insert on public.model_call
  for insert to aisar_app
  with check (true);

drop policy if exists model_call_delete on public.model_call;
create policy model_call_delete on public.model_call
  for delete to aisar_app
  using (true);

-- 000_role.sql's default privileges hand every new table select/insert/
-- update/delete to aisar_app, so the grant below is stated in full and the
-- rest revoked explicitly. A recorded call is a fact about something that
-- already happened: the app role appends and sweeps, and never rewrites.
revoke all on public.model_call from public;
grant select, insert, delete on public.model_call to aisar_app;
revoke update, truncate, references, trigger on public.model_call from aisar_app;

comment on table public.model_call is
  'Per-call diagnostic for the runtime model proxy: token counts and prompt '
  'shape, never content. No-PII/no-tenant-data table keyed by the '
  'pseudonymous rider id: RLS is enabled with identity-agnostic policies; '
  'if tenant data is ever added here, rework RLS around business_id. '
  'Swept at 90 days by the quarter-hour cron; fmcv_rider_spend, not this, '
  'is what the rider ceiling reads.';
