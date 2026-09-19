-- Quarantined spares stopped the pool refilling itself.
--
-- `queue_runtime_spares` counted inventory as "unassigned and not retired",
-- which includes quarantined. With a target of 2, two quarantined entries
-- make `n = 2` and the create loop never runs — so the pool stays empty
-- until an operator clears them by hand.
--
-- That is not rare. A ready spare is quarantined as `obsolete` by any
-- release that outpaces it, and 18 September had four releases. The pool
-- disabled itself on 17 September and was still empty two days later.
--
-- Counting them was not wrong, and most of it is load-bearing: a spare
-- quarantined after a failed preparation, attestation or checkpoint must
-- keep its slot, or the pool retries the failure and leaks a machine each
-- time. `runtime-spares.test.ts` says so in its names — "does not retry its
-- resource" — and that stays exactly as it was.
--
-- Only `obsolete` is different. Nothing went wrong: the spare was prepared
-- correctly and a release moved past it. A replacement is not a retry of a
-- failure, so it does not hold the slot. Its machine does still exist and
-- still needs clearing, which is what the backlog bound below is for.
create or replace function public.queue_runtime_spares(p_release text, p_bundle text, p_target integer)
returns table (spare_id uuid)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare n integer; backlog integer; new_id uuid;
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
  -- Everything that holds a slot: usable inventory, and quarantine that
  -- represents a failure worth not retrying. `obsolete` holds nothing.
  select count(*)::integer into n from public.runtime_spare
    where assigned_business_id is null and status <> 'retired'
      and not (status = 'quarantined' and problem = 'obsolete');
  -- Obsolete entries still own a prepared machine until an operator clears
  -- it, so they cannot accumulate without limit either. Ordinary release
  -- churn leaves at most a target's worth behind at a time.
  select count(*)::integer into backlog from public.runtime_spare
    where assigned_business_id is null and status = 'quarantined' and problem = 'obsolete';
  if backlog >= 4 then return; end if;
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
revoke all on function public.queue_runtime_spares(text,text,integer) from public;
grant execute on function public.queue_runtime_spares(text,text,integer) to aisar_app;
