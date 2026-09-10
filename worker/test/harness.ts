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
import { vi } from 'vitest';

/* One container and one port per vitest run, not one per machine.

   Both used to be fixed, and `startDatabase` opens with `docker rm -f`.
   A second run therefore destroyed the first run's database mid-test:
   296 failures in one sitting, none of them a real defect, including
   password-hashing tests that never touch Postgres. The pid makes the
   name unique and Docker picks the port, so two runs cannot collide
   and neither has to guess which high port is free.

   Both travel by environment variable because `globalSetup` runs in
   Vitest's own process and the tests run in workers: a module-level
   `let` assigned during setup is simply not the same variable the
   tests would read. */
const CONTAINER = process.env.AISAR_TEST_PG_CONTAINER ?? `aisar-test-pg-${process.pid}`;

function port(): number {
  const value = Number(process.env.AISAR_TEST_PG_PORT ?? 0);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('startDatabase() has not run: there is no test database to connect to');
  }
  return value;
}
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
  process.env.AISAR_TEST_PG_CONTAINER = CONTAINER;
  reapAbandoned();
  quiet('docker', ['rm', '-f', CONTAINER]);

  sh('docker', [
    'run', '-d', '--name', CONTAINER,
    '-e', 'POSTGRES_PASSWORD=owner',
    '-e', 'POSTGRES_USER=owner',
    '-e', 'POSTGRES_DB=aisar_test',
    /* An empty host port means "whatever is free" — asked for below. */
    '-p', '127.0.0.1::5432',
    // tmpfs and fsync=off: this database is thrown away in seconds, so
    // durability is pure cost.
    '--tmpfs', '/var/lib/postgresql/data',
    'postgres:16-alpine',
    '-c', 'fsync=off', '-c', 'full_page_writes=off',
  ]);

  process.env.AISAR_TEST_PG_PORT = String(publishedPort());

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
  delete process.env.AISAR_TEST_PG_PORT;
  delete process.env.AISAR_TEST_PG_CONTAINER;
}

/**
 * Remove test containers whose run is over.
 *
 * A per-run name means a crashed run leaks its container rather than
 * having the next run stomp it — so something has to collect them, and
 * the owning pid says exactly which are safe: a container named for a
 * process that no longer exists cannot be in use. A live run is never
 * touched, which is the whole point of the rename.
 */
function reapAbandoned(): void {
  let names: string[];
  try {
    names = sh('docker', ['ps', '-a', '--filter', 'name=aisar-test-pg', '--format', '{{.Names}}'])
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean);
  } catch {
    return; /* No Docker yet: the run below will say so far more clearly. */
  }
  for (const name of names) {
    if (name === CONTAINER) continue;
    /* The legacy fixed name predates per-run containers and owns no pid. */
    if (name === 'aisar-test-pg') {
      quiet('docker', ['rm', '-f', name]);
      continue;
    }
    /* Docker's name filter matches substrings, so re-check the prefix. */
    if (!name.startsWith('aisar-test-pg-')) continue;
    const pid = Number(name.slice('aisar-test-pg-'.length));
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      process.kill(pid, 0);
    } catch (e) {
      /* Only ESRCH means "no such process". EPERM means it is alive and
         owned by someone else — the one case where removing the container
         would break a run that is still using it. */
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
        quiet('docker', ['rm', '-f', name]);
      }
    }
  }
}

/** The host port Docker chose for 5432. */
function publishedPort(): number {
  const mapping = sh('docker', ['port', CONTAINER, '5432/tcp']).trim().split('\n')[0];
  const port = Number(mapping.slice(mapping.lastIndexOf(':') + 1));
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Could not read the test database port from: ${mapping}`);
  }
  return port;
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
    /* Read per call, not once at import: the port is only known after
       the container starts, and postgres() connects lazily anyway. */
    port: port(),
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
      truncate routine_change, routine_occurrence, routine, runtime_task_outbox, runtime_usage, runtime_budget, runtime_task, agent_runtime, credential, connection, run_event, run, work_record, business_fact, approval, action_policy, work_done, learn, membership,
               oauth_identity, session, login_token, auth_attempt, business, app_user, fmcv_rider_spend, model_call
      restart identity cascade`);
  });
}

