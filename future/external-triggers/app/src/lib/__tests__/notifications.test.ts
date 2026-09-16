import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNotifications } from '@/lib/notifications';

const ID = '11111111-1111-4111-8111-111111111111';
const item = { id: ID, kind: 'external_report', title: 'Internal report', body: 'Ready in Activity.', runId: ID,
  routineId: null, occurrenceId: null, readAt: null, createdAt: '2026-09-16T00:00:00.000Z' };
function respond(notification = item) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, notifications: [notification], unread: 1, nextCursor: null })));
}
afterEach(() => vi.unstubAllGlobals());
describe('external report inbox compatibility', () => {
  it('accepts the report notification and preserves its Activity run link', async () => {
    respond();
    expect(await fetchNotifications()).toEqual({ ok: true, notifications: [item], unread: 1, nextCursor: null });
  });
  it('still rejects unknown notification kinds', async () => {
    respond({ ...item, kind: 'execute_browser_action' });
    await expect(fetchNotifications()).rejects.toThrow('invalid notification list');
  });
  it('still rejects invalid task destinations', async () => {
    respond({ ...item, runId: 'https://evil.test' });
    await expect(fetchNotifications()).rejects.toThrow('invalid notification list');
  });
});
