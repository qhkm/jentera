/* ============================================================
   A real Postgres, in Docker, for the duration of a test run.

   Not a mock and not a shared cloud database. Every bug that reached
   production in this Worker — the RLS bootstrap failure, the jsonb
   double-encoding, the Hyperdrive cache — was invisible to anything
   short of a real INSERT executed by the real role against the real
   schema. A fake would have agreed with the code and stayed silent.

   Two connections are handed out, and the difference is the point:

     owner — migrations and fixtures. Bypasses RLS, as the production
             owner does.
     app   — what the Worker actually uses. Subject to every policy.

   A test that sets up fixtures as `app` will fail confusingly; one
   that asserts as `owner` will pass while production leaks. Use
   `owner` to arrange and `app` to assert.
   ============================================================ */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const CONTAINER = 'aisar-test-pg';
const PORT = 55432;
const APP_PASSWORD = 'test-only-not-a-secret';
const MIGRATIONS = new URL('../migrations', import.meta.url).pathname;

function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function quiet(cmd: string, args: string[]): void {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
  } catch {
    /* Removing a container that is not there is success, not failure. */
  }
}

/** Start the container and apply every migration in order. */
export async function startDatabase(): Promise<void> {
  quiet('docker', ['rm', '-f', CONTAINER]);

  sh('docker', [
    'run', '-d', '--name', CONTAINER,
    '-e', 'POSTGRES_PASSWORD=owner',
    '-e', 'POSTGRES_USER=owner',
    '-e', 'POSTGRES_DB=aisar_test',
    '-p', `${PORT}:5432`,
    // tmpfs and fsync=off: this database is thrown away in seconds, so
    // durability is pure cost.
    '--tmpfs', '/var/lib/postgresql/data',
    'postgres:16-alpine',
    '-c', 'fsync=off', '-c', 'full_page_writes=off',
  ]);

  await waitReady();

  /* citext is used by app_user.email and is not installed by default. */
  await asOwner(async (sql) => {
    await sql`create extension if not exists citext`;
  });

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const body = readFileSync(join(MIGRATIONS, file), 'utf8')
      /* 000_role.sql is written for psql, which owns \set and :'var'.
         Substituting here keeps one file serving both callers rather
         than letting the test schema drift from the real one. */
      .replace(/^\\set .*$/gm, '')
      .replace(/:'app_password'/g, `'${APP_PASSWORD}'`);
    await asOwner(async (sql) => {
      await sql.unsafe(body);
    });
  }
}

export function stopDatabase(): void {
  quiet('docker', ['rm', '-f', CONTAINER]);
}

async function waitReady(): Promise<void> {
  const deadline = Date.now() + 60_000;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const sql = connect('owner', 'owner');
      await sql`select 1`;
      await sql.end();
      return;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`Postgres never became ready: ${String(last)}`);
}

function connect(user: string, password: string) {
  return postgres({
    host: '127.0.0.1',
    port: PORT,
    database: 'aisar_test',
    username: user,
    password,
    max: 2,
    // Matches the Worker, where type introspection is a wasted round
    // trip — and is the setting under which the jsonb bug appeared.
    fetch_types: false,
    onnotice: () => {},
  });
}

/** Superuser-ish. Arrange fixtures here; never assert tenancy here. */
export async function asOwner<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = connect('owner', 'owner');
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Exactly what the Worker gets. Assert here. */
export async function asApp<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = connect('aisar_app', APP_PASSWORD);
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * The production `withTenant`, reproduced.
 *
 * Deliberately a copy rather than an import: src/db.ts takes an Env
 * with a Hyperdrive binding that does not exist outside workerd. What
 * matters is that the shape is identical — a transaction, a
 * transaction-local set_config, and no other way to set it.
 */
export async function asTenant<T>(
  businessId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return asApp(async (sql) => {
    const out = await sql.begin(async (tx) => {
      await tx`select set_config('app.business_id', ${businessId}, true)`;
      return fn(tx);
    });
    return out as T;
  });
}

/** Empty every table, owner-side, between tests. */
export async function truncateAll(): Promise<void> {
  await asOwner(async (sql) => {
    await sql.unsafe(`
      truncate approval, action_policy, work_done, learn, membership,
               oauth_identity, session, login_token, auth_attempt, business, app_user
      restart identity cascade`);
  });
}
