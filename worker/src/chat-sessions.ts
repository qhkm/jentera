/* ============================================================
   Chat sessions, and who may read a run.

   A chat used to exist only in the owner's browser; the run carried its
   id inside trigger_ref and every member of the business could read
   every run. With more than one person in a business a chat is private
   to whoever opened it unless it lives in a shared workspace, so the chat
   is a row (`chat_session`, migration 034) and the run points at it.

   The rule, in one place: a run with no chat — Telegram, a routine, an
   ingest — is the business's and every member may read it; a run with a
   chat may be read by the person who opened that chat. Workspaces widen
   the second half when they arrive; nothing else should restate it.
   ============================================================ */
import type postgres from 'postgres';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only an app-shaped chat id becomes a row. Telegram's
    `telegram:<business>:<chat>` and a free-form id from an older build
    stay Hermes sessions with no owner, so their runs stay the business's. */
export const isChatSessionId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/** The chat exists and is owned by whoever opened it first; every later
    turn, by anyone, only moves its clock. */
export async function ensureChatSession(
  tx: postgres.TransactionSql,
  businessId: string,
  sessionId: string,
  userId: string,
): Promise<{ createdBy: string }> {
  const [row] = await tx<{ created_by: string }[]>`
    insert into chat_session (id, business_id, created_by)
    values (${sessionId}, ${businessId}, ${userId})
    on conflict (business_id, id) do update set last_at = now()
    returning created_by`;
  return { createdBy: row.created_by };
}

/** May this person read this run? False for a run that does not exist. */
export async function runVisibleTo(
  tx: postgres.TransactionSql,
  businessId: string,
  runId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await tx<{ visible: boolean }[]>`
    select (r.session_id is null or c.created_by = ${userId}::uuid) as visible
      from run r
      left join chat_session c on c.business_id = r.business_id and c.id = r.session_id
     where r.business_id = ${businessId} and r.id = ${runId}`;
  return row?.visible === true;
}
