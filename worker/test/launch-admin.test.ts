import { beforeEach, describe, expect, it } from 'vitest';
import { asOwner, signIn, testEnv, truncateAll } from './harness';
import { handleLaunchAdmin } from '../src/routes/launch-admin';
import { hashToken } from '../src/auth';

let admin: string;
let other: string;
let unverified: string;
beforeEach(async () => {
  await truncateAll();
  await asOwner(sql => sql`truncate platform_access,trial_redemption,trial_invite,waitlist_entry cascade`);
  const users = await asOwner(sql => sql`insert into app_user (email,email_verified) values ('qhkmdev90@gmail.com',true),('visitor@example.com',true),('unverified@example.com',false) returning id,email`);
  admin = await signIn(users.find(u => u.email === 'qhkmdev90@gmail.com')!.id);
  other = await signIn(users.find(u => u.email === 'visitor@example.com')!.id);
  unverified = await signIn(users.find(u => u.email === 'unverified@example.com')!.id);
});
async function call(cookie?: string, body?: unknown, origin = 'http://localhost:5173', path?: string) {
  const url = new URL(`http://localhost:8787${path ?? (body ? '/api/admin/launch/invites' : '/api/admin/launch')}`);
  return (await handleLaunchAdmin(new Request(url, { method: body ? 'POST' : 'GET', headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), testEnv(), url, {}))!;
}
describe('launch admin', () => {
  it('denies visitors and ordinary accounts for both reads and writes', async () => {
    for (const cookie of [undefined,other,unverified]) {
      expect((await call(cookie)).status).toBe(404);
      expect((await call(cookie,{email:'trial@example.com'})).status).toBe(404);
    }
    await asOwner(sql => sql`update app_user set email_verified=false where email='qhkmdev90@gmail.com'`);
    expect((await call(admin)).status).toBe(404);
  });
  it('returns real counts and no token hashes', async () => {
    await asOwner(sql => sql`insert into waitlist_entry (email) values ('waiting@example.com')`);
    const res = await call(admin);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json() as {totals: {waitlist: number}; rows: {email: string}[]};
    expect(body.totals.waitlist).toBe(1);
    expect(body.rows[0].email).toBe('waiting@example.com');
    expect(JSON.stringify(body)).not.toContain('token_hash');
    expect((await call(admin,undefined,undefined,'/api/admin/launch?offset=-1')).status).toBe(400);
  });
  it('issues an email-bound code, stores only its hash, and keeps access unchanged', async () => {
    expect((await call(admin,{email:'Trial@example.com'},'https://evil.test')).status).toBe(403);
    const res = await call(admin,{email:'Trial@example.com'});
    expect(res.status).toBe(201);
    const body = await res.json() as {email:string; code:string; trialHours:number};
    expect(body.email).toBe('trial@example.com');
    expect(body.trialHours).toBe(72);
    const rows = await asOwner(sql => sql`select email,token_hash,expires_at from trial_invite`);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(await hashToken(body.code));
    expect(new Date(rows[0].expires_at).getTime()-Date.now()).toBeGreaterThan(6.9*86400000);
    expect(await asOwner(sql => sql`select email from platform_access`)).toHaveLength(0);
  });
  it('reports a redeemed trial and its first completed chat request without exposing content', async () => {
    const business = crypto.randomUUID(), chat = crypto.randomUUID();
    const hash = 'a'.repeat(64);
    await asOwner(async sql => {
      const [user] = await sql`select id from app_user where email='visitor@example.com'`;
      await sql`insert into business (id,name,playbook_key) values (${business},'Test','generic')`;
      await sql`insert into membership (user_id,business_id,role) values (${user.id},${business},'owner')`;
      await sql`insert into chat_session (id,business_id,created_by,title) values (${chat},${business},${user.id},'Private title')`;
      await sql`insert into trial_invite (token_hash,email,expires_at,redeemed_by,redeemed_at) values (${hash},'visitor@example.com',now()+interval '7 days',${user.id},now()-interval '1 hour')`;
      await sql`insert into trial_redemption (user_id,token_hash,started_at,expires_at) values (${user.id},${hash},now()-interval '1 hour',now()+interval '71 hours')`;
      await sql`insert into platform_access (email,kind,expires_at) values ('visitor@example.com','trial',now()+interval '71 hours')`;
      await sql`insert into run (id,business_id,kind,trigger_shape,runtime,model,session_id,status,ended_at) values (${crypto.randomUUID()},${business},'ask','owner.ask','hermes-sprite','deepseek',${chat},'completed',now())`;
    });
    const body = await (await call(admin)).json() as { totals: {redeemed:number;active:number}; rows: {firstCompletedRequest:string|null}[] };
    expect(body.totals).toMatchObject({redeemed:1,active:1});
    expect(body.rows[0].firstCompletedRequest).not.toBeNull();
    expect(JSON.stringify(body)).not.toContain('Private title');
    expect((await call(admin,{email:'visitor@example.com'})).status).toBe(409);
  });

  it('reports durable launch milestones without claiming a push was seen', async () => {
    const business = crypto.randomUUID(), chat = crypto.randomUUID(), hash = 'b'.repeat(64);
    const run = crypto.randomUUID(), reminder = crypto.randomUUID();
    await asOwner(async sql => {
      const [user] = await sql`select id from app_user where email='visitor@example.com'`;
      await sql`insert into business (id,name,playbook_key,onboarded) values (${business},'Test','generic',true)`;
      await sql`insert into membership (user_id,business_id,role) values (${user.id},${business},'owner')`;
      await sql`insert into trial_invite (token_hash,email,expires_at,redeemed_by,redeemed_at) values (${hash},'visitor@example.com',now()+interval '7 days',${user.id},now()-interval '1 hour')`;
      await sql`insert into trial_redemption (user_id,token_hash,started_at,expires_at) values (${user.id},${hash},now()-interval '1 hour',now()+interval '71 hours')`;
      await sql`insert into platform_access (email,kind,expires_at) values ('visitor@example.com','trial',now()+interval '71 hours')`;
      await sql`insert into runtime_task (business_id,kind,status,dedupe_key) values (${business},'provision','completed','launch-test')`;
      await sql`insert into agent_runtime (business_id,provider,provider_name,status,desired_release,last_ready_at) values (${business},'local','launch-test','ready','test',now())`;
      await sql`insert into activation_milestone (business_id,user_id,kind) values (${business},${user.id},'installed_app_opened')`;
      await sql`insert into push_subscription (business_id,user_id,endpoint,p256dh,auth,last_used_at) values (${business},${user.id},'https://push.example/device',${'B'.repeat(87)},${'a'.repeat(22)},now())`;
      await sql`insert into chat_session (id,business_id,created_by,title) values (${chat},${business},${user.id},'Private title')`;
      await sql`insert into run (id,business_id,kind,trigger_shape,runtime,model,session_id,status,ended_at) values (${run},${business},'ask','owner.ask','hermes-sprite','deepseek',${chat},'completed',now())`;
      await sql`insert into reminder (id,business_id,user_id,message,due_at,time_zone,status) values (${reminder},${business},${user.id},'Private reminder',now()-interval '1 minute','Asia/Kuala_Lumpur','sent')`;
      const [notice] = await sql`insert into notification (business_id,recipient_user_id,kind,title,body,source_key) values (${business},${user.id},'reminder_due','Reminder','Private reminder',${`reminder:${reminder}`}) returning created_at`;
      await sql`insert into push_outbox (business_id,user_id,title,body,url,tag,delivered_at,created_at) values (${business},${user.id},'Reminder','Private reminder','/app',${`notification:reminder:${reminder}`},now(),${notice.created_at})`;
      await sql`update push_subscription set last_used_at=now() where business_id=${business} and user_id=${user.id}`;
    });
    const body = await (await call(admin)).json() as { rows: Array<Record<string, string | null>> };
    const row = body.rows.find(item => item.email === 'visitor@example.com')!;
    expect(row).toMatchObject({ lastPushIssue: null });
    for (const key of ['onboardingCompletedAt','computerReadyAt','installedAppOpenedAt','pushEnabledAt','lastPushAcceptedAt','firstCompletedRequest','firstReminderScheduledAt','firstReminderDeliveredAt','firstReminderPushAcceptedAt']) {
      expect(row[key], key).not.toBeNull();
    }
    expect(JSON.stringify(body)).not.toContain('Private reminder');
    expect(JSON.stringify(body)).not.toContain('Private title');
  });
});
