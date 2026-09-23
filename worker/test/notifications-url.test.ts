import { beforeEach, describe, expect, it } from 'vitest';
import { createNotification, listNotifications, notificationJson, workspaceTarget } from '../src/notifications/store';
import { asOwner, asTenant, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
let user = '';

beforeEach(async () => {
  await truncateAll();
  user = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded) values (${A}, 'Alpha', 'services', true)`;
    const [u] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('o@example.com', true) returning id`;
    return u.id;
  });
});

describe('notification targets', () => {
  it('accepts workspace paths and nothing else', () => {
    expect(workspaceTarget('/app?view=apps&app=bookings&booking=1')).toBe('/app?view=apps&app=bookings&booking=1');
    expect(workspaceTarget('/app')).toBe('/app');
    for (const bad of ['https://evil.example/app', '//evil.example', '/apple', '/api/x', 'javascript:alert(1)', '/app\\evil', undefined]) {
      expect(workspaceTarget(bad)).toBeNull();
    }
  });

  it('stores the target, lists it, and pushes to the same place', async () => {
    await asTenant(A, (tx) => createNotification(tx, A, {
      recipientUserId: user, kind: 'booking_requested', title: 'New booking request',
      body: 'Aisyah · Sat 3:00 pm', sourceKey: 'booking:b1', url: '/app?view=apps&app=bookings&booking=b1',
    }));
    const page = await asTenant(A, (tx) => listNotifications(tx, user, 10, null));
    expect(notificationJson(page.rows[0]).url).toBe('/app?view=apps&app=bookings&booking=b1');
    const [push] = await asOwner((sql) => sql<{ url: string }[]>`select url from push_outbox`);
    expect(push.url).toBe('/app?view=apps&app=bookings&booking=b1');
  });

  it('drops an unsafe target, falls back to the inbox for the push, and keeps legacy rows null', async () => {
    await asTenant(A, (tx) => createNotification(tx, A, {
      recipientUserId: user, kind: 'booking_requested', title: 't', body: 'b', sourceKey: 'booking:b2', url: 'https://evil.example',
    }));
    const page = await asTenant(A, (tx) => listNotifications(tx, user, 10, null));
    expect(notificationJson(page.rows[0]).url).toBeNull();
    const [push] = await asOwner((sql) => sql<{ url: string }[]>`select url from push_outbox`);
    expect(push.url).toBe('/app?view=notifications');
  });
});
