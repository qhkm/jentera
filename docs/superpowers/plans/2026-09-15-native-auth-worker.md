# Native Auth (Worker Half) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the native app hold a session as a bearer token, obtained through the system browser with PKCE, so the Capacitor shell can call the API from an origin the session cookie cannot reach.

**Architecture:** The phone never renders its own sign-in form. It opens the real sign-in page in the system browser with a `state` and a PKCE challenge; once that page holds a session it mints a single-use code; the app exchanges code + state + verifier for a **new** session row and stores the token in Keychain/Keystore. The worker learns one new way to read a session token and gains two routes and one table. Nothing about the cookie path changes.

**Tech Stack:** TypeScript, Cloudflare Workers, Neon Postgres via Hyperdrive, vitest with a throwaway Postgres in Docker.

**Spec:** `docs/superpowers/specs/2026-09-14-mobile-apps-design.md`, section "Auth".

## Global Constraints

- **This plan touches `worker/` only.** Another session is actively building the Capacitor shell in `app/` and `mobile/`. Do not edit, test, or typecheck anything under `app/`.
- TypeScript, two-space indent, semicolons, single quotes, camelCase.
- Conventional Commit subjects, one visible behaviour per commit.
- `cd worker && pnpm test` needs Docker running; a single-file vitest run also starts the throwaway Postgres via `globalSetup`. `pnpm typecheck` runs twice (src alone, then src + test); both must be clean.
- **Assert as `aisar_app`, arrange as `owner`** — `test/harness.ts` hands out both. RLS does not exist for a superuser, so a test that asserts as the owner passes while production leaks.
- Tests import the production queries rather than copying their SQL. A copied query is a test that keeps passing while the real one drifts.
- `worker/src/index.ts` cannot be imported from a test — it re-exports a Durable Object importing `cloudflare:workers`, unresolvable under plain node vitest. Test routes by calling their handler, and test cross-cutting answers (CORS, the guard) by calling that unit directly or scanning source.
- The next free migration number is **044**; `043_activation_milestone.sql` is taken. Re-check `ls worker/migrations | tail -1` before creating the file, since another session may land one first.
- Secrets and tokens are stored as SHA-256 only, never in the clear. `hashToken` in `src/auth.ts` is the one hasher.

---

### Task 1: Accept a bearer token wherever a cookie is accepted

The phone's origin is `capacitor://app.jentera.ai`, and a `SameSite=Lax` cookie is withheld from a cross-site fetch out of it. A bearer is also CSRF-immune, so it loses nothing the cookie was buying.

**Files:**
- Modify: `worker/src/auth.ts` (add `readSessionToken`, keep `readCookie`)
- Modify: `worker/src/tenancy.ts:25`, `worker/src/request-guard.ts:66`, `worker/src/routes/session.ts` (4 sites), `worker/src/routes/access.ts:33`, `worker/src/routes/launch-admin.ts:10`
- Modify: `worker/src/index.ts` (`Access-Control-Allow-Headers`)
- Modify: `worker/wrangler.toml` (`ALLOWED_ORIGINS`)
- Test: `worker/test/native-bearer.test.ts` (create), `worker/test/cors.test.ts` (extend)

**Interfaces:**
- Consumes: `readCookie`, `verifySession` from `src/auth.ts`; `signIn`, `testEnv`, `req` from `test/harness.ts`.
- Produces: `readSessionToken(request: Request): string | null` exported from `src/auth.ts`. Header first, cookie second. Every later task assumes routes authenticate through it.

- [ ] **Step 1: Write the failing test**

Create `worker/test/native-bearer.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { readSessionToken, verifySession } from '../src/auth';
import { asOwner, signIn, testEnv, truncateAll } from './harness';

const B = '22222222-2222-4222-8222-222222222222';
let token: string;
let cookie: string;

beforeEach(async () => {
  await truncateAll();
  const userId = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${B}, 'Kedai', 'restaurant')`;
    const [u] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('owner@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${u.id}, ${B}, 'owner')`;
    return u.id;
  });
  cookie = await signIn(userId);
  token = cookie.replace(/^aisar_session=/, '').split(';')[0];
});

