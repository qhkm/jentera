/* ============================================================
   The run spine: what AISAR did, in order, and what came of it.

   Home and Activity are projections of these tables rather than
   independent state. That is the point — a dashboard that counts
   things it stores separately from the things that happened will
   eventually disagree with them, and the owner has no way to tell
   which half is lying.

   Three tables, three jobs:
     run          one unit of work, with its status
     run_event    the append-only trace of what happened inside it
     work_record  the durable summary a person actually reads
   ============================================================ */

create table if not exists run (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  kind          text not null,
  status        text not null default 'queued'
                check (status in ('queued','working','needs_approval',
                                  'completed','failed','cancelled')),
  -- What shape of thing triggered this, as a grouping key. Distinct
  -- from trigger_ref, which is the specific instance.
  trigger_shape text not null,
  trigger_ref   jsonb,
  requested_by  uuid references app_user(id),
  -- Snapshotted at start, not looked up later. A run that executed on
  -- one model must not appear to have used whatever is configured
  -- today when someone reads its history back next month.
  runtime       text not null,
  model         text,
  parent_run_id uuid references run(id),
  batch_key     text,
  started_at    timestamptz,
  ended_at      timestamptz,
  cost_cents    integer,
  attempt       int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists idx_run_business on run (business_id, created_at desc);
create index if not exists idx_run_status on run (business_id, status) where status in ('queued','working','needs_approval');

create table if not exists run_event (
  id          bigint generated always as identity primary key,
  run_id      uuid not null references run(id) on delete cascade,
  business_id uuid not null references business(id) on delete cascade,
  seq         int  not null,
  type        text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  unique (run_id, seq)
);

create index if not exists idx_run_event_run on run_event (run_id, seq);

/* Append-only, enforced rather than promised.

   The trace is the evidence for everything the product later claims it
   did. A trace that can be edited after the fact is not evidence, and
   the edit would be invisible precisely when it mattered most. */
create or replace function run_event_immutable() returns trigger as $$
begin
  raise exception 'run_event is append-only (attempted % on run_event)', tg_op;
end;
$$ language plpgsql;

drop trigger if exists run_event_no_update on run_event;
create trigger run_event_no_update
  before update or delete on run_event
  for each row execute function run_event_immutable();

create table if not exists work_record (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references business(id) on delete cascade,
  run_id          uuid references run(id),
  -- Set when this record summarises many runs rather than one.
  batch_key       text,
  objective       text not null,
  outcome         text,
  status          text not null,
  function        text,
  channel         text,
  subject         text,
  risk            text check (risk in ('low','medium','high')),
  approval_id     uuid,
  counters        jsonb not null default '{}',
  minutes_saved   integer,
  cost_cents      integer,
  artifacts       jsonb not null default '[]',
  decision        text,
  -- Which facts and reads the work leaned on. This is what makes a
  -- wrong output traceable to the wrong input rather than merely
  -- regrettable.
  inputs_used     jsonb,
  outcome_quality text check (outcome_quality in ('unknown','good','poor')),
  quality_at      timestamptz,
  occurred_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_work_record_business
  on work_record (business_id, occurred_at desc);

/* RLS on all three, forced, same shape as every other tenant table. */
do $$
declare t text;
begin
  foreach t in array array['run','run_event','work_record'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format(
      'create policy %I on %I using (business_id = (nullif(current_setting(''app.business_id'', true), ''''))::uuid)',
      t || '_tenant', t);
  end loop;
end
$$;
