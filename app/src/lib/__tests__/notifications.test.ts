import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNotifications } from '@/lib/notifications';

const item = (kind: string) => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind,
  title: 'Chase the late invoices — done',
  body: 'Open it to see the result.',
  runId: '22222222-2222-4222-8222-222222222222',
  routineId: null,
  occurrenceId: null,
  readAt: null,
  createdAt: '2026-09-24T02:00:00.000Z',
});

const serve = (notifications: unknown[]) => vi.stubGlobal('fetch', vi.fn(async () => new Response(
  JSON.stringify({ ok: true, notifications, unread: notifications.length, nextCursor: null }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
)));

afterEach(() => vi.unstubAllGlobals());

describe('the notification list', () => {
  it('accepts a finished-task notification', async () => {
    serve([item('work_finished')]);
    const page = await fetchNotifications();
    expect(page.notifications.map((n) => n.kind)).toEqual(['work_finished']);
  });

  /* A Worker that learns a kind before this app does must not empty the
     inbox: the one it cannot show is left out, the rest still arrive. */
  it('leaves out a kind it does not know and keeps the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    serve([item('made_up'), { ...item('work_finished'), id: '33333333-3333-4333-8333-333333333333' }]);
    const page = await fetchNotifications();
    expect(page.notifications.map((n) => n.kind)).toEqual(['work_finished']);
    expect(warn).toHaveBeenCalledWith('[notifications] left out 1 of an unknown kind');
    warn.mockRestore();
  });

  it('still refuses a malformed notification', async () => {
    serve([{ ...item('work_finished'), id: 'not-an-id' }]);
    await expect(fetchNotifications()).rejects.toThrow('invalid notification list');
  });
});
