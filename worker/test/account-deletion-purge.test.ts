import { beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { asApp, asOwner, asTenant, testEnv, truncateAll } from './harness';
import { sweepAccountDeletions } from '../src/account-deletion/purge';
import type { Env } from '../src/env';
import type { sendNotice } from '../src/email';
import { applyTenantFixtures, newFixtureContext, TENANT_FIXTURES } from './fixtures/tenant-rows';

beforeEach(async () => {
  await truncateAll();
  /* `truncate ... cascade` reaches every table with a foreign key into the
     ones it names, which is most of them. These two are keyed by address
     alone and reference nothing, so nothing carries them away — and they
     are exactly what the last stage of the purge has to delete. */
  await asOwner(async (sql) => {
    await sql`delete from platform_access`;
    await sql`delete from waitlist_entry`;
  });
});

describe('the purge', () => {
  it('cannot reach the cascade while the objects it must delete first survive', async () => {
    /* The invariant is only provable by failing the external call: a sweep
       that succeeds at everything proves nothing about the order it went in. */
    const attempted: string[] = [];
    const env = testEnv({
      ARTIFACTS: {
        delete: async (key: string) => {
          attempted.push(key);
          throw new Error('R2 down');
        },
      },
      RUNTIME_QUEUE: { send: async () => {} },
    });
    const { businessId, userId } = await asOwner((owner) =>
      seedDueDeletion(owner, { artifacts: ['a/1', 'a/2'] }),
    );

    /* Four ticks is more than enough to walk pending → connectors → objects
       and then fail twice there. If the cascade ran before the objects, it
       would have run inside these four. */
    await drive(env, {}, 4);

    /* The headline, asserted first: the cascade did not run, and cannot,
       while the objects whose only index it would erase are still there. */
    const business = await asOwner((owner) => owner`select 1 from business where id = ${businessId}`);
    expect(business).toHaveLength(1);
    const user = await asOwner((owner) => owner`select 1 from app_user where id = ${userId}`);
    expect(user).toHaveLength(1);

    const [record] = await asOwner((owner) => owner<Stored[]>`
      select stage, attempts, last_error from account_deletion where user_id = ${userId}`);
    expect(record.stage).toBe('objects');
    expect(record.attempts).toBe(2);
    expect(record.last_error).toMatch(/R2 down/);
    expect(attempted).toContain('a/1');
  });

  it('erases everything and marks itself done', async () => {
    const deleted: string[] = [];
    const tasks: unknown[] = [];
    const notices = noticeFake();
    const { businessId, userId, connectionId } = await asOwner((owner) =>
      seedDueDeletion(owner, { artifacts: ['a/1'], sprite: 'sprite-9' }),
    );
    /* seedDueDeletion above seeds one of everything the purge itself has to
       reason about; this seeds one row in every OTHER tenant table, so the
       assertion below — nothing left for this business, table by table — is
       checked against a business that is genuinely full rather than one
       where most tables were never populated in the first place. */
    const fixtureCtx = newFixtureContext(businessId, userId);
    await asOwner((owner) => applyTenantFixtures(owner, fixtureCtx));
    const env = testEnv({
      ARTIFACTS: { delete: async (key: string) => { deleted.push(key); } },
      RUNTIME_QUEUE: {
        send: async (message: unknown) => {
          tasks.push(message);
          /* What the queue consumer's deleteRuntime ends by doing once the
             machine is actually gone. Faking the send without it would be
             faking a destroy that never happened. */
          await asOwner((o) => o`delete from agent_runtime where business_id = ${businessId}`);
        },
      },
    });

    const summaries = await drive(env, { send: notices.send }, 8);

    expect(deleted).toEqual(['a/1']);
    expect(tasks).toHaveLength(1);
    expect(summaries.some((s) => s.completed === 1)).toBe(true);

    await asOwner(async (owner) => {
      expect(await owner`select 1 from business where id = ${businessId}`).toHaveLength(0);
      expect(await owner`select 1 from app_user where id = ${userId}`).toHaveLength(0);
      expect(await owner`select 1 from run where business_id = ${businessId}`).toHaveLength(0);
      expect(await owner`select 1 from connection where id = ${connectionId}`).toHaveLength(0);
      /* Keyed by address, reached by no cascade: the last stage is the only
         thing that ever removes these. */
      expect(await owner`select 1 from platform_access where email = ${EMAIL}`).toHaveLength(0);
      expect(await owner`select 1 from waitlist_entry where email = ${EMAIL}`).toHaveLength(0);
      expect(await owner`select 1 from trial_redemption where user_id = ${userId}`).toHaveLength(0);
      /* The invite itself is the operator's record that a code was issued
         and spent, so it stays — pointing at nobody. */
      const [invite] = await owner<{ redeemed_by: string | null }[]>`
        select redeemed_by from trial_invite`;
      expect(invite.redeemed_by).toBeNull();

      /* The genuinely-full-business assertion: every tenant table
         tenant-cascade.test.ts requires a fixture for is checked here,
         table by table, rather than trusting the cascade in the abstract.
         `session` is the one exception — its business_id is set null
         before the row disappears (migrations/001_identity.sql), so it is
         checked by user_id, the id whose cascade actually removes it. */
      for (const table of Object.keys(TENANT_FIXTURES)) {
        const rows =
          table === 'session'
            ? await owner.unsafe('select 1 from session where user_id = $1 limit 1', [userId])
            : await owner.unsafe(`select 1 from ${table} where business_id = $1 limit 1`, [businessId]);
        expect(rows, `expected ${table} to be purged`).toHaveLength(0);
      }
    });

    /* user_id is null by now: deleting app_user set it null, which is the
       point of the record living outside the cascade. */
    const [record] = await asOwner((owner) => owner<Stored[]>`
      select stage, completed_at from account_deletion where email = ${EMAIL}`);
    expect(record.stage).toBe('done');
    expect(record.completed_at).not.toBeNull();

    expect(notices.calls).toHaveLength(1);
    expect(notices.calls[0].to).toBe(EMAIL);
    expect(notices.calls[0].subject).toMatch(/deleted/i);
  });

  it('leaves the business standing when a staff member goes', async () => {
    const deleted: string[] = [];
    const tasks: unknown[] = [];
    const env = testEnv({
      ARTIFACTS: { delete: async (key: string) => { deleted.push(key); } },
      RUNTIME_QUEUE: { send: async (message: unknown) => { tasks.push(message); } },
    });
    const { businessId, userId, runId, connectionId } = await asOwner((owner) =>
      seedDueDeletion(owner, { kind: 'staff', artifacts: ['keep/1'], sprite: 'sprite-9' }),
    );

    await drive(env, {}, 8);

    /* The business survives with its history, minus the person. */
    expect(deleted).toEqual([]);
    expect(tasks).toEqual([]);
    await asOwner(async (owner) => {
      expect(await owner`select 1 from business where id = ${businessId}`).toHaveLength(1);
      expect(await owner`select 1 from app_user where id = ${userId}`).toHaveLength(0);
      expect(await owner`select 1 from connection where id = ${connectionId}`).toHaveLength(1);
      expect(await owner`select 1 from artifact where business_id = ${businessId}`).toHaveLength(1);
      /* The machine belongs to the business, which is still trading. */
      expect(await owner`select 1 from agent_runtime where business_id = ${businessId}`)
        .toHaveLength(1);
    });

    await asTenant(businessId, async (tx) => {
      const [run] = await tx<{ requested_by: string | null }[]>`
        select requested_by from run where id = ${runId}`;
      expect(run.requested_by).toBeNull();
      const [approval] = await tx<{ decided_by: string | null }[]>`
        select decided_by from approval where business_id = ${businessId}`;
      expect(approval.decided_by).toBeNull();
      const [fact] = await tx<{ confirmed_by: string | null }[]>`
        select confirmed_by from business_fact where business_id = ${businessId}`;
      expect(fact.confirmed_by).toBeNull();
      const [policy] = await tx<{ updated_by: string | null }[]>`
        select updated_by from action_policy where business_id = ${businessId}`;
      expect(policy.updated_by).toBeNull();
      const [connection] = await tx<{ connected_by: string | null }[]>`
        select connected_by from connection where id = ${connectionId}`;
      expect(connection.connected_by).toBeNull();
      expect(await tx`select 1 from routine where created_by = ${userId}`).toHaveLength(0);
      expect(await tx`select 1 from membership where user_id = ${userId}`).toHaveLength(0);
      expect(await tx`select 1 from invitation where email = ${EMAIL}`).toHaveLength(0);
    });

    const [record] = await asOwner((owner) => owner<Stored[]>`
      select stage, completed_at from account_deletion where email = ${EMAIL}`);
    expect(record.stage).toBe('done');
    expect(record.completed_at).not.toBeNull();
  });

  it('will not cascade over a sprite that is still standing', async () => {
    /* The destroy is queued, not watched — and the cascade erases the queued
       task along with everything else that names the machine. So the last
       step before it refuses to run while the runtime record is still there. */
    const env = testEnv({
      ARTIFACTS: { delete: async () => {} },
      RUNTIME_QUEUE: { send: async () => {} },
    });
    const { businessId, userId } = await asOwner((owner) =>
      seedDueDeletion(owner, { artifacts: ['a/1'], sprite: 'sprite-9' }),
    );

    await drive(env, {}, 6);

    expect(await asOwner((o) => o`select 1 from business where id = ${businessId}`))
      .toHaveLength(1);
    const [stuck] = await asOwner((o) => o<Stored[]>`
      select stage, attempts, last_error from account_deletion where user_id = ${userId}`);
    expect(stuck.stage).toBe('tenant');
    expect(stuck.attempts).toBeGreaterThan(0);
    expect(stuck.last_error).toMatch(/still standing/);
    expect(stuck.last_error).toMatch(/recorded sprite: sprite-9/);

    /* The consumer finishes; the purge picks up where it stopped. */
    await asOwner((o) => o`delete from agent_runtime where business_id = ${businessId}`);
    await drive(env, {}, 4);

    expect(await asOwner((o) => o`select 1 from business where id = ${businessId}`))
      .toHaveLength(0);
    const [record] = await asOwner((o) => o<Stored[]>`
      select stage from account_deletion where email = ${EMAIL}`);
    expect(record.stage).toBe('done');
  });

  it('destroys a sprite that appeared after the request, which the record never named', async () => {
    /* `sprite_id` is a snapshot seven days old, and only verifySession
       honours `business.deleted_at` — a Telegram message during the grace
       period provisions a machine nothing in the record knows about. It is
       still the person's memory, so it is still theirs to have destroyed. */
    const tasks: unknown[] = [];
    const env = testEnv({
      ARTIFACTS: { delete: async () => {} },
      RUNTIME_QUEUE: { send: async (message: unknown) => { tasks.push(message); } },
    });
    const { businessId, userId } = await asOwner((owner) =>
      seedDueDeletion(owner, { artifacts: [] }),
    );
    const [record] = await asOwner((o) => o<{ sprite_id: string | null }[]>`
      select sprite_id from account_deletion where user_id = ${userId}`);
    expect(record.sprite_id).toBeNull();
    await asOwner((o) => o`
      insert into agent_runtime (business_id, provider, provider_name, desired_release)
      values (${businessId}, 'fly-sprite', 'sprite-late', 'r1')`);

    await drive(env, {}, 6);

    /* Queued, despite the record naming no sprite. */
    expect(tasks).toHaveLength(1);
    expect(await asOwner((o) => o`
      select 1 from runtime_task where business_id = ${businessId} and kind = 'delete'`))
      .toHaveLength(1);
    /* And guarded: the cascade would have orphaned it. */
    expect(await asOwner((o) => o`select 1 from business where id = ${businessId}`))
      .toHaveLength(1);
    const [stuck] = await asOwner((o) => o<Stored[]>`
      select stage, last_error from account_deletion where user_id = ${userId}`);
    expect(stuck.stage).toBe('tenant');
    expect(stuck.last_error).toMatch(/recorded sprite: none/);

    await asOwner((o) => o`delete from agent_runtime where business_id = ${businessId}`);
    await drive(env, {}, 4);

    expect(await asOwner((o) => o`select 1 from business where id = ${businessId}`))
      .toHaveLength(0);
  });

  it('will not delete another tenant’s routines through the definer', async () => {
    /* FORCE row level security binds a table owner, not a superuser and not
       a BYPASSRLS role, so the function cannot lean on RLS for its tenant
       bound — it reads app.business_id itself. Without that it would be a
       cross-tenant delete granted to the app role, correct only for as long
       as every caller passed the right id. */
    const { businessId, userId } = await asOwner((owner) =>
      seedDueDeletion(owner, { kind: 'staff' }),
    );

    const loose = await asApp((sql) => sql`
      select public.delete_member_routines(${businessId}::uuid, ${userId}::uuid) as id`);
    expect(loose).toHaveLength(0);

    const elsewhere = await asTenant(crypto.randomUUID(), (tx) => tx`
      select public.delete_member_routines(${businessId}::uuid, ${userId}::uuid) as id`);
    expect(elsewhere).toHaveLength(0);

    expect(await asOwner((o) => o`select 1 from routine where created_by = ${userId}`))
      .toHaveLength(1);
  });

  it('leaves a routine the departing member only authorised', async () => {
    /* A routine whose authoriser is lost is paused, not deleted (022), and
       the confirm screen counts `created_by` alone — so deleting on
       `authorised_by` would destroy more than the person was shown. */
    const { businessId, userId } = await asOwner((owner) =>
      seedDueDeletion(owner, { kind: 'staff' }),
    );
    const [boss] = await asOwner((o) => o<{ user_id: string }[]>`
      select user_id from membership where business_id = ${businessId} and role = 'owner'`);
    const [bosses] = await asOwner((o) => o<{ id: string }[]>`
      insert into routine
        (business_id, name, task_kind, frequency, time_of_day, time_zone, status,
         created_by, authorised_by, create_request_id)
      values (${businessId}, 'The owner''s job', 'weekly_summary', 'daily', '08:00',
              'Asia/Kuala_Lumpur', 'active', ${boss.user_id}, ${userId},
              gen_random_uuid())
      returning id`);

    const removed = await asTenant(businessId, (tx) => tx`
      select public.delete_member_routines(${businessId}::uuid, ${userId}::uuid) as id`);

    /* Only the one they created. The owner's, which they merely authorised,
       stays — to be paused, which is what the house rule says happens to a
       routine that loses its authoriser. */
    expect(removed).toHaveLength(1);
    expect(await asOwner((o) => o`select 1 from routine where id = ${bosses.id}`))
      .toHaveLength(1);
    expect(await asOwner((o) => o`select 1 from routine where created_by = ${userId}`))
      .toHaveLength(0);
  });

  it('stalls loudly rather than abandoning a sprite that will not die', async () => {
    const notices = noticeFake();
    /* No RUNTIME_QUEUE: publishRuntimeTask refuses, which is the same shape
       as a destroy the runtime will not accept. */
    const env = testEnv({ SIGNUP_NOTICE_TO: 'ops@example.com' });
    const { userId } = await asOwner((owner) =>
      seedDueDeletion(owner, { artifacts: [], sprite: 'sprite-9', stage: 'sprite' }),
    );

    await drive(env, { send: notices.send }, 9);

    const [record] = await asOwner((owner) => owner<Stored[]>`
      select stage, attempts, last_error from account_deletion where user_id = ${userId}`);
    expect(record.stage).toBe('stalled');
    expect(record.attempts).toBe(8);
    expect(record.last_error).toMatch(/RUNTIME_QUEUE/);

    /* A machine still holding someone's memory is not a finished deletion. */
    expect(notices.calls).toHaveLength(1);
    expect(notices.calls[0].to).toBe('ops@example.com');
    expect(notices.calls[0].subject).toMatch(/could not be completed/i);
  });

  it('does nothing to a deletion whose grace period is still running', async () => {
    const deleted: string[] = [];
    const env = testEnv({
      ARTIFACTS: { delete: async (key: string) => { deleted.push(key); } },
      RUNTIME_QUEUE: { send: async () => {} },
    });
    const { businessId, userId } = await asOwner((owner) =>
      seedDueDeletion(owner, { artifacts: ['a/1'], scheduledIn: '7 days' }),
    );

    const summary = await sweepAccountDeletions(env);

    expect(summary).toEqual({ advanced: 0, completed: 0, stalled: 0 });
    expect(deleted).toEqual([]);
    const [record] = await asOwner((owner) => owner<Stored[]>`
      select stage from account_deletion where user_id = ${userId}`);
    expect(record.stage).toBe('pending');
    expect(await asOwner((owner) => owner`select 1 from business where id = ${businessId}`))
      .toHaveLength(1);
  });

  it('no-ops cleanly when there is no R2 binding at all', async () => {
    /* ARTIFACTS is optional in `env.ts`, so a deployment without it must
       still finish the deletion rather than crashing the cron. */
    const env = testEnv({ RUNTIME_QUEUE: { send: async () => {} } });
    const { businessId } = await asOwner((owner) =>
      seedDueDeletion(owner, { artifacts: ['a/1'] }),
    );

    await drive(env, {}, 8);

    expect(await asOwner((owner) => owner`select 1 from business where id = ${businessId}`))
      .toHaveLength(0);
    const [record] = await asOwner((owner) => owner<Stored[]>`
      select stage from account_deletion where email = ${EMAIL}`);
    expect(record.stage).toBe('done');
  });
});

/* ---- helpers ----------------------------------------------------------- */

const EMAIL = 'due@example.com';

interface Stored {
  stage: string;
  attempts: number;
  last_error: string | null;
  completed_at: Date | null;
}

/** A sender with the real signature, so the assertions read what was sent. */
function noticeFake(): {
  send: typeof sendNotice;
  calls: { to: string; subject: string; text: string }[];
} {
  const calls: { to: string; subject: string; text: string }[] = [];
  const send: typeof sendNotice = async (_env, to, subject, text) => {
    calls.push({ to, subject, text });
    return true;
  };
  return { send, calls };
}

/**
 * One cron tick, N times.
 *
 * The sweep backs off after a failure, so the clock is wound forward between
 * ticks the way a real minute would. Nothing else is faked.
 *
 * An hour rather than `now()`, because the due scan compares `next_attempt_at`
 * — written by the database — against a timestamp taken from this process's
 * clock, and Docker's VM clock runs a few milliseconds off the host's. Making
 * the two meet exactly at `now()` is a coin toss: a tick would silently find
 * nothing due and the record would lag a stage behind for reasons that have
 * nothing to do with the code under test.
 */
async function drive(
  env: Env,
  options: { send?: typeof sendNotice } = {},
  ticks: number,
): Promise<{ advanced: number; completed: number; stalled: number }[]> {
  const summaries = [];
  for (let i = 0; i < ticks; i += 1) {
    await asOwner((owner) => owner`
      update account_deletion set next_attempt_at = now() - interval '1 hour'
       where completed_at is null and cancelled_at is null`);
    summaries.push(await sweepAccountDeletions(env, options));
  }
  return summaries;
}

/**
 * A business whose grace period is over, with one of everything the purge
 * has to deal with: artifacts in R2, a connector, a sprite, tenant history
 * pointing at the person, and the address-keyed rows outside every cascade.
 */
async function seedDueDeletion(
  owner: postgres.Sql,
  opts: {
    kind?: 'owner' | 'staff';
    artifacts?: string[];
    sprite?: string;
    stage?: string;
    scheduledIn?: string;
  } = {},
): Promise<{
  deletionId: string;
  businessId: string;
  userId: string;
  runId: string;
  connectionId: string;
}> {
  const kind = opts.kind ?? 'owner';

  const [business] = await owner<{ id: string }[]>`
    insert into business (name, playbook_key) values ('Purge Test', 'restaurant') returning id`;
  const businessId = business.id;

  const [person] = await owner<{ id: string }[]>`
    insert into app_user (email, email_verified, deleted_at)
    values (${EMAIL}, true, now()) returning id`;
  const userId = person.id;
  await owner`
    insert into membership (user_id, business_id, role)
    values (${userId}, ${businessId}, ${kind === 'owner' ? 'owner' : 'staff'})`;

  let inviter = userId;
  if (kind === 'owner') {
    await owner`update business set deleted_at = now() where id = ${businessId}`;
  } else {
    /* A business only outlives its staff because someone else owns it. The
       boss also sent the invitation, so it does not simply cascade away with
       the person — the purge has to remove it on purpose. */
    const [boss] = await owner<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('boss@example.com', true) returning id`;
    await owner`insert into membership (user_id, business_id, role) values (${boss.id}, ${businessId}, 'owner')`;
    inviter = boss.id;
  }

  const [run] = await owner<{ id: string }[]>`
    insert into run (business_id, kind, trigger_shape, runtime, requested_by)
    values (${businessId}, 'ask', 'manual', 'inline', ${userId}) returning id`;
  for (const [index, key] of (opts.artifacts ?? []).entries()) {
    await owner`
      insert into artifact (business_id, run_id, name, content_type, size_bytes, r2_key)
      values (${businessId}, ${run.id}, ${`report-${index}.txt`}, 'text/plain', 10, ${key})`;
  }

  const [connection] = await owner<{ id: string }[]>`
    insert into connection (business_id, connector, method, status, connected_by)
    values (${businessId}, 'telegram', 'bot_token', 'connected', ${userId}) returning id`;

  await owner`
    insert into approval (business_id, connector, op, args, risk, status, decided_by)
    values (${businessId}, 'telegram', 'send', '{}'::jsonb, 'low', 'approved', ${userId})`;
  await owner`
    insert into business_fact (business_id, key, value, source, confirmed_by)
    values (${businessId}, 'hours.monday', '"9-5"'::jsonb, 'owner', ${userId})`;
  await owner`
    insert into action_policy (business_id, op, policy, updated_by)
    values (${businessId}, 'telegram.send', 'approval', ${userId})`;
  await owner`
    insert into routine
      (business_id, name, task_kind, frequency, time_of_day, time_zone, status,
       created_by, authorised_by, create_request_id)
    values (${businessId}, 'Daily summary', 'business_summary', 'daily', '09:00',
            'Asia/Kuala_Lumpur', 'active', ${userId}, ${userId}, gen_random_uuid())`;
  await owner`
    insert into invitation (business_id, email, token_hash, invited_by, expires_at)
    values (${businessId}, ${EMAIL}, ${'b'.repeat(64)}, ${inviter}, now() + interval '7 days')`;

  if (opts.sprite) {
    await owner`
      insert into agent_runtime (business_id, provider, provider_name, desired_release)
      values (${businessId}, 'fly-sprite', ${opts.sprite}, 'r1')`;
  }

  /* Outside every cascade, and the reason the last stage exists. */
  await owner`insert into platform_access (email, kind) values (${EMAIL}, 'paid')`;
  await owner`insert into waitlist_entry (email) values (${EMAIL})`;
  await owner`
    insert into trial_invite (token_hash, email, expires_at, redeemed_by, redeemed_at)
    values (${'c'.repeat(64)}, ${EMAIL}, now() + interval '7 days', ${userId}, now())`;
  await owner`
    insert into trial_redemption (user_id, token_hash, expires_at)
    values (${userId}, ${'c'.repeat(64)}, now() + interval '7 days')`;

  /* Arrays go in the way `requestDeletion` writes them, so the row the sweep
     reads has exactly the shape production gives it. */
  const [deletion] = await owner<{ id: string }[]>`
    insert into account_deletion
      (business_id, user_id, email, kind, scheduled_for, stage, artifact_keys, sprite_id, connector_ids)
    values (
      ${businessId}, ${userId}, ${EMAIL}, ${kind},
      now() + ${opts.scheduledIn ?? '-1 hour'}::interval,
      ${opts.stage ?? 'pending'},
      array(select jsonb_array_elements_text(${owner.json(opts.artifacts ?? [])})),
      ${opts.sprite ?? null},
      array(select jsonb_array_elements_text(${owner.json([connection.id])})::uuid)
    )
    returning id`;

  return {
    deletionId: deletion.id,
    businessId,
    userId,
    runId: run.id,
    connectionId: connection.id,
  };
}
