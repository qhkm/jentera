import { beforeEach, describe, expect, it } from 'vitest';
import { getBusinessPlan } from '../src/agent-runtime';
import { handleSession } from '../src/routes/session';
import { asOwner, asTenant, req, signIn, testEnv, truncateAll } from './harness';

const FREE = '11111111-1111-4111-8111-111111111111';
const PRO = '22222222-2222-4222-8222-222222222222';
const TEAM = '33333333-3333-4333-8333-333333333333';
const cors = { 'Access-Control-Allow-Origin': 'https://jentera.ai' };
let cookies: Record<string, string>;

beforeEach(async () => {
  await truncateAll();
  const users = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, plan) values
      (${FREE}, 'Solo', 'restaurant', 'free'), (${PRO}, 'Always on', 'retail', 'pro'), (${TEAM}, 'Crew', 'clinic', 'team')`;
    const rows = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values
      ('free@example.com', true), ('pro@example.com', true), ('team@example.com', true), ('staff@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values
      (${rows[0].id}, ${FREE}, 'owner'), (${rows[1].id}, ${PRO}, 'owner'),
      (${rows[2].id}, ${TEAM}, 'owner'), (${rows[3].id}, ${TEAM}, 'staff')`;
    return rows;
  });
  cookies = {
    free: await signIn(users[0].id), pro: await signIn(users[1].id),
    team: await signIn(users[2].id), staff: await signIn(users[3].id),
  };
});

async function me(cookie: string) {
  const { request, url } = req('GET', '/api/me', { cookie });
  const response = await handleSession(request, testEnv(), url, cors);
  return (await response!.json()) as { businessId?: string | null; role?: string | null; features?: { team?: { apiVersion: number }; routines?: unknown } };
}

describe('the team plan', () => {
  it('is a third plan value the business table accepts, and reads back as itself', async () => {
    expect(await asTenant(FREE, (tx) => getBusinessPlan(tx, FREE))).toBe('free');
    expect(await asTenant(PRO, (tx) => getBusinessPlan(tx, PRO))).toBe('pro');
    expect(await asTenant(TEAM, (tx) => getBusinessPlan(tx, TEAM))).toBe('team');
    await expect(asOwner((sql) => sql`update business set plan = 'enterprise' where id = ${FREE}`))
      .rejects.toThrow(/business_plan_check/);
  });

  it('is advertised on /api/me to every member of a team business, and to nobody else', async () => {
    expect((await me(cookies.team)).features?.team).toEqual({ apiVersion: 1 });
    expect((await me(cookies.staff)).features?.team).toEqual({ apiVersion: 1 });
    expect((await me(cookies.free)).features?.team).toBeUndefined();
    expect((await me(cookies.pro)).features?.team).toBeUndefined();
  });
});

describe('leaving the team plan', () => {
  it('drops staff to no business while the owner keeps it, and brings them back when the plan returns', async () => {
    await asOwner((sql) => sql`update business set plan = 'pro' where id = ${TEAM}`);
    expect(await me(cookies.staff)).toMatchObject({ businessId: null, role: null });
    expect(await me(cookies.team)).toMatchObject({ businessId: TEAM, role: 'owner' });
    expect((await me(cookies.team)).features?.team).toBeUndefined();
    await asOwner((sql) => sql`update business set plan = 'team' where id = ${TEAM}`);
    expect(await me(cookies.staff)).toMatchObject({ businessId: TEAM, role: 'staff' });
  });
});
