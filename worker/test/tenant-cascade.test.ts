import { expect, it } from 'vitest';
import { asOwner } from './harness';

/* The container belongs to test/global-setup.ts. Never start or stop it here. */

/*
 * A tenant table is discovered by the presence of a `business_id` column
 * (`tenant_tables` below) — not by having a direct FK to `business`. Some
 * tables only reach `business` through a sibling table: `goal_checkpoint`
 * reaches it through `goal`, `workspace_member` through `workspace`, both
 * via a composite `(business_id, sibling_id) references sibling(business_id,
 * id)` foreign key. Filtering on a direct FK to `business` alone drops both
 * of those tables from the guard entirely — a real gap an earlier version
 * of this file had, caught in review.
 *
 * `fk_edges` is every foreign key anywhere that carries `business_id` as
 * one of its columns. `reach` walks those edges recursively from a table
 * to `business`, tracking whether every edge on a given path is CASCADE.
 * `bool_or` per table then asks: does *at least one* path from this table
 * to `business` cascade all the way? A table can have other, unrelated
 * business_id-bearing FKs that are correctly NO ACTION (sibling
 * consistency constraints — see below) as long as one path fully cascades.
 *
 * `run` and `chat_session` are the reason that "at least one path" matters:
 * both carry a direct `business_id references business(id) on delete
 * cascade` FK *and* one or more composite FKs to a sibling table (run to
 * chat_session/goal/goal_checkpoint via session_id/goal_id/goal_checkpoint_id;
 * chat_session to workspace via workspace_id) with no ON DELETE clause, i.e.
 * NO ACTION. Verified empirically (see the account-deletion-purge tests and
 * this task's report) that a business deletion still removes all of these
 * rows cleanly: both sides of every composite constraint are cascaded away
 * from business independently in the same statement, and Postgres defers a
 * NO ACTION check to the end of that statement, by which point there is
 * nothing left to violate it. A query that only looked at kcu.column_name =
 * 'business_id' without following the reference would flag those composite
 * constraints as false positives; `reach`'s per-table bool_or is what makes
 * "one good path is enough" possible instead of naively rejecting the table
 * for having any non-cascading edge at all.
 */
const REACH_SQL = `
  with recursive fk_edges as (
    select
      con.conrelid::regclass::text as table_name,
      con.confrelid::regclass::text as ref_table_name,
      con.confdeltype
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
    where con.contype = 'f'
      and att.attname = 'business_id'
      and con.connamespace = 'public'::regnamespace
  ),
  reach (table_name, all_cascade) as (
    select table_name, (confdeltype = 'c')
      from fk_edges
     where ref_table_name = 'business'
    union
    select e.table_name, (e.confdeltype = 'c' and r.all_cascade)
      from fk_edges e
      join reach r on r.table_name = e.ref_table_name
     where e.ref_table_name <> 'business'
  ),
  tenant_tables as (
    select table_name
      from information_schema.columns
     where table_schema = 'public'
       and column_name = 'business_id'
       and table_name <> 'account_deletion'
  )
  select tt.table_name, coalesce(bool_or(r.all_cascade), false) as cascades
    from tenant_tables tt
    left join reach r on r.table_name = tt.table_name
   group by tt.table_name
   order by tt.table_name`;

it('deletes every tenant table with the business it belongs to', async () => {
  const rows = await asOwner((owner) =>
    owner.unsafe<{ table_name: string; cascades: boolean }[]>(REACH_SQL));

  /* account_deletion is excluded from tenant_tables itself: it must outlive
     the cascade, because it is what the external cleanup retries from
     (business_id on delete set null, migrations/051_account_deletion.sql).
     session.business_id is also `on delete set null`
     (migrations/001_identity.sql), and has no other path to business, so it
     never cascades and is named here instead — a session belongs to its
     user, not its business, and it still disappears because session.user_id
     cascades from app_user, which the purge's identity stage deletes.
     Anything else with no fully-cascading path to business is a table a
     deletion would leave behind — grouped by table_name, so a table with
     several non-cascading edges is named once, not once per edge. */
  const offenders = rows
    .filter((row) => !row.cascades && row.table_name !== 'session')
    .map((row) => row.table_name);
  expect(offenders).toEqual([]);
});

it('has a purge fixture for every tenant table', async () => {
  const rows = await asOwner((owner) => owner<{ table_name: string }[]>`
    select table_name
      from information_schema.columns
     where table_schema = 'public'
       and column_name = 'business_id'
       and table_name <> 'account_deletion'
     order by table_name`);

  /* The catalog assertion above passes vacuously against a table nobody
     populated, so the purge test seeds one row in each of these. A new table
     fails here until it is added to the fixture — same discovery query as
     the offenders test (every business_id-bearing table), so a table
     reachable only through a composite chain cannot silently stay
     unfixtured either. */
  const { TENANT_FIXTURES } = await import('./fixtures/tenant-rows');
  expect(rows.map((t) => t.table_name).filter((name) => !(name in TENANT_FIXTURES))).toEqual([]);
});
