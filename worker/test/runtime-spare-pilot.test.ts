import { beforeEach, expect, it, vi } from 'vitest';
import { asOwner, testEnv, truncateAll } from './harness';
import { ACCESS_OWNER } from '../src/access';
import { handleSparePilot } from '../scripts/runtime-spare-pilot';
import { prepareRuntimeSpare } from '../src/runtime/spare-worker';
import { handleRuntimeQueueMessage } from '../src/runtime/consumer';

// The wrapper re-exports the deployment's DO binding, which uses Cloudflare's
// runtime-only module. These tests exercise pilot guards, not event streaming.
vi.mock('../src/run-stream', () => ({ RunStream: class {} }));

vi.mock('../src/runtime/spare-worker', () => ({
  prepareRuntimeSpare: vi.fn(async () => ({ action: 'ack', reason: 'completed' })),
}));
vi.mock('../src/runtime/consumer', () => ({
  handleRuntimeQueueMessage: vi.fn(async () => ({ action: 'ack', reason: 'missing' })),
}));
const ownerId = '11111111-1111-4111-8111-111111111111';
const mainId = '44444444-4444-4444-8444-444444444444';
const pilotId = 'f2222222-2222-4222-8222-222222222222';
const send = vi.fn(async (_message: unknown) => {});
const env = { ...testEnv(), AISAR_SUPPORT_KEY: 'private-operator-key',
  SPARE_PILOT_MODE: 'operator-only', SPARE_PILOT_OWNER_USER_ID: ownerId, SPARE_PILOT_BUSINESS_ID: pilotId,
  RUNTIME_SPARE_POOL_ENABLED: 'false', RUNTIME_SPARE_POOL_TARGET: '2',
  RUNTIME_PROVISIONING_ENABLED: 'true', RUNTIME_BOOTSTRAP_ENABLED: 'true', MODEL_TRANSPORT_READY: 'true',
  RUNTIME_RELEASE: '2026.09.17-3', RUNTIME_BUNDLE_COMMIT: 'a'.repeat(40), SPRITES_TOKEN: 'private-sprites-key',
  RUNTIME_QUEUE: { send } as unknown as Queue,
};
function request(path: string, confirm?: string, extra: Record<string, unknown> = {}) {
  return new Request(`https://private-preview.invalid${path}`, {
    method: confirm ? 'POST' : 'GET', headers: { Authorization: 'Bearer private-operator-key', 'Content-Type': 'application/json' },
    ...(confirm ? { body: JSON.stringify({ confirm, ...extra }) } : {}),
  });
}
beforeEach(async () => {
  await truncateAll(); vi.clearAllMocks();
  await asOwner(async sql => {
    await sql`insert into app_user(id,email,email_verified) values(${ownerId},${ACCESS_OWNER},true)`;
    await sql`insert into business(id,name,playbook_key) values(${mainId},'Existing founder workspace','generic')`;
    await sql`insert into membership(user_id,business_id,role) values(${ownerId},${mainId},'owner')`;
  });
});

it('requires dedicated operator authentication before any preparation or tenant creation', async () => {
  expect((await handleSparePilot(new Request('https://private-preview.invalid/status'), env)).status).toBe(401);
  expect(prepareRuntimeSpare).not.toHaveBeenCalled();
  await asOwner(async sql => { expect((await sql`select id from business`)).toHaveLength(1); });
});

it('fails closed on missing pilot configuration or an unverified founder account', async () => {
  expect((await handleSparePilot(request('/prepare', 'prepare-one-clean-spare'), { ...env, SPARE_PILOT_MODE: undefined })).status).toBe(409);
  await asOwner(sql => sql`update app_user set email_verified=false where id=${ownerId}`);
  expect((await handleSparePilot(request('/prepare', 'prepare-one-clean-spare'), env)).status).toBe(409);
  expect(prepareRuntimeSpare).not.toHaveBeenCalled();
});

it('refuses to make the private pilot the founder default business', async () => {
  await asOwner(async sql => {
    await sql`delete from membership where user_id=${ownerId}`;
    await sql`insert into business(id,name,playbook_key) values('ffffffff-ffff-4fff-8fff-ffffffffffff','Current founder workspace','generic')`;
    await sql`insert into membership(user_id,business_id,role) values(${ownerId},'ffffffff-ffff-4fff-8fff-ffffffffffff','owner')`;
  });
  expect((await handleSparePilot(request('/prepare', 'prepare-one-clean-spare'), env)).status).toBe(409);
  expect(prepareRuntimeSpare).not.toHaveBeenCalled();
});

it('accepts no business, URL, credentials or other overrides in the request body', async () => {
  const response = await handleSparePilot(request('/activate', 'activate-private-pilot', { businessId: mainId }), env);
  expect(response.status).toBe(400);
  expect(handleRuntimeQueueMessage).not.toHaveBeenCalled();
  await asOwner(async sql => { expect((await sql`select id from business where id=${pilotId}`)).toHaveLength(0); });
});

it('prepares exactly one through the real restricted inventory functions without publishing to production queue', async () => {
  const response = await handleSparePilot(request('/prepare', 'prepare-one-clean-spare'), env);
  expect(response.status).toBe(200);
  expect(prepareRuntimeSpare).toHaveBeenCalledOnce();
  expect(vi.mocked(prepareRuntimeSpare).mock.calls[0][0]).toMatchObject({ RUNTIME_SPARE_POOL_ENABLED: 'true', RUNTIME_SPARE_POOL_TARGET: '1', SELF: undefined });
  expect(send).not.toHaveBeenCalled();
  expect(env.RUNTIME_SPARE_POOL_ENABLED).toBe('false');
  await asOwner(async sql => { expect((await sql`select * from runtime_spare`)).toHaveLength(1); });
});

it('creates only the private founder-owned workspace and does not claim readiness from a failed activation', async () => {
  const response = await handleSparePilot(request('/activate', 'activate-private-pilot'), env);
  expect(response.status).toBe(409);
  expect(handleRuntimeQueueMessage).toHaveBeenCalledOnce();
  await asOwner(async sql => {
    expect((await sql`select name,plan from business where id=${mainId}`)).toMatchObject([{ name: 'Existing founder workspace', plan: 'free' }]);
    expect((await sql`select name,plan from business where id=${pilotId}`)).toMatchObject([{ name: 'Sprite pool pilot (operator-only)', plan: 'free' }]);
    expect((await sql`select user_id,role from membership where business_id=${pilotId}`)).toMatchObject([{ user_id: ownerId, role: 'owner' }]);
  });
});

it('refuses a colliding existing workspace and rolls back without adding an owner', async () => {
  await asOwner(sql => sql`insert into business(id,name,playbook_key) values(${pilotId},'Customer workspace','generic')`);
  expect((await handleSparePilot(request('/activate', 'activate-private-pilot'), env)).status).toBe(409);
  expect(handleRuntimeQueueMessage).not.toHaveBeenCalled();
  await asOwner(async sql => { expect((await sql`select * from membership where business_id=${pilotId}`)).toHaveLength(0); });
});

it('status exposes only required-secret presence and safe metadata, never secret values', async () => {
  const response = await handleSparePilot(request('/status'), env);
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain('productionPoolFlag');
  expect(body).not.toContain('private-operator-key');
  expect(body).not.toContain('private-sprites-key');
});
