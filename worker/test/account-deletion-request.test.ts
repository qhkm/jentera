import { beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { asOwner, testEnv, truncateAll } from './harness';
import { requestDeletion } from '../src/account-deletion/request';
import type { Identity } from '../src/auth';

beforeEach(async () => {
  await truncateAll();
});

describe('account_deletion schema', () => {
  it('survives the business cascade it describes', async () => {
    await asOwner(async (sql) => {
      const [business] = await sql`
        insert into business (name, playbook_key) values ('Cascade Test', 'restaurant') returning id`;
      const [user] = await sql`
        insert into app_user (email, email_verified) values ('cascade@example.com', true) returning id`;
      await sql`
        insert into account_deletion (business_id, user_id, email, kind, scheduled_for, sprite_id)
        values (${business.id}, ${user.id}, 'cascade@example.com', 'owner', now() + interval '7 days', 'sprite-1')`;

      await sql`delete from business where id = ${business.id}`;

      /* The whole point: the record outlives the data it describes, so the
         external cleanup still has the sprite id to work from. */
      const rows = await sql`select sprite_id, business_id from account_deletion where user_id = ${user.id}`;
      expect(rows).toHaveLength(1);
      expect(rows[0].sprite_id).toBe('sprite-1');
      expect(rows[0].business_id).toBeNull();
    });
  });
});

const TEST_TOKEN = { id: 'a'.repeat(64), value: 'test-cancel-token-value' };

describe('requesting deletion', () => {
  it('refuses an owner whose team still has members', async () => {
    const env = testEnv();
    const { identity } = await asOwner((owner) => seedTeam(owner, { members: 1 }));

    const result = await requestDeletion(env, identity, identity.email, TEST_TOKEN);

    expect(result.status).toBe(409);
    expect(result.err).toMatch(/remove.*member/i);
  });

  it('refuses when the typed address does not match', async () => {
    const env = testEnv();
    const { identity } = await asOwner((owner) => seedTeam(owner, { members: 0 }));

    const result = await requestDeletion(env, identity, 'someone-else@example.com', TEST_TOKEN);

    expect(result.status).toBe(403);
  });

  it('stamps, revokes and records — copying out identifiers before anything is deleted', async () => {
    const env = testEnv();
    const { identity, businessId } = await asOwner((owner) => seedTeam(owner, { members: 0, sprite: 'sprite-9' }));

    const result = await requestDeletion(env, identity, identity.email, TEST_TOKEN);
    expect(result.status).toBe(200);

    await asOwner(async (owner) => {
      const [business] = await owner`select deleted_at from business where id = ${businessId}`;
      const [user] = await owner`select deleted_at from app_user where id = ${identity.userId}`;
      expect(business.deleted_at).not.toBeNull();
      expect(user.deleted_at).not.toBeNull();

      const live = await owner`select 1 from session where user_id = ${identity.userId} and revoked_at is null`;
      expect(live).toHaveLength(0);

      const [record] = await owner`select * from account_deletion where user_id = ${identity.userId}`;
      expect(record.kind).toBe('owner');
      expect(record.sprite_id).toBe('sprite-9');
      /* Copied out before anything is deleted — after the cascade there is
         nothing left to read them from. */
      expect(record.artifact_keys.length).toBeGreaterThan(0);
      expect(record.cancel_token_id).toBe(TEST_TOKEN.id);

      const days = (new Date(record.scheduled_for).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThan(7.1);

      /* No runtime task kind exists for "stop", and every session for this
         business was just revoked, so nothing will wake the sprite during
         grace — doing nothing here is what leaves it merely stopped rather
         than destroyed. */
      const tasks = await owner`select 1 from runtime_task where business_id = ${businessId}`;
      expect(tasks).toHaveLength(0);
    });
  });

  it('leaves the business alone for a staff member, and records kind "staff"', async () => {
    const env = testEnv();
    const { businessId, staff } = await asOwner((owner) => seedTeam(owner, { members: 1 }));
    const staffIdentity = staff[0];

    const result = await requestDeletion(env, staffIdentity, staffIdentity.email, TEST_TOKEN);
    expect(result.status).toBe(200);

    await asOwner(async (owner) => {
      const [business] = await owner`select deleted_at from business where id = ${businessId}`;
      const [user] = await owner`select deleted_at from app_user where id = ${staffIdentity.userId}`;
      expect(business.deleted_at).toBeNull();
      expect(user.deleted_at).not.toBeNull();

      const [record] = await owner`select kind from account_deletion where user_id = ${staffIdentity.userId}`;
      expect(record.kind).toBe('staff');

      const stillMember = await owner`
        select 1 from membership where business_id = ${businessId} and user_id = ${staffIdentity.userId}`;
      /* Membership is a tenant row, cascaded only by a business deletion —
         a staff request does not touch the business, so it is untouched
         here too; the purge (a later task) is what removes it. */
      expect(stillMember).toHaveLength(1);
    });
  });
});

/**
 * A business with an owner, N staff, and one of each external identifier
 * (an artifact, a connector, and optionally a sprite) so the "copy the
 * identifiers out" assertions have something real to find.
 */
async function seedTeam(
  owner: postgres.Sql,
  opts: { members?: number; sprite?: string } = {},
): Promise<{ identity: Identity; businessId: string; staff: Identity[] }> {
  const suffix = crypto.randomUUID();

  const [business] = await owner<{ id: string }[]>`
    insert into business (name, playbook_key) values ('Deletion Test', 'restaurant') returning id`;
  const businessId = business.id;

  const [ownerUser] = await owner<{ id: string; email: string }[]>`
    insert into app_user (email, email_verified) values (${`owner-${suffix}@example.com`}, true)
    returning id, email`;
  await owner`insert into membership (user_id, business_id, role) values (${ownerUser.id}, ${businessId}, 'owner')`;

  const staff: Identity[] = [];
  for (let i = 0; i < (opts.members ?? 0); i++) {
    const [staffUser] = await owner<{ id: string; email: string }[]>`
      insert into app_user (email, email_verified) values (${`staff-${i}-${suffix}@example.com`}, true)
      returning id, email`;
    await owner`insert into membership (user_id, business_id, role) values (${staffUser.id}, ${businessId}, 'staff')`;
    staff.push({
      userId: staffUser.id,
      email: staffUser.email,
      businessId,
      role: 'staff',
      detailLevel: 'beginner',
    });
  }

  const [run] = await owner<{ id: string }[]>`
    insert into run (business_id, kind, trigger_shape, runtime)
    values (${businessId}, 'ask', 'manual', 'inline') returning id`;
  await owner`
    insert into artifact (business_id, run_id, name, content_type, size_bytes, r2_key)
    values (${businessId}, ${run.id}, 'report.txt', 'text/plain', 10, ${`${businessId}/${run.id}/a1/report.txt`})`;

  await owner`
    insert into connection (business_id, connector, method, status)
    values (${businessId}, 'telegram', 'bot_token', 'connected')`;

  if (opts.sprite) {
    await owner`
      insert into agent_runtime (business_id, provider, provider_name, desired_release)
      values (${businessId}, 'fly-sprite', ${opts.sprite}, 'r1')`;
  }

  const identity: Identity = {
    userId: ownerUser.id,
    email: ownerUser.email,
    businessId,
    role: 'owner',
    detailLevel: 'beginner',
  };
  return { identity, businessId, staff };
}
