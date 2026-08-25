# Slice 1 — Identity and Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A business owner signs in with an emailed link, and their data lives on a server instead of in their browser — reached through the same `Repository` interface every screen already uses.

**Architecture:** Postgres on Neon (`ap-southeast-1`) behind Hyperdrive. The existing Cloudflare Worker is extended into a real control plane: magic-link sign-in, an opaque session cookie, and a tenant identity derived from that session rather than trusted from the caller. A `RemoteRepository` implements the interface slice 0 created, so no screen changes. Row-level security enforces tenant isolation beneath the data-access layer, as defence in depth.

**Tech Stack:** Cloudflare Workers, Hyperdrive, Neon Postgres, Resend, TypeScript, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-backend-integration-design.md` — slice 1 in §3, the data model in §4.1, isolation in §4.6.

**Depends on:** slice 0 merged. This plan is meaningless without the `Repository` seam.

## Global Constraints

- **All `pnpm` commands run from `app/` for the frontend and `worker/` for the backend.** Never the repo root.
- **Style:** two-space indent, semicolons, single quotes, camelCase. `@/` alias in `app/`.
- **`localStorage` keys must not change.** `LocalRepository` remains the anonymous-demo implementation and must keep working untouched.
- **The `Repository` interface in `app/src/lib/repo/types.ts` is fixed.** `RemoteRepository` implements it as-is. If a method genuinely cannot be implemented remotely, stop and report rather than changing the interface — every screen depends on its shape.
- **Never trust a caller-supplied tenant.** The current Worker takes `business` from the request body. That is the security hole slice 1 closes. Tenant identity comes from the session, always.
- **Secrets via `wrangler secret put`, never `[vars]`, never committed.**
- Commits: Conventional Commit subjects.

## Infrastructure that already exists — verified 2026-08-25

- **A Neon account is live on this Cloudflare account.** Two Hyperdrive configs point at `ap-southeast-1` Neon endpoints for the `loyca` project (`de3b4193…`, `3b02f98e…`). No new vendor signup is needed, and the target region is confirmed available.
- **No local reference wiring exists.** Those repos do not reference their Hyperdrive configs, so slice 1 writes the Worker↔Hyperdrive↔Neon wiring fresh rather than copying a working example.
- **Resend is not used in this repository.** It appears in other Kitakod projects. An API key must be obtained before Task 3.

## Two things the repository owner must do before Task 2 and Task 3

Both are account actions no agent should take:

1. **Create a Neon project** for AISAR in `ap-southeast-1` (do not reuse `loyca`'s), then `npx wrangler hyperdrive create aisar-db --connection-string '<pooled connection string>'` and record the returned id.
2. **Obtain a Resend API key** and verify a sending domain. Magic links cannot be delivered without it, and Task 3 stops at the send step otherwise.

Task 1 needs neither and can start immediately.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `worker/schema.sql` (rewritten) | The slice-1 tables; replaces the D1 approval schema |
| `worker/migrations/001_identity.sql` | Idempotent, versioned; the schema file is documentation |
| `worker/src/db.ts` | Hyperdrive connection, transaction helper, `SET LOCAL` tenant scoping |
| `worker/src/auth.ts` | Magic-link issue and consume, session create and verify |
| `worker/src/email.ts` | Resend client; the only file that knows about email |
| `worker/src/tenancy.ts` | Session → user → business resolution; the single source of tenant identity |
| `worker/src/routes/session.ts` | `POST /api/auth/request`, `/api/auth/consume`, `GET /api/me`, `POST /api/auth/logout` |
| `worker/src/routes/repo.ts` | The endpoints backing the 17 `Repository` methods |
| `app/src/lib/repo/remote.ts` | `RemoteRepository implements Repository` |
| `app/src/lib/repo/migrate.ts` | One-time local→remote state transfer on first sign-in |
| `app/src/routes/SignIn.tsx` | Email entry and the "check your inbox" state |

**Modified:** `worker/src/index.ts` · `worker/wrangler.toml` · `worker/package.json` · `app/src/lib/repo/context.tsx` · `app/src/lib/repo/index.ts` · `app/src/App.tsx` · and the nineteen `void mutate(...)` call sites listed in Task 1.

---

## Task 1: Make the Repository survive failure

**No backend work.** `LocalRepository` cannot fail — `storage.ts` catches every accessor. `RemoteRepository` fails constantly: offline, expired session, 500. Every assumption that a write always succeeds becomes a bug the moment Task 6 lands. Fixing it first means Task 6 changes one line rather than debugging nineteen call sites.

The whole-branch review of slice 0 identified these precisely; the line numbers are its findings.

**Files:**
- Modify: `app/src/lib/repo/context.tsx`, `app/src/routes/Setup.tsx`, `app/src/routes/Onboard.tsx`
- Modify (add `.catch`): `app/src/hooks/useBusiness.ts`, `app/src/hooks/useTheme.ts`, `app/src/i18n/I18nProvider.tsx`, `app/src/routes/views/ActivityView.tsx`, `app/src/routes/views/PermissionsPanel.tsx`
- Test: `app/src/lib/repo/__tests__/context.test.tsx`

**Interfaces:**
- Produces: `useMutate()` keeps its signature but no longer leaves rejections unhandled. `RepositoryProvider` gains a `status` of `'loading' | 'ready' | 'error'` exposed by a new `useRepoStatus()`. Task 6 relies on both.

- [ ] **Step 1: Write the failing test for a rejecting `load()`**

In `app/src/lib/repo/__tests__/context.test.tsx`, add a repository whose `load()` rejects, render the provider, and assert the app shows an error state rather than rendering nothing forever.

```tsx
class FailingRepo extends LocalRepository {
  async load(): Promise<BusinessSnapshot> {
    throw new Error('network down');
  }
}

