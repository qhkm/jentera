-- A departing member's scheduled jobs go with them.
--
-- `routine.created_by` and `routine.authorised_by` are `not null`, so a
-- routine cannot lose its author the way a run loses its requester. The
-- authorisation was personal and nobody else gave it, so when a staff member
-- deletes their account their routines are deleted rather than orphaned. An
-- owner's deletion takes the whole business, where the cascade does it.
--
-- 022 deliberately revoked delete on `routine` from aisar_app — "v1 never
-- deletes: pause is the recoverable stop" — and that stays true of every
-- route. This is the single exception, so it is a function rather than a
-- grant: the app role gains the ability to delete one person's routines in
-- one business and nothing else. Same shape and the same reason as
-- account_deletion_due (051) and invitation_by_token (035).
--
-- `routine` has FORCE row level security, which applies to the definer as
-- well, so this deletes nothing unless it is called inside `withTenant` for
-- the business named — the boundary holds even here. The occurrences and
-- change rows follow through their `on delete cascade`, which runs as the
-- table owner and needs no grant.
create or replace function public.delete_member_routines(
  p_business_id uuid,
  p_user_id uuid
)
returns setof uuid
language sql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  delete from public.routine
   where business_id = p_business_id
     and (created_by = p_user_id or authorised_by = p_user_id)
  returning id
$$;

revoke all on function public.delete_member_routines(uuid, uuid) from public;
grant execute on function public.delete_member_routines(uuid, uuid) to aisar_app;
