/* Customer-defined, persistent Hermes profiles for each business. */

create table if not exists specialist_profile (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references business(id) on delete cascade,
  profile_key  text not null check (profile_key ~ '^[a-z][a-z0-9-]{0,47}$'),
  name         text not null check (char_length(name) between 1 and 60),
  description  text not null check (char_length(description) between 1 and 500),
  instructions text not null default '' check (char_length(instructions) <= 4000),
  enabled      boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, profile_key)
);

create index if not exists idx_specialist_profile_business
  on specialist_profile (business_id, enabled, sort_order, created_at);

alter table specialist_profile enable row level security;
alter table specialist_profile force row level security;
drop policy if exists specialist_profile_tenant on specialist_profile;
create policy specialist_profile_tenant on specialist_profile
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid);

/* Existing businesses receive editable starters. They are examples, not a
   closed system list: owners may rename, rewrite, disable, or add roles. */
insert into specialist_profile
  (business_id, profile_key, name, description, instructions, sort_order)
select b.id, seed.profile_key, seed.name, seed.description, '', seed.sort_order
  from business b
 cross join (values
   ('operations', 'Operations', 'Processes, planning, stock, suppliers and follow-through.', 10),
   ('customers', 'Customer communications', 'Enquiries, replies, bookings and service recovery.', 20),
   ('growth', 'Growth and marketing', 'Research, campaigns, content, sales and retention.', 30),
   ('records', 'Finance and records', 'Invoices, expenses, cash flow, documents and summaries.', 40)
 ) as seed(profile_key, name, description, sort_order)
on conflict (business_id, profile_key) do nothing;
