import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { handleBrowserDesktop } from '../src/routes/browser-desktop';
import { handleBrowser } from '../src/routes/browser';
import { ensureProviderRuntime, LocalRuntimeProvider } from '../src/runtime';
import { asOwner, fetchFake, req, signIn, testEnv, truncateAll } from './harness';
const A = '11111111-1111-4111-8111-111111111111';
const B = '33333333-3333-4333-8333-333333333333';
const CONTROL = '22222222-2222-4222-8222-222222222222';
const env = testEnv({ SPRITES_TOKEN: 'synthetic-provider-key', RUNTIME_RELEASE: '2026.09.17-2', DESKTOP_VIEW_ENABLED: 'true', DESKTOP_VIEW_BUSINESS_IDS: A });
let ownerCookie: string;
let staffCookie: string;
beforeEach(async () => {
  await truncateAll();
  const users = await asOwner(async sql => {
    await sql`insert into business (id,name,playbook_key,onboarded,plan) values (${A},'Alpha','restaurant',true,'team')`;
    const [owner] = await sql<{ id: string }[]>`insert into app_user (email,email_verified) values ('owner@example.com',true) returning id`;
    const [staff] = await sql<{ id: string }[]>`insert into app_user (email,email_verified) values ('staff@example.com',true) returning id`;
    await sql`insert into membership (user_id,business_id,role) values (${owner.id},${A},'owner'),(${staff.id},${A},'staff')`;
    return { owner, staff };
  });
  ownerCookie = await signIn(users.owner.id); staffCookie = await signIn(users.staff.id);
  await ensureProviderRuntime(env, A, { provider: new LocalRuntimeProvider(), runnerKey: 'synthetic-runner-key', hermesApiKey: 'synthetic-model-key' });
  await asOwner(sql => sql`update agent_runtime set provider='fly-sprite', provider_name='alpha-desktop-test', provider_url='https://alpha.sprites.app', status='ready' where business_id=${A}`);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function call({ cookie = ownerCookie, origin = 'http://localhost:5173', path = '/api/browser/desktop',
  protocols = `binary, jentera-control.${CONTROL}`, upgrade = 'websocket', config = env } = {}) {
  const { request, url } = req('GET', path, { cookie });
  if (origin) request.headers.set('Origin', origin);
  if (upgrade) request.headers.set('Upgrade', upgrade);
  request.headers.set('Sec-WebSocket-Protocol', protocols);
  const response = await handleBrowserDesktop(request, config, url);
  if (!response) throw new Error('Missing desktop route');
  return response;
}
it('refuses anonymous, staff and missing/cross-origin handshakes before contacting Sprites', async () => {
  const upstream = fetchFake(async () => new Response('', { status: 503 })); vi.stubGlobal('fetch', upstream);
  expect((await call({ cookie: '' })).status).toBe(401);
  expect((await call({ cookie: staffCookie })).status).toBe(403);
  expect((await call({ origin: '' })).status).toBe(403);
  expect((await call({ origin: 'https://evil.test' })).status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
});
it('requires the pilot flag and exact server-resolved business allowlist, not a client business selector', async () => {
  const upstream = fetchFake(async () => new Response('', { status: 503 })); vi.stubGlobal('fetch', upstream);
  expect((await call({ config: { ...env, DESKTOP_VIEW_ENABLED: 'false' } })).status).toBe(404);
  expect((await call({ config: { ...env, DESKTOP_VIEW_BUSINESS_IDS: B } })).status).toBe(404);
  expect((await call({ path: `/api/browser/desktop?businessId=${A}&host=evil.test` })).status).toBe(400);
  expect((await call({ protocols: `binary, jentera-control.${CONTROL},owner.${B}` })).status).toBe(400);
  expect((await call({ upgrade: '' })).status).toBe(426);
  expect(upstream).not.toHaveBeenCalled();
});
it('uses only the authenticated tenant runtime name and fixed provider proxy; never follows redirects or relays secrets', async () => {
  const timers = vi.spyOn(globalThis, 'setTimeout');
  const cleared = vi.spyOn(globalThis, 'clearTimeout');
  const upstream = fetchFake(async () => new Response('synthetic-provider-key synthetic-runner-key', {
    status: 302, headers: { Location: 'https://evil.test' },
  })); vi.stubGlobal('fetch', upstream);
  const response = await call();
  expect(response.status).toBe(503); expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(await response.text()).toBe('{"err":"Desktop unavailable"}');
  expect(upstream).toHaveBeenCalledTimes(2);
  const [leaseUrl, leaseInit] = upstream.mock.calls[0];
  expect(String(leaseUrl)).toBe('https://alpha.sprites.app/v1/browser');
  expect(leaseInit).toMatchObject({ method: 'POST', redirect: 'manual',
    headers: { 'X-Aisar-Runner-Key': 'synthetic-runner-key', Authorization: 'Bearer synthetic-provider-key' } });
  expect(JSON.parse(String(leaseInit?.body))).toEqual({ action: 'frame', businessId: A,
    ownerId: expect.any(String), controlId: CONTROL });
  const [url, init] = upstream.mock.calls[1];
  expect(url).toBe('https://api.sprites.dev/v1/sprites/alpha-desktop-test/proxy');
  expect(init).toMatchObject({ redirect: 'manual', headers: { Upgrade: 'websocket', Authorization: 'Bearer synthetic-provider-key' } });
  expect(init?.signal?.aborted).toBe(false);
  const timerIndex = timers.mock.calls.findIndex(([, delay]) => delay === 20_000);
  expect(timerIndex).toBeGreaterThanOrEqual(0);
  expect(cleared).toHaveBeenCalledWith(timers.mock.results[timerIndex].value);
  expect(init?.body).toBeUndefined();
});
it('blocks busy runtimes and malformed stored provider names without opening a generic proxy', async () => {
  const upstream = fetchFake(async () => new Response('', { status: 503 })); vi.stubGlobal('fetch', upstream);
  await asOwner(sql => sql`update agent_runtime set status='busy' where business_id=${A}`);
  expect((await call()).status).toBe(503);
  await asOwner(sql => sql`update agent_runtime set status='ready',provider_name='../other-business' where business_id=${A}`);
  expect((await call()).status).toBe(503); expect(upstream).not.toHaveBeenCalled();
});
it('exposes the versioned desktop capability only to allowlisted owners and strips transport metadata', async () => {
  vi.stubGlobal('fetch', fetchFake(async () => new Response('{"desktopView":1,"ticket":"private","url":"private","ownerId":"private"}')));
  const { request, url } = req('GET', '/api/browser', { cookie: ownerCookie });
  expect(await (await handleBrowser(request, env, url, {}))!.json()).toEqual({ desktopView: 1 });
  expect(await (await handleBrowser(request, { ...env, DESKTOP_VIEW_ENABLED: 'false' }, url, {}))!.json()).toEqual({});
});
