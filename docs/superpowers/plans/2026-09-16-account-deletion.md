# Account Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person can delete their account from inside the app; access ends immediately and every trace — Postgres rows, R2 objects, the Fly sprite, connector registrations — is gone seven days later.

**Architecture:** Requesting deletion stamps `deleted_at`, revokes sessions, stops the sprite and writes an `account_deletion` record that deliberately sits **outside** the business cascade. Seven days later the minute cron purges in recorded, resumable stages — revoke connectors, delete R2 objects, destroy the sprite, delete the `business` row (which cascades ~20 tenant tables), delete the identity. The record outlives the data it describes, because the cascade erases the only index of what lives outside Postgres.

**Tech Stack:** Cloudflare Workers, Neon Postgres via Hyperdrive with forced RLS, postgres.js, R2, Fly Sprites, Resend, Vitest with a real Postgres container.

**Spec:** `docs/superpowers/specs/2026-09-16-account-deletion-design.md`

## Global Constraints

- Grace period is **7 days**, exactly. Name it once as `GRACE_DAYS = 7` in `src/account-deletion/store.ts`; no other file hard-codes it.
- Give-up threshold is **8 attempts**, matching `push_outbox`.
- Migrations are numbered sequentially and **049 is the last committed one** — this plan adds `050_account_deletion.sql` and nothing else. Verify with `ls worker/migrations | tail -1` before writing it; if 050 exists, use the next free number consistently everywhere in this plan.
- Every cross-tenant read is a `SECURITY DEFINER` function returning **ids only**; all row reads and writes happen inside `withTenant`.
- Tests **assert as `aisar_app`, arrange as `owner`** (`test/harness.ts`). A test that asserts as the owner passes while production leaks.
- Nothing is sent to an external service from inside a transaction.
- Worker tests need Docker running: `cd worker && pnpm test`.
- Typecheck is two passes and both matter: `cd worker && pnpm typecheck`.
- Commit subjects are Conventional Commits, one visible behaviour per commit.

---

## File Structure

**Created:**
- `worker/migrations/050_account_deletion.sql` — the `account_deletion` table, `deleted_at` columns, and the `account_deletion_due` scan function.
- `worker/src/account-deletion/store.ts` — every SQL statement this feature runs. One responsibility: reading and writing deletion state.
- `worker/src/account-deletion/request.ts` — classifying (owner vs staff), refusing, and the request transaction.
- `worker/src/account-deletion/purge.ts` — the staged sweep the cron calls.
- `worker/src/routes/account.ts` — `DELETE /api/me` and `GET /api/account/restore`.
- `worker/test/account-deletion-request.test.ts`
- `worker/test/account-deletion-purge.test.ts`
- `worker/test/account-deletion-lockout.test.ts`
- `worker/test/tenant-cascade.test.ts` — the catalog test plus the fixture registry.
- `app/src/components/DeleteAccount.tsx` — the settings entry, confirm screen and consequences.
- `app/src/components/__tests__/delete-account.test.tsx`

**Modified:**
- `worker/src/auth.ts` — `verifySession` and the door checks refuse a deleted account.
- `worker/src/routes/session.ts` — signup/login/Google refuse an address mid-deletion.
- `worker/src/index.ts` — route dispatch for `handleAccount`, and the purge on the minute cron.
- `worker/src/permissions.ts` — no new permission; a comment recording why deletion is not role-gated.
- `app/src/lib/repo/remote.ts` + `app/src/lib/repo/types.ts` — `requestAccountDeletion()`.
- `docs/todo.md`, `CLAUDE.md` — folded into the tasks that make them true.

---

### Task 1: Schema

**Files:**
- Create: `worker/migrations/050_account_deletion.sql`
- Test: `worker/test/account-deletion-request.test.ts` (first test only)

**Interfaces:**
- Consumes: nothing.
- Produces: table `account_deletion(id uuid, business_id uuid, user_id uuid, kind text, scheduled_for timestamptz, stage text, attempts int, next_attempt_at timestamptz, last_error text, artifact_keys text[], sprite_id text, connector_ids uuid[], cancel_token_id text, requested_at timestamptz, completed_at timestamptz)`; columns `business.deleted_at`, `app_user.deleted_at`; function `public.account_deletion_due(p_now timestamptz, p_limit integer) returns table (deletion_id uuid, business_id uuid)`.

- [ ] **Step 1: Write the failing test**

