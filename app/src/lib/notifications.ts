import { isRunId } from '@/lib/task';

export type NotificationKind =
  | 'reminder_due'
  | 'routine_completed'
  | 'routine_failed'
  | 'routine_skipped'
  | 'routine_needs_approval'
  | 'work_needs_you'
  | 'approval_requested'
  | 'booking_requested';

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

/* One unknown kind rejects the whole list (`fetchNotifications`), so a new
   kind ships here before the Worker writes it. */
const KINDS: readonly NotificationKind[] = [
  'reminder_due', 'routine_completed', 'routine_failed', 'routine_skipped', 'routine_needs_approval',
  'work_needs_you', 'approval_requested', 'booking_requested',
];
const WORKSPACE_URL = /^\/app([/?#]|$)/;

function notification(value: unknown): value is AppNotification {
  if (!object(value)) return false;
  return isRunId(value.id) && typeof value.kind === 'string' &&
    (KINDS as readonly string[]).includes(value.kind) &&
    (value.url === undefined || value.url === null ||
      (typeof value.url === 'string' && value.url.length <= 300 && WORKSPACE_URL.test(value.url) && !value.url.includes('\\'))) &&
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
  return {
    notifications: (data.notifications as AppNotification[]).map((item) => ({ ...item, url: typeof item.url === 'string' ? item.url : null })),
    unread: data.unread as number,
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
