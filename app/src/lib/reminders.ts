export interface ReminderDraft { id: string; message: string }
export interface Reminder { id: string; message: string; dueAt: string; timeZone: string; status: 'scheduled' | 'sent' | 'cancelled' }

/** Deliberately recognizes direct commands, not discussions about reminders.
 * Dates are reviewed explicitly rather than guessed from ambiguous prose. */
export function isReminderRequest(text: string): boolean {
  return /^(?:(?:hey|btw|please|pls|tolong|can you|could you|boleh)\s*[, :]?\s*)*(?:remind me\b|ingatkan (?:saya|aku)\b|(?:set|create|schedule|add|buat|tetapkan)\s+(?:(?:a|an|me a|one|satu)\s+)?(?:reminder|peringatan)\b)/i.test(text.trim());
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
