#!/usr/bin/env node
// Bounded launch canary: temporary fictional identity, no email, checkout,
// business provisioning or provider execution. Credentials stay in memory.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import postgres from 'postgres';

let sql;
let created = false;
const userId = randomUUID();
const email = `launch-preview-${userId}@example.invalid`;
const token = randomBytes(32).toString('base64url');
const sessionId = createHash('sha256').update(token).digest('hex');
let phase = 'connection';
try {
  const connection = execFileSync('neon', ['connection-string', 'production',
    '--project-id', 'red-haze-10375483', '--role-name', 'neondb_owner',
    '--database-name', 'neondb', '--pooled', '--no-color'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const target = new URL(connection);
  assert.equal(target.hostname, 'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech');
  assert.equal(target.pathname, '/neondb');
  assert.equal(target.username, 'neondb_owner');
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol) && target.password);
  sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
  const get = async (path, authenticated = true) => {
    const response = await fetch(`https://api.jentera.ai${path}`, {
      headers: { Origin: 'https://jentera.ai', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    return response.json();
  };
  phase = 'anonymous-access';
  const anonymous = await get('/api/access', false);
  assert.equal(anonymous.signedIn, false);
  assert.equal(anonymous.access, null);
  assert.equal(anonymous.founderGroup, null);
  assert.equal(anonymous.billing.checkoutEnabled, true);
  phase = 'fixture';
  await sql.begin(async tx => {
    await tx`insert into app_user(id,email,name,email_verified) values(${userId},${email},'Fictional launch canary',true)`;
    await tx`insert into session(id,user_id,expires_at) values(${sessionId},${userId},now()+interval '5 minutes')`;
  });
  created = true;
  phase = 'verified-preview';
  const fresh = await get('/api/access');
  assert.equal(fresh.signedIn, true);
  assert.equal(fresh.access.allowed, true);
  assert.equal(fresh.access.kind, 'preview');
  assert.deepEqual(fresh.access.preview, { limit: 10, used: 0, remaining: 10 });
  assert.equal(fresh.founderGroup, null);
  const billing = await get('/api/billing/status');
  assert.deepEqual(billing.preview, fresh.access.preview);
  assert.equal(billing.checkoutEnabled, true);
  assert.equal(billing.mode, 'live');
  assert.deepEqual(billing.offer, { initialMonthlyAmount: 99, introductoryMonths: 3, renewalMonthlyAmount: 199, currency: 'MYR' });
  phase = 'exhausted-read-access';
  // No AI requests are executed; exercise the live read gate at the quota boundary.
  await sql`update chat_preview_account set requests_used=10 where user_id=${userId}`;
  const exhausted = await get('/api/access');
  assert.equal(exhausted.access.allowed, true);
  assert.equal(exhausted.access.kind, 'preview');
  assert.deepEqual(exhausted.access.preview, { limit: 10, used: 10, remaining: 0 });
  assert.deepEqual((await get('/api/billing/status')).preview, exhausted.access.preview);
  assert.equal(exhausted.founderGroup, null);
  phase = 'unverified-denial';
  await sql`update app_user set email_verified=false where id=${userId} and email=${email}`;
  const unverified = await get('/api/access');
  assert.equal(unverified.signedIn, false);
  assert.equal(unverified.access, null);
  phase = 'stripe-readiness';
  const key = process.env.AISAR_SUPPORT_KEY?.trim()
    || await readFile(`${homedir()}/.config/jentera/support-key`, 'utf8').then(value => value.trim());
  assert.ok(key);
  const response = await fetch('https://api.jentera.ai/api/support/billing-readiness', {
    headers: { Authorization: `Bearer ${key}`, Origin: 'https://jentera.ai' },
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200);
  const readiness = await response.json();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.checkoutEnabled, true);
  assert.ok(Object.values(readiness.checks).every(value => value === true));
  assert.deepEqual(readiness.failures, []);
  console.log(JSON.stringify({ ok: true, verifiedPreview: true, exhaustedReadAccess: true,
    unverifiedDenied: true, paidInvitePrivate: true, liveCheckoutReady: true,
    agentRequestsExecuted: 0, paymentsCreated: 0 }));
} catch {
  console.error(`[chat-preview] live canary failed at ${phase}; credentials and provider payloads withheld`);
  process.exitCode = 1;
} finally {
  if (sql) {
    if (created) {
      try {
        await sql.begin(async tx => {
          // Exact newly created fixture only; never customer identities or runs.
          const [fixture] = await tx`select id from app_user where id=${userId} and email=${email}`;
          assert.ok(fixture);
          await tx`delete from session where id=${sessionId} and user_id=${userId}`;
          await tx`delete from chat_preview_account where user_id=${userId}`;
          await tx`delete from app_user where id=${userId} and email=${email}`;
        });
        console.log(JSON.stringify({ canaryFixtureRemoved: true }));
      } catch {
        console.error('[chat-preview] exact canary cleanup failed; no broad deletion attempted');
        process.exitCode = 1;
      }
    }
    await sql.end({ timeout: 5 });
  }
}
