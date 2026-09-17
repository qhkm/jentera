-- Recovery can only retire quarantined, never-assigned inventory. Direct
-- table access remains denied; assignments and once-used tombstones survive.
alter table public.runtime_spare
  add column if not exists retirement_token uuid,
  add column if not exists retirement_expires_at timestamptz,
  add column if not exists retirement_attempt integer not null default 0 check (retirement_attempt between 0 and 3),
  add column if not exists retirement_available_at timestamptz not null default now(),
  add column if not exists retirement_problem text check (retirement_problem in ('unsafe_state','provider_unavailable'));

create or replace function public.runtime_spare_retirement_candidates()
returns table(spare_id uuid) language sql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
  select s.id from public.runtime_spare s where s.status='quarantined'
    and s.assigned_business_id is null and s.assigned_at is null
    and s.retirement_attempt<3 and s.retirement_available_at<=now()
    and (s.retirement_token is null or s.retirement_expires_at<=now())
    and not exists(select 1 from public.agent_runtime ar where ar.provider_name=s.provider_name)
    order by s.updated_at limit 2
$$;

create or replace function public.lease_runtime_spare_retirement(p_id uuid,p_token uuid)
returns table(spare_id uuid,provider_name text,provider_id text,provider_url text,
  release text,bundle_commit text,never_prepared boolean)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_id is null or p_token is null then return; end if;
  perform pg_advisory_xact_lock(59170917);
  if exists(select 1 from public.runtime_spare s where s.retirement_token is not null
    and s.retirement_expires_at>now()) then return; end if;
  return query update public.runtime_spare s set retirement_token=p_token,
    retirement_expires_at=now()+interval '2 minutes',
    retirement_attempt=s.retirement_attempt+1,
    retirement_available_at=now()+interval '10 minutes',updated_at=now()
    where s.id=p_id and s.status='quarantined'
      and s.assigned_business_id is null and s.assigned_at is null
      and s.retirement_attempt<3 and s.retirement_available_at<=now()
      and (s.retirement_token is null or s.retirement_expires_at<=now())
      and not exists(select 1 from public.agent_runtime ar where ar.provider_name=s.provider_name)
    returning s.id,s.provider_name,s.provider_id,s.provider_url,s.release,s.bundle_commit,
      (s.problem='obsolete' and s.provider_id is null and s.ready_at is null
       and s.checkpoint_id is null and s.lease_token is null and s.lease_expires_at is null);
end $$;

