import { beforeEach, expect, it, vi } from 'vitest';
import { asApp, asOwner, testEnv, truncateAll } from './harness';
import { accessForEmail } from '../src/access';
import { authLandingPath, consumeLoginToken, issueLoginToken, signInWithGoogle, signUpWithPassword, verifySession } from '../src/auth';
// @ts-expect-error Operator tooling is JavaScript, tested against real Postgres.
import { offboardAccounts } from '../scripts/offboard-accounts.mjs';

const env = testEnv();
const blocked = 'blocked@example.com';
beforeEach(truncateAll);
async function block(email = blocked) {
  await asOwner(sql => sql`insert into account_block(email) values(public.canonical_account_email(${email}))`);
}

it('normalizes Gmail aliases without blocking another mailbox or an entire company domain', async () => {
  await block('b.locked+test@googlemail.com');
  for (const email of ['blocked@gmail.com', 'B.L.O.C.K.E.D+other@gmail.com', 'blocked@googlemail.com']) {
    expect(await issueLoginToken(env, email)).toEqual({ token: null });
    expect(await signUpWithPassword(env, email, 'test-hash')).toBe('exists');
  }
  expect((await issueLoginToken(env, 'other@gmail.com')).token).not.toBeNull();
  await block('blocked@company.test');
  expect((await issueLoginToken(env, 'other@company.test')).token).not.toBeNull();
});

it('blocks password, magic link and Google registration without making an account/session', async () => {
  const { token } = await issueLoginToken(env, blocked);
  await block();
  expect(await issueLoginToken(env, blocked)).toEqual({ token: null });
  expect(await consumeLoginToken(env, token!)).toBeNull();
  expect(await signUpWithPassword(env, blocked, 'test-hash')).toBe('exists');
  await expect(signInWithGoogle(env, { subject: 'blocked-google-subject', email: blocked, name: 'Blocked' }))
    .rejects.toMatchObject({ code: '42501', message: 'Account unavailable' });
  await asOwner(async sql => {
    expect((await sql`select * from app_user`)).toHaveLength(0);
    expect((await sql`select * from session`)).toHaveLength(0);
  });
});

it('blocks the same Google identity after an email change and rolls back the new verified user', async () => {
  await asOwner(sql => sql`insert into account_identity_block(provider,subject) values('google','blocked-subject')`);
  await expect(signInWithGoogle(env, { subject: 'blocked-subject', email: 'changed@example.com', name: null }))
    .rejects.toMatchObject({ code: '42501' });
  await asOwner(async sql => { expect((await sql`select * from app_user`)).toHaveLength(0); });
});

it('protects denial records from the application role', async () => {
  await block();
  await expect(asApp(sql => sql`delete from account_block`)).rejects.toMatchObject({ code: '42501' });
  await expect(asApp(sql => sql`delete from account_identity_block`)).rejects.toMatchObject({ code: '42501' });
  await expect(asApp(sql => sql`select * from account_block`)).rejects.toMatchObject({ code: '42501' });
});

it('prevents inserting or changing to a blocked email even when bypassing auth helpers', async () => {
  await block();
  await expect(asApp(sql => sql`insert into app_user(email) values(${blocked})`)).rejects.toMatchObject({ code: '42501' });
  const [user] = await asApp(sql => sql`insert into app_user(email) values('allowed@example.com') returning id`);
  await expect(asApp(sql => sql`update app_user set email=${blocked} where id=${user.id}`)).rejects.toMatchObject({ code: '42501' });
});