```ts
// worker/test/account-deletion-request.test.ts
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { startDatabase, stopDatabase, appSql, ownerSql } from './harness';

beforeAll(startDatabase);
afterAll(stopDatabase);

describe('account_deletion schema', () => {
  it('survives the business cascade it describes', async () => {
    const owner = ownerSql();
    const [business] = await owner`
      insert into business (name) values ('Cascade Test') returning id`;
    const [user] = await owner`
      insert into app_user (email, email_verified) values ('cascade@example.com', true) returning id`;
    await owner`
      insert into account_deletion (business_id, user_id, email, kind, scheduled_for, sprite_id)
      values (${business.id}, ${user.id}, 'cascade@example.com', 'owner', now() + interval '7 days', 'sprite-1')`;

    await owner`delete from business where id = ${business.id}`;

    /* The whole point: the record outlives the data it describes, so the
       external cleanup still has the sprite id to work from. */
    const rows = await owner`select sprite_id, business_id from account_deletion where user_id = ${user.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].sprite_id).toBe('sprite-1');
    expect(rows[0].business_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd worker && pnpm vitest run test/account-deletion-request.test.ts`
Expected: FAIL — `relation "account_deletion" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- worker/migrations/050_account_deletion.sql
--
-- Deleting an account is the one operation that must survive its own
-- cascade. Every tenant table references business(id) on delete cascade, so
-- deleting the business row erases the tenant data in one statement — and
-- with it the only record of what lives outside Postgres: artifact rows name
-- the R2 keys, runtime names the Fly sprite, connection names the provider
-- registrations to revoke. Cleanup that ran after the cascade would have
-- nothing to work from, which is how you get orphaned objects and a live
-- machine holding someone's memory with no row pointing at it.
--
-- So this table is NOT a tenant table, its business_id is set null rather
-- than cascading, and the identifiers are copied into it before anything is
-- deleted. It is what the retries work from.
alter table business add column if not exists deleted_at timestamptz;
alter table app_user add column if not exists deleted_at timestamptz;

create table if not exists account_deletion (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid references business(id) on delete set null,
  user_id         uuid references app_user(id) on delete set null,
  email           text not null check (char_length(email) between 3 and 320),
  kind            text not null check (kind in ('owner', 'staff')),
  requested_at    timestamptz not null default now(),
  scheduled_for   timestamptz not null,
  stage           text not null default 'pending'
                  check (stage in ('pending', 'connectors', 'objects', 'sprite', 'tenant', 'identity', 'done', 'stalled')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text check (char_length(last_error) <= 300),
  artifact_keys   text[] not null default '{}',
  sprite_id       text check (char_length(sprite_id) <= 200),
  connector_ids   uuid[] not null default '{}',
  cancel_token_id text unique check (cancel_token_id ~ '^[0-9a-f]{64}$'),
  cancelled_at    timestamptz,
  completed_at    timestamptz
);

create index if not exists idx_account_deletion_due
  on account_deletion (next_attempt_at, id)
  where completed_at is null and cancelled_at is null;

-- No RLS: this table has no tenant once the cascade has run, and only the
-- cron and the account routes touch it. Reads are by id or by user.
grant select, insert, update, delete on account_deletion to aisar_app;

-- The cron has no tenant. Like push_outbox_due (031) and routine_due_targets
-- (022), this returns ids and nothing else.
create or replace function public.account_deletion_due(
  p_now timestamptz,
  p_limit integer default 50
)
returns table (deletion_id uuid, business_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select d.id, d.business_id
    from public.account_deletion as d
   where d.completed_at is null
     and d.cancelled_at is null
     and d.stage <> 'stalled'
     and d.scheduled_for <= p_now
     and d.next_attempt_at <= p_now
     and d.attempts < 8
   order by d.next_attempt_at, d.id
   limit greatest(1, least(p_limit, 200))
$$;

revoke all on function public.account_deletion_due(timestamptz, integer) from public;
grant execute on function public.account_deletion_due(timestamptz, integer) to aisar_app;
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd worker && pnpm vitest run test/account-deletion-request.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/migrations/050_account_deletion.sql worker/test/account-deletion-request.test.ts
git commit -m "feat: add the account deletion record

Not a tenant table, deliberately. Deleting the business row cascades every
tenant table and with it the only index of what lives outside Postgres, so
the identifiers are copied here first and business_id is set null rather
than cascading. This row is what the external cleanup retries from."
```

---

### Task 2: The lockout

**Files:**
- Modify: `worker/src/auth.ts` (`verifySession`, `verifyIdentitySession`)
- Modify: `worker/src/routes/session.ts` (signup, login, Google callback)
- Test: `worker/test/account-deletion-lockout.test.ts`

**Interfaces:**
- Consumes: `app_user.deleted_at` from Task 1.
- Produces: an `Identity` is never returned for a user with `deleted_at`; all three doors answer 409 with code `ACCOUNT_DELETING`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/test/account-deletion-lockout.test.ts
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { startDatabase, stopDatabase, ownerSql, testEnv, jsonOf } from './harness';
import { verifySession } from '../src/auth';
import { handleSession } from '../src/routes/session';

beforeAll(startDatabase);
afterAll(stopDatabase);

describe('an account being deleted', () => {
  it('cannot authenticate with a session that was valid a moment ago', async () => {
    const env = testEnv();
    const owner = ownerSql();
    const { token, userId } = await seedSignedInUser(owner, 'locked@example.com');

    expect(await verifySession(env, token)).not.toBeNull();
    await owner`update app_user set deleted_at = now() where id = ${userId}`;
    expect(await verifySession(env, token)).toBeNull();
  });

  it.each(['/api/auth/request', '/api/auth/signup', '/api/auth/login'])(
    'refuses %s for that address and names the way back',
    async (path) => {
      const env = testEnv();
      const owner = ownerSql();
      await seedDeletingUser(owner, 'locked2@example.com');

      const response = await handleSession(
        new Request(`https://api.jentera.ai${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'https://jentera.ai' },
          body: JSON.stringify({ email: 'locked2@example.com', password: 'hunter2hunter2' }),
        }),
        env,
        new URL(`https://api.jentera.ai${path}`),
        {},
      );

      expect(response!.status).toBe(409);
      const body = await jsonOf<{ code: string; err: string }>(response!);
      expect(body.code).toBe('ACCOUNT_DELETING');
      /* The password door otherwise refuses to say whether an address
         exists. This is the deliberate exception: whoever is typing is
         almost always the owner changing their mind, and saying nothing
         strands them for seven days. */
      expect(body.err).toMatch(/being deleted/i);
    },
  );
});
```

Add these helpers at the bottom of the same file:

```ts
async function seedSignedInUser(owner: ReturnType<typeof ownerSql>, email: string) {
  const [user] = await owner`
    insert into app_user (email, email_verified) values (${email}, true) returning id`;
  const token = 'tok-' + email;
  const id = await sha256Hex(token);
  await owner`
    insert into session (id, user_id, expires_at) values (${id}, ${user.id}, now() + interval '30 days')`;
  return { token, userId: user.id as string };
}

