import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asApp, asOwner, asTenant, testEnv, truncateAll } from './harness';
import { retireRuntimeSpare, retirementCheckScript } from '../src/runtime/spare-retirement';
import { notifySparePool } from '../src/runtime/spare-alerts';
import { claimSpare, refillSparePool } from '../src/runtime/spares';
import { claimRuntime } from '../src/agent-runtime';
import { handleRuntimeQueueMessage } from '../src/runtime/consumer';
import type { BootstrapRuntimeProvider, DesiredRuntime, ObservedRuntime } from '../src/runtime/provider';

const BID = '11111111-1111-4111-8111-111111111111';
const OLD = '2026.09.17-3'; const RELEASE = '2026.09.17-4';
const BUNDLE = 'a'.repeat(40); const NEXT = 'b'.repeat(40);
const config = { release: RELEASE, bundle: NEXT, target: 2 };
const env = () => testEnv({ RUNTIME_SPARE_POOL_ENABLED: 'true', RUNTIME_SPARE_POOL_TARGET: '2',
  RUNTIME_SPARE_POOL_RECOVERY_ENABLED: 'true', RUNTIME_RELEASE: RELEASE, RUNTIME_BUNDLE_COMMIT: NEXT,
  RUNTIME_PROVISIONING_ENABLED: 'true', RUNTIME_BOOTSTRAP_ENABLED: 'true', MODEL_TRANSPORT_READY: 'true',
  SPRITES_TOKEN: 'test-only-org-key', RUNTIME_QUEUE: { send: vi.fn(async () => {}) },
  SIGNUP_NOTICE_TO: 'founder@example.test', RESEND_API_KEY: 'test-only-mail-key' });

class CleanProvider implements BootstrapRuntimeProvider {
  readonly id = 'fly-sprite' as const;
  resources = new Map<string, ObservedRuntime>();
  lookup = vi.fn(async (name: string) => this.resources.get(name) ?? null);
  destroys = vi.fn(async (runtime: ObservedRuntime) => { this.resources.delete(runtime.name); });
  exec = vi.fn(async (_runtime: ObservedRuntime, _command: string, _args?: string[]) =>
    ({ exitCode: 0, stdout: JSON.stringify({ clean: true, release: OLD, bundle: BUNDLE }), stderr: '' }));
  async create(desired: DesiredRuntime) {
    const resource: ObservedRuntime = { provider: this.id, name: desired.name, id: crypto.randomUUID(),
      url: `https://${desired.name}-test.sprites.app`, state: 'cold' };
    this.resources.set(resource.name, resource); return resource;
  }
  async destroy(runtime: ObservedRuntime) { await this.destroys(runtime); }
  async writeFile() {} async stop() {} async restore() {} async checkpoint() { return 'v1'; }
  async wake(runtime: ObservedRuntime) { return runtime; } async status(runtime: ObservedRuntime) { return runtime; }
}
beforeEach(async () => {
  await truncateAll(); vi.restoreAllMocks();
  await asOwner(sql => sql`insert into business(id,name,playbook_key) values(${BID},'Fixture','generic')`);
});
afterEach(() => { vi.unstubAllGlobals(); });

async function stale(provider = new CleanProvider()) {
  const [row] = await asApp(sql => sql<{ spare_id: string }[]>`select * from public.queue_runtime_spares(${OLD},${BUNDLE},1)`);
  const [leased] = await asApp(sql => sql<{ provider_name: string }[]>`
    select * from public.lease_runtime_spare(${row.spare_id},${BID},${OLD},${BUNDLE})`);
  const resource = await provider.create({ name: leased.provider_name, businessId: '', release: OLD });
  await asApp(sql => sql`select public.finish_runtime_spare(${row.spare_id},${BID},${resource.id},${resource.url},'v1',true)`);
  await asApp(sql => sql`select * from public.queue_runtime_spares(${RELEASE},${NEXT},1)`);
  return { id: row.spare_id, resource, provider, message: { version: 3 as const, kind: 'retire_spare' as const, spareId: row.spare_id } };
}
async function status(id: string) {
  return asOwner(async sql => (await sql`select status,retirement_attempt,retirement_problem from runtime_spare where id=${id}`)[0]);
}

it('keeps inventory and alert state inaccessible to the actual restricted application role', async () => {
  await expect(asApp(sql => sql`select * from runtime_spare_monitor`)).rejects.toThrow(/permission denied/);
  await expect(asApp(sql => sql`update runtime_spare set retirement_attempt=0`)).rejects.toThrow(/permission denied/);
  await expect(asApp(sql => sql`select * from public.lease_runtime_spare_retirement(null,${BID})`)).resolves.toEqual([]);
  await expect(asApp(sql => sql`select * from public.lease_runtime_spare_alert(null,${NEXT},2,${BID})`)).resolves.toEqual([]);
});

