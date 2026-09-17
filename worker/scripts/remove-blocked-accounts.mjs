#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { offboardAccounts } from './offboard-accounts.mjs';
import { writeRecoveryBackup } from './offboarding-backup.mjs';

// No hard-coded customer targets or secret URLs in source/command arguments.
// Explicit invocation: --apply UUID=email [UUID=email ...]. Exact identities,
// dependency review and verified recovery are required before any deletion.
const [mode, ...arguments_] = process.argv.slice(2);
if (mode !== '--apply' || arguments_.length === 0 || arguments_.some(value => !value.includes('='))) {
  console.error('Usage: node scripts/remove-blocked-accounts.mjs --apply UUID=email [UUID=email ...]');
  process.exit(1);
}
const targets = arguments_.map(value => ({ id: value.slice(0, value.indexOf('=')), email: value.slice(value.indexOf('=') + 1) }));
let sql;
try {
  const connection = (await readFile(join(homedir(), '.config/neon/owner-url'), 'utf8')).trim();
  const target = new URL(connection);
  const hosts = new Set(['ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech',
    'ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech']);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !hosts.has(target.hostname)
    || target.pathname !== '/neondb' || target.username !== 'neondb_owner' || !target.password) {
    throw new Error('Database does not match the reviewed production owner target');
  }
  sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require', onnotice: () => {} });
  // Empty operator-only guards can be safely installed ahead of the atomic
  // block + deletion. Reapplying the migration never removes existing blocks.
  await sql.begin(async tx => {
    await tx`set local lock_timeout='5s'`;
    await tx`set local statement_timeout='20s'`;
    await tx.unsafe(await readFile(new URL('../migrations/058_account_blocks.sql', import.meta.url), 'utf8'));
    const [guard] = await tx`select count(*)::int as count from pg_trigger where tgname='guard_blocked_account'
      and tgenabled='O' and tgrelid in ('public.app_user'::regclass,'public.session'::regclass,
      'public.login_token'::regclass,'public.oauth_identity'::regclass)`;
    if (guard.count !== 4) throw new Error('Account guard verification failed');
  });
  const recoveryDir = join(homedir(), '.config/jentera/offboarding-backups');
  const result = await offboardAccounts(sql, targets, snapshot => writeRecoveryBackup(snapshot, recoveryDir));
  console.log(JSON.stringify({ ok: true, migration: '058_account_blocks.sql', ...result }));
} catch {
  // PostgreSQL exceptions may include record values. Do not log raw errors.
  console.error('[account-removal] aborted; inspect with a private operator session, not public logs');
  process.exitCode = 1;
} finally { if (sql) await sql.end({ timeout: 5 }); }