describe('reading a session token from a request', () => {
  it('takes the Authorization header', () => {
    const request = new Request('https://api.test/api/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(readSessionToken(request)).toBe(token);
  });

  it('still takes the cookie', () => {
    const request = new Request('https://api.test/api/me', { headers: { Cookie: cookie } });
    expect(readSessionToken(request)).toBe(token);
  });

  /* Android's WebView shares the system cookie jar, so a stale Set-Cookie
     from api.jentera.ai could otherwise shadow the token the app holds. */
  it('prefers the header when both are present', () => {
    const request = new Request('https://api.test/api/me', {
      headers: { Authorization: 'Bearer header-wins', Cookie: cookie },
    });
    expect(readSessionToken(request)).toBe('header-wins');
  });

  it('ignores a malformed Authorization header', () => {
    const request = new Request('https://api.test/api/me', { headers: { Authorization: token } });
    expect(readSessionToken(request)).toBeNull();
  });

  it('authenticates a real session presented as a bearer', async () => {
    const identity = await verifySession(testEnv(), readSessionToken(
      new Request('https://api.test/api/me', { headers: { Authorization: `Bearer ${token}` } }),
    )!);
    expect(identity?.businessId).toBe(B);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && pnpm vitest run test/native-bearer.test.ts`
Expected: FAIL on the import — `readSessionToken` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `worker/src/auth.ts`, beside `readCookie`:

```typescript
/**
 * The session token a request carries, from either door.
 *
 * Header before cookie, deliberately: the native app's WebView shares
 * Android's system cookie jar, so a stale `Set-Cookie` from a previous
 * sign-in could otherwise shadow the token the app actually holds. A
 * bearer is also CSRF-immune, which is what the SameSite=Lax cookie was
 * buying on the web.
 */
export function readSessionToken(request: Request): string | null {
  const authorization = request.headers.get('Authorization') ?? '';
  const bearer = /^Bearer\s+(\S+)$/i.exec(authorization);
  if (bearer) return bearer[1];
  return readCookie(request);
}
```

Then replace `readCookie(request)` with `readSessionToken(request)` at each call site: `src/tenancy.ts:25`, `src/request-guard.ts:66`, `src/routes/session.ts` (all four), `src/routes/access.ts:33`, `src/routes/launch-admin.ts:10`. Leave `readNamedCookie` in `session.ts:55` alone — it reads the OAuth stash, not a session.

In `worker/src/index.ts`, extend the header list (it currently reads `'Content-Type,X-Aisar-File-Name'`):

```typescript
    'Access-Control-Allow-Headers': 'Content-Type,X-Aisar-File-Name,Authorization',
```

In `worker/wrangler.toml`, append the two native origins to `ALLOWED_ORIGINS`:
`capacitor://app.jentera.ai,https://app.jentera.ai`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && pnpm vitest run test/native-bearer.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Prove the bearer does not cross into the credential routes**

Three route families read a *runtime* credential from the same `Authorization` header and must not start accepting session tokens: `src/runtime/identity.ts:42`, `src/routes/model.ts:588`, `src/routes/support.ts:75`. Append to `worker/test/native-bearer.test.ts`:

```typescript
import { handleSupport } from '../src/routes/support';

describe('a session bearer is not a runtime credential', () => {
  it('is refused at the support routes', async () => {
    const request = new Request('https://api.test/api/support/runtime-slice', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const response = await handleSupport(request, testEnv(), new URL(request.url), {});
    expect(response?.status).toBe(401);
  });
});
```

Run it. If `handleSupport`'s signature differs, read the file and match it rather than changing the route.

- [ ] **Step 6: Extend the CORS scan**

`worker/test/cors.test.ts` already scans the client's custom headers. Add `Authorization` to what it expects, as its own assertion:

```typescript
it('names Authorization, which the native app sends', async () => {
  expect(await corsAllowHeaders()).toContain('authorization');
});
```

- [ ] **Step 7: Run the suite and both typecheck passes**

Run: `cd worker && pnpm test && pnpm typecheck`
Expected: the 5 pre-existing failures in `orchestration.test.ts` and `runtime-runner.test.ts` and no others. Confirm that count before continuing; anything new is yours.

- [ ] **Step 8: Commit**

```bash
git add worker/src worker/test worker/wrangler.toml
git commit -m "feat: accept a session token as a bearer

The native app's origin is capacitor://app.jentera.ai, and a SameSite=Lax
cookie is withheld from a cross-site fetch out of it. readSessionToken
reads the header first and the cookie second, because Android's WebView
shares the system cookie jar and a stale Set-Cookie would otherwise
shadow the token the app holds."
```

---

### Task 2: The single-use native code table

The browser mints a short-lived code; the app exchanges it. The code is stored SHA-256 like the magic link, bound to the session that minted it and to a PKCE challenge, and consumed by a conditional UPDATE so two exchanges cannot both win.

**Files:**
- Create: `worker/migrations/044_native_auth_code.sql`
- Test: `worker/test/native-auth.test.ts` (create)

**Interfaces:**
- Produces: table `native_auth_code` with columns `id` (text primary key, the SHA-256 of the code), `user_id` (uuid, cascade), `session_id` (text, the hash of the minting session's token), `code_challenge` (text), `state` (text), `expires_at`, `consumed_at`, `created_at`. Task 3 inserts; Task 4 consumes.

- [ ] **Step 1: Write the migration**

Create `worker/migrations/044_native_auth_code.sql`:

```sql
-- A one-time code handed to the native app through the system browser.
--
-- Shaped like login_token: only the SHA-256 of the code is stored, it is
-- single-use through a conditional UPDATE, and it expires in a minute
-- rather than the link's fifteen, because the app is already waiting on
-- the callback when it is minted.
--
-- session_id is the hash of the session that minted it, so the exchange
-- can refuse a code whose browser session was revoked in between.
-- code_challenge is PKCE S256: the exchange must present a verifier whose
-- SHA-256 matches, which is what stops another app that claimed the same
-- custom scheme from spending an intercepted code. state is echoed back so
-- the app can reject a callback it did not start — without it, an attacker
-- could hand a victim a code minted on the attacker's own account and land
-- the victim's phone in the attacker's business.
create table if not exists native_auth_code (
  id             text primary key,
  user_id        uuid not null references app_user(id) on delete cascade,
  session_id     text not null,
  code_challenge text not null check (char_length(code_challenge) between 43 and 128),
  state          text not null check (char_length(state) between 16 and 128),
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_native_auth_code_user on native_auth_code (user_id);

grant select, insert, update, delete on native_auth_code to aisar_app;
```

Check `worker/migrations/000_role.sql` for how other non-tenant tables grant to `aisar_app` and match it exactly; `login_token` is the closest sibling.

- [ ] **Step 2: Run the suite so the migration applies**

Run: `cd worker && pnpm vitest run test/native-bearer.test.ts`
Expected: PASS. The harness applies `migrations/` in order, so a syntax error surfaces here as a setup failure.

- [ ] **Step 3: Commit**

```bash
git add worker/migrations/044_native_auth_code.sql
git commit -m "feat: add the native auth code table"
```

---

### Task 3: Mint a code from the browser session

**Files:**
- Modify: `worker/src/auth.ts` (export `startSession`, add `issueNativeCode`)
- Modify: `worker/src/routes/session.ts` (add the route)
- Test: `worker/test/native-auth.test.ts`

**Interfaces:**
- Consumes: `readSessionToken`, `verifyIdentitySession`, `hashToken`, `mintToken` from `src/auth.ts`; `accessForEmail` from `src/access.ts`.
- Produces: `issueNativeCode(env, sessionToken, input: { state: string; codeChallenge: string }): Promise<string | null>` in `src/auth.ts`, returning the code or null when the session is not usable. Route `POST /api/auth/native/code` answering `{ code }` or an error.

- [ ] **Step 1: Write the failing test**

Create `worker/test/native-auth.test.ts` with the arrange block from Task 1 (a verified owner and a session), then:

```typescript
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const STATE = 'state-0123456789abcdef';

describe('minting a native code', () => {
  it('returns a code for a live session', async () => {
    const code = await issueNativeCode(testEnv(), token, { state: STATE, codeChallenge: CHALLENGE });
    /* mintToken is 32 random bytes as base64url: 43 characters. */
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('stores only the hash', async () => {
    const code = await issueNativeCode(testEnv(), token, { state: STATE, codeChallenge: CHALLENGE })!;
    const rows = await asApp((sql) => sql<{ id: string }[]>`select id from native_auth_code`);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(await hashToken(code!));
  });

  it('refuses a revoked session', async () => {
    await asOwner((sql) => sql`update session set revoked_at = now()`);
    expect(await issueNativeCode(testEnv(), token, { state: STATE, codeChallenge: CHALLENGE })).toBeNull();
  });
});
```

Import `asApp` alongside `asOwner` from the harness — the assertion runs as `aisar_app`, the arrangement as owner.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && pnpm vitest run test/native-auth.test.ts`
Expected: FAIL — `issueNativeCode` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `worker/src/auth.ts`, make `startSession` exported (change `async function startSession` to `export async function startSession`) and add:

```typescript
/** One minute: the app is already waiting on the callback. */
const NATIVE_CODE_TTL_MS = 60 * 1000;

/**
 * Turn a live browser session into a one-time code the native app can
 * exchange. This is the most valuable route in the system — it converts an
 * HttpOnly cookie into an exportable bearer — so the caller must be a live,
 * verified, access-allowed session, and the code is bound to it.
 */
export async function issueNativeCode(
  env: Env,
  sessionToken: string,
  input: { state: string; codeChallenge: string },
): Promise<string | null> {
  const identity = await verifyIdentitySession(env, sessionToken);
  if (!identity) return null;
  if (!(await accessForEmail(env, identity.email)).allowed) return null;

  const code = mintToken();
  const expiresAt = new Date(Date.now() + NATIVE_CODE_TTL_MS);
  /* Both hashes are awaited before the query: the tagged template runs
     inside a non-async arrow, where an await would not compile. */
  const codeHash = await hashToken(code);
  const sessionHash = await hashToken(sessionToken);
  await withUser(env, (sql) => sql`
    insert into native_auth_code (id, user_id, session_id, code_challenge, state, expires_at)
    values (${codeHash}, ${identity.userId}, ${sessionHash},
            ${input.codeChallenge}, ${input.state}, ${expiresAt})
  `);
  return code;
}
```

`accessForEmail` is imported from `./access`; check whether `auth.ts` already imports it and do not duplicate the import.

In `worker/src/routes/session.ts`, add the route inside `handleSession`, following the shape of the routes already there:

```typescript
  if (url.pathname === '/api/auth/native/code' && request.method === 'POST') {
    /* Same Origin check as routes/access.ts: this route converts a cookie
       into a token, so a cross-site page must never be able to call it. */
    if (!(env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).includes(request.headers.get('Origin') ?? '')) {
      return json({ ok: false, err: 'Untrusted request origin.' }, { status: 403 }, cors);
    }
    const token = readSessionToken(request);
    if (!token) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);
    const body = (await request.json().catch(() => ({})) ?? {}) as { state?: unknown; codeChallenge?: unknown };
    const state = typeof body.state === 'string' ? body.state : '';
    const codeChallenge = typeof body.codeChallenge === 'string' ? body.codeChallenge : '';
    if (!/^[A-Za-z0-9._~-]{16,128}$/.test(state) || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeChallenge)) {
      return json({ ok: false, err: 'state and codeChallenge are required' }, { status: 400 }, cors);
    }
    const code = await issueNativeCode(env, token, { state, codeChallenge });
    if (!code) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);
    return json({ ok: true, code }, {}, cors);
  }
```

Match the file's own `json(...)` helper signature rather than the one written here if it differs.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && pnpm vitest run test/native-auth.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src worker/test
git commit -m "feat: mint a one-time native auth code"
```

---

### Task 4: Exchange the code for a new session

**Files:**
- Modify: `worker/src/auth.ts` (add `redeemNativeCode`)
- Modify: `worker/src/routes/session.ts` (add the route)
- Test: `worker/test/native-auth.test.ts` (extend)

**Interfaces:**
- Consumes: `startSession` (now exported), `hashToken` from `src/auth.ts`.
- Produces: `redeemNativeCode(env, input: { code: string; state: string; codeVerifier: string }): Promise<Session | null>`. Route `POST /api/auth/native/token` answering `{ token, expiresAt }`.

- [ ] **Step 1: Write the failing test**

The verifier below hashes to the `CHALLENGE` constant from Task 3 — this is the RFC 7636 worked example, so a mistake in the S256 implementation fails here rather than in production:

```typescript
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

describe('exchanging a native code', () => {
  it('returns a session token that authenticates', async () => {
    const code = (await issueNativeCode(testEnv(), token, { state: STATE, codeChallenge: CHALLENGE }))!;
    const session = await redeemNativeCode(testEnv(), { code, state: STATE, codeVerifier: VERIFIER });
    expect(session).not.toBeNull();
    const identity = await verifySession(testEnv(), session!.token);
    expect(identity?.businessId).toBe(B);
  });

  /* A new row, not the browser's token: revoking the phone must not sign
     out the laptop. */
  it('mints a session distinct from the one that minted the code', async () => {
    const code = (await issueNativeCode(testEnv(), token, { state: STATE, codeChallenge: CHALLENGE }))!;
    const session = await redeemNativeCode(testEnv(), { code, state: STATE, codeVerifier: VERIFIER });
    expect(session!.token).not.toBe(token);
    const rows = await asApp((sql) => sql<{ id: string }[]>`select id from session where revoked_at is null`);
    expect(rows).toHaveLength(2);
  });

  it('refuses a second exchange of the same code', async () => {
    const code = (await issueNativeCode(testEnv(), token, { state: STATE, codeChallenge: CHALLENGE }))!;
    await redeemNativeCode(testEnv(), { code, state: STATE, codeVerifier: VERIFIER });
    expect(await redeemNativeCode(testEnv(), { code, state: STATE, codeVerifier: VERIFIER })).toBeNull();
  });

  it('refuses a wrong verifier', async () => {
    const code = (await issueNativeCode(testEnv(), token, { state: STATE, codeChallenge: CHALLENGE }))!;
    expect(await redeemNativeCode(testEnv(), { code, state: STATE, codeVerifier: 'wrongVerifier_wrongVerifier_wrongVerifier_x' })).toBeNull();
  });

  it('refuses a mismatched state', async () => {
    const code = (await issueNativeCode(testEnv(), token, { state: STATE, codeChallenge: CHALLENGE }))!;
    expect(await redeemNativeCode(testEnv(), { code, state: 'someone-elses-state', codeVerifier: VERIFIER })).toBeNull();
  });

  it('refuses an expired code', async () => {
    const code = (await issueNativeCode(testEnv(), token, { state: STATE, codeChallenge: CHALLENGE }))!;
    await asOwner((sql) => sql`update native_auth_code set expires_at = now() - interval '1 second'`);
    expect(await redeemNativeCode(testEnv(), { code, state: STATE, codeVerifier: VERIFIER })).toBeNull();
  });

  /* The browser session being revoked between mint and exchange means the
     person signed out; the code must die with it. */
  it('refuses when the minting session was revoked', async () => {
    const code = (await issueNativeCode(testEnv(), token, { state: STATE, codeChallenge: CHALLENGE }))!;
    await asOwner((sql) => sql`update session set revoked_at = now()`);
    expect(await redeemNativeCode(testEnv(), { code, state: STATE, codeVerifier: VERIFIER })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && pnpm vitest run test/native-auth.test.ts`
Expected: FAIL — `redeemNativeCode` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `worker/src/auth.ts`:

```typescript
/** PKCE S256: base64url(SHA-256(verifier)), no padding. */
async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Spend a native code and mint a fresh session for the app.
 *
 * The UPDATE is the lock: consuming and reading happen in one statement,
 * so two exchanges racing the same code cannot both succeed. The new
 * session is deliberately a new row rather than the browser's token —
 * revoking the phone must not sign out the laptop.
 */
export async function redeemNativeCode(
  env: Env,
  input: { code: string; state: string; codeVerifier: string },
): Promise<Session | null> {
  const id = await hashToken(input.code);
  return withUser(env, async (sql) => {
    const rows = await sql<{ user_id: string; session_id: string; code_challenge: string; state: string }[]>`
      update native_auth_code
         set consumed_at = now()
       where id = ${id}
         and consumed_at is null
         and expires_at > now()
      returning user_id, session_id, code_challenge, state
    `;
    if (rows.length === 0) return null;
    const row = rows[0];
    if (row.state !== input.state) return null;
    if (row.code_challenge !== (await s256(input.codeVerifier))) return null;

    const [live] = await sql<{ email: string }[]>`
      select u.email from session s join app_user u on u.id = s.user_id
       where s.id = ${row.session_id} and s.revoked_at is null and s.expires_at > now()
    `;
    if (!live) return null;

    return startSession(sql, row.user_id, live.email);
  });
}
```

A wrong state or verifier still consumes the code. That is deliberate: one guess, one code.

In `worker/src/routes/session.ts`, add the route, behind the auth burst limiter the way `/api/auth/request` is:

```typescript
  if (url.pathname === '/api/auth/native/token' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({})) ?? {}) as
      { code?: unknown; state?: unknown; codeVerifier?: unknown };
    const code = typeof body.code === 'string' ? body.code : '';
    const state = typeof body.state === 'string' ? body.state : '';
    const codeVerifier = typeof body.codeVerifier === 'string' ? body.codeVerifier : '';
    if (!code || !state || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
      return json({ ok: false, err: 'code, state and codeVerifier are required' }, { status: 400 }, cors);
    }
    const session = await redeemNativeCode(env, { code, state, codeVerifier });
    if (!session) return json({ ok: false, err: 'that code is not valid' }, { status: 400 }, cors);
    return json({ ok: true, token: session.token, expiresAt: session.expiresAt.toISOString() }, {}, cors);
  }
```

Read how `/api/auth/request` reaches `AUTH_BURST` in this file and apply the same brake here; do not invent a second mechanism.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && pnpm vitest run test/native-auth.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the suite and both typecheck passes**

Run: `cd worker && pnpm test && pnpm typecheck`
Expected: the same 5 pre-existing failures and no others.

- [ ] **Step 6: Commit**

```bash
git add worker/src worker/test
git commit -m "feat: exchange a native code for a session

PKCE S256 and a state echo, because the callback arrives on a custom
scheme any app can claim. Without state, an attacker could mint a code on
their own account and hand the victim a link that signs their phone into
the attacker's business."
```

---

## What this plan does not cover

- **The app half**: the system-browser flow, the `state`/verifier generation, Keychain and Keystore storage, and the `/signin?native=1` branch. Another session owns `app/` and `mobile/` right now.
- **Universal Links and App Links**, including `apple-app-site-association` and the Play App Signing hash in `assetlinks.json`.
- **The run-stream ticket and native artifact downloads** — both regress natively without further work; they are named in the spec and want their own plan.
- **A devices list and sign-out-everywhere**, which needs `kind`, `device_label` and `last_seen_at` on `session`.
- **Native push** (APNs and FCM), which is a separate plan.
