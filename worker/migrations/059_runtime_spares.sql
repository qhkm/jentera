-- Clean, never-used compute inventory. Not a tenant table: direct access is
-- denied even to aisar_app. Narrow control-plane functions hold the authority.
create table if not exists public.runtime_spare (
  id uuid primary key default gen_random_uuid(),
  provider_name text not null unique check (provider_name ~ '^aisar-p-[0-9a-f]{32}$'),
  release text not null check (release ~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]+$'),
  bundle_commit text not null check (bundle_commit ~ '^[0-9a-f]{40}$'),
  status text not null default 'queued'
    check (status in ('queued','preparing','ready','assigned','quarantined','retired')),
  provider_id text,
  provider_url text,
  checkpoint_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  ready_at timestamptz,
  -- No FK: deletion of the business must not erase the once-used tombstone.
  assigned_business_id uuid unique,
  assigned_at timestamptz,
  problem text check (problem is null or problem in ('prepare_failed','prepare_abandoned','obsolete','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((assigned_business_id is null) = (assigned_at is null)),
  check (status <> 'ready' or (provider_id is not null and provider_url is not null
    and checkpoint_id is not null and checkpoint_id ~ '^v[0-9]+$' and ready_at is not null)),
  check (status <> 'preparing' or (lease_token is not null and lease_expires_at is not null)),
  check (status <> 'assigned' or assigned_business_id is not null)
);
revoke all on public.runtime_spare from public, aisar_app;
create index if not exists idx_runtime_spare_pending on public.runtime_spare(status,created_at)
  where assigned_business_id is null and status <> 'retired';
create index if not exists idx_runtime_spare_created on public.runtime_spare(created_at);

create or replace function public.runtime_spare_review_count()
returns integer language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$ select count(*)::integer from public.runtime_spare
  where status='quarantined' and assigned_business_id is null $$;
revoke all on function public.runtime_spare_review_count() from public;
grant execute on function public.runtime_spare_review_count() to aisar_app;

-- Failures count against the two-spare budget until an operator investigates.
-- Never silently create replacements for abandoned/orphaned resources.
create or replace function public.queue_runtime_spares(p_release text, p_bundle text, p_target integer)
returns table (spare_id uuid)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare n integer; new_id uuid;
begin
  if p_target is null or p_release is null or p_bundle is null
     or p_target not between 1 and 2 or p_release !~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]+$'
     or p_bundle !~ '^[0-9a-f]{40}$' then return; end if;
  perform pg_advisory_xact_lock(59170917);
  update public.runtime_spare set status='quarantined', problem=case
      when status='preparing' then 'prepare_abandoned'
      when release<>p_release or bundle_commit<>p_bundle then 'obsolete' else 'expired' end,
      updated_at=now()
    where assigned_business_id is null and (
      (status='preparing' and lease_expires_at < now()) or
      (status in ('queued','ready') and (release<>p_release or bundle_commit<>p_bundle)) or
      (status='ready' and ready_at < now()-interval '24 hours'));
  select count(*)::integer into n from public.runtime_spare
    where assigned_business_id is null and status <> 'retired';
  -- A hard hourly preparation brake, independent of signup volume.
  while n < p_target and (select count(*) from public.runtime_spare
      where created_at > now()-interval '1 hour') < 4 loop
    new_id := gen_random_uuid();
    insert into public.runtime_spare(id,provider_name,release,bundle_commit)
      values(new_id,'aisar-p-'||replace(new_id::text,'-',''),p_release,p_bundle);
    n := n+1;
  end loop;
  return query select s.id from public.runtime_spare s where s.status='queued'
    and s.release=p_release and s.bundle_commit=p_bundle order by s.created_at limit 2;
end
$$;

create or replace function public.lease_runtime_spare(p_id uuid,p_token uuid,p_release text,p_bundle text)
returns table (spare_id uuid,provider_name text,release text,bundle_commit text)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_id is null or p_token is null or p_release is null or p_bundle is null
     or p_release !~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]+$'
     or p_bundle !~ '^[0-9a-f]{40}$' then return; end if;
  perform pg_advisory_xact_lock(59170917);
  -- Prepare at most one VM at a time; leave headroom for customer workloads.
  if exists(select 1 from public.runtime_spare s where s.status='preparing') then return; end if;
  return query update public.runtime_spare s set status='preparing',lease_token=p_token,
    lease_expires_at=now()+interval '20 minutes',updated_at=now()
    where s.id=p_id and s.status='queued' and s.release=p_release and s.bundle_commit=p_bundle
    returning s.id,s.provider_name,s.release,s.bundle_commit;
