/* ============================================================
   The purge: what happens seven days after someone asks.

   Order is the invariant here, not an implementation detail. Deleting the
   business row cascades every tenant table, and with them the only index of
   what lives outside Postgres — `artifact` names the R2 keys, `agent_runtime`
   names the sprite, `connection` names the provider registrations. So
   everything external happens first, and the identifiers it works from were
   copied into `account_deletion` when the deletion was requested, before
   anything was touched.

   Each stage is one tick of the minute cron and records that it finished, so
   a failure anywhere leaves a record that resumes rather than a half-deleted
   account. `stage` names the work still to do.
   ============================================================ */

import type { Env } from '../env';
import { connect, withTenant, withUser } from '../db';
import { publishRuntimeTask } from '../runtime/consumer';
import { sendNotice } from '../email';
import { revokeConnector } from '../routes/connect';
import type { DeletionRecord } from './store';

/** Eight tries with doubling delays, as the push outbox gives itself. */
const GIVE_UP_AFTER = 8;
const BASE_BACKOFF_MS = 60_000;
const SCAN_LIMIT = 50;

export interface SweepSummary {
  advanced: number;
  completed: number;
  stalled: number;
}

type Stage = DeletionRecord['stage'];

/** Stages in order. Each is resumable, and each records what it finished. */
const NEXT: Record<string, Stage> = {
  pending: 'connectors',
  connectors: 'objects',
  objects: 'sprite',
  sprite: 'tenant',
  tenant: 'identity',
  identity: 'done',
};

export async function sweepAccountDeletions(
  env: Env,
  options: { now?: Date; limit?: number; send?: typeof sendNotice } = {},
): Promise<SweepSummary> {
  const send = options.send ?? sendNotice;
  const now = options.now ?? new Date();
  const summary: SweepSummary = { advanced: 0, completed: 0, stalled: 0 };

  /* One cross-tenant read of ids through the security definer function, the
     same shape as push_outbox_due: this sweep has no tenant of its own, and
     half the records it finds no longer have one either. */
  const sql = connect(env);
  let due: { deletion_id: string }[];
  try {
    due = await sql<{ deletion_id: string }[]>`
      select deletion_id
        from public.account_deletion_due(
          ${now.toISOString()}::timestamptz, ${options.limit ?? SCAN_LIMIT})`;
  } finally {
    await sql.end({ timeout: 1 });
  }

  for (const target of due) {
    try {
      const reached = await advance(env, target.deletion_id, send);
      summary.advanced += 1;
      if (reached === 'done') summary.completed += 1;
    } catch (err) {
      const gaveUp = await recordFailure(env, target.deletion_id, String(err));
      if (gaveUp) {
        summary.stalled += 1;
        /* The record is 'stalled' now, so the due scan will not offer it
           again and this notice is never retried. If it cannot be sent, the
           log line is the only thing left saying a machine may still be
           holding someone's memory — and one address refusing mail must not
           abandon the other deletions in this tick. */
        try {
          await notifyStalled(env, target.deletion_id, String(err), send);
        } catch (sendErr) {
          console.error(
            `[deletion] STALLED ${target.deletion_id} and could not tell anyone: ` +
              `${String(sendErr)} — original failure: ${String(err)}`,
          );
        }
      }
    }
  }
  return summary;
}