it('retires only after clean attestation and confirmed provider absence, then refills fresh inventory', async () => {
  const s = await stale();
  expect(await handleRuntimeQueueMessage(env(), s.message, { provider: s.provider })).toEqual({ action: 'ack', reason: 'completed' });
  expect(s.provider.destroys).toHaveBeenCalledOnce(); expect(s.provider.lookup).toHaveBeenCalledTimes(2);
  expect(s.provider.exec.mock.calls[0][2]?.join(' ')).toContain('timeout -k 1 15');
  expect(await status(s.id)).toMatchObject({ status: 'retired' });
  await refillSparePool({ ...env(), RESEND_API_KEY: '' });
  await asOwner(async sql => {
    expect(await sql`select release,bundle_commit from runtime_spare where status='queued'`).toMatchObject([
      { release: RELEASE, bundle_commit: NEXT }, { release: RELEASE, bundle_commit: NEXT },
    ]);
  });
});

it('leases concurrent duplicate cleanup deliveries once', async () => {
  const s = await stale();
  await Promise.all([1, 2, 3].map(() => retireRuntimeSpare(env(), s.message, { provider: s.provider })));
  expect(s.provider.destroys).toHaveBeenCalledOnce(); expect(await status(s.id)).toMatchObject({ status: 'retired' });
});

it('cannot retire an assigned customer, even after the business is deleted', async () => {
  const s = await stale();
  await asOwner(sql => sql`update runtime_spare set status='ready' where id=${s.id}`);
  await asTenant(BID, tx => claimSpare(tx, { release: OLD, bundle: BUNDLE }));
  await asOwner(sql => sql`delete from business where id=${BID}`);
  expect(await retireRuntimeSpare(env(), s.message, { provider: s.provider })).toEqual({ action: 'ack', reason: 'already_done' });
  expect(s.provider.lookup).not.toHaveBeenCalled();
});

it('also refuses inconsistent inventory that is linked to any tenant runtime', async () => {
  const s = await stale();
  await asTenant(BID, tx => claimRuntime(env(), tx, BID, { provider: 'fly-sprite', providerName: s.resource.name,
    release: RELEASE, runnerKey: 'r'.repeat(40), hermesApiKey: 'h'.repeat(40) }));
  expect(await retireRuntimeSpare(env(), s.message, { provider: s.provider })).toEqual({ action: 'ack', reason: 'already_done' });
  expect(s.provider.lookup).not.toHaveBeenCalled();
});

it('fences stale completion and authorization tokens', async () => {
  const s = await stale(); const token = crypto.randomUUID();
  await asApp(sql => sql`select * from public.lease_runtime_spare_retirement(${s.id},${token})`);
  await asOwner(sql => sql`update runtime_spare set retirement_expires_at=now()-interval '1 minute' where id=${s.id}`);
  const [authorized] = await asApp(sql => sql<{ ok: boolean }[]>`select public.runtime_spare_retirement_authorized(${s.id},${token}) as ok`);
  const [finished] = await asApp(sql => sql<{ ok: boolean }[]>`select public.finish_runtime_spare_retirement(${s.id},${token},true,false) as ok`);
  expect(authorized.ok).toBe(false); expect(finished.ok).toBe(false); expect(await status(s.id)).toMatchObject({ status: 'quarantined' });
});

it('keeps dirty/assigned/malformed filesystem attestation quarantined for manual review', async () => {
  const s = await stale();
  s.provider.exec.mockResolvedValue({ exitCode: 1, stdout: 'SECRET unsafe contents', stderr: 'SECRET' });
  expect((await retireRuntimeSpare(env(), s.message, { provider: s.provider })).reason).toBe('failed');
  expect(s.provider.destroys).not.toHaveBeenCalled();
  expect(await status(s.id)).toMatchObject({ status: 'quarantined', retirement_attempt: 3, retirement_problem: 'unsafe_state' });
});

it('refuses a changed provider identity before executing or deleting anything', async () => {
  const s = await stale(); s.provider.resources.set(s.resource.name, { ...s.resource, id: 'another-resource' });
  await retireRuntimeSpare(env(), s.message, { provider: s.provider });
  expect(s.provider.exec).not.toHaveBeenCalled(); expect(s.provider.destroys).not.toHaveBeenCalled();
  expect(await status(s.id)).toMatchObject({ retirement_problem: 'unsafe_state' });
});

it('does not forget an uncertain interrupted create just because lookup is missing', async () => {
  const s = await stale(); s.provider.resources.clear();
  await asOwner(sql => sql`update runtime_spare set provider_id=null,provider_url=null,
    ready_at=null,checkpoint_id=null,problem='prepare_abandoned' where id=${s.id}`);
  expect((await retireRuntimeSpare(env(), s.message, { provider: s.provider })).reason).toBe('failed');
  expect(await status(s.id)).toMatchObject({ status: 'quarantined', retirement_problem: 'unsafe_state' });
});

it('can retire an obsolete queue entry that was never prepared and has no provider resource', async () => {
  const [s] = await asApp(sql => sql<{ spare_id: string }[]>`select * from public.queue_runtime_spares(${OLD},${BUNDLE},1)`);
  await asApp(sql => sql`select * from public.queue_runtime_spares(${RELEASE},${NEXT},1)`);
  const provider = new CleanProvider();
  expect((await retireRuntimeSpare(env(), { version: 3, kind: 'retire_spare', spareId: s.spare_id }, { provider })).reason).toBe('completed');
  expect(provider.destroys).not.toHaveBeenCalled(); expect(await status(s.spare_id)).toMatchObject({ status: 'retired' });
});

