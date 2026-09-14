-- A private launch link may admit a small, explicitly bounded cohort. Existing
-- invitations remain single-use, and each account can still redeem only once.
alter table trial_invite
  add column if not exists max_claims integer not null default 1,
  add column if not exists claim_count integer not null default 0;

update trial_invite
   set claim_count = 1
 where redeemed_at is not null and claim_count = 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trial_invite_claim_limit') then
    alter table trial_invite add constraint trial_invite_claim_limit
      check (max_claims between 1 and 100 and claim_count between 0 and max_claims);
  end if;
end $$;

alter table trial_redemption drop constraint if exists trial_redemption_token_hash_key;
create index if not exists trial_redemption_token_hash_idx on trial_redemption(token_hash);
