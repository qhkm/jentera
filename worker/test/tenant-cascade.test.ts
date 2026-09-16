import { expect, it } from 'vitest';
import { asOwner } from './harness';

/* The container belongs to test/global-setup.ts. Never start or stop it here. */

/*
 * Both queries below join on `constraint_column_usage` and filter
 * `ccu.table_name = 'business'` so they see only the FK that actually
 * decides whether a table's rows survive a business deletion — the direct
 * `business_id references business(id)` constraint every tenant table
 * carries. Several tables also carry a second, *composite* foreign key
 * naming business_id as part of a sibling reference (e.g. `run`'s
 * `(business_id, session_id) references chat_session`, or `chat_session`'s
 * `(business_id, workspace_id) references workspace`) with no ON DELETE
 * clause at all, i.e. NO ACTION. A naive join on key_column_usage alone
 * flags those too, which is a false positive: `run` and `chat_session`
 * already cascade from business through their own direct FK, so both
 * rows disappear in the same statement that removes the business row,
 * and Postgres defers a NO ACTION check to the end of that statement —
 * by then nothing referencing the sibling row is left to violate it.
 * Verified empirically (delete a business with a run wired through
 * session_id, goal_id and goal_checkpoint_id, and a chat_session wired
 * through workspace_id: nothing survives, no FK error). Restricting to
 * `ccu.table_name = 'business'` targets the one constraint this guard is
 * actually about, and leaves those NO ACTION sibling constraints alone —
 * they are a separate integrity concern, not a deletion-survival one.
 */
it('deletes every tenant table with the business it belongs to', async () => {
  const offenders = await asOwner((owner) => owner<{ table_name: string; delete_rule: string }[]>`
    select tc.table_name, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.referential_constraints rc
        on rc.constraint_name = tc.constraint_name
       and rc.constraint_schema = tc.constraint_schema
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
       and kcu.constraint_schema = tc.constraint_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
       and ccu.constraint_schema = tc.constraint_schema
     where tc.constraint_type = 'FOREIGN KEY'
       and tc.table_schema = 'public'
       and kcu.column_name = 'business_id'
       and ccu.table_name = 'business'
       and rc.delete_rule <> 'CASCADE'
       and tc.table_name not in ('account_deletion', 'session')
     order by tc.table_name`);

  /* account_deletion is the deliberate exception: it must outlive the
     cascade, because it is what the external cleanup retries from
     (business_id on delete set null, migrations/051_account_deletion.sql).
     session.business_id is also `on delete set null`
     (migrations/001_identity.sql), and that is correct too — a session
     belongs to its user, not its business, and it still disappears
     because session.user_id cascades from app_user, which the purge's
     identity stage deletes. Anything else here is a table a deletion
     would leave behind. */
  expect(offenders.map((row) => `${row.table_name} (${row.delete_rule})`)).toEqual([]);
});

it('has a purge fixture for every tenant table', async () => {
  const tables = await asOwner((owner) => owner<{ table_name: string }[]>`
    select distinct tc.table_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
       and kcu.constraint_schema = tc.constraint_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
       and ccu.constraint_schema = tc.constraint_schema
     where tc.constraint_type = 'FOREIGN KEY'
       and tc.table_schema = 'public'
       and kcu.column_name = 'business_id'
       and ccu.table_name = 'business'
       and tc.table_name <> 'account_deletion'
     order by tc.table_name`);

  /* The catalog assertion above passes vacuously against a table nobody
     populated, so the purge test seeds one row in each of these. A new table
     fails here until it is added to the fixture. */
  const { TENANT_FIXTURES } = await import('./fixtures/tenant-rows');
  expect(tables.map((t) => t.table_name).filter((name) => !(name in TENANT_FIXTURES))).toEqual([]);
});
