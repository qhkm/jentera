/* ============================================================
   One isolated execution environment per business.

   This row is control-plane state, not a claim that a Sprite exists.
   Provisioning is deliberately two-phase: claim the row first, then
   create or reconcile the provider resource, and only mark it ready
   after the runner answers an authenticated readiness probe.
   ============================================================ */

create table if not exists agent_runtime (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null unique references business(id) on delete cascade,
  provider                 text not null check (provider in ('local','fly-sprite')),
  provider_id              text,
  provider_name            text not null,
  provider_url             text,
  status                   text not null default 'provisioning'
                           check (status in (
                             'provisioning','ready','cold','waking','idle','busy',
                             'error','upgrading','migrating','deleting'
                           )),
  desired_release          text not null,
  observed_release         text,
  last_ready_at            timestamptz,
  last_error               text,
  latest_checkpoint_id     text,
  -- Different random credentials for the runner boundary and Hermes.
  -- The database never receives their plaintext; CREDENTIAL_KEY encrypts
  -- them exactly like connector credentials.
  runner_key_ciphertext    bytea,
  runner_key_version       int,
  hermes_key_ciphertext    bytea,
  hermes_key_version       int,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  unique (provider, provider_name),
  check (
    (runner_key_ciphertext is null and runner_key_version is null) or
    (runner_key_ciphertext is not null and runner_key_version is not null)
  ),
  check (
    (hermes_key_ciphertext is null and hermes_key_version is null) or
    (hermes_key_ciphertext is not null and hermes_key_version is not null)
  )
);

create index if not exists idx_agent_runtime_reconcile
  on agent_runtime (status, updated_at)
  where deleted_at is null;

alter table agent_runtime enable row level security;
alter table agent_runtime force row level security;
drop policy if exists agent_runtime_tenant on agent_runtime;
create policy agent_runtime_tenant on agent_runtime
  using (business_id = (nullif(current_setting('app.business_id', true), ''))::uuid);