async function seedDeletingUser(owner: ReturnType<typeof ownerSql>, email: string) {
  const [user] = await owner`
    insert into app_user (email, email_verified, deleted_at) values (${email}, true, now()) returning id`;
  return user.id as string;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd worker && pnpm vitest run test/account-deletion-lockout.test.ts`
Expected: FAIL — `verifySession` still returns an identity, and each door answers 200/202.

- [ ] **Step 3: Refuse in `verifyIdentitySession`**

In `worker/src/auth.ts`, add `and u.deleted_at is null` to the session lookup's where clause:

```ts
       where s.id = ${id}
         and s.revoked_at is null
         and s.expires_at > now()
         and u.deleted_at is null
         and (${!restrictedAccess(env)} or u.email_verified = true)
```

The comment above it:

```ts
  /* deleted_at is checked here rather than at each route because this is the
     only place a session becomes an identity. Access ends the moment
     deletion is requested; the seven-day grace buys back the data, not the
     way in — so a stolen phone cannot reverse the decision. */
```

- [ ] **Step 4: Refuse at the three doors**

In `worker/src/routes/session.ts`, add near the other helpers:

```ts
const DELETING = {
  ok: false as const,
  err: 'An account for this address is being deleted. Use the cancel link in the email we sent to keep it.',
  code: 'ACCOUNT_DELETING' as const,
};

/** True when this address belongs to an account inside its grace period. */
async function deletionPending(env: Env, email: string): Promise<boolean> {
  return withUser(env, async (sql) => {
    const rows = await sql<{ one: number }[]>`
      select 1 as one from app_user
       where lower(email) = ${email.toLowerCase()} and deleted_at is not null limit 1`;
    return rows.length > 0;
  });
}
```

Then, as the first check inside each of the three handlers — the link request, the password signup and the password login — after the email is parsed and before Turnstile:

```ts
    if (await deletionPending(env, email)) return json(DELETING, { status: 409 }, cors);
```

And in the Google callback, immediately after `profile` is known and before `signInWithGoogle`:

```ts
    if (await deletionPending(env, profile.email)) return fail('account-deleting');
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd worker && pnpm vitest run test/account-deletion-lockout.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
cd worker && pnpm typecheck
git add worker/src/auth.ts worker/src/routes/session.ts worker/test/account-deletion-lockout.test.ts
git commit -m "feat: lock out an account the moment deletion is asked for

Access ends at once and the grace period buys back the data, not the way
in. verifySession is the single place a session becomes an identity, so
that is where deleted_at is checked; the three doors refuse the address and
name the cancel link, which is a deliberate exception to the password
door's refusal to admit an address exists."
```

---

### Task 3: Requesting deletion

**Files:**
- Create: `worker/src/account-deletion/store.ts`, `worker/src/account-deletion/request.ts`, `worker/src/routes/account.ts`
- Modify: `worker/src/index.ts`, `worker/src/permissions.ts`
- Test: `worker/test/account-deletion-request.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's schema; `withTenant`, `withUser` from `../db`; `publishRuntimeTask(env, businessId, { kind, dedupeKey })`; `sendNotice(env, email, subject, text)`.
- Produces:
  - `GRACE_DAYS = 7`
  - `requestDeletion(env, identity, confirmEmail): Promise<{ status: 200 } | { status: 403 | 409; err: string }>`
  - `handleAccount(request, env, url, cors): Promise<Response | null>`
  - `deletionConsequences(tx, businessId, userId): Promise<{ routines: number }>`

- [ ] **Step 1: Write the failing tests**

```ts
// append to worker/test/account-deletion-request.test.ts
const TEST_TOKEN = { id: 'a'.repeat(64), value: 'test-cancel-token-value' };

describe('requesting deletion', () => {
  it('refuses an owner whose team still has members', async () => {
    const env = testEnv();
    const { identity } = await seedTeam(ownerSql(), { members: 1 });
    const result = await requestDeletion(env, identity, identity.email, TEST_TOKEN);
    expect(result.status).toBe(409);
    expect(result.err).toMatch(/remove.*member/i);
  });

  it('refuses when the typed address does not match', async () => {
    const env = testEnv();
    const { identity } = await seedTeam(ownerSql(), { members: 0 });
    const result = await requestDeletion(env, identity, 'someone-else@example.com', TEST_TOKEN);
    expect(result.status).toBe(403);
  });

  it('stamps, revokes, records and stops the sprite', async () => {
    const env = testEnv();
    const owner = ownerSql();
    const { identity, businessId } = await seedTeam(owner, { members: 0, sprite: 'sprite-9' });

    expect((await requestDeletion(env, identity, identity.email, TEST_TOKEN)).status).toBe(200);

    const [business] = await owner`select deleted_at from business where id = ${businessId}`;
    const [user] = await owner`select deleted_at from app_user where id = ${identity.userId}`;
    expect(business.deleted_at).not.toBeNull();
    expect(user.deleted_at).not.toBeNull();

    const live = await owner`select 1 from session where user_id = ${identity.userId} and revoked_at is null`;
    expect(live).toHaveLength(0);

    const [record] = await owner`select * from account_deletion where user_id = ${identity.userId}`;
    expect(record.kind).toBe('owner');
    expect(record.sprite_id).toBe('sprite-9');
    /* Copied out before anything is deleted — after the cascade there is
       nothing left to read them from. */
    expect(record.artifact_keys.length).toBeGreaterThan(0);
    expect(record.cancel_token_id).toMatch(/^[0-9a-f]{64}$/);

    const days = (new Date(record.scheduled_for).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    /* Stopped, not destroyed: Hermes memory lives on the sprite, so
       destroying it here would make the cancel path a lie. */
    const [task] = await owner`select kind from runtime_task where business_id = ${businessId} order by created_at desc limit 1`;
    expect(task.kind).toBe('stop');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd worker && pnpm vitest run test/account-deletion-request.test.ts`
Expected: FAIL — `requestDeletion` is not exported by any module.

- [ ] **Step 3: Write the store**

```ts
// worker/src/account-deletion/store.ts
import type postgres from 'postgres';

/** Seven days. The one place this number lives. */
export const GRACE_DAYS = 7;

export interface DeletionRecord {
  id: string;
  /* Which of the two operations this is. Every stage branches on it: an
     owner's deletion takes the business with it, a staff member's must
     leave the business exactly as it was, minus them. */
  businessId: string | null;
  userId: string | null;
  email: string;
  kind: 'owner' | 'staff';
  stage: 'pending' | 'connectors' | 'objects' | 'sprite' | 'tenant' | 'identity' | 'done' | 'stalled';
  attempts: number;
  artifactKeys: string[];
  spriteId: string | null;
  connectorIds: string[];
}

/** What the person is about to lose, in numbers they can check. */
export async function deletionConsequences(
  tx: postgres.TransactionSql,
  businessId: string,
  userId: string,
): Promise<{ routines: number }> {
  const [row] = await tx<{ routines: number }[]>`
    select count(*)::int as routines from routine
     where business_id = ${businessId} and created_by = ${userId}`;
  return { routines: row?.routines ?? 0 };
}

/** The identifiers the cascade is about to erase. Read before anything dies. */
export async function externalIdentifiers(
  tx: postgres.TransactionSql,
  businessId: string,
): Promise<{ artifactKeys: string[]; spriteId: string | null; connectorIds: string[] }> {
  const artifacts = await tx<{ r2_key: string }[]>`
    select r2_key from artifact where business_id = ${businessId}`;
  const runtimes = await tx<{ external_id: string | null }[]>`
    select external_id from runtime where business_id = ${businessId}`;
  const connectors = await tx<{ id: string }[]>`
    select id from connection where business_id = ${businessId}`;
  return {
    artifactKeys: artifacts.map((a) => a.r2_key),
    spriteId: runtimes[0]?.external_id ?? null,
    connectorIds: connectors.map((c) => c.id),
  };
}
```

- [ ] **Step 4: Write the request path**

```ts
// worker/src/account-deletion/request.ts
import type { Env } from '../env';
import type { Identity } from '../auth';
import { withTenant } from '../db';
import { publishRuntimeTask } from '../runtime/consumer';
import { GRACE_DAYS, deletionConsequences, externalIdentifiers } from './store';

export type RequestResult = { status: 200; routines: number } | { status: 403 | 409; err: string };

/** Deletion is not role-gated: anyone may delete their own account, which is
 *  what both stores require. Ownership decides which of the two operations
 *  runs, not whether the person is allowed to ask. */
export async function requestDeletion(
  env: Env,
  identity: Identity,
  confirmEmail: string,
  token: { id: string; value: string },
): Promise<RequestResult> {
  if (confirmEmail.trim().toLowerCase() !== identity.email.toLowerCase()) {
    return { status: 403, err: 'Type the account’s email address to confirm.' };
  }
  if (!identity.businessId) return { status: 409, err: 'There is nothing to delete yet.' };
  const businessId = identity.businessId;
  const kind = identity.role === 'owner' ? 'owner' : 'staff';

  const outcome = await withTenant(env, businessId, async (tx): Promise<RequestResult> => {
    if (kind === 'owner') {
      const [{ others }] = await tx<{ others: number }[]>`
        select count(*)::int as others from membership
         where business_id = ${businessId} and user_id <> ${identity.userId}`;
      if (others > 0) {
        return {
          status: 409,
          err: 'Remove the other people from your team first, then delete your account.',
        };
      }
    }

    const { routines } = await deletionConsequences(tx, businessId, identity.userId);
    const external = await externalIdentifiers(tx, businessId);

    await tx`update app_user set deleted_at = now() where id = ${identity.userId}`;
    if (kind === 'owner') await tx`update business set deleted_at = now() where id = ${businessId}`;
    await tx`update session set revoked_at = now() where user_id = ${identity.userId} and revoked_at is null`;

    await tx`
      insert into account_deletion
        (business_id, user_id, email, kind, scheduled_for, artifact_keys, sprite_id, connector_ids, cancel_token_id)
      values (
        ${businessId}, ${identity.userId}, ${identity.email.toLowerCase()}, ${kind},
        now() + ${`${GRACE_DAYS} days`}::interval,
        ${external.artifactKeys}, ${external.spriteId}, ${external.connectorIds}, ${token.id}
      )`;

    return { status: 200, routines };
  });

  if (outcome.status !== 200) return outcome;

  /* Outside the transaction, always: nothing is sent or queued from inside
     one. Stopped rather than destroyed — the sprite holds Hermes memory and
     the cancel path has to be honest about what comes back. */
  await publishRuntimeTask(env, businessId, {
    kind: 'stop',
    dedupeKey: `stop:deletion:${identity.userId}`,
  });

  return outcome;
}
```

- [ ] **Step 5: Write the route**

```ts
// worker/src/routes/account.ts
import type { Env } from '../env';
import { resolveTenant } from '../tenancy';
import { originAllowed } from '../request-guard';
import { requestDeletion } from '../account-deletion/request';
import { GRACE_DAYS } from '../account-deletion/store';
import { sendNotice } from '../email';
import { hashToken, randomToken } from '../auth';

export async function handleAccount(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname !== '/api/me' || request.method !== 'DELETE') return null;
  if (!originAllowed(request, cors)) {
    return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
  }
  const identity = await resolveTenant(request, env);
  if (!identity) return json({ ok: false, err: 'sign in first' }, { status: 401 }, cors);

  const body = (await request.json().catch(() => ({}))) as { email?: unknown };
  const confirmEmail = typeof body.email === 'string' ? body.email : '';

  const value = randomToken();
  const result = await requestDeletion(env, identity, confirmEmail, {
    id: await hashToken(value),
    value,
  });
  if (result.status !== 200) {
    return json({ ok: false, err: result.err }, { status: result.status }, cors);
  }

  const cancelUrl = `${env.API_ORIGIN}/api/account/restore?token=${value}`;
  await sendNotice(
    env,
    identity.email,
    'Your Jentera account is being deleted',
    `You asked us to delete your Jentera account.\n\n` +
      `You have been signed out everywhere. Your data is erased in ${GRACE_DAYS} days.\n\n` +
      `Changed your mind? Keep the account: ${cancelUrl}\n\n` +
      `This link works once, and only until the ${GRACE_DAYS} days are up.`,
  );

  return json({ ok: true, graceDays: GRACE_DAYS, routines: result.routines }, {}, cors);
}

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}
```

Register it in `worker/src/index.ts` beside the other handlers, after `handleTeam`:

```ts
    const account = await handleAccount(request, env, url, headers);
    if (account) return account;
```

And add `DELETE` for `/api/me` to the allowlist in `request-guard.ts` if that route table names methods per path.

- [ ] **Step 6: Record the permission decision**

In `worker/src/permissions.ts`, above the permission map:

```ts
/* Account deletion has no entry here on purpose. Both app stores require
   that anyone can delete their own account, so it is not role-gated;
   ownership decides which of the two operations runs (destroy the business,
   or leave it), not whether the person may ask. */
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `cd worker && pnpm vitest run test/account-deletion-request.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
cd worker && pnpm typecheck
git add worker/src/account-deletion worker/src/routes/account.ts worker/src/index.ts worker/src/permissions.ts worker/test/account-deletion-request.test.ts
git commit -m "feat: let someone ask for their account to be deleted

Typing the address is the confirmation: two of the three doors have no
password to re-enter, so a password prompt would be a dead end for Google
and magic-link accounts. An owner with a team is refused until it is empty.
The identifiers the cascade will erase are copied into the record inside
the same transaction, and the sprite is stopped rather than destroyed."
```

---

### Task 4: Cancelling during grace

**Files:**
- Modify: `worker/src/routes/account.ts`
- Test: `worker/test/account-deletion-request.test.ts` (extend)

**Interfaces:**
- Consumes: `cancel_token_id` from Task 1; `hashToken` from `../auth`.
- Produces: `GET /api/account/restore?token=…` → 302 to `${APP_ORIGIN}/signin?restored=1`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('cancelling during grace', () => {
  it('clears the stamps and works exactly once', async () => {
    const env = testEnv();
    const owner = ownerSql();
    const { identity } = await seedTeam(owner, { members: 0 });
    const value = 'cancel-token-value';
    await requestDeletionWithToken(env, identity, value);

    const first = await handleAccount(restoreRequest(value), env, restoreUrl(value), {});
    expect(first!.status).toBe(302);

    const [user] = await owner`select deleted_at from app_user where id = ${identity.userId}`;
    expect(user.deleted_at).toBeNull();

    const second = await handleAccount(restoreRequest(value), env, restoreUrl(value), {});
    expect(second!.status).toBe(404);
  });

  it('refuses after the grace period has passed', async () => {
    const env = testEnv();
    const owner = ownerSql();
    const { identity } = await seedTeam(owner, { members: 0 });
    const value = 'expired-token-value';
    await requestDeletionWithToken(env, identity, value);
    await owner`update account_deletion set scheduled_for = now() - interval '1 hour' where user_id = ${identity.userId}`;

    const response = await handleAccount(restoreRequest(value), env, restoreUrl(value), {});
    expect(response!.status).toBe(404);
  });
});

const restoreUrl = (token: string) => new URL(`https://api.jentera.ai/api/account/restore?token=${token}`);
const restoreRequest = (token: string) => new Request(restoreUrl(token).toString(), { method: 'GET' });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd worker && pnpm vitest run test/account-deletion-request.test.ts -t cancelling`
Expected: FAIL — the route returns null for `/api/account/restore`.

- [ ] **Step 3: Implement the restore branch**

Add to `handleAccount`, before the `/api/me` branch:

```ts
  if (url.pathname === '/api/account/restore' && request.method === 'GET') {
    /* A GET that mutates, because it arrives from an email — the same shape
       as the magic link, single-use through a conditional UPDATE. There is
       nowhere in the app to put a cancel button: a deleted account cannot
       sign in. */
    const presented = url.searchParams.get('token') ?? '';
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(presented)) {
      return Response.redirect(`${env.APP_ORIGIN}/signin?error=restore-failed`, 302);
    }
    const id = await hashToken(presented);
    const restored = await withUser(env, async (sql) => {
      const rows = await sql<{ user_id: string; business_id: string | null; kind: string }[]>`
        update account_deletion
           set cancelled_at = now()
         where cancel_token_id = ${id}
           and cancelled_at is null
           and completed_at is null
           and stage = 'pending'
           and scheduled_for > now()
        returning user_id, business_id, kind`;
      if (rows.length === 0) return null;
      const row = rows[0];
      await sql`update app_user set deleted_at = null where id = ${row.user_id}`;
      if (row.business_id) await sql`update business set deleted_at = null where id = ${row.business_id}`;
      return row;
    });
    if (!restored) {
      return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
    }
    return Response.redirect(`${env.APP_ORIGIN}/signin?restored=1`, 302);
  }