it('requires an exact target and verified backup, then removes auth while preserving business results', async () => {
  const session = await signInWithGoogle(env, { subject: 'removal-subject', email: 'remove@example.com', name: 'Remove' });
  const targets = [{ id: session.userId, email: session.email }];
  const businessId = '11111111-1111-4111-8111-111111111111';
  await asOwner(async sql => {
    await sql`insert into business(id,name,playbook_key) values(${businessId},'Preserved business','generic')`;
    await sql`insert into membership(user_id,business_id,role) values(${session.userId},${businessId},'owner')`;
    await sql`insert into business_fact(business_id,key,value,source,confirmed_by)
      values(${businessId},'name','"Preserved business"'::jsonb,'owner',${session.userId})`;
    await sql`insert into run(business_id,kind,status,trigger_shape,runtime,requested_by)
      values(${businessId},'task','completed','chat','test',${session.userId})`;
    await sql`insert into chat_preview_account(user_id,requests_used) values(${session.userId},1)`;
    await sql`insert into chat_preview_request(user_id,request_id,business_id)
      values(${session.userId},gen_random_uuid(),${businessId})`;
  });
  const backup = vi.fn(async () => ({ verified: true, path: 'encrypted-test-backup' }));
  await expect(asOwner(sql => offboardAccounts(sql, [{ ...targets[0], email: 'wrong@example.com' }], backup))).rejects.toThrow('Target identity changed');
  expect(backup).not.toHaveBeenCalled();
  await expect(asOwner(sql => offboardAccounts(sql, targets, async () => ({ verified: false })))).rejects.toThrow('Backup must be verified');
  const result = await asOwner(sql => offboardAccounts(sql, targets, backup));
  expect(result).toMatchObject({ removed: 1, revokedSessions: 1, blockedIdentities: 1,
    removedPreviewLedgers: 1, preservedFacts: 1, preservedRuns: 1 });
  expect(backup).toHaveBeenCalledOnce();
  expect(await issueLoginToken(env, session.email)).toEqual({ token: null });
  await expect(signInWithGoogle(env, { subject: 'removal-subject', email: 'different@example.com', name: null })).rejects.toMatchObject({ code: '42501' });
  await asOwner(async sql => {
    expect((await sql`select * from app_user`)).toHaveLength(0);
    expect((await sql`select * from oauth_identity`)).toHaveLength(0);
    expect((await sql`select * from session`)).toHaveLength(0);
    expect((await sql`select * from membership`)).toHaveLength(0);
    expect((await sql`select * from chat_preview_account`)).toHaveLength(0);
    expect((await sql`select * from chat_preview_request`)).toHaveLength(0);
    expect((await sql`select id from business where id=${businessId}`)).toHaveLength(1);
    expect((await sql`select confirmed_by from business_fact`)).toMatchObject([{ confirmed_by: null }]);
    expect((await sql`select requested_by,status from run`)).toMatchObject([{ requested_by: null, status: 'completed' }]);
  });
});

async function resetFixture() {
  const session = await signInWithGoogle(env, { subject: 'reset-subject', email: 'reset@example.com', name: 'Reset' });
  const businessId = '22222222-2222-4222-8222-222222222222';
  await asOwner(async sql => {
    await sql`insert into business(id,name,playbook_key) values(${businessId},'Private reset fixture','generic')`;
    await sql`insert into membership(user_id,business_id,role) values(${session.userId},${businessId},'owner')`;
  });
  return { session, businessId, targets: [{ id: session.userId, email: session.email }] };
}