it('retains budget until deletion is confirmed and bounds provider failures at three attempts', async () => {
  const s = await stale(); s.provider.destroys.mockImplementation(async () => {});
  for (let i = 0; i < 3; i++) {
    await asOwner(sql => sql`update runtime_spare set retirement_available_at=now()-interval '1 minute' where id=${s.id}`);
    expect((await retireRuntimeSpare(env(), s.message, { provider: s.provider })).reason).toBe('failed');
  }
  expect((await retireRuntimeSpare(env(), s.message, { provider: s.provider })).reason).toBe('already_done');
  expect(s.provider.destroys).toHaveBeenCalledTimes(3);
  expect(await status(s.id)).toMatchObject({ status: 'quarantined', retirement_attempt: 3 });
});

it('keeps disabled recovery inert without touching provider resources', async () => {
  const s = await stale();
  expect((await retireRuntimeSpare({ ...env(), RUNTIME_SPARE_POOL_RECOVERY_ENABLED: 'false' }, s.message, { provider: s.provider })).reason).toBe('missing');
  expect(s.provider.lookup).not.toHaveBeenCalled();
});

it('alerts only for sustained emptiness, deduplicates concurrent sends and throttles successful delivery', async () => {
  const email = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: 'test-only' })); vi.stubGlobal('fetch', email);
  await notifySparePool(env(), config); expect(email).not.toHaveBeenCalled();
  await asOwner(sql => sql`update runtime_spare_monitor set empty_since=now()-interval '11 minutes'`);
  await Promise.all([1, 2].map(() => notifySparePool(env(), config)));
  expect(email).toHaveBeenCalledOnce(); await notifySparePool(env(), config); expect(email).toHaveBeenCalledOnce();
  const body = String(email.mock.calls[0]?.[1]?.body);
  expect(body).toContain('founder@example.test'); expect(body).not.toContain(BID); expect(body).not.toContain('SECRET');
});

it('does not mark a refused email as delivered and retries after its backoff', async () => {
  const email = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('', { status: 503 })); vi.stubGlobal('fetch', email);
  await notifySparePool(env(), config);
  await asOwner(sql => sql`update runtime_spare_monitor set empty_since=now()-interval '11 minutes'`);
  await notifySparePool(env(), config); await notifySparePool(env(), config); expect(email).toHaveBeenCalledOnce();
  await asOwner(async sql => {
    const [m] = await sql`select last_alert_at from runtime_spare_monitor`; expect(m.last_alert_at).toBeNull();
    await sql`update runtime_spare_monitor set alert_available_at=now()-interval '1 minute'`;
  });
  email.mockResolvedValue(Response.json({ id: 'accepted' })); await notifySparePool(env(), config);
  expect(email).toHaveBeenCalledTimes(2);
});

it('alerts immediately when safe recovery requires manual review', async () => {
  const s = await stale(); await asOwner(sql => sql`update runtime_spare set retirement_attempt=3 where id=${s.id}`);
  const email = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: 'accepted' })); vi.stubGlobal('fetch', email);
  await notifySparePool(env(), config); expect(email).toHaveBeenCalledOnce();
});

it('runs the actual read-only guard against clean and unsafe filesystem fixtures', () => {
  const services = [process.execPath, '-e', 'console.log("[]")'];
  for (const kind of ['clean', 'assigned', 'credential', 'session', 'symlink', 'services', 'wrong-pin']) {
    const home = mkdtempSync(join(tmpdir(), 'jentera-retirement-test-'));
    try {
      mkdirSync(join(home, 'aisar', 'runner'), { recursive: true });
      mkdirSync(join(home, '.hermes', 'sessions'), { recursive: true });
      writeFileSync(join(home, 'aisar', 'spare-state.json'), JSON.stringify({ state: kind === 'assigned' ? 'assigned' : 'prepared',
        release: OLD, bundle: BUNDLE, hermesCommit: 'ff5b9fcfb029e230a2d3f90d1a3c06260ea1d413' }), { mode: 0o600 });
      if (kind === 'credential') writeFileSync(join(home, 'aisar', 'runner.env'), 'SECRET');
      if (kind === 'session') writeFileSync(join(home, '.hermes', 'sessions', 'private.json'), 'SECRET');
      if (kind === 'symlink') symlinkSync(join(home, 'aisar'), join(home, '.hermes', 'skills'));
      const script = retirementCheckScript(home, kind === 'services' ? [process.execPath, '-e', 'console.log("[{}]")'] : services);
      const result = spawnSync(process.execPath, ['-e', script, '--', kind === 'wrong-pin' ? RELEASE : OLD, BUNDLE], { encoding: 'utf8' });
      expect(result.status).toBe(kind === 'clean' ? 0 : 1); expect(result.stderr).not.toContain('SECRET');
      if (kind === 'clean') expect(JSON.parse(result.stdout).clean).toBe(true);
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});
