import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNotifications, workspaceParams } from '@/lib/notifications';

const ID = '11111111-1111-4111-8111-111111111111';

const item = (kind: string) => ({
  id: ID,
  kind,
  title: 'Chase the late invoices — done',
  body: 'Open it to see the result.',
  runId: '22222222-2222-4222-8222-222222222222',
  routineId: null,
  occurrenceId: null,
  readAt: null,
  createdAt: '2026-09-24T02:00:00.000Z',
});

const booking = (over: Record<string, unknown> = {}) => ({
  id: ID, kind: 'booking_requested', title: 'New booking request', body: 'Aisyah · Tue 6 Oct', runId: null, routineId: null,
  occurrenceId: null, url: `/app?view=apps&app=bookings&booking=${ID}`, readAt: null, createdAt: '2026-10-05T00:00:00.000Z', ...over,
});

const serve = (notifications: unknown[]) => vi.stubGlobal('fetch', vi.fn(async () => new Response(
  JSON.stringify({ ok: true, notifications, unread: notifications.length, nextCursor: null }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
)));

afterEach(() => vi.unstubAllGlobals());

describe('the notification list', () => {
  it('accepts a credit warning', async () => {
    serve([item('credit_warning')]);
    const page = await fetchNotifications();
    expect(page.notifications.map((n) => n.kind)).toEqual(['credit_warning']);
  });

  it('accepts a finished-task notification', async () => {
    serve([item('work_finished')]);
    const page = await fetchNotifications();
    expect(page.notifications.map((n) => n.kind)).toEqual(['work_finished']);
  });

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

describe('a booking request notification', () => {
  it('is accepted with its workspace link', async () => {
    serve([booking()]);
    const page = await fetchNotifications();
    expect(page.notifications[0]).toMatchObject({ kind: 'booking_requested', url: `/app?view=apps&app=bookings&booking=${ID}` });
  });

  it('reads a list from an older server with no url as having none', async () => {
    const legacy = booking({ kind: 'reminder_due' });
    delete (legacy as Record<string, unknown>).url;
    serve([legacy]);
    expect((await fetchNotifications()).notifications[0].url).toBeNull();
  });

  it('drops a link out of the workspace to none, and keeps the rest of the inbox', async () => {
    serve([
      booking({ url: 'https://evil.test/app' }),
      booking({ id: '22222222-2222-4222-8222-222222222222', url: '/app/\\evil.test' }),
      booking({ id: '33333333-3333-4333-8333-333333333333', url: 42 }),
      booking({ id: '44444444-4444-4444-8444-444444444444' }),
    ]);
    const page = await fetchNotifications();
    expect(page.notifications.map((entry) => entry.url)).toEqual([null, null, null, `/app?view=apps&app=bookings&booking=${ID}`]);
  });

  it('turns a workspace link into search params, and nothing else', () => {
    expect(workspaceParams(`/app?view=apps&app=bookings&booking=${ID}`)).toEqual({ view: 'apps', app: 'bookings', booking: ID });
    expect(workspaceParams('/app')).toEqual({});
    expect(workspaceParams('https://evil.test/app?view=apps')).toBeNull();
    expect(workspaceParams('/elsewhere?view=apps')).toBeNull();
  });
});