```

The `stage = 'pending'` clause is what makes this safe: once the purge has started deleting things, cancelling would restore an account whose data is already partly gone.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd worker && pnpm vitest run test/account-deletion-request.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/account.ts worker/test/account-deletion-request.test.ts
git commit -m "feat: let a deletion be cancelled from the email during grace

A GET that mutates because it arrives from an email, single-use through a
conditional UPDATE, and refused once the purge has started — cancelling
then would restore an account whose data is already partly gone."
```

---

### Task 5: The purge

**Files:**
- Create: `worker/src/account-deletion/purge.ts`
- Modify: `worker/src/index.ts` (minute cron)
- Test: `worker/test/account-deletion-purge.test.ts`

**Interfaces:**
- Consumes: `account_deletion_due(p_now, p_limit)`; `env.ARTIFACTS` (R2); `publishRuntimeTask`; `sendNotice`; `disconnectConnector(env, tx, connectionId)` from `../routes/connect` — if that export does not exist, extract it from the existing `DELETE` branch at `connect.ts:429` as part of this task rather than duplicating the provider call.
- Produces: `sweepAccountDeletions(env, options?: { now?: Date; limit?: number }): Promise<{ advanced: number; completed: number; stalled: number }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/test/account-deletion-purge.test.ts
describe('the purge', () => {
  it('deletes R2 objects before the rows that name them', async () => {
    const env = testEnv();
    const owner = ownerSql();
    const { businessId, userId } = await seedDueDeletion(owner, { artifacts: ['a/1', 'a/2'] });
    /* The invariant is only provable by failing the external call. */
    env.ARTIFACTS = { delete: async () => { throw new Error('R2 down'); } } as never;

    await sweepAccountDeletions(env);

    const business = await owner`select 1 from business where id = ${businessId}`;
    expect(business).toHaveLength(1);
    const [record] = await owner`select stage, attempts, last_error from account_deletion where user_id = ${userId}`;
    expect(record.stage).toBe('objects');
    expect(record.attempts).toBe(1);
    expect(record.last_error).toMatch(/R2 down/);
  });

  it('erases everything and marks itself done', async () => {
    const env = testEnv();
    const owner = ownerSql();
    const deleted: string[] = [];
    const { businessId, userId } = await seedDueDeletion(owner, { artifacts: ['a/1'] });
    env.ARTIFACTS = { delete: async (key: string) => { deleted.push(key); } } as never;

    await runSweepToCompletion(env);

    expect(deleted).toEqual(['a/1']);
    expect(await owner`select 1 from business where id = ${businessId}`).toHaveLength(0);
    expect(await owner`select 1 from app_user where id = ${userId}`).toHaveLength(0);
    expect(await owner`select 1 from run where business_id = ${businessId}`).toHaveLength(0);
    const [record] = await owner`select stage, completed_at from account_deletion where email = 'due@example.com'`;
    expect(record.stage).toBe('done');
    expect(record.completed_at).not.toBeNull();
  });

  it('leaves the business standing when a staff member goes', async () => {
    const env = testEnv();
    const owner = ownerSql();
    const { businessId, userId, runId } = await seedDueDeletion(owner, { kind: 'staff', artifacts: ['keep/1'] });
    const deleted: string[] = [];
    env.ARTIFACTS = { delete: async (key: string) => { deleted.push(key); } } as never;

    await runSweepToCompletion(env);

    /* The business survives with its history, minus the person. */
    expect(await owner`select 1 from business where id = ${businessId}`).toHaveLength(1);
    expect(await owner`select 1 from app_user where id = ${userId}`).toHaveLength(0);
    expect(deleted).toEqual([]);
    const [run] = await owner`select requested_by from run where id = ${runId}`;
    expect(run.requested_by).toBeNull();
    expect(await owner`select 1 from routine where created_by = ${userId}`).toHaveLength(0);
    expect(await owner`select 1 from membership where user_id = ${userId}`).toHaveLength(0);
  });

  it('stalls loudly rather than abandoning a sprite that will not die', async () => {
    const env = testEnv();
    const owner = ownerSql();
    const notices = sendFake<{ subject: string; text: string }>();
    const { userId } = await seedDueDeletion(owner, { artifacts: [], spriteFails: true });

    for (let attempt = 0; attempt < 9; attempt += 1) {
      await owner`update account_deletion set next_attempt_at = now() where user_id = ${userId}`;
      await sweepAccountDeletions(env, { send: notices });
    }

    const [record] = await owner`select stage, attempts, last_error from account_deletion where user_id = ${userId}`;
    expect(record.stage).toBe('stalled');
    expect(record.attempts).toBe(8);
    /* A machine still holding someone's memory is not a finished deletion. */
    expect(notices).toHaveBeenCalledTimes(1);
    expect(notices.mock.calls[0][0].subject).toMatch(/could not be completed/i);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd worker && pnpm vitest run test/account-deletion-purge.test.ts`