-- Recheck immediately before provider deletion. The token fences duplicate
-- deliveries; the lookup must never reference a tenant runtime, even deleted.
create or replace function public.runtime_spare_retirement_authorized(p_id uuid,p_token uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
  select exists(select 1 from public.runtime_spare s where s.id=p_id
    and s.status='quarantined' and s.assigned_business_id is null and s.assigned_at is null
    and s.retirement_token=p_token and s.retirement_expires_at>now()
    and not exists(select 1 from public.agent_runtime ar where ar.provider_name=s.provider_name))
$$;

create or replace function public.finish_runtime_spare_retirement(p_id uuid,p_token uuid,p_ok boolean,p_unsafe boolean)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_id is null or p_token is null or p_ok is null or p_unsafe is null then return false; end if;
  update public.runtime_spare s set status=case when p_ok then 'retired' else 'quarantined' end,
    retirement_token=null,retirement_expires_at=null,
    retirement_attempt=case when p_unsafe and not p_ok then 3 else s.retirement_attempt end,
    retirement_problem=case when p_ok then null when p_unsafe then 'unsafe_state' else 'provider_unavailable' end,
    updated_at=now()
    where s.id=p_id and s.status='quarantined' and s.assigned_business_id is null
      and s.assigned_at is null and s.retirement_token=p_token and s.retirement_expires_at>now()
      and not exists(select 1 from public.agent_runtime ar where ar.provider_name=s.provider_name);
  return found;
end $$;

create or replace function public.runtime_spare_health(p_release text,p_bundle text)
returns table(ready integer,queued integer,preparing integer,quarantined integer,
  review_required integer,created_last_hour integer)
language sql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
  select count(*) filter(where s.status='ready' and s.release=p_release
      and s.bundle_commit=p_bundle and s.ready_at>now()-interval '24 hours')::integer,
    count(*) filter(where s.status='queued' and s.release=p_release and s.bundle_commit=p_bundle)::integer,
    count(*) filter(where s.status='preparing')::integer,
    count(*) filter(where s.status='quarantined')::integer,
    count(*) filter(where s.status='quarantined' and s.retirement_attempt>=3)::integer,
    (select count(*)::integer from public.runtime_spare h where h.created_at>now()-interval '1 hour')
  from public.runtime_spare s where s.assigned_business_id is null and s.status<>'retired'
$$;

create table if not exists public.runtime_spare_monitor (
  singleton boolean primary key default true check(singleton),
  release text not null,bundle_commit text not null,
  empty_since timestamptz,last_alert_at timestamptz,
  alert_token uuid,alert_expires_at timestamptz,
  alert_available_at timestamptz not null default now()
);
revoke all on public.runtime_spare_monitor from public,aisar_app;

create or replace function public.lease_runtime_spare_alert(p_release text,p_bundle text,p_target integer,p_token uuid)
returns table(ready integer,queued integer,preparing integer,quarantined integer,
  review_required integer,created_last_hour integer,empty_since timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare h record; m public.runtime_spare_monitor%rowtype;
begin
  if p_release is null or p_bundle is null or p_token is null or p_target is null
    or p_release !~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]+$' or p_bundle !~ '^[0-9a-f]{40}$'
    or p_target not between 1 and 2 then return; end if;
  perform pg_advisory_xact_lock(59170917);
  select * into h from public.runtime_spare_health(p_release,p_bundle);
  insert into public.runtime_spare_monitor(singleton,release,bundle_commit)
    values(true,p_release,p_bundle) on conflict(singleton) do nothing;
  select * into m from public.runtime_spare_monitor where singleton for update;
  update public.runtime_spare_monitor as x set release=p_release,bundle_commit=p_bundle,
    empty_since=case when h.ready>0 then null when m.release<>p_release or m.bundle_commit<>p_bundle
      then now() else coalesce(m.empty_since,now()) end where x.singleton returning * into m;
  if (h.review_required=0 and (m.empty_since is null or m.empty_since>now()-interval '10 minutes'))
    or (m.last_alert_at is not null and m.last_alert_at>now()-interval '1 hour')
    or m.alert_available_at>now() or (m.alert_token is not null and m.alert_expires_at>now()) then return; end if;
  update public.runtime_spare_monitor x set alert_token=p_token,alert_expires_at=now()+interval '2 minutes'
    where x.singleton;
  return query select h.ready,h.queued,h.preparing,h.quarantined,h.review_required,h.created_last_hour,m.empty_since;
end $$;

create or replace function public.finish_runtime_spare_alert(p_token uuid,p_ok boolean)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_token is null or p_ok is null then return false; end if;
  update public.runtime_spare_monitor x set alert_token=null,alert_expires_at=null,
    last_alert_at=case when p_ok then now() else x.last_alert_at end,
    alert_available_at=now()+case when p_ok then interval '1 hour' else interval '5 minutes' end
    where x.singleton and x.alert_token=p_token and x.alert_expires_at>now();
  return found;
end $$;

revoke all on function public.runtime_spare_retirement_candidates() from public;
revoke all on function public.lease_runtime_spare_retirement(uuid,uuid) from public;
revoke all on function public.runtime_spare_retirement_authorized(uuid,uuid) from public;
revoke all on function public.finish_runtime_spare_retirement(uuid,uuid,boolean,boolean) from public;
revoke all on function public.runtime_spare_health(text,text) from public;
revoke all on function public.lease_runtime_spare_alert(text,text,integer,uuid) from public;
revoke all on function public.finish_runtime_spare_alert(uuid,boolean) from public;
grant execute on function public.runtime_spare_retirement_candidates(),
  public.lease_runtime_spare_retirement(uuid,uuid),public.runtime_spare_retirement_authorized(uuid,uuid),
  public.finish_runtime_spare_retirement(uuid,uuid,boolean,boolean),public.runtime_spare_health(text,text),
  public.lease_runtime_spare_alert(text,text,integer,uuid),public.finish_runtime_spare_alert(uuid,boolean) to aisar_app;
