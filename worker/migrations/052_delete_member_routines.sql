-- A departing member's scheduled jobs go with them.
--
-- `routine.created_by` is `not null`, so a routine cannot lose its author the
-- way a run loses its requester. When a staff member deletes their account
-- the routines they created are deleted rather than orphaned. An owner's
-- deletion takes the whole business, where the cascade does it.
--
-- Only `created_by`. A routine whose *authoriser* is lost is paused, not
-- deleted (022's comment on `authorised_by`), and the confirm screen counts
-- `created_by` alone — deleting on `authorised_by` too would destroy more
-- than the person was shown a number for.
--
-- 022 deliberately revoked delete on `routine` from aisar_app — "v1 never
-- deletes: pause is the recoverable stop" — and that stays true of every
-- route. This is the single exception, so it is a function rather than a
-- grant: the app role gains the ability to delete one person's routines in
-- one business and nothing else. Same shape and the same reason as
-- account_deletion_due (051) and invitation_by_token (035).
--
-- The tenant bound is in the statement, not in RLS. FORCE row level security
-- binds a table *owner*; it does not bind a superuser or a BYPASSRLS role,
-- and this function is owned by whoever ran the migration — `neondb_owner` in
-- production, a superuser in the test harness. Leaning on RLS here would make
-- this a cross-tenant DELETE primitive granted to aisar_app, correct only as
-- long as every caller passes the right id. So it reads `app.business_id`
-- itself: outside `withTenant`, or inside the wrong tenant, it deletes
-- nothing whoever owns it. The occurrences and change rows follow through
-- their `on delete cascade`, which runs as the table owner and needs no
-- grant.
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
     and business_id = (nullif(current_setting('app.business_id', true), ''))::uuid
     and created_by = p_user_id
  returning id
$$;

revoke all on function public.delete_member_routines(uuid, uuid) from public;
grant execute on function public.delete_member_routines(uuid, uuid) to aisar_app;
