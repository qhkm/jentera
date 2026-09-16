import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accessForEmail, businessHasAccess } from '../src/access';
import { withUser } from '../src/db';
import { previewForEmail, reservePreview, previewModelAccess } from '../src/chat-preview';
import { authLandingPath, verifySession } from '../src/auth';
import { claimRuntime, markRuntimeReady } from '../src/agent-runtime';
import { handleRuns } from '../src/routes/runs';
import { handleAccess } from '../src/routes/access';
import { handleBilling } from '../src/routes/billing';
import { asOwner, asTenant, req, signIn, testEnv, truncateAll, sendFake } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let userId: string; let cookie: string;
const env = (extra = {}) => testEnv({ ACCESS_MODE: 'waitlist', CHAT_PREVIEW_ENABLED: 'true',
  RUNTIME_EXECUTION_ENABLED: 'true', RUNTIME_RELEASE: '2026.08.28-4',
  AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731', RUNTIME_QUEUE: { send: sendFake() }, ...extra });
beforeEach(async () => {
  await truncateAll();
  await asOwner(async sql => {
    await sql`truncate platform_access, trial_invite, trial_redemption, waitlist_entry cascade`;
    await sql`insert into business (id,name,playbook_key) values (${A},'Alpha','restaurant'),(${B},'Beta','retail')`;
    const [user] = await sql<{ id: string }[]>`insert into app_user (email,email_verified) values ('preview@example.com',true) returning id`;
    userId = user.id;
    await sql`insert into membership (user_id,business_id,role) values (${userId},${A},'owner'),(${userId},${B},'owner')`;
  });
  cookie = await signIn(userId);
});
async function ready() {
  await asTenant(A, tx => claimRuntime(env(), tx, A, { provider: 'fly-sprite', providerName: 'preview-test',
    release: '2026.08.28-4', runnerKey: 'runner-test-key', hermesApiKey: 'hermes-test-key' }));
  await asTenant(A, tx => markRuntimeReady(tx, A, '2026.08.28-4', 'v1'));
}
async function ask(requestId = crypto.randomUUID(), options = {}, customEnv = env()) {
  const incoming = req('POST','/api/runs/ask',{ cookie, body: { question: 'Compare these supplier options', requestId, ...options } });
  return (await handleRuns(incoming.request,customEnv,incoming.url,{}))!;
}
describe('verified account lifetime chat preview', () => {
  it('does not give the app role delete privileges and prevents decreasing the lifetime counter', async () => {
    await previewForEmail(env(),'preview@example.com');
    await reservePreview(env(),userId,A,crypto.randomUUID());
    const [privileges] = await withUser(env(),sql => sql`select
      has_table_privilege(current_user,'chat_preview_account','delete') as account_delete,
      has_table_privilege(current_user,'chat_preview_request','delete') as request_delete`);
    expect(privileges).toEqual({ account_delete:false,request_delete:false });
    await expect(withUser(env(),sql => sql`update chat_preview_account set requests_used=0 where user_id=${userId}`)).rejects.toThrow('cannot be reset');
    expect(await previewForEmail(env(),'preview@example.com')).toMatchObject({ used:1,remaining:9 });
  });
  it('is off by default and never opens anonymous or unverified access', async () => {
    expect(await accessForEmail(env({ CHAT_PREVIEW_ENABLED: 'false' }),'preview@example.com')).toMatchObject({ allowed: false });
    expect(await previewForEmail(env(),'unknown@example.com')).toBeNull();
    await asOwner(sql => sql`update app_user set email_verified=false where id=${userId}`);
    expect(await previewForEmail(env(),'preview@example.com')).toBeNull();
  });
  it('opens onboarding immediately without a code, payment or founder-group access', async () => {
    expect(await accessForEmail(env(),'preview@example.com')).toMatchObject({ allowed:true,kind:'preview',preview:{ limit:10,used:0,remaining:10 } });
    expect(await authLandingPath(env(),userId)).not.toBe('/access');
    expect(await verifySession(env(),cookie.replace('aisar_session=',''))).not.toBeNull();
    const url = new URL('http://localhost:8787/api/access');
    const response = (await handleAccess(new Request(url,{ headers:{ Cookie:cookie } }),env({ LAUNCH_FOUNDER_GROUP_URL:'https://chat.whatsapp.com/'+'A'.repeat(22) }),url,{}))!;
    expect(await response.json()).toMatchObject({ signedIn:true,founderGroup:null,access:{ kind:'preview' } });
    const billing = req('GET','/api/billing/status',{ cookie });
    const status = (await handleBilling(billing.request,env(),billing.url,{}))!;
    expect(status.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await status.json()).toMatchObject({ ok:true,activation:'inactive',preview:{ limit:10,used:0,remaining:10 } });
  });
  it('atomically admits only ten requests across concurrent tabs and different businesses', async () => {
    await previewForEmail(env(),'preview@example.com');
    const results = await Promise.all(Array.from({ length:20 },(_,i) => reservePreview(env(),userId,i%2 ? A:B,crypto.randomUUID())));
    expect(results.filter(result => result?.kind==='new')).toHaveLength(10);
    expect(results.filter(result => result?.kind==='blocked')).toHaveLength(10);
    expect(await previewForEmail(env(),'preview@example.com')).toEqual({ limit:10,used:10,remaining:0 });
    expect(await accessForEmail(env(),'preview@example.com')).toMatchObject({ allowed:true,kind:'preview' });
  });
  it('does not recharge an in-progress duplicate or reuse its key in another business', async () => {
    await previewForEmail(env(),'preview@example.com');
    const requestId = crypto.randomUUID();
    expect(await reservePreview(env(),userId,A,requestId)).toMatchObject({ kind:'new' });
    expect(await reservePreview(env(),userId,A,requestId)).toMatchObject({ kind:'busy' });
    expect(await reservePreview(env(),userId,B,requestId)).toMatchObject({ kind:'conflict' });
    expect(await previewForEmail(env(),'preview@example.com')).toMatchObject({ used:1 });
  });
  it('does not open revoked or expired paid accounts, or restart a redeemed invitation', async () => {
    await asOwner(sql => sql`insert into platform_access (email,kind,expires_at,note) values ('preview@example.com','paid',now()-interval '1 day','verified previous payment')`);
    expect(await accessForEmail(env(),'preview@example.com')).toMatchObject({ allowed:false });
    expect(await previewForEmail(env(),'preview@example.com')).toBeNull();
    await asOwner(sql => sql`update platform_access set expires_at=now()+interval '1 day',revoked_at=now() where email='preview@example.com'`);
    expect(await accessForEmail(env(),'preview@example.com')).toMatchObject({ allowed:false });
  });
  it('does not consume allowance for invalid requests or an unready runtime', async () => {
    expect((await ask(crypto.randomUUID(),{ question:'' })).status).toBe(400);
    expect((await ask()).status).toBe(503);
    expect(await previewForEmail(env(),'preview@example.com')).toMatchObject({ used:0 });
  });
  it('does not start a fresh allowance for a previously redeemed invitation', async () => {
    const hash = 'a'.repeat(64);
    await asOwner(async sql => {
      await sql`insert into trial_invite (token_hash,expires_at) values (${hash},now()+interval '1 day')`;
      await sql`insert into trial_redemption (user_id,token_hash,expires_at) values (${userId},${hash},now()-interval '1 day')`;
    });
    expect(await previewForEmail(env(),'preview@example.com')).toBeNull();
    expect(await accessForEmail(env(),'preview@example.com')).toMatchObject({ allowed:false });
    expect(await reservePreview(env(),userId,A,crypto.randomUUID())).toMatchObject({ kind:'blocked' });
  });
  it('fails closed for a missing admission record while retaining the operator exemption', async () => {
    expect(await reservePreview(env(),userId,A,crypto.randomUUID())).toMatchObject({ kind:'blocked' });
    await asOwner(sql => sql`update app_user set email='qhkmdev90@gmail.com' where id=${userId}`);
    expect(await reservePreview(env(),userId,A,crypto.randomUUID())).toBeNull();
  });
  it('retains invitation access rather than charging free chats', async () => {
    await asOwner(sql => sql`insert into platform_access (email,kind,expires_at,note) values ('preview@example.com','trial',now()+interval '1 day','verified invitation')`);
    expect(await reservePreview(env(),userId,A,crypto.randomUUID())).toBeNull();
    expect(await accessForEmail(env(),'preview@example.com')).toMatchObject({ allowed:true,kind:'trial' });
  });
  it('replays safely after a queue transport failure without a second charge', async () => {
    await ready();
    const send = vi.fn().mockRejectedValueOnce(new Error('provider error')).mockResolvedValue(undefined);
    const customEnv = env({ RUNTIME_QUEUE:{ send } });
    const key = crypto.randomUUID();
    expect((await ask(key,{},customEnv)).status).toBe(503);
    expect((await ask(key,{},customEnv)).status).toBe(202);
    expect(await previewForEmail(env(),'preview@example.com')).toMatchObject({ used:1 });
    const [runs] = await asOwner(sql => sql`select count(*)::int as count from chat_preview_request where user_id=${userId}`);
    expect(runs.count).toBe(1);
  });
  it('caps new agent requests, keeps the tenth result readable and allows safe replays', async () => {
    await ready();
    const ids = Array.from({ length:10 },() => crypto.randomUUID());
    let last!: { runId:string; preview:{ remaining:number } };
    for (const id of ids) {
      const response = await ask(id);
      expect(response.status).toBe(202);
      last = await response.json();
    }
    expect(last.preview.remaining).toBe(0);
    const blocked = await ask();
    expect(blocked.status).toBe(402);
    expect(await blocked.json()).toMatchObject({ code:'CHAT_PREVIEW_EXHAUSTED',next:'/subscribe' });
    const replay = await ask(ids[9]);
    expect(replay.status).toBe(202);
    expect(await replay.json()).toMatchObject({ runId:last.runId,preview:{ used:10 } });
    const incoming = req('GET','/api/runs/'+last.runId,{ cookie });
    expect((await handleRuns(incoming.request,env(),incoming.url,{}))?.status).toBe(200);
    const [task] = await asOwner(sql => sql`select task_id from chat_preview_request where run_id=${last.runId}`);
    expect(await businessHasAccess(env(),A,task.task_id)).toBe(true);
    expect(await businessHasAccess(env(),A)).toBe(false);
    expect(await businessHasAccess(env(),B,task.task_id)).toBe(false);
    expect(await previewModelAccess(env(),A)).toBe(false);
    await asOwner(sql => sql`update runtime_task set status='leased',lease_token='test-only',lease_heartbeat_at=now(),lease_expires_at=now()+interval '1 minute' where id=${task.task_id}`);
    expect(await previewModelAccess(env(),A)).toBe(true);
    await asOwner(sql => sql`update runtime_task set lease_expires_at=now()-interval '1 minute' where id=${task.task_id}`);
    expect(await previewModelAccess(env(),A)).toBe(false);
  });
  it('cannot bypass the quota through the legacy inline-answer mode', async () => {
    await ready();
    expect((await ask(crypto.randomUUID(),{ mode:'ask' })).status).toBe(202);
    expect(await previewForEmail(env(),'preview@example.com')).toMatchObject({ used:1 });
    await asOwner(sql => sql`update chat_preview_account set requests_used=10 where user_id=${userId}`);
    expect((await ask(crypto.randomUUID(),{ mode:'ask' })).status).toBe(402);
  });
  it('removes the trial cap after trusted paid activation without resetting trial history', async () => {
    await ready(); await previewForEmail(env(),'preview@example.com');
    await asOwner(sql => sql`update chat_preview_account set requests_used=10 where user_id=${userId}`);
    await asOwner(sql => sql`insert into platform_access (email,kind,expires_at,note) values ('preview@example.com','paid',now()+interval '1 month','verified operator payment')`);
    expect((await ask()).status).toBe(202);
    expect(await accessForEmail(env(),'preview@example.com')).toMatchObject({ allowed:true,kind:'paid' });
    const [account] = await asOwner(sql => sql`select requests_used from chat_preview_account where user_id=${userId}`);
    expect(account.requests_used).toBe(10);
  });
  it('blocks exhausted file conversions before a provider is called', async () => {
    await ready(); await previewForEmail(env(),'preview@example.com');
    await asOwner(sql => sql`update chat_preview_account set requests_used=10 where user_id=${userId}`);
    const toMarkdown = vi.fn();
    const form = new FormData(); form.set('question','Read this file');form.set('requestId',crypto.randomUUID());
    form.set('file',new File(['file bytes'],'sales.xlsx',{ type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const url = new URL('http://localhost:8787/api/runs/ask/file');
    const response = await handleRuns(new Request(url,{ method:'POST',headers:{ Cookie:cookie },body:form }),env({ AI:{ toMarkdown } }),url,{});
    expect(response?.status).toBe(402);expect(toMarkdown).not.toHaveBeenCalled();
  });
});