Expected: FAIL — `sweepAccountDeletions` is not exported.

- [ ] **Step 3: Write the sweep**

```ts
// worker/src/account-deletion/purge.ts
import type { Env } from '../env';
import { connect, withTenant, withUser } from '../db';
import { publishRuntimeTask } from '../runtime/consumer';
import { sendNotice } from '../email';

const GIVE_UP_AFTER = 8;
const BASE_BACKOFF_MS = 60_000;

export interface SweepSummary { advanced: number; completed: number; stalled: number }

/** Stages in order. Each is resumable, and each records what it finished. */
const NEXT: Record<string, string> = {
  pending: 'connectors',
  connectors: 'objects',
  objects: 'sprite',
  sprite: 'tenant',
  tenant: 'identity',
  identity: 'done',
};

export async function sweepAccountDeletions(
  env: Env,
  options: { now?: Date; limit?: number; send?: typeof sendNotice } = {},
): Promise<SweepSummary> {
  const send = options.send ?? sendNotice;
  const now = options.now ?? new Date();
  const summary: SweepSummary = { advanced: 0, completed: 0, stalled: 0 };

  const sql = connect(env);
  let due: { deletion_id: string; business_id: string | null }[];
  try {
    due = await sql<{ deletion_id: string; business_id: string | null }[]>`
      select deletion_id, business_id
        from public.account_deletion_due(${now.toISOString()}::timestamptz, ${options.limit ?? 50})`;
  } finally {
    await sql.end();
  }

  for (const target of due) {
    try {
      const advanced = await advance(env, target.deletion_id, send);
      summary.advanced += 1;
      if (advanced === 'done') summary.completed += 1;
    } catch (err) {
      const stalled = await recordFailure(env, target.deletion_id, String(err));
      if (stalled) {
        summary.stalled += 1;
        await notifyStalled(env, target.deletion_id, String(err), send);
      }
    }
  }
  return summary;
}

/** One stage, then return. A slow stage cannot starve the others. */
async function advance(env: Env, deletionId: string, send: typeof sendNotice): Promise<string> {
  const record = await load(env, deletionId);

  switch (record.stage) {
    case 'pending':
      break; // nothing external yet; fall through to the stage bump
    case 'connectors':
      /* Only an owner's deletion takes the business down with it. A staff
         member leaving must not revoke the business's connectors or destroy
         its sprite — both belong to the business, which survives. */
      if (record.kind === 'owner') {
        for (const id of record.connectorIds) {
          await revokeConnector(env, record.businessId, id);
        }
      }
      break;
    case 'objects':
      /* Artifacts belong to the business, so a staff deletion leaves them. */
      if (record.kind === 'owner') {
        for (const key of record.artifactKeys) await env.ARTIFACTS.delete(key);
      }
      break;
    case 'sprite':
      if (record.kind === 'owner' && record.spriteId && record.businessId) {
        await publishRuntimeTask(env, record.businessId, {
          kind: 'delete',
          dedupeKey: `delete:deletion:${deletionId}`,
        });
      }
      break;
    case 'tenant':
      if (record.kind === 'owner') {
        /* The cascade. Every tenant table references business(id) on delete
           cascade — asserted by test/tenant-cascade.test.ts, which fails the
           day a table is added with any other rule. */
        if (record.businessId) {
          await withUser(env, (sql) => sql`delete from business where id = ${record.businessId}`);
        }
      } else if (record.businessId && record.userId) {
        /* A staff deletion leaves the business standing, so their rows in it
           are handled rather than cascaded. These five references are
           nullable and are nulled, which keeps the business's history intact
           with the person removed from it. */
        const businessId = record.businessId;
        const userId = record.userId;
        await withTenant(env, businessId, async (tx) => {
          await tx`update run set requested_by = null where business_id = ${businessId} and requested_by = ${userId}`;
          await tx`update approval set decided_by = null where business_id = ${businessId} and decided_by = ${userId}`;
          await tx`update business_fact set updated_by = null where business_id = ${businessId} and updated_by = ${userId}`;
          await tx`update business_fact set confirmed_by = null where business_id = ${businessId} and confirmed_by = ${userId}`;
          await tx`update connection set connected_by = null where business_id = ${businessId} and connected_by = ${userId}`;
          /* routine.created_by and routine.authorised_by are not null, so
             these cannot lose their author. They go: the authorisation was
             personal and nobody else gave it. The confirm screen said so in
             numbers before any of this was asked for. */
          await tx`delete from routine where business_id = ${businessId} and created_by = ${userId}`;
          await tx`delete from membership where business_id = ${businessId} and user_id = ${userId}`;
        });
      }
      break;
    case 'identity':
      await withUser(env, async (sql) => {
        if (record.userId) await sql`delete from app_user where id = ${record.userId}`;
        /* Keyed by address, referencing neither business nor user, so no
           cascade reaches them. */
        await sql`delete from platform_access where lower(email) = ${record.email}`;
        await sql`delete from waitlist_entry where lower(email) = ${record.email}`;
        await sql`delete from trial_redemption where lower(email) = ${record.email}`;
        await sql`delete from invitation where lower(email) = ${record.email}`;
      });
      break;
    default:
      return record.stage;
  }

  const next = NEXT[record.stage] ?? 'done';
  await withUser(env, (sql) => sql`
    update account_deletion
       set stage = ${next}, attempts = 0, last_error = null,
           next_attempt_at = now(),
           completed_at = case when ${next} = 'done' then now() else null end
     where id = ${deletionId}`);

  if (next === 'done') await notifyComplete(env, record.email, send);
  return next;
}
```

