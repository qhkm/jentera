import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleVault } from '../src/routes/vault';
import type { Env } from '../src/env';
import { asOwner, req, signIn, testEnv, truncateAll } from './harness';

const BUSINESS = '11111111-1111-4111-8111-111111111111';
const APPROVAL = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://jentera.ai';

let ownerId = '';
let ownerCookie = '';
let staffCookie = '';

beforeEach(async () => {
  await truncateAll();
  let staffId = '';
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded)
              values (${BUSINESS}, 'Alpha', 'restaurant', true)`;
    await sql`update business set plan = 'team'`;
    const [owner] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified)
      values ('vault-owner@example.com', true) returning id`;
    const [staff] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified)
      values ('vault-staff@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role)
              values (${owner.id}, ${BUSINESS}, 'owner'), (${staff.id}, ${BUSINESS}, 'staff')`;
    ownerId = owner.id;
    staffId = staff.id;
  });
  ownerCookie = await signIn(ownerId);
  staffCookie = await signIn(staffId);
});

function approval(status = 'pending') {
  return {
    id: APPROVAL,
    secretId: crypto.randomUUID(),
    taskId: crypto.randomUUID(),
    resource: 'https://api.stripe.com',
    operations: ['send'],
    issuedTo: 'sprite:aisar-b-alpha',
    reason: 'Send invoice 104 to the customer',
    status,
    requestedAt: '2026-09-16T01:00:00.000Z',
    requestedBy: 'sprite:aisar-b-alpha',
    decidedAt: status === 'pending' ? null : '2026-09-16T01:01:00.000Z',
    decidedBy: status === 'pending' ? null : ownerId,
    expiresAt: '2026-09-16T01:10:00.000Z',
    consumedAt: null,
  };
}

function vaultEnv(fetchImpl: (request: Request) => Promise<Response>): Env {
  return testEnv({
    ALLOWED_ORIGINS: ORIGIN,
    VAULT_INTERNAL_TOKEN: 'vault-internal-test',
    VAULT: { fetch: fetchImpl },
  });
}

async function call(
  method: string,
  path: string,
  env: Env,
  opts: { cookie?: string; origin?: string | null; body?: unknown } = {},
) {
  const incoming = req(method, path, { cookie: opts.cookie });
  const headers = new Headers(incoming.request.headers);
  if (opts.origin !== null) headers.set('Origin', opts.origin ?? ORIGIN);
  if (method !== 'GET') headers.set('Content-Type', 'application/json');
  const request = new Request(incoming.url, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
  });
  const response = await handleVault(request, env, incoming.url, {
    'Access-Control-Allow-Origin': ORIGIN,
  });
  if (!response) throw new Error('vault route did not match');
  return response;
}

describe('vault owner bridge', () => {
  it('reads material-free approval metadata over the private binding', async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        `https://vault.internal/v1/approvals/${APPROVAL}?businessId=${BUSINESS}`,
      );
      expect(request.headers.get('X-Vault-Internal')).toBe('vault-internal-test');
      return Response.json({ ok: true, approval: approval() });
    });
    const response = await call(
      'GET', `/api/vault/approvals/${APPROVAL}`, vaultEnv(fetcher), { cookie: staffCookie },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      ok: true,
      approval: {
        id: APPROVAL,
        reason: 'Send invoice 104 to the customer',
        resource: 'https://api.stripe.com',
        operations: ['send'],
        status: 'pending',
        requestedAt: '2026-09-16T01:00:00.000Z',
        expiresAt: '2026-09-16T01:10:00.000Z',
        decidedAt: null,
      },
    });
  });

  it('derives business and owner identity from the signed-in session', async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe(`https://vault.internal/v1/approvals/${APPROVAL}/decide`);
      expect(await request.json()).toEqual({
        businessId: BUSINESS,
        decision: 'approve',
        decidedBy: ownerId,
      });
      return Response.json({ ok: true, approval: approval('approved') });
    });
    const response = await call(
      'POST', `/api/vault/approvals/${APPROVAL}/decide`, vaultEnv(fetcher),
      {
        cookie: ownerCookie,
        body: {
          decision: 'approve',
          businessId: crypto.randomUUID(),
          decidedBy: crypto.randomUUID(),
        },
      },
    );
    expect(response.status).toBe(200);
    expect((await response.json() as { approval: { status: string } }).approval.status)
      .toBe('approved');
  });

  it('refuses staff decisions before calling the vault', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    const response = await call(
      'POST', `/api/vault/approvals/${APPROVAL}/decide`, vaultEnv(fetcher),
      { cookie: staffCookie, body: { decision: 'approve' } },
    );
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses cross-site decisions before calling the vault', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    const response = await call(
      'POST', `/api/vault/approvals/${APPROVAL}/decide`, vaultEnv(fetcher),
      { cookie: ownerCookie, origin: 'https://evil.test', body: { decision: 'approve' } },
    );
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed when the binding or shared credential is absent', async () => {
    const response = await call(
      'GET', `/api/vault/approvals/${APPROVAL}`, testEnv(), { cookie: ownerCookie },
    );
    expect(response.status).toBe(503);
  });

  it('does not reveal whether an approval exists to another business', async () => {
    const fetcher = vi.fn(async () => Response.json(
      { ok: false, err: 'not found' }, { status: 404 },
    ));
    const response = await call(
      'GET', `/api/vault/approvals/${APPROVAL}`, vaultEnv(fetcher), { cookie: ownerCookie },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, err: 'approval not found' });
  });

  it('requires a signed-in business member', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, approval: approval() }));
    const response = await call(
      'GET', `/api/vault/approvals/${APPROVAL}`, vaultEnv(fetcher),
    );
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
