import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRuntime } from '../src/routes/runtime';
import type { Env } from '../src/env';
import { asOwner, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
let ownerCookie: string;
let staffCookie: string;

beforeEach(async () => {
  await truncateAll();
  let ownerId = '';
  let staffId = '';
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`;
    const [owner] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('owner@example.com', true) returning id`;
    const [staff] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('staff@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role)
              values (${owner.id}, ${A}, 'owner'), (${staff.id}, ${A}, 'staff')`;
    ownerId = owner.id;
    staffId = staff.id;
  });
  ownerCookie = await signIn(ownerId);
  staffCookie = await signIn(staffId);
});

describe('runtime canary route', () => {
  it('shows no runtime without exposing provider identity', async () => {
    const response = await call('GET', '/api/runtime', testEnv(), ownerCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, runtime: null });
  });

  it('requires authentication and an owner', async () => {
    expect((await call('POST', '/api/runtime/provision', testEnv())).status).toBe(401);
    expect((await call('POST', '/api/runtime/provision', enabled(), staffCookie)).status).toBe(403);
  });

  it('fails closed unless provisioning and secure transport are explicit', async () => {
    const disabled = await call('POST', '/api/runtime/provision', testEnv(), ownerCookie);
    expect(disabled.status).toBe(503);
    const insecure = await call('POST', '/api/runtime/provision', testEnv({
      RUNTIME_PROVISIONING_ENABLED: 'true',
    }), ownerCookie);
    expect(insecure.status).toBe(503);
    expect((await insecure.json()).err).toMatch(/secure model transport/);
    const noBootstrap = await call('POST', '/api/runtime/provision', testEnv({
      RUNTIME_PROVISIONING_ENABLED: 'true',
      VRS_TRANSPORT_READY: 'true',
    }), ownerCookie);
    expect(noBootstrap.status).toBe(503);
    expect((await noBootstrap.json()).err).toMatch(/bootstrap is disabled/);
  });

  it('requires the session-derived business to be in the canary', async () => {
    const response = await call('POST', '/api/runtime/provision', testEnv({
      RUNTIME_PROVISIONING_ENABLED: 'true',
      VRS_TRANSPORT_READY: 'true',
      RUNTIME_BOOTSTRAP_ENABLED: 'true',
      RUNTIME_CANARY_BUSINESS_IDS: '22222222-2222-4222-8222-222222222222',
    }), ownerCookie);
    expect(response.status).toBe(403);
  });

  it('publishes one deduplicated provisioning task for an allowed owner', async () => {
    const send = vi.fn(async () => {});
    const env = enabled(send);
    const first = await call('POST', '/api/runtime/provision', env, ownerCookie);
    const second = await call('POST', '/api/runtime/provision', env, ownerCookie);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect((await second.json()).taskId).toBe((await first.json()).taskId);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({ version: 1, businessId: A });
    const [{ count }] = await asOwner((sql) => sql<{ count: string }[]>`
      select count(*)::text as count from runtime_task where business_id = ${A}`);
    expect(count).toBe('1');
  });
});

function enabled(send = vi.fn(async () => {})): Env {
  return testEnv({
    RUNTIME_RELEASE: '2026.08.27-1',
    RUNTIME_PROVISIONING_ENABLED: 'true',
    VRS_TRANSPORT_READY: 'true',
    RUNTIME_BOOTSTRAP_ENABLED: 'true',
    RUNTIME_CANARY_BUSINESS_IDS: A,
    RUNTIME_QUEUE: { send },
  });
}

async function call(method: string, path: string, env: Env, cookie?: string) {
  const { request, url } = req(method, path, { cookie });
  const response = await handleRuntime(request, env, url, {});
  if (!response) throw new Error('runtime route did not match');
  return response;
}
