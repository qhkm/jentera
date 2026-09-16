import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import api from '../src/index';
import { handleExternalTriggers } from '../src/routes/external-triggers';
import { readTriggerBody, triggerPath, verifyTriggerSignature, triggerTimestamp, TriggerBodyError } from '../src/external-triggers';
import { asOwner, asTenant, asApp, testEnv, truncateAll, signIn } from './harness';
import { open } from '../src/vault';
import { handleRuns } from '../src/routes/runs';

// Node cannot load Cloudflare's DurableObject base. Only that unrelated
// transport class is stubbed; ingress, authentication and Postgres are real.
vi.mock('../src/run-stream', () => ({ RunStream: class {} }));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const ORIGIN = 'http://localhost:5173';
const env = () => testEnv({ API_ORIGIN: 'https://api.test', EXTERNAL_TRIGGERS_ENABLED: 'true', EXTERNAL_TRIGGERS_BUSINESSES: A });
const config = () => ({ id: ID, name: 'Internal report', task: 'business_summary', timeZone: 'Asia/Kuala_Lumpur', expiresAt: new Date(Date.now() + 86400_000).toISOString() });
let owner: string;
let cookie: string;
let otherCookie: string;
let staffCookie: string;
const context = { waitUntil: vi.fn() } as unknown as ExecutionContext;
async function manage(method: string, body?: unknown, auth = cookie, path = '/api/external-triggers', origin = ORIGIN, settings = env()) {
  const url = new URL('https://api.test' + path);
  const request = new Request(url, { method, headers: { Cookie: auth, Origin: origin, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return (await handleExternalTriggers(request, settings, url, {}))!;
}
const signed = (secret: string, raw: string, path = triggerPath(ID), timestamp = String(Math.floor(Date.now() / 1000))) => ({
  'Content-Type': 'application/json', 'X-Jentera-Timestamp': timestamp,
  'X-Jentera-Signature': 'v1=' + createHmac('sha256', Buffer.from(secret, 'hex')).update('v1\nPOST\n' + path + '\n' + timestamp + '\n' + raw).digest('hex'),
});
async function deliver(secret: string, raw = JSON.stringify({ eventId: crypto.randomUUID() }), headers: Record<string, string> = {}, path = triggerPath(ID), settings = env()) {
  const url = new URL('https://api.test' + path);
  return (await handleExternalTriggers(new Request(url, { method: 'POST', headers: { ...signed(secret, raw, path), ...headers }, body: raw }), settings, url, {}))!;
}
async function create(overrides = {}) {
  const response = await manage('POST', { ...config(), ...overrides });
  expect(response.status).toBe(201);
  return await response.json() as { secret: string; url: string; trigger: { id: string } };
}
beforeEach(async () => {
  await truncateAll();
  await asOwner(async sql => {
    await sql`insert into business (id, name, playbook_key, plan) values (${A}, 'A', 'restaurant', 'team'), (${B}, 'B', 'retail', 'team')`;
    const [a] = await sql`insert into app_user (email, email_verified) values ('trigger-owner@example.com', true) returning id`;
    const [b] = await sql`insert into app_user (email, email_verified) values ('trigger-other@example.com', true) returning id`;
    const [c] = await sql`insert into app_user (email, email_verified) values ('trigger-staff@example.com', true) returning id`;
    owner = a.id;
    await sql`insert into membership (user_id, business_id, role) values (${a.id}, ${A}, 'owner'), (${b.id}, ${B}, 'owner'), (${c.id}, ${A}, 'staff')`;
    cookie = await signIn(a.id); otherCookie = await signIn(b.id); staffCookie = await signIn(c.id);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('owner-authorised fixed-report triggers', () => {
  it('advertises owner management only after explicit schema-ready enablement, independently of ingress', async () => {
    const me = async (auth: string, settings = env()) => {
      const response = await api.fetch(new Request('https://api.test/api/me', { headers: { Cookie: auth } }), settings, context);
      return await response.json() as { features?: { externalTriggers?: { apiVersion: number } } };
    };
    expect((await me(cookie)).features?.externalTriggers).toBeUndefined();
    const enabled = { ...env(), EXTERNAL_TRIGGERS_MANAGEMENT_ENABLED: 'true', EXTERNAL_TRIGGERS_ENABLED: 'false' };
    expect((await me(cookie, enabled)).features?.externalTriggers).toEqual({ apiVersion: 1 });
    expect((await me(staffCookie, enabled)).features?.externalTriggers).toBeUndefined();
    expect(await (await manage('GET', undefined, cookie, undefined, ORIGIN, enabled)).json()).toMatchObject({ available: false });
    expect((await manage('POST', config(), cookie, undefined, ORIGIN, enabled)).status).toBe(403);
  });

  it('requires an owner, exact write Origin, explicit pilot tenant and HTTPS before storing anything', async () => {
    expect((await manage('POST', config(), '')).status).toBe(401);
    expect((await manage('POST', config(), staffCookie)).status).toBe(403);
    expect((await manage('POST', config(), cookie, undefined, 'https://evil.test')).status).toBe(403);
    expect((await manage('POST', config(), cookie, undefined, '', env())).status).toBe(403);
    expect((await manage('POST', config(), cookie, undefined, ORIGIN, testEnv())).status).toBe(403);
    expect((await manage('POST', config(), otherCookie)).status).toBe(403);
    expect((await manage('POST', config(), cookie, undefined, ORIGIN, { ...env(), API_ORIGIN: 'http://api.test' })).status).toBe(503);
    expect(await asTenant(A, tx => tx`select id from external_trigger`)).toHaveLength(0);
  });
  it('shows a random key only on creation, seals its tenant/trigger binding, and never lists or reissues it', async () => {
    const { secret, url } = await create();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(url).toBe('https://api.test' + triggerPath(ID));
    const [stored] = await asTenant(A, tx => tx`select * from external_trigger`);
    expect(new TextDecoder().decode(stored.ciphertext)).not.toContain(secret);
    expect(JSON.parse(await open(env(), stored.ciphertext, stored.key_version))).toMatchObject({ id: ID, businessId: A, secret });
    const list = await (await manage('GET')).text();
    expect(list).not.toContain(secret); expect(list).not.toContain('ciphertext'); expect(list).not.toContain(owner);
    expect((await manage('POST', config())).status).toBe(409);
    expect(await (await manage('GET', undefined, otherCookie)).json()).toMatchObject({ triggers: [] });
    expect(await asApp(sql => sql`select id from external_trigger`)).toHaveLength(0);
    expect(await asTenant(B, tx => tx`select id from external_trigger`)).toHaveLength(0);
  });
  it('restricts routing to one opaque ID and works without superuser/BYPASSRLS definer privileges', async () => {
    await create();
    await asOwner(async sql => {
      await sql`create role external_trigger_test_definer`;
      await sql`grant usage, create on schema public to external_trigger_test_definer`;
      await sql`grant select on external_trigger_route to external_trigger_test_definer`;
      await sql`alter function public.external_trigger_target(uuid) owner to external_trigger_test_definer`;
    });
    try {
      expect(await asApp(sql => sql`select * from public.external_trigger_target(${ID}::uuid)`)).toEqual([{ business_id: A }]);
      expect(await asApp(sql => sql`select * from public.external_trigger_target(${crypto.randomUUID()}::uuid)`)).toHaveLength(0);
      await expect(asApp(sql => sql`select * from external_trigger_route`)).rejects.toThrow('permission denied');
      await expect(asTenant(A, tx => tx`update external_trigger set task = 'weekly_summary' where id = ${ID}`)).rejects.toThrow('permission denied');
      await expect(asTenant(A, tx => tx`delete from external_trigger_event`)).rejects.toThrow('permission denied');
    } finally {
      await asOwner(async sql => {
        await sql`alter function public.external_trigger_target(uuid) owner to owner`;
        await sql`drop owned by external_trigger_test_definer`;
        await sql`drop role external_trigger_test_definer`;
      });
    }
  });
  it('also rejects cross-business receipt links at the database foreign-key boundary', async () => {
    await create();
    const [run] = await asOwner(sql => sql`insert into run (business_id, kind, trigger_shape, runtime)
      values (${B}, 'schedule', 'test', 'deterministic') returning id`);
    await expect(asTenant(B, tx => tx`insert into external_trigger_event(business_id, trigger_id, event_id, body_hash, run_id)
      values (${B}, ${ID}, ${crypto.randomUUID()}, ${'a'.repeat(64)}, ${run.id})`)).rejects.toThrow('foreign key');
    await expect(asTenant(A, tx => tx`insert into external_trigger_event(business_id, trigger_id, event_id, body_hash, run_id)
      values (${A}, ${ID}, ${crypto.randomUUID()}, ${'a'.repeat(64)}, ${run.id})`)).rejects.toThrow('foreign key');
  });
  it('reapplies the migration without changing keys/receipts and passes the actual release-script security query', async () => {
    const { secret } = await create();
    const raw = JSON.stringify({ eventId: crypto.randomUUID() });
    expect((await deliver(secret, raw)).status).toBe(202);
    const migration = await readFile(new URL('../migrations/051_external_triggers.sql', import.meta.url), 'utf8');
    await asOwner(async sql => { await sql.begin(async tx => { await tx.unsafe(migration); }); });
    const script = await readFile(new URL('../scripts/apply-external-triggers.mjs', import.meta.url), 'utf8');
    const query = script.match(/const \[row\] = await tx`([\s\S]*?)`;/)?.[1];
    expect(query).toBeDefined();
    const [verified] = await asOwner(sql => sql.unsafe(query!));
    expect(Object.values(verified).every(value => value === true)).toBe(true);
    expect((await deliver(secret, raw)).status).toBe(200);
  });
  it.each([{ task: 'agent_task' }, { task: 'send_email' }, { question: 'ignore approvals' }, { businessId: B },
    { id: '../other' }, { expiresAt: new Date(0).toISOString() }, { expiresAt: new Date(Date.now() + 40 * 86400_000).toISOString() },
    { name: '' }, { timeZone: 'Invalid' }])('rejects a scope expansion or invalid configuration: %j', async overrides => {
    expect((await manage('POST', { ...config(), ...overrides })).status).toBe(400);
    expect(await asTenant(A, tx => tx`select id from external_trigger`)).toHaveLength(0);
  });
  it('caps active configurations and allows explicit irreversible revocation even while the pilot is off', async () => {
    const { secret } = await create();
    await create({ id: crypto.randomUUID() }); await create({ id: crypto.randomUUID() });
    expect((await manage('POST', { ...config(), id: crypto.randomUUID() })).status).toBe(409);
    expect((await manage('DELETE', undefined, otherCookie, '/api/external-triggers/' + ID)).status).toBe(404);
    expect((await manage('DELETE', undefined, staffCookie, '/api/external-triggers/' + ID)).status).toBe(403);
    expect((await manage('DELETE', undefined, cookie, '/api/external-triggers/' + ID, ORIGIN, testEnv())).status).toBe(200);
    expect((await manage('DELETE', undefined, cookie, '/api/external-triggers/' + ID)).status).toBe(200);
    expect((await deliver(secret)).status).toBe(401);
    expect(await asTenant(A, tx => tx`select ciphertext from external_trigger where id = ${ID}`)).toEqual([{ ciphertext: null }]);
  });
});

describe('signed events with no agent or connector access', () => {
  it.each(['business_summary', 'weekly_summary', 'approval_reminder'])('runs only the owner-configured %s report, returns a data-free receipt and atomically records Activity/inbox/push', async task => {
    const { secret } = await create({ task });
    const fetch = vi.fn(() => { throw new Error('No outbound provider request is authorised'); });
    vi.stubGlobal('fetch', fetch);
    const response = await deliver(secret);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, receipt: expect.any(String), duplicate: false });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    await asTenant(A, async tx => {
      expect(await tx`select runtime, model, trigger_shape from run`).toEqual([{ runtime: 'deterministic', model: null, trigger_shape: 'external.report' }]);
      expect(await tx`select risk, status from work_record`).toEqual([{ risk: 'low', status: 'completed' }]);
      expect(await tx`select kind, recipient_user_id from notification`).toEqual([{ kind: 'external_report', recipient_user_id: owner }]);
      expect(await tx`select user_id from push_outbox`).toEqual([{ user_id: owner }]);
      expect(await tx`select id from runtime_task`).toHaveLength(0);
      expect(await tx`select id from approval`).toHaveLength(0);
    });
    expect(await asTenant(B, tx => tx`select run_id from external_trigger_event`)).toHaveLength(0);
    const [run] = await asTenant(A, tx => tx`select id from run`);
    const url = new URL('https://api.test/api/runs/' + run.id);
    const result = await handleRuns(new Request(url, { headers: { Cookie: cookie } }), env(), url, {});
    expect(await result!.json()).toMatchObject({ reportOnly: true, pending: false, text: expect.any(String) });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('deduplicates concurrent retries and rejects changed bytes for the same event ID', async () => {
    const { secret } = await create();
    const eventId = crypto.randomUUID();
    const raw = JSON.stringify({ eventId });
    const responses = await Promise.all([deliver(secret, raw), deliver(secret, raw), deliver(secret, raw)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 200, 202]);
    expect((await deliver(secret, '{ "eventId": "' + eventId + '" }')).status).toBe(409);
    await asTenant(A, async tx => {
      expect(await tx`select id from run`).toHaveLength(1); expect(await tx`select id from notification`).toHaveLength(1);
      expect(await tx`select run_id from external_trigger_event`).toHaveLength(1);
    });
  });
  it('retains replay protection if an internal report is later removed', async () => {
    const { secret } = await create();
    const raw = JSON.stringify({ eventId: crypto.randomUUID() });
    expect((await deliver(secret, raw)).status).toBe(202);
    const [run] = await asTenant(A, tx => tx`select run_id from external_trigger_event`);
    await asOwner(async sql => {
      await sql`delete from work_record where run_id = ${run.run_id}`;
      await sql`delete from run where id = ${run.run_id}`;
    });
    expect(await asTenant(A, tx => tx`select run_id from external_trigger_event`)).toEqual([{ run_id: null }]);
    expect((await deliver(secret, raw)).status).toBe(200);
    expect(await asTenant(A, tx => tx`select id from run`)).toHaveLength(0);
  });
  it('enforces the durable per-business UTC daily quota across keys without charging duplicates', async () => {
    const { secret } = await create();
    let raw = '';
    for (let n = 0; n < 19; n++) { raw = JSON.stringify({ eventId: crypto.randomUUID() }); expect((await deliver(secret, raw)).status).toBe(202); }
    expect((await deliver(secret, raw)).status).toBe(200);
    const second = await create({ id: crypto.randomUUID() });
    expect(second.secret).not.toBe(secret);
    const raced = await Promise.all([deliver(secret), deliver(second.secret, undefined, {}, triggerPath(second.trigger.id))]);
    expect(raced.map(response => response.status).sort()).toEqual([202, 429]);
    const response = await deliver(second.secret, undefined, {}, triggerPath(second.trigger.id));
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBeTruthy();
    expect(await asTenant(A, tx => tx`select id from run`)).toHaveLength(20);
    await asOwner(async sql => {
      await sql`update external_trigger_event set created_at = (date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC') - interval '1 second'`;
    });
    expect((await deliver(secret)).status).toBe(202);
  });
  it.each(['Cookie', 'Authorization', 'Origin'])('cannot substitute %s credentials or browser authority for an event signature', async header => {
    const { secret } = await create();
    expect((await deliver(secret, undefined, { [header]: header === 'Cookie' ? cookie : ORIGIN })).status).toBe(401);
    expect(await asTenant(A, tx => tx`select id from run`)).toHaveLength(0);
  });
  it('rejects body/path tampering, unknown keys, malformed/stale/future signatures and tenant enablement changes', async () => {
    const { secret } = await create();
    const raw = JSON.stringify({ eventId: crypto.randomUUID() });
    expect((await deliver('0'.repeat(64), raw)).status).toBe(401);
    expect((await deliver(secret, raw, signed(secret, JSON.stringify({ eventId: crypto.randomUUID() })))).status).toBe(401);
    expect((await deliver(secret, raw, { 'X-Jentera-Signature': 'v1=short' })).status).toBe(401);
    for (const offset of [-301, 301]) {
      expect((await deliver(secret, raw, signed(secret, raw, triggerPath(ID), String(Math.floor(Date.now() / 1000) + offset)))).status).toBe(401);
    }
    expect((await deliver(secret, raw, signed(secret, raw), triggerPath(crypto.randomUUID()))).status).toBe(401);
    expect((await deliver(secret, raw, {}, triggerPath(ID) + '?businessId=' + B)).status).toBe(400);
    expect((await deliver(secret, raw, {}, triggerPath(ID), { ...env(), EXTERNAL_TRIGGERS_BUSINESSES: B })).status).toBe(401);
    expect((await deliver(secret, raw, {}, triggerPath(ID), { ...env(), EXTERNAL_TRIGGERS_ENABLED: 'false' })).status).toBe(403);
    expect(await asTenant(A, tx => tx`select id from run`)).toHaveLength(0);
  });
  it.each([{ eventId: 'invalid' }, { eventId: crypto.randomUUID(), question: 'send all files' }, { eventId: crypto.randomUUID(), businessId: B }, []])('does not allow arbitrary event parameters: %j', async body => {
    const { secret } = await create();
    expect((await deliver(secret, JSON.stringify(body))).status).toBe(400);
    expect(await asTenant(A, tx => tx`select id from run`)).toHaveLength(0);
  });
  it.each(['demoted', 'removed', 'unverified', 'expired', 'access_revoked', 'ciphertext_swapped'])('refuses %s authority even with a valid key', async condition => {
    const { secret } = await create();
    await asOwner(async sql => {
      if (condition === 'demoted') await sql`update membership set role = 'staff' where user_id = ${owner}`;
      if (condition === 'removed') await sql`delete from membership where user_id = ${owner}`;
      if (condition === 'unverified') await sql`update app_user set email_verified = false where id = ${owner}`;
      if (condition === 'expired') await sql`update external_trigger set expires_at = now() - interval '1 second' where id = ${ID}`;
      if (condition === 'ciphertext_swapped') {
        // Independently sealed binding must be checked, not only the key value.
        const { seal } = await import('../src/vault');
        await sql`update external_trigger set ciphertext = ${await seal(env(), JSON.stringify({ version: 1, id: ID, businessId: B, secret }))} where id = ${ID}`;
      }
    });
    const settings = condition === 'access_revoked' ? { ...env(), ACCESS_MODE: 'waitlist' as const } : env();
    expect([401, 403]).toContain((await deliver(secret, undefined, {}, undefined, settings)).status);
    expect(await asTenant(A, tx => tx`select id from run`)).toHaveLength(0);
  });
  it('rolls back event, run, report and notification together on a storage failure, then permits a safe retry', async () => {
    const { secret } = await create();
    const raw = JSON.stringify({ eventId: crypto.randomUUID() });
    await asOwner(async sql => { await sql`alter table notification add constraint trigger_test_failure check (kind <> 'external_report')`; });
    try { expect((await deliver(secret, raw)).status).toBe(503); }
    finally { await asOwner(async sql => { await sql`alter table notification drop constraint trigger_test_failure`; }); }
    expect(await asTenant(A, tx => tx`select id from run`)).toHaveLength(0);
    expect(await asTenant(A, tx => tx`select run_id from external_trigger_event`)).toHaveLength(0);
    expect((await deliver(secret, raw)).status).toBe(202);
  });
  it('is mounted behind pre-route flood/body guards and fails closed when burst protection is down', async () => {
    const { secret } = await create();
    const raw = JSON.stringify({ eventId: crypto.randomUUID() });
    const request = () => new Request('https://api.test' + triggerPath(ID), { method: 'POST', headers: signed(secret, raw), body: raw });
    expect((await api.fetch(request(), env(), context)).status).toBe(202);
    const denied = testEnv({ ...env(), API_BURST: { limit: async () => ({ success: false }) } });
    expect((await api.fetch(request(), denied, context)).status).toBe(429);
    const down = testEnv({ ...env(), API_BURST: { limit: async () => { throw new Error('down'); } } });
    expect((await api.fetch(request(), down, context)).status).toBe(503);
  });
});

describe('bounded parsing and WebCrypto interoperability', () => {
  it('verifies independent Node HMAC signatures and binds all protocol fields', async () => {
    const secret = 'f'.repeat(64); const raw = '{"eventId":"' + ID + '"}'; const headers = signed(secret, raw);
    const timestamp = headers['X-Jentera-Timestamp']; const signature = headers['X-Jentera-Signature'];
    expect(await verifyTriggerSignature(secret, triggerPath(ID), timestamp, raw, signature)).toBe(true);
    expect(await verifyTriggerSignature(secret, triggerPath(ID), timestamp, raw + ' ', signature)).toBe(false);
    expect(await verifyTriggerSignature(secret, triggerPath(A), timestamp, raw, signature)).toBe(false);
    expect(await verifyTriggerSignature(secret, triggerPath(ID), String(Number(timestamp) + 1), raw, signature)).toBe(false);
    expect(triggerTimestamp('0')).toBeNull(); expect(triggerTimestamp(timestamp + ', ' + timestamp)).toBeNull();
  });
  it('measures actual UTF-8 bytes despite a false declared length and rejects unsupported encoding/content types', async () => {
    const { secret } = await create();
    expect((await deliver(secret, 'あ'.repeat(700), { 'Content-Length': '1' })).status).toBe(413);
    expect((await deliver(secret, undefined, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await deliver(secret, undefined, { 'Content-Encoding': 'gzip' })).status).toBe(415);
    expect((await deliver(secret, '{not json')).status).toBe(400);
  });
  it('bounds stalled uploads and cancels the stream', async () => {
    const cancel = vi.fn();
    const request = new Request('https://api.test', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: new ReadableStream({ cancel }), duplex: 'half' } as RequestInit);
    vi.useFakeTimers();
    const check = readTriggerBody(request);
    const assertion = expect(check).rejects.toEqual(new TriggerBodyError(408));
    await vi.advanceTimersByTimeAsync(5000); await assertion;
    expect(cancel).toHaveBeenCalled();
  });
  it('keeps the upload deadline reachable through the real pre-route guard', async () => {
    const { secret } = await create();
    const raw = JSON.stringify({ eventId: crypto.randomUUID() });
    const cancel = vi.fn();
    const request = new Request('https://api.test' + triggerPath(ID), { method: 'POST', headers: signed(secret, raw),
      body: new ReadableStream({ cancel }), duplex: 'half' } as RequestInit);
    const response = await api.fetch(request, env(), context);
    expect(response.status).toBe(408); expect(cancel).toHaveBeenCalled();
    expect(await asTenant(A, tx => tx`select id from run`)).toHaveLength(0);
  });
});
