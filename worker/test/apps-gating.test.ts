import { beforeEach, describe, expect, it } from 'vitest';
import { appsEnabledFor } from '../src/apps/gating';
import { handleSession } from '../src/routes/session';
import { asOwner, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:5173' };

describe('appsEnabledFor', () => {
  it('needs the switch and an exact id, with no wildcard', () => {
    expect(appsEnabledFor(testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: A }), A)).toBe(true);
    expect(appsEnabledFor(testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: ` ${A.toUpperCase()} ,${B}` }), A)).toBe(true);
    expect(appsEnabledFor(testEnv({ APPS_ENABLED: 'false', APPS_BUSINESS_IDS: A }), A)).toBe(false);
    expect(appsEnabledFor(testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: '' }), A)).toBe(false);
    expect(appsEnabledFor(testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: '*' }), A)).toBe(false);
    expect(appsEnabledFor(testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: B }), A)).toBe(false);
    expect(appsEnabledFor(testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: `${A},not-a-uuid` }), A)).toBe(false);
  });
});

describe('/api/me advertises apps to owners only', () => {
  let owner = '';
  let staff = '';
  beforeEach(async () => {
    await truncateAll();
    const ids = await asOwner(async (sql) => {
      await sql`insert into business (id, name, playbook_key, onboarded) values (${A}, 'Alpha', 'services', true)`;
      await sql`update business set plan = 'team' where id = ${A}`;
      const [o] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('owner@example.com', true) returning id`;
      const [s] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('staff@example.com', true) returning id`;
      await sql`insert into membership (user_id, business_id, role) values (${o.id}, ${A}, 'owner'), (${s.id}, ${A}, 'staff')`;
      return { o: o.id, s: s.id };
    });
    owner = await signIn(ids.o);
    staff = await signIn(ids.s);
  });

  async function features(cookie: string, env = testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: A })) {
    const { request, url } = req('GET', '/api/me', { cookie });
    const res = await handleSession(request, env, url, CORS);
    return ((await res!.json()) as { features?: Record<string, unknown> }).features ?? {};
  }

  it('includes apps for the owner of an allowed business', async () => {
    expect((await features(owner)).apps).toEqual({ apiVersion: 1 });
  });
  it('omits apps for staff, and when the flag is off', async () => {
    expect((await features(staff)).apps).toBeUndefined();
    expect((await features(owner, testEnv({ APPS_ENABLED: 'false', APPS_BUSINESS_IDS: A }))).apps).toBeUndefined();
  });
});