end
$$;

create or replace function public.finish_runtime_spare(
  p_id uuid,p_token uuid,p_provider_id text,p_url text,p_checkpoint text,p_ok boolean)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_id is null or p_token is null or p_ok is null then return false; end if;
  if p_ok and (p_provider_id is null or p_provider_id='' or p_url is null
      or p_url !~ '^https://[a-zA-Z0-9.-]+\.sprites\.app$' or p_checkpoint is null
      or p_checkpoint !~ '^v[0-9]+$') then return false; end if;
  update public.runtime_spare s set status=case when p_ok then 'ready' else 'quarantined' end,
    provider_id=p_provider_id,provider_url=p_url,checkpoint_id=p_checkpoint,
    ready_at=case when p_ok then now() else null end,
    problem=case when p_ok then null else 'prepare_failed' end,
    lease_token=null,lease_expires_at=null,updated_at=now()
    where s.id=p_id and s.status='preparing' and s.lease_token=p_token
      and s.lease_expires_at>now();
  return found;
end
$$;

-- Called inside the SAME tenant transaction as claimRuntime. Row locking
-- prevents two signups taking one spare; rollback returns an unused spare.
create or replace function public.claim_runtime_spare(p_release text,p_bundle text)
returns table (spare_id uuid,provider_name text,provider_id text,provider_url text,
  release text,bundle_commit text)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare bid uuid; chosen uuid;
begin
  bid := nullif(current_setting('app.business_id',true),'')::uuid;
  if bid is null then return; end if;
  perform 1 from public.business b where b.id=bid for update;
  if not found or exists(select 1 from public.agent_runtime ar where ar.business_id=bid)
    or exists(select 1 from public.runtime_spare s where s.assigned_business_id=bid) then return; end if;
  select s.id into chosen from public.runtime_spare s where s.status='ready'
    and s.assigned_business_id is null and s.release=p_release and s.bundle_commit=p_bundle
    and s.ready_at>now()-interval '24 hours'
    order by s.ready_at for update skip locked limit 1;
  if chosen is null then return; end if;
  return query update public.runtime_spare s set status='assigned',assigned_business_id=bid,
    assigned_at=now(),updated_at=now() where s.id=chosen
    returning s.id,s.provider_name,s.provider_id,s.provider_url,s.release,s.bundle_commit;
end
$$;

create or replace function public.assigned_runtime_spare(p_name text)
returns table (spare_id uuid,provider_name text,provider_id text,provider_url text,
  release text,bundle_commit text)
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select s.id,s.provider_name,s.provider_id,s.provider_url,s.release,s.bundle_commit
    from public.runtime_spare s where s.assigned_business_id=
      nullif(current_setting('app.business_id',true),'')::uuid
      and s.status='assigned' and s.provider_name=p_name
$$;

revoke all on function public.queue_runtime_spares(text,text,integer) from public;
revoke all on function public.lease_runtime_spare(uuid,uuid,text,text) from public;
revoke all on function public.finish_runtime_spare(uuid,uuid,text,text,text,boolean) from public;
revoke all on function public.claim_runtime_spare(text,text) from public;
revoke all on function public.assigned_runtime_spare(text) from public;
grant execute on function public.queue_runtime_spares(text,text,integer),
  public.lease_runtime_spare(uuid,uuid,text,text),
  public.finish_runtime_spare(uuid,uuid,text,text,text,boolean),
  public.claim_runtime_spare(text,text),public.assigned_runtime_spare(text) to aisar_app;