/** One stage, then return. A slow stage cannot starve the others. */
async function advance(
  env: Env,
  deletionId: string,
  send: typeof sendNotice,
): Promise<Stage> {
  const record = await load(env, deletionId);
  if (!record) return 'done';

  switch (record.stage) {
    case 'pending':
      break; // nothing external yet; fall through to the stage bump
    case 'connectors':
      /* Only an owner's deletion takes the business down with it. A staff
         member leaving must not revoke the business's connectors or destroy
         its sprite — both belong to the business, which survives.

         The record alone, with no live read beside it: connecting anything
         needs a session, and every session was revoked in the same
         transaction that wrote this record, so `connector_ids` can only have
         shrunk since. Artifacts below are the opposite case — work keeps
         producing them through the grace period — which is why that stage
         asks the table and this one does not. */
      if (record.kind === 'owner' && record.businessId) {
        for (const id of record.connectorIds) {
          await revokeConnector(env, record.businessId, id);
        }
      }
      break;
    case 'objects':
      /* Artifacts belong to the business, so a staff deletion leaves them. */
      if (record.kind === 'owner') await deleteObjects(env, await liveArtifactKeys(env, record));
      break;
    case 'sprite':
      /* Asked live, not read off the record. `sprite_id` is a snapshot taken
         seven days earlier, and only `verifySession` honours
         `business.deleted_at` — a Telegram message during the grace period
         provisions a sprite for a business whose snapshot had none. Trusting
         the snapshot would leave that machine unqueued, unguarded, and
         orphaned by the cascade a minute later. */
      if (record.kind === 'owner' && record.businessId
          && await runtimeStanding(env, record.businessId)) {
        /* The existing destroy path, not a new one. It needs the business
           row, which is why it runs before the cascade and not after. */
        await publishRuntimeTask(env, record.businessId, {
          kind: 'delete',
          dedupeKey: `delete:deletion:${deletionId}`,
        });
      }
      break;
    case 'tenant':
      if (record.kind === 'owner') await requireRuntimeGone(env, record);
      await deleteTenantData(env, record);
      break;
    case 'identity':
      await deleteIdentity(env, record);
      break;
    default:
      return record.stage;
  }

  const next = NEXT[record.stage] ?? 'done';
  await withUser(env, (sql) => sql`
    update account_deletion
       set stage = ${next}, attempts = 0, last_error = null,
           next_attempt_at = now(),
           completed_at = case when ${next} = 'done' then now() else null end
     where id = ${deletionId} and cancelled_at is null and completed_at is null`);

  if (next === 'done') {
    /* The record is already done. A notice that will not send is worth a log
       line, never a retry of a deletion that has finished. */
    try {
      await notifyComplete(env, record.email, send);
    } catch (err) {
      console.error(`[deletion] completion notice for ${deletionId}: ${String(err)}`);
    }
  }
  return next;
}

/* ---- the stages -------------------------------------------------------- */

/**
 * Every key this business has in R2, recorded and current.
 *
 * `artifact_keys` is a snapshot taken seven days earlier, and nothing reads
 * `business.deleted_at` — Telegram messages and routines keep doing work
 * through the grace period, and each artifact they produce has a key the
 * record does not carry. The cascade one stage later erases the `artifact`
 * row naming it, so what is missed here is missed permanently and silently,
 * after the person has been emailed that everything was erased.
 *
 * So the table is asked while it still exists — this stage runs before the
 * cascade — and the record is kept as the union's other half, because after
 * the cascade (a resumed deletion, a business id already nulled) it is all
 * there is.
 */
async function liveArtifactKeys(env: Env, record: DeletionRecord): Promise<string[]> {
  const keys = new Set(record.artifactKeys);
  if (record.businessId) {
    const rows = await withTenant(env, record.businessId, (tx) => tx<{ r2_key: string }[]>`
      select r2_key from artifact where business_id = ${record.businessId}`);
    for (const row of rows) keys.add(row.r2_key);
  }
  return [...keys];
}

/**
 * The bytes in R2.
 *
 * `ARTIFACTS` is optional in `env.ts`, and a deployment without it must
 * finish the deletion rather than crash the cron — but silence would leave
 * objects nobody can find again, so say so.
 */
async function deleteObjects(env: Env, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  if (!env.ARTIFACTS) {
    console.warn(`[deletion] no ARTIFACTS binding: ${keys.length} object(s) left in place`);
    return;
  }
  for (const key of keys) await env.ARTIFACTS.delete(key);
}

/**
 * Refuse to cascade while the machine is still standing.
 *
 * The sprite stage queues the destroy; it does not watch it happen. That is
 * fine everywhere except here, because `runtime_task` references
 * `business(id) on delete cascade` — so deleting the business erases the
 * destroy task, its outbox row and the runtime record naming the sprite, all
 * at once. A destroy the consumer had not reached yet would simply cease to
 * exist, leaving a live machine holding the person's Hermes memory with
 * nothing in the system pointing at it. That is the precise failure the
 * deletion record exists to prevent, so it is checked at the one moment it
 * is still preventable.
 *
 * `deleteRuntime` ends by removing the `agent_runtime` row, so the row's
 * absence means the machine is gone, not merely that something was queued.
 * Eight refusals stall the deletion and tell a human, which is the loud
 * ending the design asks for.
 *
 * Asked of the table, never of `record.spriteId`: a sprite provisioned after
 * the request is exactly the one nothing else knows about.
 *
 * And it asks again before it refuses. A wake lost between the sprite stage
 * and here — the queue dropped it, the consumer died mid-flight — is the most
 * likely reason this ever stalls, and `publishRuntimeTask` is idempotent on
 * `dedupeKey` and re-signals a task that is queued or failed. So the refusal
 * carries one more attempt with it rather than counting down to a human.
 * A re-publish that itself fails is logged and swallowed: the refusal below
 * is the message worth keeping.
 */
