export interface ReminderDraft { id: string; message: string; dueAt?: string }
export interface Reminder { id: string; message: string; dueAt: string; timeZone: string; status: 'scheduled' | 'sent' | 'cancelled' }

/** A proposal is untrusted model output, never authorization to schedule.
 * Use the durable run ID for replay safety; ignore any model-supplied ID. */
export function reminderProposal(text: string, runId?: string): { text: string; draft?: ReminderDraft } {
  const blocks = [...text.matchAll(/```jentera-reminder\s*\n([\s\S]*?)```/g)];
  if (blocks.length !== 1 || !runId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) return { text };
  try {
    const value: unknown = JSON.parse(blocks[0][1]);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { text };
    const data = value as Record<string, unknown>;
    if (typeof data.message !== 'string' || !data.message.trim() || data.message.length > 500 || data.timeZone !== 'Asia/Kuala_Lumpur') return { text };
    if (data.dueAt !== null && (typeof data.dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.dueAt) || !Number.isFinite(Date.parse(data.dueAt)))) return { text };
    return { text: text.replace(blocks[0][0], '').trim(), draft: { id: runId, message: data.message.trim(), ...(typeof data.dueAt === 'string' ? { dueAt: data.dueAt } : {}) } };
  } catch { return { text }; }
}

export function reminderLocalTime(instant?: string): string {
  if (!instant || !Number.isFinite(Date.parse(instant))) return '';
  // The supported zone has a fixed UTC+8 offset. Keep seconds so a relative
  // three-minute request is not rounded down to two minutes by the form.
  return new Date(Date.parse(instant) + 8 * 3600_000).toISOString().slice(0, 19);
}

export class ReminderError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export async function listReminders(): Promise<Reminder[]> {
  const response = await fetch(`${BASE}/api/reminders`, { credentials: 'include', cache: 'no-store' });
  const data = await response.json();
  if (!response.ok || !data.ok || !Array.isArray(data.reminders)) throw new ReminderError('Could not load reminders.');
  return data.reminders;
}
export async function reminderRequest(id: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<{ reminder: Reminder; push?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ReminderError('Invalid reminder.');
  const response = await fetch(`${BASE}/api/reminders${method === 'POST' ? '' : `/${id}`}`, {
    method, credentials: 'include', cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new ReminderError(data.err ?? 'Could not check the reminder.', response.status);
  if (data.reminder?.id !== id || !['scheduled', 'sent', 'cancelled'].includes(data.reminder?.status)) throw new ReminderError('Could not verify the saved reminder.');
  return data;
}
