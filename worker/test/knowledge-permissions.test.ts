import { beforeEach, expect, it } from 'vitest';
import { handleRepo } from '../src/routes/repo';
import { handleRuns } from '../src/routes/runs';
import { recordFact } from '../src/facts';
import { asOwner, asTenant, jsonOf, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
let staffCookie: string;
let ownerCookie: string;
beforeEach(async () => {
  await truncateAll();
  const users = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, plan) values (${A}, 'Alpha', 'restaurant', 'team')`;
    const users = await sql<{ id: string }[]>`insert into app_user (email, email_verified)
      values ('owner@example.com', true), ('staff@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role)
      values (${users[0].id}, ${A}, 'owner'), (${users[1].id}, ${A}, 'staff')`;
    return users;
  });
  ownerCookie = await signIn(users[0].id);
  staffCookie = await signIn(users[1].id);
  await asTenant(A, (tx) => recordFact(tx, A, { key: 'service.price', value: 'RM 100', source: 'owner', confirmedBy: users[0].id }));
});

it('staff can read knowledge but cannot write, confirm, forget, or import it', async () => {
  const e = testEnv();
  for (const path of ['/api/state/facts', '/api/state/facts/confirm', '/api/state/facts/confirm-batch', '/api/state/facts/forget', '/api/runs/ingest', '/api/runs/ingest/file']) {
    const { request, url } = req('POST', path, { cookie: staffCookie,
      body: { key: 'service.price', keys: ['service.price'], value: 'RM 1', source: 'owner', url: 'https://example.com' } });
    const response = await (path.startsWith('/api/state') ? handleRepo : handleRuns)(request, e, url, {});
    expect(response?.status, path).toBe(403);
  }
  const incoming = req('GET', '/api/state', { cookie: staffCookie });
  const response = await handleRepo(incoming.request, e, incoming.url, {});
  expect(await jsonOf(response!)).toMatchObject({ snapshot: { canManageKnowledge: false,
    facts: [expect.objectContaining({ value: 'RM 100', confirmed: true })] } });
});

it('owner approval requires the displayed proposal version and batch cannot bypass it', async () => {
  const proposal = await asTenant(A, (tx) => recordFact(tx, A, { key: 'service.price', value: 'RM 80', source: 'agent' }));
  for (const [path, body, status] of [
    ['/api/state/facts/confirm', { key: proposal.key }, 409],
    ['/api/state/facts/confirm-batch', { keys: [proposal.key] }, 409],
    ['/api/state/facts/confirm', { key: proposal.key, version: proposal.version }, 204],
  ] as const) {
    const incoming = req('POST', path, { cookie: ownerCookie, body });
    expect((await handleRepo(incoming.request, testEnv(), incoming.url, {}))?.status).toBe(status);
  }
});
