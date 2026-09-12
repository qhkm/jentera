import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { handleAgentMemory } from '../src/routes/agent-memory';
import { LocalRuntimeProvider } from '../src/runtime';
import { ensureProviderRuntime } from '../src/runtime/provision';
import { asOwner, fetchFake, jsonOf, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const cors = { 'Access-Control-Allow-Origin': 'https://jentera.ai' };
let env: Env;
let ownerCookie: string;
let staffCookie: string;

beforeEach(async () => {
  await truncateAll();
  env = testEnv({ SPRITES_TOKEN: 'sprites-edge-token', RUNTIME_RELEASE: '2026.09.12-2' });
  const users = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded, plan) values (${A}, 'Alpha', 'restaurant', true, 'team')`;
    const [owner] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('owner@example.com', true) returning id`;
    const [staff] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('staff@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${owner.id}, ${A}, 'owner'), (${staff.id}, ${A}, 'staff')`;
    return { owner, staff };
  });
  ownerCookie = await signIn(users.owner.id);
  staffCookie = await signIn(users.staff.id);
  await ensureProviderRuntime(env, A, { provider: new LocalRuntimeProvider(), runnerKey: 'runner-secret-runner-secret-1234', hermesApiKey: 'hermes-secret' });
  await asOwner((sql) => sql`update agent_runtime set provider = 'fly-sprite', provider_url = 'https://alpha.sprites.app', status = 'ready' where business_id = ${A}`);
});
afterEach(() => vi.unstubAllGlobals());

async function call(method: 'GET' | 'POST', path: string, cookie?: string, body?: unknown) {
  const incoming = req(method, path, { cookie, body });
  incoming.request.headers.set('Origin', 'https://jentera.ai');
  const response = await handleAgentMemory(incoming.request, env, incoming.url, cors);
  if (!response) throw new Error('route missing');
  return response;
}

const UPSTREAM = { ok: true, profiles: [
  { profile: 'default', files: [
    { file: 'MEMORY.md', entries: [{ index: 0, text: 'pdftotext absent' }] },
    { file: 'USER.md', entries: [{ index: 0, text: 'prefers English' }, { index: 1, text: 'favourite colour: teal' }] },
  ] },
  { profile: 'growth', files: [{ file: 'MEMORY.md', entries: [{ index: 0, text: 'cron has no platform' }] }] },
  { profile: '../evil', files: [{ file: 'SOUL.md', entries: [{ index: 0, text: 'never' }] }] },
] };

it('shows the owner what the agent remembers, by profile, and relays nothing it does not recognise', async () => {
  const upstream = fetchFake(async () => new Response(JSON.stringify(UPSTREAM)));
  vi.stubGlobal('fetch', upstream);
  const response = await call('GET', '/api/agent/memory', ownerCookie);
  expect(response.status).toBe(200);
  const body = await jsonOf<{ available: boolean; profiles: { profile: string; files: { file: string; entries: { text: string }[] }[] }[] }>(response);
  expect(body.available).toBe(true);
  expect(body.profiles.map((p) => p.profile)).toEqual(['default', 'growth']);
  expect(body.profiles[0].files[1].entries.map((e) => e.text)).toEqual(['prefers English', 'favourite colour: teal']);
  expect(String(upstream.mock.calls[0][0])).toBe('https://alpha.sprites.app/v1/memory');
  const init = upstream.mock.calls[0][1] as RequestInit;
  expect((init.headers as Record<string, string>)['X-Aisar-Runner-Key']).toBe('runner-secret-runner-secret-1234');
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sprites-edge-token');
});

it('is the owner\'s alone', async () => {
  vi.stubGlobal('fetch', fetchFake(async () => new Response(JSON.stringify(UPSTREAM))));
  expect((await call('GET', '/api/agent/memory', staffCookie)).status).toBe(403);
  expect((await call('GET', '/api/agent/memory')).status).toBe(401);
});

it('reads as not available on a runtime that is not ready or predates the endpoint', async () => {
  vi.stubGlobal('fetch', fetchFake(async () => new Response('{"error":"not_found"}', { status: 404 })));
  expect(await jsonOf(await call('GET', '/api/agent/memory', ownerCookie))).toMatchObject({ ok: true, available: false, profiles: [] });
  await asOwner((sql) => sql`update agent_runtime set status = 'provisioning' where business_id = ${A}`);
  expect(await jsonOf(await call('GET', '/api/agent/memory', ownerCookie))).toMatchObject({ ok: true, available: false });
});

it('forgets one entry through the runner, and passes on busy and gone', async () => {
  const upstream = fetchFake(async () => new Response('{"ok":true}'));
  vi.stubGlobal('fetch', upstream);
  const entry = { profile: 'default', file: 'USER.md', text: 'favourite colour: teal' };
  expect((await call('POST', '/api/agent/memory/forget', ownerCookie, entry)).status).toBe(200);
  expect(String(upstream.mock.calls[0][0])).toBe('https://alpha.sprites.app/v1/memory/forget');
  expect(JSON.parse(String((upstream.mock.calls[0][1] as RequestInit).body))).toEqual(entry);
  expect((await call('POST', '/api/agent/memory/forget', ownerCookie, { ...entry, file: 'SOUL.md' })).status).toBe(400);
  vi.stubGlobal('fetch', fetchFake(async () => new Response('{"error":"runtime_busy"}', { status: 409 })));
  expect((await call('POST', '/api/agent/memory/forget', ownerCookie, entry)).status).toBe(409);
  vi.stubGlobal('fetch', fetchFake(async () => new Response('{"error":"not_found"}', { status: 404 })));
  expect((await call('POST', '/api/agent/memory/forget', ownerCookie, entry)).status).toBe(404);
});
