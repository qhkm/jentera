import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNotifications, workspaceParams } from '../notifications';

const ID = '11111111-1111-4111-8111-111111111111';
const item = (over: Record<string, unknown> = {}) => ({
  id: ID, kind: 'booking_requested', title: 'New booking request', body: 'Aisyah · Tue 6 Oct', runId: null, routineId: null,
  occurrenceId: null, url: `/app?view=apps&app=bookings&booking=${ID}`, readAt: null, createdAt: '2026-10-05T00:00:00.000Z', ...over,
});
function serve(notifications: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, notifications, unread: 1, nextCursor: null }))));
}
afterEach(() => vi.unstubAllGlobals());

describe('notifications', () => {
  it('accepts a booking request with its workspace link', async () => {
    serve([item()]);
    const page = await fetchNotifications();
    expect(page.notifications[0]).toMatchObject({ kind: 'booking_requested', url: `/app?view=apps&app=bookings&booking=${ID}` });
  });

  it('reads a list from an older server with no url as having none', async () => {
    const legacy = item({ kind: 'reminder_due' });
    delete (legacy as Record<string, unknown>).url;
    serve([legacy]);
    expect((await fetchNotifications()).notifications[0].url).toBeNull();
  });

  it('refuses a link out of the workspace', async () => {
    serve([item({ url: 'https://evil.test/app' })]);
    await expect(fetchNotifications()).rejects.toThrow();
  });

  it('turns a workspace link into search params, and nothing else', () => {
    expect(workspaceParams(`/app?view=apps&app=bookings&booking=${ID}`)).toEqual({ view: 'apps', app: 'bookings', booking: ID });
    expect(workspaceParams('/app')).toEqual({});
    expect(workspaceParams('https://evil.test/app?view=apps')).toBeNull();
    expect(workspaceParams('/elsewhere?view=apps')).toBeNull();
  });
});
