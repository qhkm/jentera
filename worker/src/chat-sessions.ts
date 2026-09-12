/* ============================================================
   Chat sessions, and who may read a run.

   A chat used to exist only in the owner's browser; the run carried its
   id inside trigger_ref and every member of the business could read
   every run. With more than one person in a business a chat is private
   to whoever opened it unless it lives in a shared workspace, so the chat
   is a row (`chat_session`, migration 034; `workspace_id` from 036) and
   the run points at it.

   The rule, in one place: a run with no chat — Telegram, a routine, an
   ingest — is the business's and every member may read it; a run with a
   chat may be read by the person who opened that chat and by every member
   of the workspace it was opened in. `visibleRunPredicate` is that rule
   as SQL, over a run aliased `r` and its chat aliased `c`; the run,
   Activity and artifact queries all embed it rather than restate it.
   ============================================================ */
import type postgres from 'postgres';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only an app-shaped chat id becomes a row. Telegram's
    `telegram:<business>:<chat>` and a free-form id from an older build
    stay Hermes sessions with no owner, so their runs stay the business's. */
export const isChatSessionId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/** The chat exists and is owned by whoever opened it first, in the
    workspace it was opened in, under the title of its first question;
    every later turn, by anyone, only moves its clock. */
export async function ensureChatSession(
  tx: postgres.TransactionSql,
  businessId: string,
  sessionId: string,
  userId: string,
  options: { workspaceId?: string | null; title?: string | null } = {},
): Promise<{ createdBy: string; workspaceId: string | null }> {
  const title = options.title?.trim().slice(0, 200) || null;
  const [row] = await tx<{ created_by: string; workspace_id: string | null }[]>`
    insert into chat_session (id, business_id, created_by, workspace_id, title)
    values (${sessionId}, ${businessId}, ${userId}, ${options.workspaceId ?? null}, ${title})
    on conflict (business_id, id) do update set last_at = now()
    returning created_by, workspace_id`;
  return { createdBy: row.created_by, workspaceId: row.workspace_id };
}

/** Is this person in this workspace? False for a workspace that does not exist. */
export async function isWorkspaceMember(
  tx: postgres.TransactionSql,
  businessId: string,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await tx<{ found: number }[]>`
    select 1 as found from workspace_member
     where business_id = ${businessId} and workspace_id = ${workspaceId} and user_id = ${userId}`;
  return Boolean(row);
}

/** The rule as SQL, for a query that has `run r` and `left join chat_session c`
    on `c.business_id = r.business_id and c.id = r.session_id`. A null viewer
    reads everything, for callers that list without a person. */
export function visibleRunPredicate(tx: postgres.TransactionSql, viewer: string | null) {
  return tx`(${viewer}::uuid is null or r.session_id is null or c.created_by = ${viewer}::uuid
    or exists (select 1 from workspace_member wm
                where wm.business_id = c.business_id and wm.workspace_id = c.workspace_id
                  and wm.user_id = ${viewer}::uuid))`;
}

/** May this person read this run? False for a run that does not exist. */
export async function runVisibleTo(
  tx: postgres.TransactionSql,
  businessId: string,
  runId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await tx<{ visible: boolean }[]>`
    select ${visibleRunPredicate(tx, userId)} as visible
      from run r
      left join chat_session c on c.business_id = r.business_id and c.id = r.session_id
     where r.business_id = ${businessId} and r.id = ${runId}`;
  return row?.visible === true;
}

/** May this person read this chat? The opener, or a member of its workspace. */
export async function chatVisibleTo(
  tx: postgres.TransactionSql,
  businessId: string,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await tx<{ visible: boolean }[]>`
    select (c.created_by = ${userId}::uuid
      or exists (select 1 from workspace_member wm
                  where wm.business_id = c.business_id and wm.workspace_id = c.workspace_id
                    and wm.user_id = ${userId}::uuid)) as visible
      from chat_session c
     where c.business_id = ${businessId} and c.id = ${sessionId}`;
  return row?.visible === true;
}
