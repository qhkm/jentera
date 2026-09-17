import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { asApp, asOwner, asTenant, req, testEnv, truncateAll } from './harness';
import { assignedSpare, claimSpare, refillSparePool, sparePoolConfig } from '../src/runtime/spares';
import { prepareRuntimeSpare } from '../src/runtime/spare-worker';
import { ensureProviderRuntime, sparePreparationTransfer } from '../src/runtime/provision';
import { getRuntime, getRuntimeSecrets, claimRuntime } from '../src/agent-runtime';
import { handleRuntimeQueueMessage } from '../src/runtime/consumer';
import { handleSupport } from '../src/routes/support';
import { deriveJenteraRuntimeCredential } from '../src/runtime/openrouter-keys';
import { riderBudgetStatus, verifyJenteraKey } from '../src/fmcv-verifier';
import { handleModelProxy } from '../src/routes/model';
import type { BootstrapRuntimeProvider, DesiredRuntime, ObservedRuntime, RuntimeExecResult } from '../src/runtime/provider';
import type { Env } from '../src/env';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const RELEASE = '2026.09.17-3';
const BUNDLE = 'a'.repeat(40);
const HERMES = 'bb0305ae08bf1dc9ac5a39d2b017f27e42854170';
const config = { release: RELEASE, bundle: BUNDLE };

function enabled(over: Partial<Env> = {}) {
  return testEnv({ RUNTIME_SPARE_POOL_ENABLED: 'true', RUNTIME_SPARE_POOL_TARGET: '2',
    RUNTIME_PROVISIONING_ENABLED: 'true', RUNTIME_BOOTSTRAP_ENABLED: 'true', MODEL_TRANSPORT_READY: 'true',
    RUNTIME_RELEASE: RELEASE, RUNTIME_BUNDLE_COMMIT: BUNDLE, SPRITES_TOKEN: 'fake-org-token',
    RUNTIME_QUEUE: { send: vi.fn(async () => {}) }, AISAR_MODEL_PROVIDER: 'openrouter',
    AISAR_MODEL_BASE: 'https://router.fmcv.my', AISAR_MODEL_KEY: 's'.repeat(64), AISAR_MODEL_NAME: 'MiniMax-M3', ...over });
}

beforeEach(async () => {
  await truncateAll();
  await asOwner(sql => sql`insert into business(id,name,playbook_key)
    values(${A},'Alpha','generic'),(${B},'Beta','generic')`);
});

async function inventory() {
  return asOwner(sql => sql<{ id: string; status: string; assigned_business_id: string | null; problem: string | null }[]>`
    select id,status,assigned_business_id,problem from runtime_spare order by created_at`);
}

async function queued() {
  return asApp(sql => sql<{ spare_id: string }[]>`select * from public.queue_runtime_spares(${RELEASE},${BUNDLE},2)`);
}

async function ready(provider: FakeSprite, id: string) {
  const token = crypto.randomUUID();
  const [row] = await asApp(sql => sql<{ provider_name: string }[]>`
    select * from public.lease_runtime_spare(${id},${token},${RELEASE},${BUNDLE})`);
  const resource = await provider.create({ name: row.provider_name, release: RELEASE, businessId: '' });
  const [saved] = await asApp(sql => sql<{ ok: boolean }[]>`select public.finish_runtime_spare(
    ${id},${token},${resource.id},${resource.url},'v1',true) as ok`);
  expect(saved.ok).toBe(true);
}

