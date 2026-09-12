-- Artifacts: files the agent hands the owner (a report, a spreadsheet, a
-- document). The bytes live in R2 under `<business>/<run>/<artifact>/<name>`;
-- this table is the tenant's index of them, and every read of the bytes
-- resolves the row under RLS first. The runner uploads a task's output
-- files before it reports the task complete, so a finished run already
-- knows its files.
create table if not exists artifact (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references business(id) on delete cascade,
  run_id       uuid not null references run(id) on delete cascade,
  task_id      uuid,
  name         text not null check (name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'),
  content_type text not null check (char_length(content_type) between 3 and 120),
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  r2_key       text not null unique check (char_length(r2_key) <= 400),
  sha256       text check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now()
);

create index if not exists idx_artifact_business_created
  on artifact (business_id, created_at desc, id desc);
create index if not exists idx_artifact_run
  on artifact (business_id, run_id, created_at desc);

alter table artifact enable row level security;
alter table artifact force row level security;
drop policy if exists artifact_tenant on artifact;
create policy artifact_tenant on artifact
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
