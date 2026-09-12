import type postgres from 'postgres';
import { enqueuePush } from '../push/outbox';

export type NotificationKind =
  | 'routine_completed'
  | 'routine_failed'
  | 'routine_skipped'
  | 'routine_needs_approval';

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  run_id: string | null;
  routine_id: string | null;
  occurrence_id: string | null;
  read_at: Date | null;
  created_at: Date;
}

export interface NotificationJson {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  runId: string | null;
  routineId: string | null;
  occurrenceId: string | null;
  readAt: string | null;
  createdAt: string;
}

const COLUMNS = 'id, kind, title, body, run_id, routine_id, occurrence_id, read_at, created_at';

export function notificationJson(row: NotificationRow): NotificationJson {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    runId: row.run_id,
    routineId: row.routine_id,
    occurrenceId: row.occurrence_id,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createRoutineNotification(
  tx: postgres.TransactionSql,
  businessId: string,
  input: {
    recipientUserId: string;
    kind: NotificationKind;
    title: string;
    body: string;
    sourceKey: string;
    runId?: string | null;
    routineId: string;
    occurrenceId: string;
  },
): Promise<void> {
  const [inserted] = await tx<{ id: string }[]>`
    insert into notification
      (business_id, recipient_user_id, kind, title, body, source_key,
       run_id, routine_id, occurrence_id)
    values (${businessId}, ${input.recipientUserId}, ${input.kind},
            ${input.title.slice(0, 160)}, ${input.body.slice(0, 500)}, ${input.sourceKey},
            ${input.runId ?? null}, ${input.routineId}, ${input.occurrenceId})
    on conflict (business_id, recipient_user_id, source_key) do nothing
    returning id`;
  /* Every notification also reaches the owner's devices: queued in this
     same transaction, sent by the cron within the minute (src/push/outbox.ts).
     A duplicate insert queues nothing. */
  if (!inserted) return;
  await enqueuePush(tx, businessId, input.recipientUserId, {
    title: input.title,
    body: input.body,
    url: '/app?view=notifications',
    tag: `notification:${input.sourceKey}`,
  });
}

export async function unreadNotificationCount(
  tx: postgres.TransactionSql,
  recipientUserId: string,
): Promise<number> {
  const [row] = await tx<{ count: string }[]>`
    select count(*)::text as count from notification
     where recipient_user_id = ${recipientUserId} and read_at is null`;
  return Number(row.count);
}

export async function listNotifications(
  tx: postgres.TransactionSql,
  recipientUserId: string,
  limit: number,
  cursor: { createdAt: Date; id: string } | null,
): Promise<{ rows: NotificationRow[]; nextCursor: string | null }> {
  const rows = cursor
    ? await tx.unsafe<NotificationRow[]>(
      `select ${COLUMNS} from notification
        where recipient_user_id = $1 and (created_at, id) < ($2::timestamptz, $3::uuid)
        order by created_at desc, id desc limit $4`,
      [recipientUserId, cursor.createdAt, cursor.id, limit + 1],
    )
    : await tx.unsafe<NotificationRow[]>(
      `select ${COLUMNS} from notification where recipient_user_id = $1
        order by created_at desc, id desc limit $2`,
      [recipientUserId, limit + 1],
    );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor: rows.length > limit && last
      ? btoa(`${last.created_at.toISOString()}|${last.id}`)
      : null,
  };
}

export function decodeNotificationCursor(value: string): { createdAt: Date; id: string } | null {
  try {
    const [instant, id] = atob(value).split('|');
    const createdAt = new Date(instant);
    if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id ?? '')) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export async function markNotificationRead(
  tx: postgres.TransactionSql,
  recipientUserId: string,
  id: string,
): Promise<boolean> {
  const rows = await tx`
    update notification set read_at = coalesce(read_at, now())
     where id = ${id} and recipient_user_id = ${recipientUserId}
     returning id`;
  return rows.length === 1;
}

export async function markAllNotificationsRead(
  tx: postgres.TransactionSql,
  recipientUserId: string,
): Promise<number> {
  const rows = await tx`
    update notification set read_at = now()
     where recipient_user_id = ${recipientUserId} and read_at is null
     returning id`;
  return rows.length;
}
