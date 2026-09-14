/** Operator-only. Never expose the database credential or this script in the app. */
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import postgres from 'postgres';

const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
const target = new URL(connection);
if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
    target.hostname !== 'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech' ||
    target.pathname !== '/neondb' || target.username !== 'neondb_owner' || !target.password) {
  throw new Error('Connection does not match the reviewed production owner target');
}
const [command, address, until, reference] = process.argv.slice(2);
const email = address?.trim().toLowerCase();
const sharedClaims = command === 'invite-link' ? Number(address) : null;
if (!['migrate', 'invite', 'invite-link', 'grant-paid', 'revoke', 'list-waitlist'].includes(command)) throw new Error('Use migrate | invite EMAIL | invite-link MAX_CLAIMS | grant-paid EMAIL UNTIL_ISO PAYMENT_REFERENCE | revoke EMAIL | list-waitlist');
if (['invite', 'grant-paid', 'revoke'].includes(command) && (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('A valid email is required');
if (command === 'invite-link' && (!Number.isInteger(sharedClaims) || sharedClaims < 1 || sharedClaims > 100)) throw new Error('MAX_CLAIMS must be an integer from 1 to 100');
if (command === 'grant-paid' && (!until || !Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.now() || !reference)) throw new Error('A future paid-through date and verified payment reference are required');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  if (command === 'migrate') {
    const migrations = await Promise.all(['041_access_gate.sql', '042_shared_trial_invites.sql']
      .map(file => readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')));
    await sql.begin(async tx => {
      for (const migration of migrations) await tx.unsafe(migration);
      const [result] = await tx`select has_table_privilege('aisar_app', 'platform_access', 'select,insert,update') and has_table_privilege('aisar_app', 'trial_invite', 'select,update') and has_table_privilege('aisar_app', 'trial_redemption', 'select,insert') and has_table_privilege('aisar_app', 'waitlist_entry', 'select,insert') as ok`;
      if (!result.ok) throw new Error('Access migration permission check failed');
    });
    console.log('Access migrations applied and verified. Access policy is not enabled by migration.');
  } else if (command === 'invite') {
    const code = randomBytes(24).toString('base64url');
    const hash = createHash('sha256').update(code).digest('hex');
    await sql`insert into trial_invite (token_hash, email, expires_at) values (${hash}, ${email}, now() + interval '7 days')`;
    console.log(JSON.stringify({ email, code, redeemWithinDays: 7, trialHoursAfterRedemption: 72 }));
  } else if (command === 'invite-link') {
    const code = randomBytes(24).toString('base64url');
    const hash = createHash('sha256').update(code).digest('hex');
    await sql`insert into trial_invite (token_hash, email, expires_at, max_claims)
      values (${hash}, null, now() + interval '7 days', ${sharedClaims})`;
    console.log(JSON.stringify({
      url: `https://jentera.ai/access?invite=1#code=${code}`,
      maxClaims: sharedClaims,
      redeemWithinDays: 7,
      trialHoursAfterRedemption: 72,
    }));
  } else if (command === 'grant-paid') {
    await sql`insert into platform_access (email, kind, expires_at, note) values (${email}, 'paid', ${new Date(until).toISOString()}, ${reference})
      on conflict (email) do update set kind = 'paid', expires_at = excluded.expires_at, revoked_at = null, note = excluded.note`;
    console.log('Paid access recorded. Business plan and payment processing are unchanged.');
  } else if (command === 'revoke') {
    await sql`insert into platform_access (email, kind, revoked_at, note) values (${email}, 'paid', now(), 'Operator revocation')
      on conflict (email) do update set revoked_at = now()`;
    console.log('Access revoked. Accounts and data were not deleted. The owner exception cannot be revoked here.');
  } else console.log(JSON.stringify(await sql`select email, created_at from waitlist_entry order by created_at`));
} finally { await sql.end({ timeout: 5 }); }