it('explicit test reset permits fresh verified signup without reusing old workspace, results or quota', async () => {
  const { session, businessId, targets } = await resetFixture();
  const chatId = '33333333-3333-4333-8333-333333333333';
  await asOwner(async sql => {
    await sql`insert into platform_access(email,kind,note) values(${session.email},'paid','Internal test allowlist, not a payment')`;
    await sql`insert into chat_preview_account(user_id,requests_used) values(${session.userId},10)`;
    await sql`insert into chat_session(id,business_id,created_by) values(${chatId},${businessId},${session.userId})`;
    await sql`insert into run(business_id,kind,status,trigger_shape,runtime,requested_by,session_id)
      values(${businessId},'task','completed','chat','test',${session.userId},${chatId})`;
    await sql`insert into connection(business_id,connector,method,status,connected_by)
      values(${businessId},'google_calendar','oauth','connected',${session.userId})`;
  });
  const backup = vi.fn(async (_snapshot: unknown) => ({ verified: true, path: 'encrypted-test-backup' }));
  const result = await asOwner(sql => offboardAccounts(sql, targets, backup, { mode: 'reset-for-testing' }));
  expect(result).toMatchObject({ removed: 1, registrationBlocked: false, blockedIdentities: 0, disconnectedConnections: 1 });
  expect(backup.mock.calls[0][0]).toMatchObject({ chats: [{ id: chatId }], chatRuns: [{ session_id: chatId }], connections: [{ status: 'connected' }] });
  expect(await verifySession(env, session.token)).toBeNull();
  const fresh = await signInWithGoogle(env, { subject: 'reset-subject', email: session.email, name: 'Reset' });
  expect(fresh.created).toBe(true);
  expect(fresh.userId).not.toBe(session.userId);
  expect(await authLandingPath(env, fresh.userId)).toBe('/onboard');
  expect((await issueLoginToken(env, session.email)).token).not.toBeNull();
  await asOwner(async sql => {
    expect((await sql`select id from business where id=${businessId}`)).toHaveLength(1);
    expect((await sql`select requested_by,session_id,status from run where business_id=${businessId}`))
      .toMatchObject([{ requested_by: null, session_id: null, status: 'completed' }]);
    expect((await sql`select connected_by,status from connection where business_id=${businessId}`))
      .toMatchObject([{ connected_by: null, status: 'revoked' }]);
    expect((await sql`select * from membership where user_id=${fresh.userId}`)).toHaveLength(0);
    expect((await sql`select * from chat_preview_account where user_id=${fresh.userId}`)).toHaveLength(0);
    expect((await sql`select * from account_block`)).toHaveLength(0);
    expect((await sql`select * from account_identity_block`)).toHaveLength(0);
    expect((await sql`select * from platform_access where email=${session.email}`)).toHaveLength(0);
  });
  expect(await accessForEmail({ ...env, ACCESS_MODE: 'waitlist', CHAT_PREVIEW_ENABLED: 'true' }, session.email))
    .toMatchObject({ allowed: true, kind: 'preview', preview: { used: 0, remaining: 10 } });
});

it('test reset refuses a Stripe-linked workspace and does not change identity or billing evidence', async () => {
  const { session, businessId, targets } = await resetFixture();
  await asOwner(sql => sql`update business set stripe_customer_id='cus_real' where id=${businessId}`);
  const backup = vi.fn(async () => ({ verified: true }));
  await expect(asOwner(sql => offboardAccounts(sql, targets, backup, { mode: 'reset-for-testing' })))
    .rejects.toThrow('billing offboarding review');
  expect(backup).not.toHaveBeenCalled();
  expect(await verifySession(env, session.token)).not.toBeNull();
});

it('test reset never clears an existing registration or identity block', async () => {
  const { session, targets } = await resetFixture();
  await block(session.email);
  const backup = vi.fn(async () => ({ verified: true }));
  await expect(asOwner(sql => offboardAccounts(sql, targets, backup, { mode: 'reset-for-testing' })))
    .rejects.toThrow('Existing account block');
  expect(backup).not.toHaveBeenCalled();
  await asOwner(async sql => {
    expect((await sql`select * from app_user where id=${session.userId}`)).toHaveLength(1);
    await sql`delete from account_block`;
    await sql`insert into account_identity_block(provider,subject) values('google','reset-subject')`;
  });
  await expect(asOwner(sql => offboardAccounts(sql, targets, backup, { mode: 'reset-for-testing' })))
    .rejects.toThrow('Existing identity block');
});

it('test reset rolls back when backup verification fails and denies application-role quota resets', async () => {
  const { session, targets } = await resetFixture();
  await expect(asOwner(sql => offboardAccounts(sql, targets, async () => ({ verified: false }), { mode: 'reset-for-testing' })))
    .rejects.toThrow('Backup must be verified');
  expect(await verifySession(env, session.token)).not.toBeNull();
  await expect(asApp(sql => offboardAccounts(sql, targets, async () => ({ verified: true }), { mode: 'reset-for-testing' })))
    .rejects.toThrow('Operator role required');
  await expect(asOwner(sql => offboardAccounts(sql, targets, async () => ({ verified: true }), { mode: 'allow' })))
    .rejects.toThrow('supported removal mode');
});