describe('clean-spare inventory security and concurrency', () => {
  it('denies direct inventory access, including from a tenant', async () => {
    await queued();
    await expect(asApp(sql => sql`select * from runtime_spare`)).rejects.toThrow(/permission denied/);
    await expect(asTenant(A, tx => tx`update runtime_spare set status='ready'`)).rejects.toThrow(/permission denied/);
    await expect(asApp(sql => sql`select * from public.claim_runtime_spare(${RELEASE},${BUNDLE})`)).resolves.toEqual([]);
  });

  it('bounds inventory at two across concurrent refill attempts', async () => {
    await Promise.all(Array.from({ length: 8 }, () => queued()));
    expect(await inventory()).toHaveLength(2);
    await expect(asApp(sql => sql`select * from public.queue_runtime_spares(${RELEASE},${BUNDLE},100)`)).resolves.toEqual([]);
    expect(await inventory()).toHaveLength(2);
  });

  it('rejects incomplete control parameters without creating or leasing inventory', async () => {
    await expect(asApp(sql => sql`select * from public.queue_runtime_spares(null,${BUNDLE},2)`)).resolves.toEqual([]);
    await expect(asApp(sql => sql`select * from public.queue_runtime_spares(${RELEASE},null,2)`)).resolves.toEqual([]);
    await expect(asApp(sql => sql`select * from public.queue_runtime_spares(${RELEASE},${BUNDLE},null)`)).resolves.toEqual([]);
    expect(await inventory()).toHaveLength(0);
    const [row] = await queued();
    await expect(asApp(sql => sql`select * from public.lease_runtime_spare(
      ${row.spare_id},null,${RELEASE},${BUNDLE})`)).resolves.toEqual([]);
    expect((await inventory()).find(s => s.id === row.spare_id)?.status).toBe('queued');
    const token = crypto.randomUUID();
    await asApp(sql => sql`select * from public.lease_runtime_spare(${row.spare_id},${token},${RELEASE},${BUNDLE})`);
    const [saved] = await asApp(sql => sql<{ ok: boolean }[]>`select public.finish_runtime_spare(
      ${row.spare_id},${token},'id','https://test.sprites.app','v1',null) as ok`);
    expect(saved.ok).toBe(false);
    expect((await inventory()).find(s => s.id === row.spare_id)?.status).toBe('preparing');
  });

  it('leases only one preparation, once, with fenced finalization', async () => {
    const rows = await queued();
    const token = crypto.randomUUID();
    const leases = await Promise.all(rows.map(row => asApp(sql => sql`
      select * from public.lease_runtime_spare(${row.spare_id},${token},${RELEASE},${BUNDLE})`)));
    expect(leases.flat()).toHaveLength(1);
    const preparing = (await inventory()).find(row => row.status === 'preparing')!;
    const [stale] = await asApp(sql => sql<{ ok: boolean }[]>`select public.finish_runtime_spare(
      ${preparing.id},${crypto.randomUUID()},'id','https://pool-test.sprites.app','v1',true) as ok`);
    expect(stale.ok).toBe(false);
    const [invalid] = await asApp(sql => sql<{ ok: boolean }[]>`select public.finish_runtime_spare(
      ${preparing.id},${token},'id','https://attacker.test','Current',true) as ok`);
    expect(invalid.ok).toBe(false);
  });

  it('atomically assigns different computers to concurrent businesses', async () => {
    const provider = new FakeSprite();
    const rows = await queued();
    for (const row of rows) await ready(provider, row.spare_id);
    const [a,b] = await Promise.all([A,B].map(bid => asTenant(bid, tx => claimSpare(tx, config))));
    expect(a?.spare_id).toBeTruthy(); expect(b?.spare_id).toBeTruthy();
    expect(a?.spare_id).not.toBe(b?.spare_id);
    expect(await asTenant(B, tx => assignedSpare(tx, a!.provider_name))).toBeNull();
    expect(await asTenant(A, tx => assignedSpare(tx, a!.provider_name))).toMatchObject(a!);
    expect(await asTenant(A, tx => claimSpare(tx, config))).toBeNull();
  });

  it('does not consume two spares for two requests from the same business', async () => {
    const provider = new FakeSprite();
    const rows = await queued();
    for (const row of rows) await ready(provider, row.spare_id);
    const taken = await Promise.all([1,2].map(() => asTenant(A, tx => claimSpare(tx, config))));
    expect(taken.filter(Boolean)).toHaveLength(1);
    expect((await inventory()).filter(row => row.status === 'ready')).toHaveLength(1);
  });

  it('rolls back a reservation if the tenant transaction fails', async () => {
    const provider = new FakeSprite();
    const [row] = await queued(); await ready(provider, row.spare_id);
    await expect(asTenant(A, async tx => { await claimSpare(tx, config); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect((await inventory()).find(s => s.id === row.spare_id)?.status).toBe('ready');
  });

  it('never recycles an assigned computer after account deletion', async () => {
    const provider = new FakeSprite();
    const rows = await queued(); for (const row of rows) await ready(provider, row.spare_id);
    const taken = await asTenant(A, tx => claimSpare(tx, config));
    await asOwner(sql => sql`delete from business where id=${A}`);
    await queued();
    const b = await asTenant(B, tx => claimSpare(tx, config));
    expect(b?.spare_id).not.toBe(taken?.spare_id);
    expect((await inventory()).find(s => s.id === taken?.spare_id)?.assigned_business_id).toBe(A);
  });

  it('quarantines stale releases instead of handing them to a new signup', async () => {
    const provider = new FakeSprite(); const [row] = await queued(); await ready(provider, row.spare_id);
    expect(await asTenant(A, tx => claimSpare(tx, { ...config, bundle: 'b'.repeat(40) }))).toBeNull();
    await asApp(sql => sql`select * from public.queue_runtime_spares('2026.09.17-4',${BUNDLE},2)`);
    expect((await inventory()).find(s => s.id === row.spare_id)).toMatchObject({ status: 'quarantined', problem: 'obsolete' });
    expect(await inventory()).toHaveLength(2);
  });

  it('quarantines abandoned preparations without launching replacements', async () => {
    const [row] = await queued();
    const token = crypto.randomUUID();
    await asApp(sql => sql`select * from public.lease_runtime_spare(${row.spare_id},${token},${RELEASE},${BUNDLE})`);
    await asOwner(sql => sql`update runtime_spare set lease_expires_at=now()-interval '1 second' where id=${row.spare_id}`);
    await queued();
    expect((await inventory()).find(s => s.id === row.spare_id)).toMatchObject({ status: 'quarantined', problem: 'prepare_abandoned' });
    const [late] = await asApp(sql => sql<{ ok: boolean }[]>`select public.finish_runtime_spare(
      ${row.spare_id},${token},'id','https://test.sprites.app','v1',true) as ok`);
    expect(late.ok).toBe(false); expect(await inventory()).toHaveLength(2);
  });

  it('does not assign expired spares and retains them for safe review', async () => {
    const provider = new FakeSprite(); const [row] = await queued(); await ready(provider, row.spare_id);
    await asOwner(sql => sql`update runtime_spare set ready_at=now()-interval '25 hours' where id=${row.spare_id}`);
    expect(await asTenant(A, tx => claimSpare(tx, config))).toBeNull(); await queued();
    expect((await inventory()).find(s => s.id === row.spare_id)).toMatchObject({ status: 'quarantined', problem: 'expired' });
  });

  it('limits prepared resources to four per hour, even with repeated assignments', async () => {
    const provider = new FakeSprite();
    await queued();
    for (let i=0; i<4; i++) {
      const bid = crypto.randomUUID();
      await asOwner(sql => sql`insert into business(id,name,playbook_key) values(${bid},'Fixture','generic')`);
      const next = (await inventory()).find(row => row.status === 'queued')!;
      await ready(provider,next.id); await asTenant(bid,tx => claimSpare(tx,config)); await queued();
    }
    expect(await inventory()).toHaveLength(4);
  });
});

describe('preparation, refill and tenant activation', () => {
  it('verifies strictly shaped pooled runtime credentials and rejects tampering', async () => {
    const name='aisar-p-'+'a'.repeat(32);
    const credential=await deriveJenteraRuntimeCredential('s'.repeat(64),name);
    expect(await verifyJenteraKey(credential.key,'s'.repeat(64))).toMatchObject({ rid:name });
    await expect(verifyJenteraKey(credential.key,'x'.repeat(64))).rejects.toThrow(/signature/);
    for(const invalid of ['aisar-p-'+'a'.repeat(20),'aisar-p-'+'a'.repeat(33),'aisar-p-anything','aisar-p-'+'A'.repeat(32)]) {
      await expect(deriveJenteraRuntimeCredential('s'.repeat(64),invalid)).rejects.toThrow(/identity/);
    }
    // An unassigned spare is not a tenant, even if a valid credential were
    // fabricated using the control secret held only in our test fixture.
    const [lookup]=await asApp(sql=>sql<{ bid:string|null }[]>`select public.runtime_business_for_rider(${name}) as bid`);
    expect(lookup.bid).toBeNull();
  });

  it('refuses inference for an unassigned pool identity even when access is open', async () => {
    const name = 'aisar-p-' + 'a'.repeat(32);
    const credential = await deriveJenteraRuntimeCredential('s'.repeat(64), name);
    const env = enabled({ ACCESS_MODE: 'open', FMCV_UPSTREAM_KEY: 'upstream-test-only' });
    const { request, url } = req('POST', '/v1/model/chat/completions', {
      body: { model: 'MiniMax-M3', messages: [{ role: 'user', content: 'ping' }] },
    });
    request.headers.set('Authorization', `Bearer ${credential.key}`);
    const upstreamFetch = vi.fn(async () => Response.json({ choices: [] }));
    const response = await handleModelProxy(request, env, url, {}, { upstreamFetch });
    expect(response?.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
  it('keeps disabled and malformed configurations inert', async () => {
    for (const over of [{ RUNTIME_SPARE_POOL_ENABLED: 'false' }, { RUNTIME_SPARE_POOL_TARGET: '100' },
      { MODEL_TRANSPORT_READY: 'false' }, { RUNTIME_BUNDLE_COMMIT: 'main' }, { RUNTIME_QUEUE: undefined }]) {
      const env = enabled(over); expect(sparePoolConfig(env)).toBeNull();
      expect(await refillSparePool(env)).toBe(0);
    }
    expect(await inventory()).toHaveLength(0);
  });

  it('retains pending inventory after a queue outage and republishes the same ids', async () => {
    const env = enabled();
    const send = vi.fn(async (_message: unknown) => { throw new Error('offline'); });
    env.RUNTIME_QUEUE = { send } as unknown as Queue;
    await expect(refillSparePool(env)).rejects.toThrow('offline');
    const before = (await inventory()).map(s => s.id).sort();
    env.RUNTIME_QUEUE = { send: vi.fn(async () => {}) } as unknown as Queue;
    expect(await refillSparePool(env)).toBe(2);
    expect((await inventory()).map(s => s.id).sort()).toEqual(before);
  });

  it('prepares a pinned private spare without sending any tenant credentials', async () => {
    const provider = new FakeSprite(); const [row] = await queued();
    const message = { version: 3, kind: 'prepare_spare', spareId: row.spare_id } as const;
    expect(await handleRuntimeQueueMessage(enabled(),message,{ provider })).toEqual({ action: 'ack', reason: 'completed' });
    expect((await inventory()).find(s => s.id === row.spare_id)?.status).toBe('ready');
    expect(provider.writes).toHaveLength(1);
    expect(provider.writes[0].mode).toBe(0o600);
    const fields = transferFields(provider.writes[0].data);
    expect([...fields.keys()].sort()).toEqual(['HERMES_COMMIT_B64','HERMES_TAG_B64','RUNTIME_RELEASE_B64']);
    expect(fields.get('HERMES_COMMIT_B64')).toBe(HERMES);
    expect(provider.commands.some(c => c.args.some(arg => arg.includes('timeout -k 10 600')) &&
      c.env?.includes('AISAR_BOOTSTRAP_PREPARE_SPARE=1'))).toBe(true);
    const downloads = provider.commands.find(c => c.args[1]?.includes('timeout -k 10 180'))!;
    expect(downloads.args[2]).toBe('--');
    expect(downloads.args[3]).toContain(`https://raw.githubusercontent.com/qhkm/jentera/${BUNDLE}/runner/bin/spare-state.mjs`);
    // Exercise the real nested-shell argument binding, independently of
    // the provider fake and without a download or filesystem write.
    const shell = downloads.args[1].replace('timeout -k 10 180 ', '');
    expect(execFileSync('/bin/bash', [downloads.args[0], shell, downloads.args[2],
      `printf '%s' 'a literal "$1" ; not a command'`], { encoding: 'utf8' }))
      .toBe('a literal "$1" ; not a command');
    expect(provider.wakes).toBe(0);
    const count = provider.creates;
    expect(await prepareRuntimeSpare(enabled(),message,{ provider })).toEqual({ action: 'ack', reason: 'already_done' });
    expect(provider.creates).toBe(count);
  });

  it.each(['install','attestation','checkpoint'])('quarantines a %s failure and does not retry its resource', async failure => {
    const provider = new FakeSprite(); provider.failure = failure;
    const [row] = await queued(); const message = { version: 3, kind: 'prepare_spare', spareId: row.spare_id } as const;
    expect(await prepareRuntimeSpare(enabled(),message,{ provider })).toEqual({ action: 'ack', reason: 'failed' });
    expect((await inventory()).find(s => s.id === row.spare_id)).toMatchObject({ status: 'quarantined', problem: 'prepare_failed' });
    expect(JSON.stringify(await inventory())).not.toContain('SECRET');
    const count = provider.creates;
    await prepareRuntimeSpare(enabled(),message,{ provider }); await queued();
    expect(provider.creates).toBe(count); expect(await inventory()).toHaveLength(2);
  });

  it('activates without creating compute, retaining fresh per-business credentials and readiness', async () => {
    const provider = new FakeSprite(); const rows = await queued();
    for (const row of rows) await ready(provider,row.spare_id);
    provider.creates=0;
    const [a,b] = await Promise.all([A,B].map(bid => ensureProviderRuntime(enabled(),bid,{ provider,fetch: readiness })));
    expect(a.status).toBe('ready'); expect(b.status).toBe('ready');
    expect(provider.creates).toBe(0); expect(a.providerName).not.toBe(b.providerName);
    const [ka,kb] = await Promise.all([A,B].map(bid => asTenant(bid,tx => getRuntimeSecrets(enabled(),tx,bid))));
    expect(ka.runnerKey).not.toBe(kb.runnerKey); expect(ka.hermesApiKey).not.toBe(kb.hermesApiKey);
    for (const write of provider.writes) {
      const fields = transferFields(write.data);
      expect([A,B]).toContain(fields.get('BUSINESS_ID_B64'));
      expect(fields.get('MODEL_KEY_B64')).toMatch(/^sk-jentera-v1\./);
    }
    const adoption = provider.commands.findIndex(c => c.command==='/.sprite/bin/node');
    expect(adoption).toBeGreaterThanOrEqual(0);
    expect(a.observedRelease).toBe(RELEASE);
    const [lookup]=await asApp(sql=>sql<{ bid:string|null }[]>`select public.runtime_business_for_rider(${a.providerName}) as bid`);
    expect(lookup.bid).toBe(A);
    await asOwner(sql => sql`insert into runtime_budget (business_id,monthly_cost_microusd)
      values (${A},1000000),(${B},12000000)`);
    expect((await riderBudgetStatus(enabled(),a.providerName)).limitMicrousd).toBe(1_000_000);
    expect((await riderBudgetStatus(enabled(),b.providerName)).limitMicrousd).toBe(12_000_000);
    const assignedBefore = (await inventory()).filter(s => s.status==='assigned').length;
    await ensureProviderRuntime(enabled({ RUNTIME_SPARE_POOL_ENABLED:'false' }),A,{ provider,fetch:readiness });
    expect(provider.creates).toBe(0);
    expect((await inventory()).filter(s => s.status==='assigned')).toHaveLength(assignedBefore);
  });

  it('uses normal provisioning when inventory is empty', async () => {
    const provider = new FakeSprite();
    const runtime = await ensureProviderRuntime(enabled(),A,{ provider,fetch:readiness });
    expect(runtime.status).toBe('ready'); expect(runtime.providerName).toMatch(/^aisar-b-/);
    expect(provider.creates).toBe(1);
  });

  it('keeps an existing business on its current resource', async () => {
    const provider = new FakeSprite();
    const old = await ensureProviderRuntime(enabled({ RUNTIME_SPARE_POOL_ENABLED:'false' }),A,{ provider,fetch:readiness });
    const [row] = await queued(); await ready(provider,row.spare_id);
    const current = await ensureProviderRuntime(enabled(),A,{ provider,fetch:readiness });
    expect(current.providerName).toBe(old.providerName);
    expect((await inventory()).find(s => s.id===row.spare_id)?.status).toBe('ready');
  });

  it('fails closed before transferring credentials when a spare is dirty', async () => {
    const provider = new FakeSprite(); const [row] = await queued(); await ready(provider,row.spare_id);
    provider.failure='claim';
    await expect(ensureProviderRuntime(enabled(),A,{ provider,fetch:readiness })).rejects.toThrow(/clean-state/);
    expect(provider.writes).toHaveLength(0);
    expect(await asTenant(A,tx=>getRuntime(tx,A))).toMatchObject({ status:'error',observedRelease:null });
    expect((await inventory()).find(s=>s.id===row.spare_id)).toMatchObject({ status:'assigned',assigned_business_id:A });
  });

  it('requires support authentication for system pool messages', async () => {
    const { request,url } = req('POST','/api/support/runtime-slice',{ body:{ version:3,kind:'prepare_spare',spareId:A } });
    const env=enabled({ AISAR_SUPPORT_KEY:'support-secret' });
    expect((await handleSupport(request,env,url,{}))?.status).toBe(401);
    request.headers.set('Authorization','Bearer support-secret');
    env.RUNTIME_SPARE_POOL_ENABLED='false';
    expect((await handleSupport(request,env,url,{}))?.status).toBe(200);
    expect(await inventory()).toHaveLength(0);
  });

  it('does not consume inventory if claiming the runtime rolls back', async () => {
    const provider=new FakeSprite(); const [row]=await queued(); await ready(provider,row.spare_id);
    await expect(asTenant(A,async tx=>{
      const spare=await claimSpare(tx,config);
      await claimRuntime(enabled(),tx,A,{ provider:'fly-sprite',providerName:spare!.provider_name,
        release:RELEASE,runnerKey:'runner',hermesApiKey:'hermes' });
      throw new Error('interrupted');
    })).rejects.toThrow('interrupted');
    expect(await asTenant(A,tx=>getRuntime(tx,A))).toBeNull();
    expect((await inventory()).find(s=>s.id===row.spare_id)?.status).toBe('ready');
  });
});

function transferFields(data:string) {
  return new Map(data.trim().split('\n').map(line=>{
    const at=line.indexOf('='); return [line.slice(0,at),atob(line.slice(at+1))];
  }));
}

const readiness:typeof fetch=async()=>Response.json({ ok:true,release:RELEASE,
  runner:{ sourceAttested:true,sourceSha256:'a'.repeat(64) },hermes:{ jenteraPatch:'jentera-runtime-2026-09-16' },
  toolMode:'full-tools',webSearchBackend:'ddgs',edgeAuthorizationForwarded:false,
  specialistProfiles:{ operations:true,customers:true,growth:true,records:true } });

class FakeSprite implements BootstrapRuntimeProvider {
  readonly id='fly-sprite' as const;
  creates=0; wakes=0; failure='';
  resources=new Map<string,ObservedRuntime>();
  writes:{ path:string;data:string;mode:number }[]=[];
  commands:{ command:string;args:string[];env?:string[] }[]=[];
  async create(desired:DesiredRuntime) {
    this.creates++;
    const existing=this.resources.get(desired.name); if(existing) return existing;
    const resource:ObservedRuntime={ provider:this.id,id:crypto.randomUUID(),name:desired.name,
      url:`https://${desired.name}-test.sprites.app`,state:'cold' };
    this.resources.set(desired.name,resource); return resource;
  }
  async wake(runtime:ObservedRuntime) { this.wakes++; return { ...runtime,state:'ready' as const }; }
  async stop() {}
  async status(runtime:ObservedRuntime) {
    const observed=this.resources.get(runtime.name); if(!observed) throw new Error('missing'); return observed;
  }
  async checkpoint() { if(this.failure==='checkpoint') throw new Error('SECRET upstream response'); return 'v1'; }
  async restore() {}
  async destroy() {}
  async writeFile(_runtime:ObservedRuntime,path:string,data:string,mode:number) { this.writes.push({ path,data,mode }); }
  async exec(_runtime:ObservedRuntime,command:string,args:string[]=[],options?:{ env?:string[] }):Promise<RuntimeExecResult> {
    this.commands.push({ command,args,env:options?.env });
    if(command==='/.sprite/bin/node' && this.failure==='claim') return { exitCode:1,stdout:'',stderr:'SECRET' };
    if(options?.env?.includes('AISAR_BOOTSTRAP_PREPARE_SPARE=1')) {
      if(this.failure==='install') throw new Error('SECRET installer response');
      return { exitCode:0,stdout:JSON.stringify({ prepared:this.failure!=='attestation',release:RELEASE,
        bundleCommit:BUNDLE,hermesCommit:HERMES }),stderr:'' };
    }
    return { exitCode:0,stdout:'{"ok":true}',stderr:'' };
  }
}
