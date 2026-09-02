import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { handleRuns } from '../src/routes/runs';
import { asOwner, asTenant, req, signIn, testEnv, truncateAll } from './harness';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let cookieA: string;
let cookieB: string;
let workA: string;
let workB: string;

beforeEach(async () => {
  await truncateAll();
  let userA = '';
  let userB = '';
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key)
              values (${A}, 'Alpha', 'restaurant'), (${B}, 'Beta', 'retail')`;
    const [a] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('a@example.com', true) returning id`;
    const [b] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('b@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role)
              values (${a.id}, ${A}, 'owner'), (${b.id}, ${B}, 'owner')`;
    userA = a.id;
    userB = b.id;
  });
  cookieA = await signIn(userA);
  cookieB = await signIn(userB);

  /* Two completed work records, one per tenant. */
  await asTenant(A, async (tx) => {
    await tx`insert into work_record (business_id, objective, status, function, channel)
             values (${A}, 'Draft a reply', 'completed', 'reply', 'telegram')`;
    const [row] = await tx<{ id: string }[]>`
      select id from work_record where business_id = ${A} limit 1`;
    workA = row.id;
  });
  await asTenant(B, async (tx) => {
    await tx`insert into work_record (business_id, objective, status, function, channel)
             values (${B}, 'Summarise orders', 'completed', 'ask', 'app')`;
    const [row] = await tx<{ id: string }[]>`
      select id from work_record where business_id = ${B} limit 1`;
    workB = row.id;
  });
});

describe('Work quality rating', () => {
  it('records a good rating on the owner\'s own work', async () => {
    const response = await call('POST', '/api/runs/quality', testEnv(), cookieA, {
      workId: workA,
      quality: 'good',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const [row] = await asOwner((sql) => sql<{
      outcome_quality: string | null;
      quality_at: Date | null;
    }[]>`select outcome_quality, quality_at from work_record where id = ${workA}`);
    expect(row.outcome_quality).toBe('good');
    expect(row.quality_at).not.toBeNull();
  });

  it('lets the owner change their mind to poor', async () => {
    await call('POST', '/api/runs/quality', testEnv(), cookieA, {
      workId: workA,
      quality: 'good',
    });
    const response = await call('POST', '/api/runs/quality', testEnv(), cookieA, {
      workId: workA,
      quality: 'poor',
    });
    expect(response.status).toBe(200);

    const [row] = await asOwner((sql) => sql<{ outcome_quality: string | null }[]>`
      select outcome_quality from work_record where id = ${workA}`);
    expect(row.outcome_quality).toBe('poor');
  });

  it('rejects an unknown quality value', async () => {
    const response = await call('POST', '/api/runs/quality', testEnv(), cookieA, {
      workId: workA,
      quality: 'meh',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, err: 'quality must be good or poor' });
  });

  it('rejects a missing workId', async () => {
    const response = await call('POST', '/api/runs/quality', testEnv(), cookieA, {
      quality: 'good',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, err: 'workId is required' });
  });

  it('404s on work that does not exist', async () => {
    const response = await call('POST', '/api/runs/quality', testEnv(), cookieA, {
      workId: '00000000-0000-4000-8000-000000000000',
      quality: 'good',
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, err: 'work record not found' });
  });

  it('cannot rate another tenant\'s work', async () => {
    const response = await call('POST', '/api/runs/quality', testEnv(), cookieB, {
      workId: workA,
      quality: 'good',
    });
    expect(response.status).toBe(404);

    const [row] = await asOwner((sql) => sql<{ outcome_quality: string | null }[]>`
      select outcome_quality from work_record where id = ${workA}`);
    expect(row.outcome_quality).toBeNull();
  });

  it('requires a session', async () => {
    const response = await call('POST', '/api/runs/quality', testEnv(), undefined, {
      workId: workA,
      quality: 'good',
    });
    expect(response.status).toBe(401);
  });
});

async function call(
  method: string,
  path: string,
  env: Env,
  cookie?: string,
  body?: unknown,
): Promise<Response> {
  const incoming = req(method, path, { cookie, body });
  const response = await handleRuns(incoming.request, env, incoming.url, {});
  if (!response) throw new Error('runs route did not match');
  return response;
}
