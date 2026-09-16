import type { Env } from '../env';
import type { Identity } from '../auth';
import { withTenant } from '../db';
import { GRACE_DAYS, deletionConsequences, externalIdentifiers } from './store';

export type RequestResult = { status: 200; routines: number } | { status: 403 | 409; err: string };

/** Deletion is not role-gated: anyone may delete their own account, which is
 *  what both stores require. Ownership decides which of the two operations
 *  runs, not whether the person is allowed to ask. */
export async function requestDeletion(
  env: Env,
  identity: Identity,
  confirmEmail: string,
  token: { id: string; value: string },
): Promise<RequestResult> {
  if (confirmEmail.trim().toLowerCase() !== identity.email.toLowerCase()) {
    return { status: 403, err: 'Type the account’s email address to confirm.' };
  }
  if (!identity.businessId) return { status: 409, err: 'There is nothing to delete yet.' };
  const businessId = identity.businessId;
  const kind = identity.role === 'owner' ? 'owner' : 'staff';

  return withTenant(env, businessId, async (tx): Promise<RequestResult> => {
    if (kind === 'owner') {
      const [{ others }] = await tx<{ others: number }[]>`
        select count(*)::int as others from membership
         where business_id = ${businessId} and user_id <> ${identity.userId}`;
      if (others > 0) {
        return {
          status: 409,
          err: 'Remove the other members from your team first, then delete your account.',
        };
      }
    }

    const { routines } = await deletionConsequences(tx, businessId, identity.userId);
    /* Read before anything below deletes it: after the business row goes,
       the cascade has already erased the artifact and runtime rows that
       name it. */
    const external = await externalIdentifiers(tx, businessId);

    await tx`update app_user set deleted_at = now() where id = ${identity.userId}`;
    if (kind === 'owner') await tx`update business set deleted_at = now() where id = ${businessId}`;
    await tx`update session set revoked_at = now() where user_id = ${identity.userId} and revoked_at is null`;

    /* text[]/uuid[] columns: postgres.js has no reliable way to bind a
       plain JS array of strings against those column types, so the
       existing convention in this codebase (src/connections.ts, `scopes`)
       is to pass the array as jsonb and unpack it server-side. */
    await tx`
      insert into account_deletion
        (business_id, user_id, email, kind, scheduled_for, artifact_keys, sprite_id, connector_ids, cancel_token_id)
      values (
        ${businessId}, ${identity.userId}, ${identity.email.toLowerCase()}, ${kind},
        now() + ${`${GRACE_DAYS} days`}::interval,
        array(select jsonb_array_elements_text(${tx.json(external.artifactKeys)})),
        ${external.spriteId},
        array(select jsonb_array_elements_text(${tx.json(external.connectorIds)})::uuid),
        ${token.id}
      )`;

    /* Nothing is queued here on purpose. There is no runtime task kind for
       "stop", and Sprites sleep on their own once every session for this
       business has just been revoked — nothing will wake it during grace.
       Destroying it is a later stage (the purge, after grace), not this
       one. */
    return { status: 200, routines };
  });
}
