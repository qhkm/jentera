import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { browserInputTarget, handleBrowser, previewResponse } from '../src/routes/browser';
import { ensureProviderRuntime, LocalRuntimeProvider } from '../src/runtime';
import { asOwner, asTenant, fetchFake, req, signIn, testEnv, truncateAll } from './harness';
import { startRun } from '../src/runs';
import { enqueueRuntimeTask } from '../src/runtime/tasks';

const A = '11111111-1111-4111-8111-111111111111';
it('drops blocked, stale and malformed preview images without relaying extra fields', () => {
  expect(previewResponse({ previewStatus: 'private', image: 'secret' })).toEqual({ previewStatus: 'private' });
  expect(previewResponse({ previewStatus: 'navigating', image: 'obsolete' })).toEqual({ previewStatus: 'navigating' });
  expect(previewResponse(null)).toEqual({ previewStatus: 'unavailable' });
  for (const image of ['', '<script>', 'a'.repeat(670001)]) {
    expect(previewResponse({ previewStatus: 'ready', image, capturedAt: Date.now() }).previewStatus).toBe('unavailable');
  }
  expect(previewResponse({ previewStatus: 'ready', image: 'YWJj', capturedAt: 1000 }).previewStatus).toBe('unavailable');
  const capturedAt = Date.now();
  expect(previewResponse({ previewStatus: 'ready', image: 'YWJj', capturedAt, tabs: ['private'], secret: 'hidden' }))
    .toEqual({ previewStatus: 'ready', image: 'YWJj', capturedAt });
});
const CONTROL = '22222222-2222-4222-8222-222222222222';
it('sanitizes typing targets without exposing values, labels or selectors', () => {
  const target = { id: CONTROL, kind: 'password', nextSequence: 3 };
  expect(browserInputTarget({ ...target, value: 'private', label: 'email', selector: '#password' })).toEqual(target);
  for (const value of [null, [], {}, { ...target, id: 'invalid' }, { ...target, kind: 'script' }, { ...target, nextSequence: 0 }, { ...target, nextSequence: 1.5 }]) {
    expect(browserInputTarget(value)).toBeNull();
  }
});
const env = testEnv({ SPRITES_TOKEN: 'sprite-secret', RUNTIME_RELEASE: '2026.09.11-3' });
let ownerId: string;
let ownerCookie: string;
let staffCookie: string;
beforeEach(async () => {
  await truncateAll();
  const users = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded) values (${A}, 'Alpha', 'restaurant', true)`;
    /* Staff seats count only on the team plan (migration 038). */
    await sql`update business set plan = 'team'`;
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
  expect(init?.redirect).toBe('manual');
});

it('validates direct input before contacting a runtime and enforces owner/origin checks', async () => {
  const upstream = fetchFake(async () => new Response('{}'));
  vi.stubGlobal('fetch', upstream);
  const body = { action: 'input', controlId: CONTROL, inputId: CONTROL, sequence: 1, text: 'synthetic' };
  expect((await call(staffCookie, body)).status).toBe(403);
  expect((await call(ownerCookie, body, 'https://evil.test')).status).toBe(403);
  for (const changed of [{ inputId: 'invalid' }, { sequence: 0 }, { sequence: 1.5 }, { key: 'Enter' }, { text: '' }, { text: 'x'.repeat(4097) }, { text: undefined, key: 'F12' }]) {
    expect((await call(ownerCookie, { ...body, ...changed })).status).toBe(400);
  }
  expect(upstream).not.toHaveBeenCalled();
});

it('recovery requires an authenticated owner, binds identity server-side and only relays the versioned capability', async () => {
  const upstream = fetchFake(async () => new Response(JSON.stringify({ controlRecovery: 1, paused: true, controlId: 'never-relay' })));
  vi.stubGlobal('fetch', upstream);
  const body = { action: 'reclaim', controlId: CONTROL, ownerId: CONTROL, businessId: CONTROL, force: true };
  expect((await call(undefined, body)).status).toBe(401);
  expect((await call(staffCookie, body)).status).toBe(403);
  expect((await call(ownerCookie, body, 'https://evil.test')).status).toBe(403);
  expect((await call(ownerCookie, { ...body, controlId: 'bad' })).status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
  const response = await call(ownerCookie, body);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ controlRecovery: 1, paused: true });
  expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toEqual({ action: 'reclaim', controlId: CONTROL, ownerId, businessId: A });
  upstream.mockImplementation(async () => new Response('{"controlRecovery":true}'));
  expect(await (await call(ownerCookie)).json()).toEqual({});
});

it('forwards only owner-bound direct input and relays narrow capability/target metadata', async () => {
  const target = { id: CONTROL, kind: 'text', nextSequence: 2 };
  const upstream = fetchFake(async () => new Response(JSON.stringify({ ok: true, directTyping: 1,
    inputTarget: { ...target, value: 'secret', selector: '#login' }, text: 'never-relay' })));
  vi.stubGlobal('fetch', upstream);
  const body = { action: 'input', controlId: CONTROL, inputId: CONTROL, sequence: 1, text: 'synthetic', ownerId: CONTROL, businessId: CONTROL, secret: 'ignored' };
  const response = await call(ownerCookie, body);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, directTyping: 1, inputTarget: target });
  expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toEqual({ action: 'input', controlId: CONTROL,
    ownerId, businessId: A, inputId: CONTROL, sequence: 1, text: 'synthetic' });
  expect(response.headers.get('Cache-Control')).toContain('no-store');
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

it('preview rejects staff, invalid runs and cross-origin requests without fetching screens', async () => {
  const upstream = fetchFake(async () => new Response('{}'));
  vi.stubGlobal('fetch', upstream);
  const body = { action: 'preview', controlId: CONTROL, runId: CONTROL };
  expect((await call(staffCookie, body)).status).toBe(403);
  expect((await call(ownerCookie, body, 'https://evil.test')).status).toBe(403);
  expect((await call(ownerCookie, { ...body, runId: '../private' })).status).toBe(400);
  const missing = await call(ownerCookie, body);
  expect(await missing.json()).toEqual({ previewStatus: 'inactive' });
  expect(missing.headers.get('Cache-Control')).toContain('no-store');
  expect(upstream).not.toHaveBeenCalled();
});

it.each(['preview', 'preview-stream'])('delivers %s through the owner route using the server-resolved task id', async action => {
  const run = await asTenant(A, tx => startRun(tx, A, {
    kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'deepseek-flash',
  }));
  const task = await asTenant(A, tx => enqueueRuntimeTask(tx, A, {
    kind: 'run', runId: run.id, dedupeKey: `preview:${run.id}`, payload: { input: 'Browse example.com' },
  }));
  const capturedAt = Date.now();
  const upstream = fetchFake(async () => new Response(JSON.stringify({
    previewStatus: 'ready', image: 'YWJj', capturedAt, tabs: ['private'],
  }) + (action === 'preview-stream' ? '\n' : ''), { headers: { 'Content-Type': action === 'preview-stream' ? 'application/x-ndjson' : 'application/json' } }));
  vi.stubGlobal('fetch', upstream);
  const response = await call(ownerCookie, { action, runId: run.id, controlId: CONTROL, taskId: CONTROL });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ previewStatus: 'ready', image: 'YWJj', capturedAt });
  const command = JSON.parse(String(upstream.mock.calls[0][1]?.body));
  expect(command.taskId).toBe(task.id);
  expect(upstream.mock.calls[0][1]?.redirect).toBe('manual');
  expect(command.businessId).toBe(A);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
});

it('rejects upstream redirects without following them or exposing their destination', async () => {
  const upstream = fetchFake(async () => new Response(null, { status: 302, headers: { Location: 'https://untrusted.test/private' } }));
  vi.stubGlobal('fetch', upstream);
  const response = await call(ownerCookie, { action: 'claim', controlId: CONTROL });
  expect(response.status).toBe(503);
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(upstream.mock.calls[0][1]?.redirect).toBe('manual');
  expect(await response.text()).not.toContain('untrusted');
});

it('waits for a queued run before its runtime task exists', async () => {
  const run = await asTenant(A, tx => startRun(tx, A, { kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'test' }));
  const upstream = fetchFake(async () => new Response('{}'));
  vi.stubGlobal('fetch', upstream);
  const response = await call(ownerCookie, { action: 'preview-stream', runId: run.id, controlId: CONTROL });
  expect(await response.json()).toEqual({ previewStatus: 'loading' });
  expect(upstream).not.toHaveBeenCalled();
});

it.each(['preview', 'preview-stream'])('%s retries a not-yet-admitted task and stops only after DB completion', async action => {
  const run = await asTenant(A, tx => startRun(tx, A, { kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'test' }));
  const task = await asTenant(A, tx => enqueueRuntimeTask(tx, A, { kind: 'run', runId: run.id, dedupeKey: `race:${run.id}`, payload: { input: 'Browse' } }));
  const upstream = fetchFake(async () => new Response('{"previewStatus":"inactive"}\n', { headers: { 'Content-Type': action === 'preview-stream' ? 'application/x-ndjson' : 'application/json' } }));
  vi.stubGlobal('fetch', upstream);
  const body = { action, runId: run.id, controlId: CONTROL };
  expect(await (await call(ownerCookie, body)).json()).toEqual({ previewStatus: 'loading' });
  await asTenant(A, tx => tx`update runtime_task set status = 'completed' where id = ${task.id}`);
  expect(await (await call(ownerCookie, body)).json()).toEqual({ previewStatus: 'inactive' });
  expect(upstream).toHaveBeenCalledTimes(1);
});

it('admits restart as an owner command and refuses it from staff', async () => {
  const upstream = fetchFake(async () => new Response(JSON.stringify({ paused: true, controlled: true })));
  vi.stubGlobal('fetch', upstream);
  /* The recovery for a browser that has stopped responding. It reaches the
     runtime like any other command; what it must not do is become a way for
     a colleague to pull the browser out from under the owner. */
  expect((await call(ownerCookie, { action: 'restart', controlId: CONTROL })).status).toBe(200);
  expect((await call(staffCookie, { action: 'restart', controlId: CONTROL })).status).toBe(403);
  const sent = JSON.parse(String(upstream.mock.calls[0][1]?.body));
  expect(sent.action).toBe('restart');
});