Write `load`, `revokeConnector`, `recordFailure`, `notifyStalled` and `notifyComplete` in the same file:

```ts
async function recordFailure(env: Env, deletionId: string, message: string): Promise<boolean> {
  return withUser(env, async (sql) => {
    const rows = await sql<{ attempts: number }[]>`
      update account_deletion
         set attempts = attempts + 1,
             last_error = ${message.slice(0, 300)},
             next_attempt_at = now() + (${BASE_BACKOFF_MS} * power(2, attempts))::int * interval '1 millisecond',
             stage = case when attempts + 1 >= ${GIVE_UP_AFTER} then 'stalled' else stage end
       where id = ${deletionId}
      returning attempts`;
    return (rows[0]?.attempts ?? 0) >= GIVE_UP_AFTER;
  });
}

async function notifyStalled(
  env: Env,
  deletionId: string,
  message: string,
  send: typeof sendNotice,
): Promise<void> {
  if (!env.SIGNUP_NOTICE_TO) return;
  /* A sprite that will not die still holds Hermes memory, which is personal
     data. Purging the database and calling it done while a machine still
     holds it is the version that looks finished and isn't — so a human is
     told, by name, which deletion needs finishing by hand. */
  await send(
    env,
    env.SIGNUP_NOTICE_TO,
    'A Jentera account deletion could not be completed',
    `Deletion ${deletionId} gave up after ${GIVE_UP_AFTER} attempts.\n\n${message}\n\n` +
      `Finish it by hand, then set stage = 'done' and completed_at = now() on that row.`,
  );
}

async function notifyComplete(env: Env, email: string, send: typeof sendNotice): Promise<void> {
  await send(
    env,
    email,
    'Your Jentera account has been deleted',
    'Your Jentera account and everything in it have been erased. Nothing is left to restore.',
  );
}
```

