import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { claimRuntime } from '../src/agent-runtime';
import { deriveJenteraRuntimeCredential } from '../src/runtime/openrouter-keys';
import { saveConnection } from '../src/connections';
import { GOOGLE_CALENDAR_RUNTIME_PATH, handleGoogleCalendarRuntime } from '../src/routes/google-calendar-runtime';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const RID = 'aisar-b-aaaaaaaaaaaaaaaaaaaa';
const SECRET = 'fmcv-calendar-test-secret-'.padEnd(48, 's');
let key: string;
let ownerId: string;
const env = (): Env => testEnv({ AISAR_MODEL_KEY: SECRET, API_ORIGIN: 'https://api.jentera.ai' });

async function call(method = 'GET', token = key, override: Env = env()) {
  const request = new Request(`https://api.test${GOOGLE_CALENDAR_RUNTIME_PATH}/setup`, {
    method, headers: { Authorization: `Bearer ${token}` },
  });
  const response = await handleGoogleCalendarRuntime(request, override, new URL(request.url), {});
  if (!response) throw new Error('setup route did not match');
  return response;
}

beforeEach(async () => {
  await truncateAll();
  await asOwner((sql) => sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`);
  await asOwner(async (sql) => {
    const [row] = await sql<{ id: string }[]>`insert into app_user (email, email_verified)
      values ('owner@example.com', true) returning id`;
    ownerId = row.id;
    await sql`insert into membership (business_id, user_id, role) values (${A}, ${ownerId}, 'owner')`;
  });
  await asTenant(A, (tx) => claimRuntime(env(), tx, A, {
    provider: 'fly-sprite', providerName: RID, release: '2026.09.18-3',
    runnerKey: 'r'.repeat(64), hermesApiKey: 'h'.repeat(64),
  }));
  key = (await deriveJenteraRuntimeCredential(SECRET, RID)).key;
});
afterEach(() => vi.unstubAllGlobals());

async function connectCalendar() {
  await asTenant(A, (tx) => saveConnection(env(), tx, A, {
    connector: 'google', method: 'oauth', externalId: 'test-google-owner',
    displayName: 'owner@example.com', connectedBy: ownerId,
    secret: JSON.stringify({ v: 1, refreshToken: 'test-only-refresh-token',
      scopes: ['https://www.googleapis.com/auth/calendar.events.owned'] }),
    scopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
  }));
}

describe('managed gws login', () => {
  it('returns a normal-browser setup link even before Calendar is connected, with no Google credential', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, status: 'needs_owner_login',
      connectUrl: 'https://api.jentera.ai/api/connections/google-calendar/start' });
    expect(JSON.stringify(body)).not.toContain(key);
    expect(JSON.stringify(body)).not.toContain('refreshToken');
    expect(JSON.stringify(body)).not.toContain('client_secret');
  });

  it('requires a valid, provisioned runtime identity', async () => {
    expect((await call('GET', 'invalid')).status).toBe(401);
    await asOwner((sql) => sql`delete from agent_runtime where business_id = ${A}`);
    expect((await call()).status).toBe(403);
  });

  it('enforces its method and burst limit without starting OAuth or changing a connection', async () => {
    expect((await call('POST')).status).toBe(405);
    const limited = env();
    limited.RUNTIME_CONFIG_BURST = { limit: async () => ({ success: false }) };
    expect((await call('GET', key, limited)).status).toBe(429);
    const rows = await asOwner((sql) => sql`select id from connection where business_id = ${A}`);
    expect(rows).toHaveLength(0);
  });
});

describe('managed gws execution stays behind owner policy', () => {
  it('inserts only one pending proposal on retries and performs no Google write', async () => {
    await connectCalendar();
    const provider = vi.fn<typeof fetch>().mockRejectedValue(new Error('Google must not be called'));
    vi.stubGlobal('fetch', provider);
    const event = { requestId: 'test-cli-request-1', summary: 'Supplier call',
      start: '2026-09-18T10:00:00+08:00', end: '2026-09-18T10:30:00+08:00', timeZone: 'Asia/Kuala_Lumpur' };
    for (const status of [202, 200]) {
      const request = new Request(`https://api.test${GOOGLE_CALENDAR_RUNTIME_PATH}/proposals`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      const response = await handleGoogleCalendarRuntime(request, env(), new URL(request.url), {});
      expect(response?.status).toBe(status);
      expect(await response?.json()).toMatchObject({ status: 'needs_approval' });
    }
    const rows = await asTenant(A, (tx) => tx<{ status: string }[]>`select status from approval`);
    expect(rows).toEqual([{ status: 'pending' }]);
    expect(provider).not.toHaveBeenCalled();
  });

  it('honors blocked and approval-only read policies before fetching a Google credential', async () => {
    await connectCalendar();
    const provider = vi.fn<typeof fetch>().mockRejectedValue(new Error('Google must not be called'));
    vi.stubGlobal('fetch', provider);
    for (const policy of ['blocked', 'approval']) {
      await asTenant(A, (tx) => tx`insert into action_policy (business_id, op, policy)
        values (${A}, 'read', ${policy}) on conflict (business_id, op) do update set policy = excluded.policy`);
      const request = new Request(`https://api.test${GOOGLE_CALENDAR_RUNTIME_PATH}/events?timeMin=2026-09-18T00:00:00Z&timeMax=2026-09-19T00:00:00Z`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const response = await handleGoogleCalendarRuntime(request, env(), new URL(request.url), {});
      expect(response?.status).toBe(403);
    }
    expect(provider).not.toHaveBeenCalled();
  });
});
