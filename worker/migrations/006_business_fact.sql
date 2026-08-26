/* ============================================================
   What AISAR knows about a business, and how it came to know it.

   Every fact carries where it came from and how sure we are, because
   later slices reason off these rows and a wrong answer has to be
   traceable to the thing that caused it. A fact the owner typed and a
   fact an agent guessed off a web page are not interchangeable, and a
   schema that stored only `value` would make them so.

   Corrections do not overwrite. The old row is retired and a new one
   inserted at version+1, so the trail of what was believed, when, and
   on what basis survives — which is what slice 4's invalidation needs.
   ============================================================ */

create table if not exists business_fact (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  -- Dotted path: 'hours.monday', 'service.consult.price'. Not an enum;
  -- the set of things worth knowing about a business is open, and
  -- constraining it here would mean a migration per new fact type.
  key           text not null,
  value         jsonb not null,
  source        text not null check (source in ('owner','import','agent','connector')),
  -- URL, R2 artifact id, or run id — whatever makes the claim
  -- checkable. Null only for 'owner', where the source is the person.
  source_ref    text,
  confidence    real not null default 1.0 check (confidence between 0 and 1),
  -- Confirmation is a separate act from authorship. An agent proposes
  -- at confidence 0.6; an owner confirming it does not rewrite the
  -- confidence, it records that a human vouched for it.
  confirmed_by  uuid references app_user(id),
  confirmed_at  timestamptz,
  version       int not null default 1,
  live          boolean not null default true,
  superseded_at timestamptz,
  created_at    timestamptz not null default now()
);

/* One live row per key. Retired versions accumulate underneath. */
create unique index if not exists business_fact_live
  on business_fact (business_id, key) where live;

/* History reads: every version of one key, newest first. */
create index if not exists idx_business_fact_key
  on business_fact (business_id, key, version desc);

/* A `live boolean` rather than a `superseded_by` self-reference.

   A self-reference would require the new row to exist before the old
   one could point at it, which puts two live rows under the partial
   unique index for the length of a statement. Postgres can defer a
   unique CONSTRAINT but not a partial unique INDEX, and a partial
   index is exactly what "one live row per key" needs. Retiring first
   sidesteps the whole problem. */

alter table business_fact enable row level security;
alter table business_fact force row level security;

drop policy if exists business_fact_tenant on business_fact;
create policy business_fact_tenant on business_fact
  using (business_id = (nullif(current_setting('app.business_id', true), ''))::uuid);
