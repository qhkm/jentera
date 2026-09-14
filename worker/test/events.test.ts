import { describe, expect, it, vi } from 'vitest';
import { handleEvents } from '../src/routes/events';
import type { Env } from '../src/env';
import { asOwner, asTenant, signIn, testEnv, truncateAll } from './harness';

const cors = { 'Access-Control-Allow-Origin': 'https://jentera.ai' };

describe('activation events', () => {
  it('records only the bounded, pseudonymous funnel shape', async () => {
    const writeDataPoint = vi.fn();
    const env = { PRODUCT_ANALYTICS: { writeDataPoint } } as unknown as Env;
    const request = new Request('https://api.jentera.ai/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'ask_completed',
        sessionId: '123e4567-e89b-42d3-a456-426614174000',
        route: '/app',
        elapsedSeconds: 73,
      }),
    });
    const response = await handleEvents(request, env, new URL(request.url), cors);

    expect(response?.status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ['123e4567-e89b-42d3-a456-426614174000'],
      blobs: ['ask_completed', '/app'],
      doubles: [73],
    });
  });

  it('rejects arbitrary event names and routes', async () => {
    const writeDataPoint = vi.fn();
    const env = { PRODUCT_ANALYTICS: { writeDataPoint } } as unknown as Env;
    const request = new Request('https://api.jentera.ai/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'email_owner_everything',
        sessionId: '123e4567-e89b-42d3-a456-426614174000',
        route: '/private/business-name',
        elapsedSeconds: 1,
      }),
    });
    const response = await handleEvents(request, env, new URL(request.url), cors);

    expect(response?.status).toBe(400);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it('records an installed-app open only for the signed-in tenant and a trusted origin', async () => {
    await truncateAll();
    const businessId = crypto.randomUUID();
    const userId = await asOwner(async (sql) => {
      await sql`insert into business (id,name,playbook_key) values (${businessId},'Test','generic')`;
      const [user] = await sql<{ id: string }[]>`insert into app_user (email,email_verified) values ('pwa@example.com',true) returning id`;
      await sql`insert into membership (user_id,business_id,role) values (${user.id},${businessId},'owner')`;
      return user.id;
    });
    const cookie = await signIn(userId);
    const body = JSON.stringify({
      event: 'installed_app_opened',
      sessionId: '123e4567-e89b-42d3-a456-426614174000',
      route: '/app',
      elapsedSeconds: 10,
    });
    const request = new Request('https://api.jentera.ai/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost:5173' },
      body,
    });
    const response = await handleEvents(request, testEnv(), new URL(request.url), cors);
    expect(response?.status).toBe(204);
    expect(await asTenant(businessId, (tx) => tx`select kind from activation_milestone`))
      .toEqual([{ kind: 'installed_app_opened' }]);

    const crossSite = new Request('https://api.jentera.ai/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://evil.test' },
      body,
    });
    expect((await handleEvents(crossSite, testEnv(), new URL(crossSite.url), cors))?.status).toBe(403);
  });
});