- [ ] **Step 4: Put it on the minute cron**

In `worker/src/index.ts`, inside the `ROUTINES_CRON` branch beside `dispatchDueReminders`:

```ts
      try {
        const purged = await sweepAccountDeletions(env);
        if (purged.advanced || purged.stalled) {
          console.log(
            `[deletion] advanced=${purged.advanced} completed=${purged.completed} stalled=${purged.stalled}`,
          );
        }
      } catch (err) {
        console.error(`[deletion] ${String(err)}`);
      }
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd worker && pnpm vitest run test/account-deletion-purge.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
cd worker && pnpm typecheck
git add worker/src/account-deletion/purge.ts worker/src/index.ts worker/test/account-deletion-purge.test.ts
git commit -m "feat: purge a deleted account seven days later

Staged and resumable, one stage per tick: revoke connectors, delete the R2
objects, destroy the sprite, cascade the tenant data, then the identity and
the rows keyed only by address. Ordering is the invariant — identifiers out
before the cascade — and the test proves it by failing the R2 call and
asserting the business row is still there. A sprite that will not die
stalls loudly rather than leaving a machine holding someone's memory."
```

---

### Task 6: The drift guard

**Files:**
- Create: `worker/test/tenant-cascade.test.ts`

**Interfaces:**
- Consumes: `ownerSql()` from the harness.
- Produces: nothing at runtime. This is the test that keeps the cascade honest.

- [ ] **Step 1: Write the test**

```ts
// worker/test/tenant-cascade.test.ts
import { beforeAll, afterAll, expect, it } from 'vitest';
import { startDatabase, stopDatabase, ownerSql } from './harness';

beforeAll(startDatabase);
afterAll(stopDatabase);

/* A cascade is invisible: nobody reviewing the code sees what it deletes.
   This is what makes it reviewable — the list exists and is checked, rather
   than being hand-maintained and going stale the first time someone forgets
   it. The failure mode this prevents is data surviving a deletion. */
it('deletes every tenant table with the business it belongs to', async () => {
  const owner = ownerSql();
  const offenders = await owner<{ table_name: string; delete_rule: string }[]>`
    select tc.table_name, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.referential_constraints rc
        on rc.constraint_name = tc.constraint_name
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
     where tc.constraint_type = 'FOREIGN KEY'
       and tc.table_schema = 'public'
       and kcu.column_name = 'business_id'
       and rc.delete_rule <> 'CASCADE'
       and tc.table_name <> 'account_deletion'
     order by tc.table_name`;

  /* account_deletion is the deliberate exception and is named above: it must
     outlive the cascade, because it is what the external cleanup retries
     from. Anything else here is a table a deletion would leave behind. */
  expect(offenders.map((row) => `${row.table_name} (${row.delete_rule})`)).toEqual([]);
});

it('has a purge fixture for every tenant table', async () => {
  const owner = ownerSql();
  const tables = await owner<{ table_name: string }[]>`
    select distinct tc.table_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
     where tc.constraint_type = 'FOREIGN KEY'
       and tc.table_schema = 'public'
       and kcu.column_name = 'business_id'
       and tc.table_name <> 'account_deletion'
     order by tc.table_name`;

  /* The catalog assertion above passes vacuously against a table nobody
     populated, so the purge test seeds one row in each of these. A new table
     fails here until it is added to the fixture. */
  const { TENANT_FIXTURES } = await import('./fixtures/tenant-rows');
  expect(tables.map((t) => t.table_name).filter((name) => !(name in TENANT_FIXTURES))).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd worker && pnpm vitest run test/tenant-cascade.test.ts`
Expected: FAIL — `./fixtures/tenant-rows` does not exist.

- [ ] **Step 3: Write the fixture registry**

```ts
// worker/test/fixtures/tenant-rows.ts
import type postgres from 'postgres';

export interface FixtureContext {
  businessId: string;
  userId: string;
  runId: string;
}

/** One row per tenant table, so the purge test runs against a business that
 *  is genuinely full. The catalog test fails when a table has no entry here,
 *  which is what stops "assert nothing remains" from passing vacuously. */
export const TENANT_FIXTURES: Record<
  string,
  (sql: postgres.Sql, ctx: FixtureContext) => Promise<void>
> = {
  run: async (sql, { businessId, runId, userId }) => {
    await sql`insert into run (id, business_id, kind, trigger_shape, requested_by)
              values (${runId}, ${businessId}, 'ask', 'owner.ask', ${userId})`;
  },
  artifact: async (sql, { businessId, runId }) => {
    await sql`insert into artifact (business_id, run_id, name, content_type, size_bytes, r2_key)
              values (${businessId}, ${runId}, 'note.txt', 'text/plain', 12, ${`a/${runId}`})`;
  },
  membership: async (sql, { businessId, userId }) => {
    await sql`insert into membership (business_id, user_id, role) values (${businessId}, ${userId}, 'owner')
              on conflict do nothing`;
  },
  // …one entry per table the catalog test names. Run it once; it prints the
  // tables with no fixture, and each is added here in this same shape.
};
```

Run the catalog test, add an entry for every table it lists, and repeat until it passes. The purge test from Task 5 imports `TENANT_FIXTURES` and applies all of them before purging.