it('surfaces a load failure instead of rendering nothing', async () => {
  render(
    <RepositoryProvider repository={new FailingRepo()}>
      <Probe />
    </RepositoryProvider>,
  );
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd app && pnpm test src/lib/repo/__tests__/context
```

Expected: FAIL — times out. `context.tsx:59`'s `if (!value) return null` renders nothing forever, which is exactly the defect.

- [ ] **Step 3: Add the error path**

In `app/src/lib/repo/context.tsx`, wrap the `refresh` callback in try/catch, store an `error` alongside the snapshot, and give the context a three-state `status`. Render an alert with a retry button when `status === 'error'`; keep returning `null` only while `status === 'loading'`.

Export `useRepoStatus(): { status: 'loading' | 'ready' | 'error'; error: Error | null; retry: () => void }`.

Keep `useSnapshot()` throwing if called when no snapshot exists — consumers still assume one, and that assumption is what keeps reads synchronous.

- [ ] **Step 4: Make `useMutate` surface write failures**

Currently a rejected write becomes an unhandled rejection and the user sees nothing happen. Change `useMutate` so a rejection is caught, reported through the existing `ToastProvider` (already mounted at `App.tsx`), and re-thrown so callers that do await it still see it.

This is the fix for Ruling B, deferred from slice 0 on the grounds that `localStorage` writes never fail. They are about to.

- [ ] **Step 5: Fix the two sync-write assumptions**

- `app/src/routes/Setup.tsx:76-77` — `void mutate(...)` then `navigate('/app')`. Await the mutate before navigating. `setSetupDone` gates the command-centre stage; navigating before it lands would show the wrong stage.
- `app/src/routes/Onboard.tsx` — three sequential awaits inside one mutate, then a hardcoded `setTimeout(..., 1200)` before `navigate('/setup')`. That 1200 ms is a UI flourish doubling as a write budget. Await the mutate, then run the delay for presentation only. `setOnboarded` is the gate `App.tsx:19` uses to decide whether `/app` bounces to `/onboard`.

- [ ] **Step 6: Add `.catch` at the remaining fire-and-forget sites**

`useBusiness.ts:68,117,124,131` · `useTheme.ts:16,21` · `I18nProvider.tsx:70,75` · `ActivityView.tsx:86` · `PermissionsPanel.tsx:36,41`. With Step 4 done these are already reported centrally; the local `.catch` prevents the unhandled-rejection warning. Prefer a shared `void mutate(fn).catch(noop)` helper over nineteen inline copies.

- [ ] **Step 7: Verify and commit**

```bash
cd app && pnpm typecheck && pnpm test && pnpm build
```

```bash
git add app/src
git commit -m "feat: make the repository survive write and load failures

LocalRepository cannot fail; RemoteRepository will. A rejecting load()
rendered the app permanently blank, and nineteen fire-and-forget writes
became unhandled rejections with no user feedback. Both are unreachable
today and both would be reached on the first offline request."
```

---

## Task 2: The database

**Files:**
- Rewrite: `worker/schema.sql`
- Create: `worker/migrations/001_identity.sql`, `worker/src/db.ts`
- Modify: `worker/wrangler.toml`, `worker/package.json`

**Interfaces:**
- Produces: `withTenant(env, businessId, fn)` — runs `fn` inside a transaction with `SET LOCAL app.business_id`. Every later query goes through it. Also `withUser(env, fn)` for pre-tenant queries (login, session lookup).

- [ ] **Step 1: Write the schema**

`worker/migrations/001_identity.sql`, from spec §4.1. Verbatim, including `citext` — install the extension first:

```sql
create extension if not exists citext;

create table if not exists app_user (
  id           uuid primary key default gen_random_uuid(),
  email        citext not null unique,
  name         text,
  detail_level text not null default 'beginner'
               check (detail_level in ('beginner','advanced')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists business (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  playbook_key text not null,
  country      text not null default 'MY',
  lang         text not null default 'en' check (lang in ('en','bm')),
  locality     text,
  runtime      text not null default 'aisar-native',
  onboarded    boolean not null default false,
  setup_done   boolean not null default false,
  channels     jsonb not null default '[]',
  connections  jsonb not null default '[]',
  theme        text not null default 'dark' check (theme in ('dark','light')),
  created_at   timestamptz not null default now()
);

create table if not exists membership (
  user_id     uuid not null references app_user(id) on delete cascade,
  business_id uuid not null references business(id) on delete cascade,
  role        text not null check (role in ('owner','staff')),
  created_at  timestamptz not null default now(),
  primary key (user_id, business_id)
);

create table if not exists session (
  id          text primary key,
  user_id     uuid not null references app_user(id) on delete cascade,
  business_id uuid references business(id) on delete set null,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists login_token (
  token_hash  text primary key,
  email       citext not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists session_user on session (user_id) where revoked_at is null;
create index if not exists login_token_email on login_token (email) where consumed_at is null;
```

`business` carries the snapshot's scalar fields directly. `approval`, `action_policy`, `work_done` and `learn` arrive in Task 5 — keep this migration to identity so a failure here is easy to reason about.

**`session.id` stores a SHA-256 of the cookie value, never the raw token.** A leaked database dump must not yield usable sessions.

- [ ] **Step 2: Wire Hyperdrive**

In `worker/wrangler.toml`, replace the D1 binding with the Hyperdrive id the owner created:

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "PASTE_THE_ID_FROM_wrangler_hyperdrive_create"
```

Add `postgres` to `worker/package.json` dependencies (`postgres` — the `postgres.js` driver — works on Workers; `pg` does not without a shim).

- [ ] **Step 3: Write `worker/src/db.ts`**

```ts
import postgres from 'postgres';
import type { Env } from './env';

export function connect(env: Env) {
  return postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false, // Hyperdrive pools; type introspection per connection is wasted
  });
}

/**
 * Every tenant-scoped query runs through here.
 *
 * `set_config(..., true)` is transaction-local, which matters: Hyperdrive
 * pools connections, so setting the GUC per connection would leak one
 * tenant's scope into another's request. Per transaction is the only
 * correct granularity.
 */
export async function withTenant<T>(
  env: Env,
  businessId: string,
  fn: (sql: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const sql = connect(env);
  try {
    return await sql.begin(async (tx) => {
      await tx`select set_config('app.business_id', ${businessId}, true)`;
      return fn(tx);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
```

- [ ] **Step 4: Apply the migration and verify the GUC is transaction-local**

Apply `001_identity.sql` to the Neon database, then prove the scoping assumption rather than trusting it:

```sql
begin;
select set_config('app.business_id', 'aaaa', true);
select current_setting('app.business_id', true);  -- expect: aaaa
commit;
select current_setting('app.business_id', true);  -- expect: NULL, not aaaa
```

If the second select returns `aaaa`, the isolation model is wrong and everything downstream inherits it. **Stop and report** rather than continuing.

- [ ] **Step 5: Commit**

```bash
git add worker/
git commit -m "feat(worker): add the identity schema and tenant-scoped connections"
```

---

## Task 3: Magic-link sign-in

**Requires the Resend API key.** If it is not available, implement everything and stop at Step 4 with the send stubbed to a console log — the rest of the plan does not depend on real delivery.

**Files:**
- Create: `worker/src/auth.ts`, `worker/src/email.ts`, `worker/src/routes/session.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**
- Produces: `POST /api/auth/request {email}` → 204 always; `GET /api/auth/consume?token=` → sets cookie, redirects; `GET /api/me` → `{user, business}` or 401; `POST /api/auth/logout` → 204.

- [ ] **Step 1: Token issue and consume in `worker/src/auth.ts`**

- Generate 32 random bytes, base64url them: that is the token in the link.
- Store only `sha256(token)` in `login_token`, with a **15-minute** expiry.
- On consume: hash the presented token, look it up, reject if missing, expired, or already consumed. Set `consumed_at` in the same statement that selects it — `update … where token_hash = $1 and consumed_at is null returning email` — so a replayed link cannot mint two sessions.
- Create or find the `app_user` by email, mint a session, return the raw session token.

Session tokens: 32 random bytes, base64url, stored as `sha256`, 30-day expiry.

- [ ] **Step 2: `POST /api/auth/request` must not leak which emails exist**

Return **204 regardless** of whether the address has an account. A different response for known and unknown addresses turns the endpoint into an account-existence oracle.

Rate-limit per email — at most 3 outstanding unconsumed tokens, else 204 without sending.

- [ ] **Step 3: The cookie**

```
Set-Cookie: aisar_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000
```

`SameSite=Lax` rather than `Strict`: the magic link arrives from an email client, and `Strict` would withhold the cookie on that first cross-site navigation, so the user would land signed-out having just signed in.

`HttpOnly` is not optional — script-readable session cookies are how XSS becomes account takeover.

- [ ] **Step 4: Send through Resend in `worker/src/email.ts`**

One function, `sendMagicLink(env, email, url)`. Keep the Resend API surface confined to this file. Plain-text body plus a minimal HTML one. State the 15-minute expiry in the email — a user who tries an hour-old link should understand why it failed.

- [ ] **Step 5: Tests**

In `worker/`, with Vitest: a consumed token cannot be reused; an expired token is rejected; `/api/auth/request` returns 204 for both known and unknown emails; a session cookie verifies and an unknown one does not.

- [ ] **Step 6: Commit**

```bash
git add worker/
git commit -m "feat(worker): magic-link sign-in with hashed, single-use tokens"
```

---

## Task 4: Tenancy — closing the hole

The current Worker takes `business` from the request body, so any caller can read or approve another tenant's queue. `worker/README.md` documents this. Task 4 closes it.

**Files:**
- Create: `worker/src/tenancy.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/migrations/002_rls.sql`

- [ ] **Step 1: `resolveTenant(env, request)`**

Read the cookie → hash → look up an unrevoked, unexpired session → join `membership` → return `{userId, businessId, role}` or `null`. **This is the only place a `businessId` may be produced.** No route may read one from a body, query string, or header.

- [ ] **Step 2: Delete the caller-supplied tenant**

Remove `business` from every request body type in `worker/src/index.ts`. Any route needing a tenant calls `resolveTenant` and 401s when it returns null. **Grep for `body.business` afterwards and confirm zero hits** — a single survivor reopens the hole.

- [ ] **Step 3: Row-level security**

`worker/migrations/002_rls.sql`: enable RLS on every tenant-scoped table and add a policy of the form

```sql
alter table <t> enable row level security;
create policy <t>_tenant on <t>
  using (business_id = current_setting('app.business_id', true)::uuid);
```

The Neon role the Worker uses must **not** be the table owner, or RLS is bypassed silently. Verify with a query as that role and no GUC set — it must return zero rows, not an error.

- [ ] **Step 4: The isolation test that matters**

Two businesses, two sessions. Session A requests business B's data by every route. Every one must 401 or return empty — never B's rows. Then, separately, prove RLS holds beneath the application layer: run a raw query as the Worker's role with the wrong `app.business_id` set and confirm zero rows.

Both halves are required. The first proves the code is right; the second proves the code being wrong is not sufficient to leak data.

- [ ] **Step 5: Commit**

```bash
git add worker/
git commit -m "fix(worker): derive the tenant from the session, never from the caller

Closes the hole worker/README.md documents: `business` was caller-supplied,
so any caller could read or approve another tenant's queue."
```

---

## Task 5: The Repository API

**Files:**
- Create: `worker/src/routes/repo.ts`
- Create: `worker/migrations/003_state.sql`

- [ ] **Step 1: The remaining tables**

`approval`, `action_policy`, `work_done` (business_id, playbook_key, index), `learn` (business_id, playbook_key, pick, count). All with `business_id`, all RLS-enabled per Task 4.

**`approval.id` is a uuid**, not the client's `Date.now()` number. `Approval.remoteId?: string` already exists in `app/src/lib/types.ts` and `ActivityView.tsx` already routes through it — that seam exists. Task 6 maps between them; do not change the client type.

- [ ] **Step 2: `GET /api/state`** returns the whole `BusinessSnapshot` in one response, shaped exactly as `LocalRepository.load()` returns it. One round trip per `load()`, not seventeen.

- [ ] **Step 3: The mutation endpoints**, one per `Repository` method. Each resolves the tenant, validates, writes inside `withTenant`, returns 204. Keep them thin — no business logic in routes.

- [ ] **Step 4: Contract test against the interface**

The strongest test available here: run the **same** suite against `LocalRepository` and `RemoteRepository` and require identical observable behaviour. Extract `app/src/lib/repo/__tests__/local.test.ts`'s assertions into a shared suite parameterised by implementation. If both pass it, the interface genuinely abstracts the difference — which is the whole premise of slice 0.

- [ ] **Step 5: Commit**

---

## Task 6: `RemoteRepository`

**Files:**
- Create: `app/src/lib/repo/remote.ts`
- Modify: `app/src/lib/repo/index.ts`

- [ ] **Step 1: Implement all 17 methods** against Task 5's endpoints. `load()` is one `GET /api/state`; every setter is one POST. Send `credentials: 'include'` so the cookie travels.

- [ ] **Step 2: Map the approval id.** The interface takes `decideApproval(id: number, ...)`. Keep a local id→uuid map built during `load()`, using the same `hashId` approach `app/src/lib/api.ts` already uses. **Do not change the interface** — every consumer depends on its shape.

- [ ] **Step 3: A 401 means the session died.** Surface it as a distinct error the provider can act on, so an expired session shows a sign-in prompt rather than a generic failure. Task 1's `status` state is where this lands.

- [ ] **Step 4: Run the shared contract suite** from Task 5 Step 4 against `RemoteRepository`. It must pass unmodified.

- [ ] **Step 5: Commit**

---

## Task 7: Cutover

**Files:**
- Create: `app/src/lib/repo/migrate.ts`, `app/src/routes/SignIn.tsx`
- Modify: `app/src/App.tsx`, `app/src/lib/repo/context.tsx`

- [ ] **Step 1: Choose the implementation at the provider.** Signed in → `RemoteRepository`. Otherwise → `LocalRepository`, which keeps the anonymous demo working exactly as it does today. That demo is the top-of-funnel and must not regress.

- [ ] **Step 2: Migrate local state on first sign-in.** Read the local snapshot, POST it as the initial business, then clear the local keys. **Only when the remote business is new** — never overwrite existing server state with stale browser state. A returning user signing in on a fresh browser must not have their real business flattened by an empty local snapshot.

- [ ] **Step 3: Sign-in screen.** Email field, submit, "check your inbox". Note the 15-minute expiry.

- [ ] **Step 4: End-to-end verification.** Sign up with a real address, click the real link, confirm the business persists across a browser restart *and* across a different browser — the property `localStorage` never had. Then confirm a second account cannot see the first's data.

- [ ] **Step 5: Retire D1.** Remove the binding from `wrangler.toml` and delete `worker/src/store.ts`. Its single-execution guarantee moves to Task 5's approval endpoints — **port the conditional `UPDATE … WHERE status = 'pending'` pattern, do not reinvent it.** That property is proven and is the one that stops a customer being messaged twice.

- [ ] **Step 6: Commit**

---

## Done when

- [ ] A new user signs in by email and their business persists across browsers.
- [ ] Two accounts cannot see each other's data — proven at the API layer **and** at the RLS layer independently.
- [ ] `grep -rn "body.business" worker/src` returns nothing.
- [ ] The shared contract suite passes against both `LocalRepository` and `RemoteRepository`, unmodified.
- [ ] The anonymous demo still works with no account.
- [ ] An offline write shows the user an error instead of failing silently.
- [ ] D1 is gone and the single-execution guarantee survives on Postgres.

The second and last items are the ones worth defending. Tenant isolation is the property whose failure is unrecoverable — you cannot un-show one business's customers to another. And single-execution is what stops an approved message being sent twice.
