#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { offboardAccounts } from './offboard-accounts.mjs';
import { writeRecoveryBackup } from './offboarding-backup.mjs';

// Operator-only: reviewed exact identities, not a public trial-quota reset.
// This does not remove existing bans, paid accounts, or customer workspaces.
const [mode, ...arguments_] = process.argv.slice(2);
if (mode !== '--apply' || arguments_.length === 0 || arguments_.some(value => !value.includes('='))) {
  console.error('Usage: node scripts/reset-test-accounts.mjs --apply UUID=email [UUID=email ...]');
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
  const result = await offboardAccounts(sql, targets,
    snapshot => writeRecoveryBackup(snapshot, join(homedir(), '.config/jentera/offboarding-backups')),
    { mode: 'reset-for-testing' });
  console.log(JSON.stringify({ ok: true, ...result }));
} catch {
  console.error('[test-account-reset] aborted; identities, dependencies or billing require private operator review');
  process.exitCode = 1;
} finally { if (sql) await sql.end({ timeout: 5 }); }