- [ ] **Step 4: Run both tests and watch them pass**

Run: `cd worker && pnpm vitest run test/tenant-cascade.test.ts test/account-deletion-purge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/test/tenant-cascade.test.ts worker/test/fixtures/tenant-rows.ts
git commit -m "test: fail when a table would survive a deletion

The cascade is what makes deletion reliable and also what makes it
invisible. This asserts the rule from the catalog, so a table added with
any other delete rule fails the day it is written rather than surviving a
deletion months later, and requires a fixture per table so the assertion
cannot pass against tables nobody populated."
```

---

### Task 7: The screen

**Files:**
- Create: `app/src/components/DeleteAccount.tsx`, `app/src/components/__tests__/delete-account.test.tsx`
- Modify: `app/src/lib/repo/types.ts`, `app/src/lib/repo/remote.ts`, `app/src/lib/repo/local.ts`, and the settings view that renders account controls
- Modify: `docs/todo.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `DELETE /api/me` from Task 3, answering `{ ok: true, graceDays: number, routines: number }` or `{ ok: false, err }` with 403/409.
- Produces: `Repository.requestAccountDeletion(email: string): Promise<{ graceDays: number; routines: number }>`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/src/components/__tests__/delete-account.test.tsx
it('will not delete until the address is typed exactly', async () => {
  const request = vi.fn();
  render(<DeleteAccount email="owner@example.com" onDelete={request} routines={3} />);

  await userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
  expect(screen.getByText(/3 scheduled jobs you set up will stop/i)).toBeInTheDocument();

  const confirm = screen.getByRole('button', { name: /delete permanently/i });
  expect(confirm).toBeDisabled();

  await userEvent.type(screen.getByLabelText(/type your email/i), 'owner@example.com');
  expect(confirm).toBeEnabled();
  await userEvent.click(confirm);
  expect(request).toHaveBeenCalledWith('owner@example.com');
});

it('says what an owner must do first when the team is not empty', async () => {
  const request = vi.fn().mockRejectedValue(
    new Error('Remove the other people from your team first, then delete your account.'),
  );
  render(<DeleteAccount email="owner@example.com" onDelete={request} routines={0} />);
  await userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
  await userEvent.type(screen.getByLabelText(/type your email/i), 'owner@example.com');
  await userEvent.click(screen.getByRole('button', { name: /delete permanently/i }));
  expect(await screen.findByText(/remove the other people/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && pnpm vitest run src/components/__tests__/delete-account.test.tsx`
Expected: FAIL — `DeleteAccount` does not exist.

- [ ] **Step 3: Write the component**

```tsx
// app/src/components/DeleteAccount.tsx
import { useState } from 'react';

interface Props {
  email: string;
  routines: number;
  onDelete: (email: string) => Promise<unknown>;
}

/* No `text-*` or `py-*` utility on .btn or .input: they own their type and
   padding through --control-h, and overriding it has broken the shared
   control height three times. */
export default function DeleteAccount({ email, routines, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return <button type="button" className="btn" onClick={() => setOpen(true)}>
      Delete my account
    </button>;
  }

  return <section className="card mt-4 px-4 py-3" aria-label="Delete my account">
    <strong className="block">This cannot be undone after 7 days.</strong>
    <ul className="mt-2 list-disc pl-5 text-text-secondary">
      <li>You are signed out on every device now.</li>
      <li>Your chats, files and business data are erased in 7 days.</li>
      {routines > 0 && <li>{routines} scheduled jobs you set up will stop.</li>}
    </ul>
    <label className="mt-3 block" htmlFor="confirm-email">Type your email address to confirm</label>
    <input
      id="confirm-email"
      className="input mt-1"
      value={typed}
      autoComplete="off"
      onChange={(event) => setTyped(event.target.value)}
    />
    {error && <p role="alert" className="mt-2 text-brand">{error}</p>}
    <div className="mt-3 flex gap-2">
      <button
        type="button"
        className="btn btn-danger"
        disabled={busy || typed.trim().toLowerCase() !== email.toLowerCase()}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onDelete(typed.trim());
          } catch (reason) {
            /* The route writes these for a person to read — a team that is
               not empty, an address that does not match. Render verbatim. */
            setError(reason instanceof Error ? reason.message : 'Could not delete your account.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Deleting…' : 'Delete permanently'}
      </button>
      <button type="button" className="btn" onClick={() => setOpen(false)}>Keep my account</button>
    </div>
  </section>;
}
```

- [ ] **Step 4: Wire the repository method**

```ts
// app/src/lib/repo/types.ts — on the Repository interface
requestAccountDeletion(email: string): Promise<{ graceDays: number; routines: number }>;

// app/src/lib/repo/remote.ts — alongside the other calls, using call() so the
// bearer and credentials handling stays in one place
async requestAccountDeletion(email: string): Promise<{ graceDays: number; routines: number }> {
  const body = await this.call<{ graceDays: number; routines: number }>('/api/me', {
    method: 'DELETE',
    body: JSON.stringify({ email }),
  });
  return { graceDays: body.graceDays, routines: body.routines };
}

// app/src/lib/repo/local.ts — the anonymous demo has no account to delete
async requestAccountDeletion(): Promise<{ graceDays: number; routines: number }> {
  throw new Error('Sign in first — there is no account to delete yet.');
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd app && pnpm vitest run src/components/__tests__/delete-account.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Update the docs this made true**

In `docs/todo.md`, move account deletion out of the mobile blockers and record what an operator does about a stalled deletion. In `CLAUDE.md`, add a short paragraph to the worker section: the deletion record sits outside the cascade and why, and the catalog test that guards it.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/DeleteAccount.tsx app/src/components/__tests__/delete-account.test.tsx app/src/lib/repo docs/todo.md CLAUDE.md
git commit -m "feat: let someone delete their account from the app

Typing the address is the confirmation, and the consequences are named in
numbers before it — a departing member's scheduled jobs stop, and nobody
should discover that when a report fails to arrive. The entry point lives
in the app because both stores require the path to be reachable there."
```

---

## Verification before calling it done

- `cd worker && pnpm test` and `pnpm typecheck` (both passes).
- `cd app && pnpm test` and `pnpm typecheck`.
- **End to end against the deployed API, on a throwaway account only.** Sign up a fresh address, ask for deletion, confirm the email arrives with a working cancel link, cancel it, ask again, then move `scheduled_for` back with `./worker/scripts/stats.sh sql` and watch the cron finish it. Afterwards check by hand that the R2 objects are gone and the sprite no longer exists — the two things no test in this plan can prove.
- Never run this against a real account.