async function requireRuntimeGone(env: Env, record: DeletionRecord): Promise<void> {
  const businessId = record.businessId;
  if (!businessId) return;
  if (await runtimeStanding(env, businessId)) {
    try {
      await publishRuntimeTask(env, businessId, {
        kind: 'delete',
        dedupeKey: `delete:deletion:${record.id}`,
      });
    } catch (err) {
      console.warn(
        `[deletion] could not re-publish the destroy for ${businessId}: ${String(err)}`,
      );
    }
    throw new Error(
      `a runtime is still standing for ${businessId} ` +
        `(recorded sprite: ${record.spriteId ?? 'none'}); not cascading over it`,
    );
  }
}

/** Is there a machine right now? The row goes when the sprite is destroyed. */
async function runtimeStanding(env: Env, businessId: string): Promise<boolean> {
  const rows = await withTenant(env, businessId, (tx) => tx`
    select 1 from agent_runtime where business_id = ${businessId}`);
  return rows.length > 0;
}

/**
 * The tenant data.
 *
 * For an owner this is one statement: every tenant table references
 * `business(id) on delete cascade`. It runs inside `withTenant` because
 * `business` has forced row-level security keyed on `app.business_id` — the
 * same delete outside a tenant transaction matches no row and reports
 * success, which is the worst possible failure here.
 */
async function deleteTenantData(env: Env, record: DeletionRecord): Promise<void> {
  const businessId = record.businessId;
  if (!businessId) return;

  if (record.kind === 'owner') {
    await withTenant(env, businessId, (tx) => tx`delete from business where id = ${businessId}`);
    return;
  }

  const userId = record.userId;
  if (!userId) return;
  /* A staff deletion leaves the business standing, so their rows in it are
     handled rather than cascaded. These five references are nullable and are
     nulled, which keeps the business's history intact with the person
     removed from it. */
  await withTenant(env, businessId, async (tx) => {
    await tx`update run set requested_by = null
              where business_id = ${businessId} and requested_by = ${userId}`;
    await tx`update approval set decided_by = null
              where business_id = ${businessId} and decided_by = ${userId}`;
    await tx`update action_policy set updated_by = null
              where business_id = ${businessId} and updated_by = ${userId}`;
    await tx`update business_fact set confirmed_by = null
              where business_id = ${businessId} and confirmed_by = ${userId}`;
    await tx`update connection set connected_by = null
              where business_id = ${businessId} and connected_by = ${userId}`;
    /* `routine.created_by` is not null, so a routine cannot lose its author
       the way a run loses its requester. The ones they created go; the ones
       they merely authorised are paused rather than deleted (022), and the
       confirm screen counts `created_by` alone, so deleting on
       `authorised_by` too would destroy more than they were shown a number
       for. 052 narrowed this to `created_by` for exactly that reason.

       Through a function because 022 revoked delete on `routine` from the
       app role on purpose — pause is the recoverable stop, and no route may
       delete one. The function does NOT lean on RLS for its tenant bound:
       FORCE row level security binds a table owner, not a superuser or a
       BYPASSRLS role, and the definer is owned by whoever ran the migration.
       052 reads `app.business_id` itself instead, which is why this call is
       only correct from inside `withTenant`. */
    await tx`select public.delete_member_routines(${businessId}::uuid, ${userId}::uuid)`;
    /* An invitation names an address, and the address is the personal data.
       It is a tenant row under RLS, so it can only be reached from inside
       the business — which for a staff deletion means here, while the
       business still exists. An owner's cascade takes theirs. Invitations
       sent by OTHER businesses are swept in the identity stage, which is
       where the address-keyed rows live. */
    await tx`delete from invitation where business_id = ${businessId} and email = ${record.email}`;
    await tx`delete from membership where business_id = ${businessId} and user_id = ${userId}`;
  });
}

/**
 * The identity, and the rows keyed only by an address.
 *
 * `app_user` cascades sessions, memberships, OAuth identities, devices and
 * chats. Two references block it instead of cascading and have to be cleared
 * first: `trial_redemption.user_id` and `trial_invite.redeemed_by`. The
 * invite row itself stays — it is the operator's record that a code was
 * issued and spent — but `trial_invite.email` is the person's address and
 * is nullable, so it goes with the pointer rather than outliving it.
 *
 * Statement by statement rather than one transaction: every one is
 * idempotent, so a failure part-way through is resumed by the next tick.
 */
async function deleteIdentity(env: Env, record: DeletionRecord): Promise<void> {
  await deleteInvitationsForAddress(env, record.email);
  await withUser(env, async (sql) => {
    if (record.userId) {
      await sql`delete from trial_redemption where user_id = ${record.userId}`;
      await sql`update trial_invite set redeemed_by = null, email = null
                 where redeemed_by = ${record.userId}`;
      await sql`delete from app_user where id = ${record.userId}`;
    }
    /* An invite issued to the address and never spent still names it. */
    await sql`update trial_invite set email = null where email = ${record.email}`;
    /* Keyed by a lowercased address, referencing neither business nor user,
       so no cascade reaches them. */
    await sql`delete from platform_access where email = ${record.email}`;
    await sql`delete from waitlist_entry where email = ${record.email}`;
  });
}

