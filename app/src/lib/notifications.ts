import { isRunId } from '@/lib/task';

export type NotificationKind =
  | 'reminder_due'
  | 'routine_completed'
  | 'routine_failed'
  | 'routine_skipped'
  | 'routine_needs_approval'
  | 'work_needs_you'
  | 'approval_requested'
  | 'booking_requested'
  | 'work_finished';

/* The kinds this app can show. A row of any other kind is left out of the
   list rather than rejecting it (`fetchNotifications`), so a Worker that
   writes a new kind before this app ships it hides that one row and nothing
   else. It still belongs here first, or its owners never see it. */
const KINDS: readonly NotificationKind[] = [
  'reminder_due', 'routine_completed', 'routine_failed', 'routine_skipped', 'routine_needs_approval',
  'work_needs_you', 'approval_requested', 'booking_requested', 'work_finished',
];

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  runId: string | null;
  routineId: string | null;
  occurrenceId: string | null;
  /** Where the notification leads inside the workspace, when the Worker stored one. */
  url: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  notifications: AppNotification[];
  unread: number;
  nextCursor: string | null;
}

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const WORKSPACE_URL = /^\/app([/?#]|$)/;

/** A stored link only if it stays inside the workspace; anything else is
    read as no link, so one bad row cannot hide the rest. Navigation is
    guarded again by `workspaceParams`. */
function workspaceUrl(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 300 && WORKSPACE_URL.test(value) && !value.includes('\\')
    ? value : null;
}

const knownKind = (item: { kind: string }): item is AppNotification =>
  (KINDS as readonly string[]).includes(item.kind);

/** Well formed, whatever its kind; `knownKind` decides whether it is shown. */
function notification(value: unknown): value is Omit<AppNotification, 'kind'> & { kind: string } {
  if (!object(value)) return false;
  return isRunId(value.id) && typeof value.kind === 'string' &&
    typeof value.title === 'string' && typeof value.body === 'string' &&
    (value.runId === null || isRunId(value.runId)) &&
    (value.routineId === null || isRunId(value.routineId)) &&
    (value.occurrenceId === null || isRunId(value.occurrenceId)) &&
    (value.readAt === null || (typeof value.readAt === 'string' && Number.isFinite(Date.parse(value.readAt)))) &&
    typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt));
}

async function call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE}/api/notifications${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !object(body) || body.ok !== true) {
    throw new Error(object(body) && typeof body.err === 'string' ? body.err : 'Could not load notifications.');
  }
  return body;
}

export async function fetchNotifications(cursor?: string): Promise<NotificationPage> {
  const query = new URLSearchParams({ limit: '30', ...(cursor ? { cursor } : {}) });
  const data = await call(`?${query}`);
  if (!Array.isArray(data.notifications) || !data.notifications.every(notification) ||
      !Number.isInteger(data.unread) || Number(data.unread) < 0 ||
      !(data.nextCursor === null || typeof data.nextCursor === 'string')) {
    throw new Error('Jentera returned an invalid notification list.');
  }
  const notifications = data.notifications.filter(knownKind);
  const unknown = data.notifications.length - notifications.length;
  if (unknown > 0) console.warn(`[notifications] left out ${unknown} of an unknown kind`);
  return {
    notifications: notifications.map((item) => ({ ...item, url: workspaceUrl(item.url) })),
    unread: Number(data.unread),
    nextCursor: data.nextCursor as string | null,
  };
}

/** The search params of a same-origin workspace link (`/app?…`), or null. */
export function workspaceParams(url: string): Record<string, string> | null {
  const origin = typeof window === 'undefined' ? 'https://app.invalid' : window.location.origin;
  let target: URL;
  try {
    target = new URL(url, origin);
  } catch {
    return null;
  }
  if (target.origin !== origin || target.pathname !== '/app') return null;
  return Object.fromEntries(target.searchParams);
}

export async function readNotification(id: string): Promise<void> {
  if (!isRunId(id)) throw new Error('Invalid notification.');
  await call(`/${encodeURIComponent(id)}/read`, { method: 'POST', body: '{}' });
}

export async function readAllNotifications(): Promise<void> {
  await call('/read-all', { method: 'POST', body: '{}' });
}
