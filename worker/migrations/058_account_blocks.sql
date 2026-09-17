-- Operator-maintained denial survives account deletion and applies to all
-- auth doors, including old Worker versions. No tenant/application may lift it.
create or replace function public.canonical_account_email(address text) returns text
language sql immutable strict parallel safe
set search_path = pg_catalog, public, pg_temp
as $$
  select case when split_part(lower(btrim(address)), '@', 2) in ('gmail.com', 'googlemail.com')
    then replace(split_part(split_part(lower(btrim(address)), '@', 1), '+', 1), '.', '') || '@gmail.com'
    else lower(btrim(address)) end
$$;

create table if not exists public.account_block (
  email text primary key check (email = public.canonical_account_email(email)),
  reason text not null default 'operator removal',
  created_at timestamptz not null default now()
);
create table if not exists public.account_identity_block (
  provider text not null,
  subject text not null,
  created_at timestamptz not null default now(),
  primary key (provider, subject)
);
revoke all on public.account_block, public.account_identity_block from public, aisar_app;

create or replace function public.guard_blocked_account() returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare address text;
begin
  if tg_table_name = 'session' then
    select u.email::text into address from public.app_user u where u.id = new.user_id;
    if exists (select 1 from public.oauth_identity i join public.account_identity_block b
       on b.provider = i.provider and b.subject = i.subject where i.user_id = new.user_id) then
      raise exception using errcode = '42501', message = 'Account unavailable';
    end if;
  else
    address := new.email::text;
  end if;
  if exists (select 1 from public.account_block b where b.email = public.canonical_account_email(address)) then
    raise exception using errcode = '42501', message = 'Account unavailable';
  end if;
  if tg_table_name = 'oauth_identity' then
    if exists (select 1 from public.account_identity_block b where b.provider = new.provider and b.subject = new.subject) then
      raise exception using errcode = '42501', message = 'Account unavailable';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.guard_blocked_account() from public, aisar_app;
revoke all on function public.canonical_account_email(text) from public;
grant execute on function public.canonical_account_email(text) to aisar_app;

drop trigger if exists guard_blocked_account on public.app_user;
create trigger guard_blocked_account before insert or update of email on public.app_user
  for each row execute function public.guard_blocked_account();
drop trigger if exists guard_blocked_account on public.login_token;
create trigger guard_blocked_account before insert or update of email on public.login_token
  for each row execute function public.guard_blocked_account();
drop trigger if exists guard_blocked_account on public.oauth_identity;
create trigger guard_blocked_account before insert or update of email, provider, subject, user_id on public.oauth_identity
  for each row execute function public.guard_blocked_account();
drop trigger if exists guard_blocked_account on public.session;
create trigger guard_blocked_account before insert or update of user_id on public.session
  for each row execute function public.guard_blocked_account();