/**
 * Every open invitation for the address, in whatever business sent it.
 *
 * `deleteTenantData` clears the ones in the business the person belonged to,
 * which is all RLS lets it see. An invitation from a different business is
 * invisible from there and survives holding their address, which the spec
 * calls out and which is a residual address after the deletion said it was
 * done.
 *
 * The definer reads ids and nothing else (051); the DELETE is the app role's
 * own, inside `withTenant` for each business named, so the table's policy is
 * still what bounds every write. Grouped so one business costs one
 * transaction.
 */
async function deleteInvitationsForAddress(env: Env, email: string): Promise<void> {
  const rows = await withUser(env, (sql) => sql<{ invitation_id: string; business_id: string }[]>`
    select invitation_id, business_id from public.invitations_for_email(${email})`);
  const byBusiness = new Map<string, string[]>();
  for (const row of rows) {
    byBusiness.set(row.business_id, [...(byBusiness.get(row.business_id) ?? []), row.invitation_id]);
  }
  for (const [businessId, ids] of byBusiness) {
    await withTenant(env, businessId, async (tx) => {
      for (const id of ids) {
        await tx`delete from invitation where id = ${id} and business_id = ${businessId}`;
      }
    });
  }
}

/* ---- the record -------------------------------------------------------- */

interface Row {
  id: string;
  business_id: string | null;
  user_id: string | null;
  email: string;
  kind: 'owner' | 'staff';
  stage: Stage;
  attempts: number;
  artifact_keys: string[];
  sprite_id: string | null;
  connector_ids: string[];
}

/**
 * No RLS on this table: it outlives the tenant it describes.
 *
 * The arrays come back as jsonb because `connect()` sets `fetch_types:
 * false`, and without the type catalogue postgres.js hands a `uuid[]` back
 * as the literal string `{id,id}`. Iterating that yields characters, which
 * is a connector id of `{` and a stage that can never finish.
 */
async function load(env: Env, deletionId: string): Promise<DeletionRecord | null> {
  const [row] = await withUser(env, (sql) => sql<Row[]>`
    select id, business_id, user_id, email, kind, stage, attempts, sprite_id,
           to_jsonb(artifact_keys) as artifact_keys,
           to_jsonb(connector_ids) as connector_ids
      from account_deletion where id = ${deletionId}`);
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    email: row.email,
    kind: row.kind,
    stage: row.stage,
    attempts: row.attempts,
    artifactKeys: row.artifact_keys ?? [],
    spriteId: row.sprite_id,
    connectorIds: row.connector_ids ?? [],
  };
}

/** True when this was the attempt that gave up. */
async function recordFailure(env: Env, deletionId: string, message: string): Promise<boolean> {
  return withUser(env, async (sql) => {
    const rows = await sql<{ attempts: number }[]>`
      update account_deletion
         set attempts = attempts + 1,
             last_error = ${message.slice(0, 300)},
             next_attempt_at = now()
               + (${BASE_BACKOFF_MS} * power(2, attempts))::bigint * interval '1 millisecond',
             stage = case when attempts + 1 >= ${GIVE_UP_AFTER} then 'stalled' else stage end
       where id = ${deletionId} and cancelled_at is null and completed_at is null
      returning attempts`;
    return (rows[0]?.attempts ?? 0) >= GIVE_UP_AFTER;
  });
}

async function notifyStalled(
  env: Env,
  deletionId: string,
  message: string,
  send: typeof sendNotice,
): Promise<void> {
  if (!env.SIGNUP_NOTICE_TO) return;
  /* A sprite that will not die still holds Hermes memory, which is personal
     data. Purging the database and calling it done while a machine still
     holds it is the version that looks finished and isn't — so a human is
     told, by name, which deletion needs finishing by hand. */
  await send(
    env,
    env.SIGNUP_NOTICE_TO,
    'A Jentera account deletion could not be completed',
    `Deletion ${deletionId} gave up after ${GIVE_UP_AFTER} attempts.\n\n${message}\n\n` +
      `Finish it by hand, then set stage = 'done' and completed_at = now() on that row.`,
  );
}

async function notifyComplete(env: Env, email: string, send: typeof sendNotice): Promise<void> {
  await send(
    env,
    email,
    'Your Jentera account has been deleted',
    'Your Jentera account and everything in it have been erased. Nothing is left to restore.',
  );
}