/**
 * An Env the real control-plane code will accept.
 *
 * `withTenant` only needs a connection string, so pointing Hyperdrive
 * at the test container makes the genuine transaction-and-RLS path
 * run — no fake, no in-memory stand-in. Only the model and the
 * outbound HTTP are substituted, because those are the two things
 * that leave the machine.
 */
export function testEnv(over: Partial<Record<string, unknown>> = {}): import('../src/env').Env {
  return {
    HYPERDRIVE: {
      /* Tests that never touch Postgres also call this, so an absent
         database is a connection string that fails on use, not here. */
      connectionString:
        `postgres://aisar_app:${APP_PASSWORD}@127.0.0.1:${process.env.AISAR_TEST_PG_PORT ?? 0}/aisar_test`,
    },
    ALLOWED_ORIGINS: 'http://localhost:5173',
    APP_ORIGIN: 'http://localhost:5173',
    API_ORIGIN: 'http://localhost:8787',
    CREDENTIAL_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(5))),
    RESEND_API_KEY: '',
    AI: { run: async () => ({ response: 'A drafted reply.' }) },
    AUTH_BURST: { limit: async () => ({ success: true }) },
    API_BURST: { limit: async () => ({ success: true }) },
    RUNTIME_MUTATION_BURST: { limit: async () => ({ success: true }) },
    AGENT_RUN_BURST: { limit: async () => ({ success: true }) },
    RUN_STREAM_BURST: { limit: async () => ({ success: true }) },
    RUNTIME_CONFIG_BURST: { limit: async () => ({ success: true }) },
    ...over,
  } as unknown as import('../src/env').Env;
}

/**
 * A session cookie for a real user, minted the way the Worker mints
 * one: random token, SHA-256 stored.
 *
 * Route tests go through resolveTenant like every real request, rather
 * than being handed an identity. Auth gating and tenant scoping are
 * route behaviour, and a test that skipped them would not be testing
 * the route.
 */
export async function signIn(userId: string): Promise<string> {
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  await asOwner(
    (sql) => sql`insert into session (id, user_id, expires_at)
                 values (${hash}, ${userId}, now() + interval '1 hour')`,
  );
  return `aisar_session=${token}`;
}

/** A request shaped like one the frontend sends. */
export function req(
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown } = {},
): { request: Request; url: URL } {
  const url = new URL(`https://api.test${path}`);
  const request = new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
    },
    /* GET and HEAD cannot carry one, and a caller passing a body with
       a GET is describing a request the browser could not make. */
    body:
      opts.body === undefined || method === 'GET' || method === 'HEAD'
        ? undefined
        : JSON.stringify(opts.body),
  });
  return { request, url };
}

/* ------------------------------------------------------------
   Stand-ins for the two collaborators tests fake most: an outbound
   `fetch` and a queue `send`.

   Both are declared with the signature of the real thing. That is not
   ceremony: `vi.fn(async () => ...)` types its call tuple as `[]`, so
   every later `mock.calls[0][1]` reads as `never` and every assertion
   about what the code *sent* silently checks nothing. That was most of
   the eighty-four errors the first typecheck of `test/` turned up.
   ------------------------------------------------------------ */

/** A fake `fetch`, typed so `mock.calls` carries `[input, init]`. */
export function fetchFake(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
) {
  return vi.fn(impl);
}

/** A fake queue producer, typed so `mock.calls` carries `[message]`. */
export function sendFake<T = unknown>(
  impl: (message: T) => Promise<void> = async () => {},
) {
  return vi.fn(impl);
}

/**
 * The body of a response, as the shape the test already expects.
 *
 * `Response.json()` is `unknown` under workers-types — correctly, since
 * nothing has validated the bytes. A test knows what it asked for, so it
 * says so here rather than scattering casts down the assertion.
 */
export async function jsonOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
