-- Keep a confirmed live value while its proposed replacement awaits review.
alter table business_fact add column if not exists pending boolean not null default false;
create unique index if not exists business_fact_pending
  on business_fact (business_id, key) where pending;
