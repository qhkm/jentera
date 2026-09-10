import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { handleBrowser } from '../src/routes/browser';
import { ensureProviderRuntime, LocalRuntimeProvider } from '../src/runtime';
import { asOwner, fetchFake, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const CONTROL = '22222222-2222-4222-8222-222222222222';
const env = testEnv({ SPRITES_TOKEN: 'sprite-secret', RUNTIME_RELEASE: '2026.09.11-3' });
let ownerId: string;
let ownerCookie: string;
let staffCookie: string;
beforeEach(async () => {
  await truncateAll();
  const users = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded) values (${A}, 'Alpha', 'restaurant', true)`;
    const [owner] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('owner@example.com', true) returning id`;
    const [staff] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('staff@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${owner.id}, ${A}, 'owner'), (${staff.id}, ${A}, 'staff')`;
    return { owner, staff };
  });
  ownerId = users.owner.id;
  ownerCookie = await signIn(ownerId);
  staffCookie = await signIn(users.staff.id);
  await ensureProviderRuntime(env, A, { provider: new LocalRuntimeProvider(), runnerKey: 'runner-secret', hermesApiKey: 'hermes-secret' });
  await asOwner((sql) => sql`update agent_runtime set provider = 'fly-sprite', provider_url = 'https://alpha.sprites.app', status = 'ready' where business_id = ${A}`);
});
afterEach(() => vi.unstubAllGlobals());

async function call(cookie?: string, body?: unknown, origin = 'http://localhost:5173') {
  const { request, url } = req(body ? 'POST' : 'GET', '/api/browser', { cookie, body });
  request.headers.set('Origin', origin);
  const response = await handleBrowser(request, env, url, {});
  if (!response) throw new Error('route missing');
  return response;
}

it('requires authenticated owners and same-origin JSON commands before contacting a runtime', async () => {
  const upstream = fetchFake(async () => new Response('{}'));
  vi.stubGlobal('fetch', upstream);
  expect((await call()).status).toBe(401);
  expect((await call(staffCookie)).status).toBe(403);
  expect((await call(ownerCookie, { action: 'claim', controlId: CONTROL }, 'https://evil.test')).status).toBe(403);
  expect((await call(ownerCookie, { action: 'evaluate', controlId: CONTROL })).status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
});

it('binds the target and controller to the signed-in business, never customer input', async () => {
  const upstream = fetchFake(async () => new Response(JSON.stringify({ paused: true, secret: 'never-return' })));
  vi.stubGlobal('fetch', upstream);
  const response = await call(ownerCookie, { action: 'claim', controlId: CONTROL, ownerId: CONTROL, businessId: CONTROL, origin: 'https://evil.test' });
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(await response.json()).toEqual({ paused: true });
  const [target, init] = upstream.mock.calls[0];
  expect(String(target)).toBe('https://alpha.sprites.app/v1/browser');
  expect(JSON.parse(String(init?.body))).toEqual({ action: 'claim', controlId: CONTROL, ownerId, businessId: A });
  expect(init?.headers).toMatchObject({ 'X-Aisar-Runner-Key': 'runner-secret', Authorization: 'Bearer sprite-secret' });
  expect(init?.redirect).toBe('error');
});

it('redacts arbitrary upstream errors and preserves safe conflict messages', async () => {
  const upstream = fetchFake(async () => new Response(JSON.stringify({ error: 'password-secret' }), { status: 500 }));
  vi.stubGlobal('fetch', upstream);
  const failed = await call(ownerCookie);
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('password-secret');
  upstream.mockImplementation(async () => new Response(JSON.stringify({ error: 'runtime_busy' }), { status: 409 }));
  expect((await call(ownerCookie)).status).toBe(409);
});
