import { describe, expect, it } from 'vitest';
import { asOwner } from './harness';

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
