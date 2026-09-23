# Bookings v1, plan 2: public pages

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A business's customers can open a public booking page, pick a
service and a time, leave a name and a Malaysian phone number, and send a
request. The owner is notified. The pages are served by a second deploy of
`worker/` on its own origin, with no cookies and no credential secrets.

**Architecture:**
- **Link names stay put.** Every name a business has published stays with
  that business, so a link shared before a rename can never reach another
  business. Old names redirect to the current one.
- **Reads and writes live in `src/apps/bookings/`,** sharing the tenancy and
  slot code from plan 1.
  - Public reads: `public.ts`.
  - Request creation: `request.ts`. It locks the installation first, then the
    service, and is safe to retry.
- **HTML is rendered on the server** by `src/sites/render.ts`: escaped,
  bilingual, and working without JavaScript apart from the Turnstile widget.
- **`src/sites/index.ts` is the whole sites entry.** `[env.sites]` in
  `wrangler.toml` deploys it as the Worker `jentera-sites`.
- **A predeploy check keeps the two deploys' pilot flags identical.**

**Tech stack:** Cloudflare Workers (TypeScript), postgres.js through
Hyperdrive, Neon Postgres with forced RLS, Vitest with a throwaway Docker
Postgres, `node --test` for scripts, and Cloudflare Turnstile.

**Spec:** [`docs/plans/2026-09-23-apps-shell-and-bookings-v1.md`](2026-09-23-apps-shell-and-bookings-v1.md),
approved at `70c453b`, section "Public pages: the sites deploy". Plan 1's
as-built notes at the end of
[`2026-09-23-bookings-v1-plan-1-worker-foundation.md`](2026-09-23-bookings-v1-plan-1-worker-foundation.md)
list what this plan must honour. This plan also settles one of those notes,
holding released link names, which the spec left open.

**Branch:** keep working on `bookings-v1` in the existing worktree at
`~/.agent-worktree/workspaces/aisar-site-b726b8/bookings-v1`. Do not merge it
into `main`: it must not reach `main` until migration 068 is live in
production (see plan 1's notes). Nothing in this plan deploys.

## Global constraints

Copied from the spec. Every task must respect them.

- **Tenancy:**
  - `resolveTenant` stays the only source of a business id for owner routes.
  - The public side finds a business only through `bookings_by_slug`, a
    security definer. Everything after that runs in
    `withTenant(businessId)`.
  - RLS is forced on every new table, with a tenant policy that has both
    `using` and `with check`.
- **Grants:** `aisar_app` holds exactly what the code uses. The registry
  table `app_slug` gets select and insert only.
- **The pilot flag:** `appsEnabledFor(env, businessId)`. A business off the
  list answers **404** on every public path, receipts included. Paused
  (`app_installation.state = 'paused'`) or not accepting
  (`booking_settings.accepting = false`) shows **"Not taking bookings right
  now"**, not a 404. That applies to both new pages and form posts.
- **The sites deploy never reads or sets a cookie.** Its only secret is
  `TURNSTILE_SECRET`. Its env type is `SitesEnv`, a `Pick` of `Env`. It
  answers 404 for every path outside `/b/...`, `/api/*` included.
- **Every sites response carries these headers:**
  - `Content-Security-Policy: default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `X-Robots-Tag: noindex`
  - `Cache-Control: no-store`
  - no `Set-Cookie`, ever
- **Escaping:** every string a business or a customer supplied is
  HTML-escaped when rendered.
- **Turnstile:**
  - The booking form's widget uses action `booking`.
  - The server accepts a token only with action `booking`, minted on the
    sites host (`new URL(SITES_ORIGIN).hostname`).
  - Missing or rejected: the form is shown again with an error.
  - `'unavailable'`: the request is admitted, as the sign-in doors do.
  - With no secret, there is no check.
- **Abuse limits:**
  - `BOOKING_BURST.limit({ key: 'book:' + clientIp })`, at 10 per 60 s.
  - At most **200 new requests per business per Malaysian calendar day**,
    counted across every service and status under the installation lock.
    Declining or cancelling does not give the allowance back.
- **Submission keys:**
  - A random UUID travels in a hidden `submission_key` field.
  - The digest covers the normalized service, start, name, phone, party size
    and note, and never the Turnstile token.
  - An identical replay returns the original receipt, with no new booking, no
    notification and no daily-cap use. The same key with a changed payload
    answers **409**.
  - The replay check runs **before** Turnstile, because the original token may
    already have been used up.
- **Lock order:** `app_installation` first, then the service (`for update`),
  then bookings. The config save's capacity and removal checks depend on this
  order.
- **Validation:**
  - Phone: `normalizeMyPhone` (stored as `^60[0-9]{8,11}$`).
  - Name: trimmed, 1–80 characters.
  - Note: 500 characters at most.
  - Party size: 1 to the places left.
  - Start: must equal a start `openSlots` offers for that Malaysian date.
- **Snapshots:** `booking.service_name`, `starts_at` and `ends_at` are copied
  when the request is created. Start times are exact to the minute.
- **Guard `duration_minutes > 0`** when building a slot service from database
  rows. `openSlots` would loop forever on zero.
- **Owners are notified** with `createNotification`, one per owner:
  - `kind: 'booking_requested'`
  - `sourceKey: 'booking:<id>'`
  - `url: '/app?view=apps&app=bookings&booking=<id>'`
- **Privacy notice (PDPA),** shown above the submit button with a link to
  `https://jentera.ai/privacy`:
  - English: "Your name and phone number go to \<Business\> to handle this booking."
  - Malay: "Nama dan nombor telefon anda dihantar kepada \<Business\> untuk menguruskan tempahan ini."
- **Logging:** never log customer names, phone numbers or notes.
- **Language:** the page follows `business.lang` (`en` or `bm`). A `?lang=`
  choice is carried through every link, form and redirect. HTML `lang` is
  `ms` for Malay.
- **The done page** is a generic receipt: the reference, validated against
  `^[A-HJ-NP-Z2-9]{6}$`, and never any customer detail or decision state.
- **Workflow:**
  - Stage named paths only.
  - Single test files run with `pnpm exec vitest run <files>`; never use
    `pnpm test -- --run`.
  - Run `pnpm typecheck` (both passes) before claiming a task done.
  - Tests need Docker.

## Review focus

Five inputs the spec implies that a task could easily miss. Each has a test
in its owning task.

1. **A customer opens a link the owner shared before renaming it.** They land
   on the current page (301), not a 404, and never on another business's page.
   Tested in Tasks 1 and 6.
2. **A customer double-taps Send, or reloads after a lost response.** Exactly
   one booking and one notification per owner, and the same receipt. Tested
   in Tasks 4 and 6.
3. **A form left open overnight while the owner pauses bookings.** Submitting
   it is refused politely and creates nothing. Tested in Tasks 4 and 6.
4. **A business or service name containing `<script>`.** It renders as text
   everywhere, including the privacy notice and the page title. Tested in
   Tasks 5 and 6.
5. **The chosen time fills while the customer types.** The request is refused
   with "That time was just taken" and the customer is sent back to the times,
   rather than being overbooked. Tested in Tasks 4 and 6.

---

## File structure

**Created:**

| File | Holds |
|---|---|
| `worker/src/sites/env.ts` | `SitesEnv` |
| `worker/src/sites/render.ts` | HTML, strings, headers, redirects |
| `worker/src/sites/index.ts` | The sites fetch handler (`handleSites`, default export) |
| `worker/src/apps/bookings/public.ts` | Slug resolution, the public page, open times, reservations |
| `worker/src/apps/bookings/reference.ts` | Booking references |
| `worker/src/apps/bookings/request.ts` | Form parsing, the submission digest, replay lookup, request creation |
| `worker/scripts/check-apps-flags.mjs` | The flag-drift check |
| `worker/scripts/check-apps-flags.test.mjs` | Its `node:test` suite |

**Test files created:**
- `worker/test/apps-public.test.ts`
- `worker/test/apps-request.test.ts`
- `worker/test/sites-render.test.ts`
- `worker/test/sites.test.ts`

**Modified:**

| File | Change |
|---|---|
| `worker/migrations/068_apps_bookings.sql` | Adds the `app_slug` registry; `bookings_by_slug` also returns the current slug. Edited in place because 068 is not applied anywhere. |
| `worker/scripts/apply-apps-bookings.mjs` | Verifies `app_slug` |
| `worker/test/apps-migration.test.ts` | Covers the registry |
| `worker/src/apps/bookings/config.ts` | Claims names through the registry |
| `worker/test/apps-config-route.test.ts` | Covers the rename hold |
| `worker/src/db.ts` | `DatabaseEnv` |
| `worker/src/apps/gating.ts` | A narrow env type |
| `worker/src/env.ts` | Adds `TURNSTILE_SITE_KEY` and `BOOKING_BURST` |
| `worker/src/turnstile.ts` | Adds the expectation option |
| `worker/test/turnstile.test.ts` | Covers it |
| `worker/wrangler.toml` | Adds `[env.sites]` |
| `worker/package.json` | Adds `predeploy` checks and `deploy:sites` |

Documentation (`CLAUDE.md`, `docs/architecture.md`, `docs/todo.md`) is left
for plan 4's last task, so it is written once for the whole feature.

---

## Task 0: Workspace (controller)

- [ ] **Step 1: Confirm the branch state.** The worktree must be clean on
  `bookings-v1`, and the suite and typecheck must pass.

```bash
cd ~/.agent-worktree/workspaces/aisar-site-b726b8/bookings-v1/worker
git status --short && git log --oneline -1
docker info >/dev/null && pnpm typecheck && pnpm exec vitest run test/apps-migration.test.ts test/apps-config-route.test.ts test/apps-bookings-route.test.ts
```

Expected: a clean tree, and every listed test passing.

---

## Task 1: Link-name registry

**Files:**
- Modify: `worker/migrations/068_apps_bookings.sql`. Add the `app_slug` block
  directly after the `app_installation` block, and replace the
  `bookings_by_slug` function.
- Modify: `worker/scripts/apply-apps-bookings.mjs` (the `TABLES` constant)
- Modify: `worker/src/apps/bookings/config.ts` (`saveConfig`, plus a new
  `claimName`)
- Test: `worker/test/apps-migration.test.ts`
- Test: `worker/test/apps-config-route.test.ts`

**Interfaces:**
- **New table:**
  `app_slug(public_slug text primary key, business_id uuid, app_key text, created_at timestamptz)`
- **`bookings_by_slug(p_slug text)`** now returns
  `table(business_id uuid, current_slug text)`. The current slug is public:
  it is the page's own link.
- **Consumed later:** Task 3's `resolvePublicSlug` reads
  `business_id, current_slug`.

- [ ] **Step 1: Update the migration test.** In
  `worker/test/apps-migration.test.ts`:

  a. In the top-level `beforeEach`, right after the `insert into app_installation …`
  statement, add:

```ts
    await sql`insert into app_slug (public_slug, business_id, app_key)
      values ('alpha-studio', ${A}, 'bookings'), ('beta-salon', ${B}, 'bookings')`;
```

  b. In "resolves a public slug to a business id and nothing else", change the
  first assertion:

```ts
    expect(found).toEqual({ business_id: A, current_slug: 'alpha-studio' });
```

  c. Add two tests to the `'apps and bookings schema'` describe:

```ts
  it('resolves a name the business used before to its current name', async () => {
    await asOwner((sql) => sql`insert into app_slug (public_slug, business_id, app_key)
      values ('alpha-old', ${A}, 'bookings')`);
    const [found] = await asApp((sql) => sql`select * from public.bookings_by_slug('alpha-old')`);
    expect(found).toEqual({ business_id: A, current_slug: 'alpha-studio' });
  });

  it('never lets a second business register a name another business holds', async () => {
    await expect(asTenant(B, (tx) => tx`
      insert into app_slug (public_slug, business_id, app_key) values ('alpha-studio', ${B}, 'bookings')`))
      .rejects.toThrow(/app_slug_pkey|duplicate key/);
  });
```

  d. In the `'grants and row-level security on the Bookings tables'` describe,
  add `app_slug: ['select', 'insert'],` to `EXPECTED`. Its rows already exist
  from the top-level `beforeEach`, so the isolation and grant loops cover it.

- [ ] **Step 2: Add a config route test.** In
  `worker/test/apps-config-route.test.ts`, inside the
  `'apps route: config'` describe:

```ts
  it('keeps a renamed link name with its business: another business cannot take it, the owner can return to it', async () => {
    const first = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config()));
    const svc = first.config.services[0].id;
    expect((await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ version: 1, slug: 'kedai-baru', services: [service({ id: svc })] }))).status).toBe(200);
    const taken = await call('PUT', '/api/apps/bookings/config', ownerB, config());
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: 'SLUG_TAKEN' });
    expect((await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ version: 2, slug: 'kedai-aisyah', services: [service({ id: svc })] }))).status).toBe(200);
    const names = await asOwner((sql) => sql<{ public_slug: string }[]>`
      select public_slug from app_slug where business_id = ${A} order by public_slug`);
    expect(names.map((n) => n.public_slug)).toEqual(['kedai-aisyah', 'kedai-baru']);
  });
```

- [ ] **Step 3: Run both files and confirm they fail.**

```bash
pnpm exec vitest run test/apps-migration.test.ts test/apps-config-route.test.ts
```

Expected: FAIL with `relation "app_slug" does not exist`.

- [ ] **Step 4: Add the registry to the migration.** In
  `worker/migrations/068_apps_bookings.sql`, directly after the
  `revoke … on app_installation from aisar_app;` line, add:

```sql
-- Every link name a business has published. A name stays with the business
-- that first used it, so a link shared before a rename can only ever reach
-- the same business (the public page redirects it to the current name) and
-- never another one. Rows are never updated or deleted.
create table if not exists app_slug (
  public_slug text primary key check (public_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  business_id uuid not null references business(id) on delete cascade,
  app_key     text not null check (app_key in ('bookings')),
  created_at  timestamptz not null default now()
);
create index if not exists app_slug_business on app_slug (business_id);
alter table app_slug enable row level security;
alter table app_slug force row level security;
drop policy if exists app_slug_tenant on app_slug;
create policy app_slug_tenant on app_slug
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert on app_slug to aisar_app;
revoke update, delete, truncate, references, trigger on app_slug from aisar_app;
```

- [ ] **Step 5: Replace the slug function.** Replace the whole
  `bookings_by_slug` definition, from its comment down to its `grant execute`
  line, with:

```sql
-- The public page has no tenant. Like invitation_by_token (035) this returns
-- an id — plus the business's current link name, which is public anyway, so
-- a held name can redirect. Paused installations resolve so the page can say
-- "not taking bookings". The pilot flag is checked in the Worker.
drop function if exists public.bookings_by_slug(text);
create function public.bookings_by_slug(p_slug text)
returns table (business_id uuid, current_slug text)
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select a.business_id, a.public_slug from public.app_installation a
   where a.public_slug = p_slug and a.app_key = 'bookings'
  union all
  select a.business_id, a.public_slug from public.app_slug s
    join public.app_installation a on a.business_id = s.business_id and a.app_key = s.app_key
   where s.public_slug = p_slug and s.app_key = 'bookings'
  limit 1
$$;
revoke all on function public.bookings_by_slug(text) from public;
grant execute on function public.bookings_by_slug(text) to aisar_app;
```

- [ ] **Step 6: Add the registry to the apply script.** In
  `worker/scripts/apply-apps-bookings.mjs`:
  - Add this line to `TABLES`:

```js
  app_slug: ['select', 'insert'],
```

  - In the `const [fn] = await tx\`select …\`` block, add a column after
    `slug_fn`:

```js
        pg_get_function_result('public.bookings_by_slug(text)'::regprocedure) as slug_fn_result,
```

  - Directly after the `for (const key of [...])` loop, add:

```js
    if (fn.slug_fn_result !== 'TABLE(business_id uuid, current_slug text)') {
      throw new Error(`apps migration verification failed: bookings_by_slug returns ${fn.slug_fn_result}`);
    }
```

- [ ] **Step 7: Claim names through the registry.** In
  `worker/src/apps/bookings/config.ts`, add this function above `saveConfig`:

```ts
/** Record a link name for this business. A name any business has published
    stays with it: another business gets SLUG_TAKEN, and a business may go
    back to one of its own earlier names. Row-level security hides other
    businesses' names, so a row this query can see is this business's own. */
async function claimName(tx: postgres.TransactionSql, businessId: string, slug: string): Promise<void> {
  const [claimed] = await tx<{ public_slug: string }[]>`
    insert into app_slug (public_slug, business_id, app_key)
    values (${slug}, ${businessId}, 'bookings')
    on conflict (public_slug) do nothing
    returning public_slug`;
  if (claimed) return;
  const [own] = await tx`select 1 from app_slug where public_slug = ${slug} and business_id = ${businessId}`;
  if (!own) throw new ConfigError('SLUG_TAKEN');
}
```

  Then, in `saveConfig`, add `await claimName(tx, businessId, input.slug);` in
  two places:
  - **First install:** directly after the two `throw new ConfigError(...)`
    checks and before the `claimSlug(... insert into app_installation ...)`
    call.
  - **Rename:** directly inside `if (input.slug !== existing.public_slug) {`,
    before the `claimSlug(... update app_installation ...)` call.

  Keep `claimSlug` around the installation writes as a second guard.

- [ ] **Step 8: Run the tests.**

```bash
pnpm exec vitest run test/apps-migration.test.ts test/apps-config-route.test.ts test/apps-bookings-route.test.ts
```

Expected: all pass. The route fixtures insert `app_installation` rows
directly with no registry row. That still works: the function's first branch
reads `app_installation`.

- [ ] **Step 9: Typecheck and commit.**

```bash
pnpm typecheck
git add migrations/068_apps_bookings.sql scripts/apply-apps-bookings.mjs src/apps/bookings/config.ts test/apps-migration.test.ts test/apps-config-route.test.ts
git commit -m "feat(worker): link names stay with the business that published them"
```

---

## Task 2: Narrow env types and a Turnstile expectation

**Files:**
- Modify: `worker/src/db.ts` (`connect`, `withTenant`, `withUser`)
- Modify: `worker/src/apps/gating.ts` (`appsEnabledFor`)
- Modify: `worker/src/env.ts`, after `TURNSTILE_SECRET?: string;`
- Modify: `worker/src/turnstile.ts`
- Create: `worker/src/sites/env.ts`
- Test: `worker/test/turnstile.test.ts`

**Interfaces:**
- **Produced:**
  - `export type DatabaseEnv = Pick<Env, 'HYPERDRIVE'>` from `db.ts`. The
    three functions accept it, and a full `Env` still satisfies it.
  - `appsEnabledFor(env: Pick<Env, 'APPS_ENABLED' | 'APPS_BUSINESS_IDS'>, businessId)`.
  - `verifyTurnstile(env, token, ip, fetchImpl?, expected?: TurnstileExpectation)`.
    `TurnstileExpectation` is `{ action: string; hostnames: ReadonlySet<string> }`.
    Without `expected`, today's sign-in check applies unchanged.
  - `SitesEnv` from `src/sites/env.ts`.

- [ ] **Step 1: Write the failing tests.** Append to
  `worker/test/turnstile.test.ts`:

```ts
describe('verifyTurnstile for another page', () => {
  const booking = { action: 'booking', hostnames: new Set(['sites.test']) };

  it('accepts a token minted on the booking page', async () => {
    const fetchMock = outbound(true, { action: 'booking', hostname: 'sites.test' });
    expect(await verifyTurnstile(env(), 'token', '203.0.113.9', fetchMock, booking)).toBe('ok');
  });

  it('refuses a sign-in token on the booking page, and a booking token from another host', async () => {
    expect(await verifyTurnstile(env(), 'token', '203.0.113.9', outbound(true), booking)).toBe('rejected');
    expect(await verifyTurnstile(env(), 'token', '203.0.113.9',
      outbound(true, { action: 'booking', hostname: 'jentera.ai' }), booking)).toBe('rejected');
  });

  it('keeps the sign-in check unchanged when no expectation is passed', async () => {
    expect(await verifyTurnstile(env(), 'token', '203.0.113.9', outbound(true))).toBe('ok');
    expect(await verifyTurnstile(env(), 'token', '203.0.113.9',
      outbound(true, { action: 'booking', hostname: 'jentera.ai' }))).toBe('rejected');
  });

  it('needs no ALLOWED_ORIGINS when an expectation is passed', async () => {
    const sitesOnly = { TURNSTILE_SECRET: 'ts-secret' };
    const fetchMock = outbound(true, { action: 'booking', hostname: 'sites.test' });
    expect(await verifyTurnstile(sitesOnly, 'token', '203.0.113.9', fetchMock, booking)).toBe('ok');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

```bash
pnpm exec vitest run test/turnstile.test.ts
```

Expected: FAIL. The new cases get `'rejected'`, because the action is fixed
to `signin`, and TypeScript refuses the fifth argument.

- [ ] **Step 3: Narrow `db.ts`.** In `worker/src/db.ts`, add
  `export type DatabaseEnv = Pick<Env, 'HYPERDRIVE'>;` after the imports. In
  the signatures of `connect`, `withTenant` and `withUser`, change `env: Env`
  to `env: DatabaseEnv`. Nothing else changes.

- [ ] **Step 4: Narrow `appsEnabledFor`.** In `worker/src/apps/gating.ts`,
  change the signature to:

```ts
export function appsEnabledFor(env: Pick<Env, 'APPS_ENABLED' | 'APPS_BUSINESS_IDS'>, businessId: string): boolean {
```

- [ ] **Step 5: Add the env fields.** In `worker/src/env.ts`, after
  `TURNSTILE_SECRET?: string;`, add:

```ts
  /* Sites deploy only (jentera-sites, [env.sites]). The public Turnstile
     site key the booking form renders; the same value as the app's
     VITE_TURNSTILE_SITE_KEY. */
  TURNSTILE_SITE_KEY?: string;
  /* Sites deploy only: 10 booking-form posts per 60 s per address. */
  BOOKING_BURST?: RateLimit;
```

- [ ] **Step 6: Create `worker/src/sites/env.ts`.**

```ts
import type { Env } from '../env';

/** Everything the public booking pages may touch, and nothing more: no
    credential key, vault, email, billing or runtime binding. Code the sites
    entry imports is typed against this, so reaching for more is a compile
    error, not a secret that happens to be unset. */
export type SitesEnv = Pick<Env,
  'HYPERDRIVE' | 'APPS_ENABLED' | 'APPS_BUSINESS_IDS' | 'SITES_ORIGIN' |
  'TURNSTILE_SECRET' | 'TURNSTILE_SITE_KEY' | 'BOOKING_BURST'>;
```

- [ ] **Step 7: Add the expectation to `worker/src/turnstile.ts`.**
  - Add the type `TurnstileEnv`, and change `allowedHostnames` and
    `turnstileConfigured` to take it:

```ts
type TurnstileEnv = { TURNSTILE_SECRET?: string; ALLOWED_ORIGINS?: string };

/** What a token must say to count: the action its widget was rendered with
    and the hostnames it may have been minted on. */
export interface TurnstileExpectation { action: string; hostnames: ReadonlySet<string> }
```

  - `allowedHostnames(env: TurnstileEnv)` keeps its body.
    `turnstileConfigured(env: Pick<TurnstileEnv, 'TURNSTILE_SECRET'>)` keeps its
    body.
  - Change `verifyTurnstile`'s signature to:

```ts
export async function verifyTurnstile(
  env: TurnstileEnv,
  token: unknown,
  ip: string,
  fetchImpl: Fetcher = fetch,
  expected?: TurnstileExpectation,
): Promise<TurnstileVerdict> {
```

  - Replace the two lines that check `verdict.action` and `verdict.hostname`
    with:

```ts
    const wanted = expected ?? { action: TURNSTILE_ACTION, hostnames: allowedHostnames(env) };
    if (verdict.action !== wanted.action) return 'rejected';
    if (typeof verdict.hostname !== 'string' || !wanted.hostnames.has(verdict.hostname)) return 'rejected';
```

- [ ] **Step 8: Run the tests.**

```bash
pnpm exec vitest run test/turnstile.test.ts test/apps-gating.test.ts
```

Expected: all pass, and the existing sign-in door tests still pass.

- [ ] **Step 9: Typecheck and commit.**

```bash
pnpm typecheck
git add src/db.ts src/apps/gating.ts src/env.ts src/turnstile.ts src/sites/env.ts test/turnstile.test.ts
git commit -m "feat(worker): narrow env types for the sites deploy, and a Turnstile expectation per page"
```

---

## Task 3: Public reads

**Files:**
- Create: `worker/src/apps/bookings/public.ts`
- Test: `worker/test/apps-public.test.ts`

**Interfaces:**
- **Consumes:**
  - `withTenant`, `withUser` and `DatabaseEnv` (Task 2)
  - `openSlots`, `OpenSlot` and `Reservation` (plan 1)
  - `addDays`, `myDate` and `myInstant` (plan 1)
  - `Lang` (plan 1)
- **Produces:**
  - `PublicService` is `{ id; name; durationMinutes; capacity; priceLabel; hours }`.
  - `PublicPage` is
    `{ businessName; lang; open: boolean; settings: { minNoticeMinutes; horizonDays }; services: PublicService[] }`.
  - `DayTimes` is `{ date: string; slots: OpenSlot[] }`.
  - `resolvePublicSlug(env, slug)` returns
    `Promise<{ businessId; currentSlug } | null>`.
  - `readPublicPage(tx, businessId)` and `loadPublicPage(env, businessId)`
    return `PublicPage | null`.
  - `reservationsFor(tx, businessId, serviceId, from: Date, to: Date)`
    returns `Reservation[]`.
  - `loadOpenTimes(env, businessId, serviceId, from, days, now)` returns
    `Promise<{ page; service; days: DayTimes[] } | null>`.
- **The rules:** `open` is `state === 'active' && accepting`. Only active
  services with `duration_minutes > 0` are listed.

- [ ] **Step 1: Write the failing test** at `worker/test/apps-public.test.ts`.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { loadOpenTimes, loadPublicPage, resolvePublicSlug } from '../src/apps/bookings/public';
import { asOwner, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ENV = testEnv();
// Monday 5 Oct 2026, 08:00 in Malaysia. Tuesday 6 Oct is weekday 2.
const NOW = new Date('2026-10-05T00:00:00Z');
let serviceA = '';
let serviceB = '';

beforeEach(async () => {
  await truncateAll();
  const ids = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded, lang)
      values (${A}, 'SEIDO <Coffee>', 'services', true, 'en'), (${B}, 'Beta', 'salon', true, 'bm')`;
    await sql`insert into app_installation (business_id, app_key, public_slug)
      values (${A}, 'bookings', 'seido'), (${B}, 'bookings', 'beta')`;
    await sql`insert into app_slug (public_slug, business_id, app_key)
      values ('seido', ${A}, 'bookings'), ('seido-lama', ${A}, 'bookings'), ('beta', ${B}, 'bookings')`;
    await sql`insert into booking_settings (business_id, availability_acknowledged_at, min_notice_minutes, horizon_days)
      values (${A}, now(), 120, 30), (${B}, now(), 0, 30)`;
    const [a] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
      values (${A}, 'Cupping class', 60, 2) returning id`;
    await sql`insert into booking_service (business_id, name, duration_minutes, capacity, active)
      values (${A}, 'Old workshop', 60, 2, false)`;
    const [b] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
      values (${B}, 'Haircut', 30, 1) returning id`;
    await sql`insert into booking_hours (business_id, service_id, weekday, opens, closes)
      values (${A}, ${a.id}, 2, '10:00', '13:00'), (${B}, ${b.id}, 2, '10:00', '11:00')`;
    return { a: a.id, b: b.id };
  });
  serviceA = ids.a;
  serviceB = ids.b;
});

describe('public reads', () => {
  it('resolves current and held names, and nothing for unknown ones', async () => {
    expect(await resolvePublicSlug(ENV, 'seido')).toEqual({ businessId: A, currentSlug: 'seido' });
    expect(await resolvePublicSlug(ENV, 'seido-lama')).toEqual({ businessId: A, currentSlug: 'seido' });
    expect(await resolvePublicSlug(ENV, 'nobody')).toBeNull();
  });

  it('lists only active services, and reports whether the page is open', async () => {
    const page = await loadPublicPage(ENV, A);
    expect(page).toMatchObject({ businessName: 'SEIDO <Coffee>', lang: 'en', open: true });
    expect(page!.services.map((s) => s.name)).toEqual(['Cupping class']);
    await asOwner((sql) => sql`update booking_settings set accepting = false where business_id = ${A}`);
    expect((await loadPublicPage(ENV, A))!.open).toBe(false);
    await asOwner((sql) => sql`update booking_settings set accepting = true where business_id = ${A}`);
    await asOwner((sql) => sql`update app_installation set state = 'paused' where business_id = ${A}`);
    expect((await loadPublicPage(ENV, A))!.open).toBe(false);
  });

  it('offers open times with places left, minus held places, per Malaysian day', async () => {
    await asOwner((sql) => sql`insert into booking (business_id, reference, submission_key, submission_hash, service_id,
      service_name, starts_at, ends_at, party_size, customer_name, customer_phone, status)
      values (${A}, 'K7Q2MP', gen_random_uuid(), 'h', ${serviceA}, 'Cupping class',
        '2026-10-06T02:00:00Z', '2026-10-06T03:00:00Z', 2, 'Aisyah', '60123456789', 'pending')`);
    const times = await loadOpenTimes(ENV, A, serviceA, '2026-10-06', 1, NOW);
    expect(times!.days).toHaveLength(1);
    expect(times!.days[0].slots.map((s) => [s.startsAt.toISOString(), s.remaining])).toEqual([
      ['2026-10-06T03:00:00.000Z', 2], ['2026-10-06T04:00:00.000Z', 2],
    ]);
  });

  it('starts from today when asked for a past date, and refuses other businesses\' or inactive services', async () => {
    const times = await loadOpenTimes(ENV, A, serviceA, '2026-09-01', 3, NOW);
    expect(times!.days.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    expect(await loadOpenTimes(ENV, A, serviceB, '2026-10-06', 1, NOW)).toBeNull();
    const [inactive] = await asOwner((sql) => sql<{ id: string }[]>`
      select id from booking_service where business_id = ${A} and not active`);
    expect(await loadOpenTimes(ENV, A, inactive.id, '2026-10-06', 1, NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

```bash
pnpm exec vitest run test/apps-public.test.ts
```

Expected: FAIL with `Cannot find module '../src/apps/bookings/public'`.

- [ ] **Step 3: Create `worker/src/apps/bookings/public.ts`.**

```ts
import type postgres from 'postgres';
import { withTenant, withUser, type DatabaseEnv } from '../../db';
import type { Lang } from './messages';
import { openSlots, type OpenSlot, type Reservation } from './slots';
import { addDays, myDate, myInstant } from './time';

/* What a business's customers may see, read for the public booking pages.
   The business is found only through bookings_by_slug; everything after
   runs inside withTenant, so row-level security scopes every read. */

export interface PublicService {
  id: string;
  name: string;
  durationMinutes: number;
  capacity: number;
  priceLabel: string | null;
  hours: { weekday: number; opens: string; closes: string }[];
}

export interface PublicPage {
  businessName: string;
  lang: Lang;
  /** Taking new requests: the installation is active and the owner has not paused it. */
  open: boolean;
  settings: { minNoticeMinutes: number; horizonDays: number };
  services: PublicService[];
}

export interface DayTimes { date: string; slots: OpenSlot[] }

export async function resolvePublicSlug(env: DatabaseEnv, slug: string): Promise<{ businessId: string; currentSlug: string } | null> {
  const [row] = await withUser(env, (sql) => sql<{ business_id: string; current_slug: string }[]>`
    select business_id, current_slug from public.bookings_by_slug(${slug})`);
  return row ? { businessId: row.business_id, currentSlug: row.current_slug } : null;
}

export async function readPublicPage(tx: postgres.TransactionSql, businessId: string): Promise<PublicPage | null> {
  const [business] = await tx<{ name: string; lang: Lang }[]>`select name, lang from business where id = ${businessId}`;
  const [installed] = await tx<{ state: 'active' | 'paused' }[]>`
    select state from app_installation where business_id = ${businessId} and app_key = 'bookings'`;
  const [settings] = await tx<{ accepting: boolean; min_notice_minutes: number; horizon_days: number }[]>`
    select accepting, min_notice_minutes, horizon_days from booking_settings where business_id = ${businessId}`;
  if (!business || !installed || !settings) return null;
  // duration_minutes > 0 guards openSlots, whose loop would never end on zero.
  const services = await tx<{ id: string; name: string; duration_minutes: number; capacity: number; price_label: string | null }[]>`
    select id, name, duration_minutes, capacity, price_label from booking_service
     where business_id = ${businessId} and active and duration_minutes > 0
     order by sort, name, id`;
  const hours = await tx<{ service_id: string; weekday: number; opens: string; closes: string }[]>`
    select service_id, weekday, to_char(opens, 'HH24:MI') as opens, to_char(closes, 'HH24:MI') as closes
      from booking_hours where business_id = ${businessId} order by weekday, opens`;
  return {
    businessName: business.name,
    lang: business.lang,
    open: installed.state === 'active' && settings.accepting,
    settings: { minNoticeMinutes: settings.min_notice_minutes, horizonDays: settings.horizon_days },
    services: services.map((s) => ({
      id: s.id, name: s.name, durationMinutes: s.duration_minutes, capacity: s.capacity, priceLabel: s.price_label,
      hours: hours.filter((h) => h.service_id === s.id).map(({ weekday, opens, closes }) => ({ weekday, opens, closes })),
    })),
  };
}

export async function loadPublicPage(env: DatabaseEnv, businessId: string): Promise<PublicPage | null> {
  return withTenant(env, businessId, (tx) => readPublicPage(tx, businessId));
}

/** Pending and confirmed bookings of one service overlapping [from, to). */
export async function reservationsFor(
  tx: postgres.TransactionSql,
  businessId: string,
  serviceId: string,
  from: Date,
  to: Date,
): Promise<Reservation[]> {
  const rows = await tx<{ starts_at: Date; ends_at: Date; party_size: number }[]>`
    select starts_at, ends_at, party_size from booking
     where business_id = ${businessId} and service_id = ${serviceId}
       and status in ('pending', 'confirmed') and starts_at < ${to} and ends_at > ${from}`;
  return rows.map((r) => ({ startsAt: r.starts_at, endsAt: r.ends_at, partySize: r.party_size }));
}

/** Open times for one service over `days` Malaysian days from `from`,
    starting no earlier than today. Horizon and notice come from openSlots. */
export async function loadOpenTimes(
  env: DatabaseEnv,
  businessId: string,
  serviceId: string,
  from: string,
  days: number,
  now: Date,
): Promise<{ page: PublicPage; service: PublicService; days: DayTimes[] } | null> {
  return withTenant(env, businessId, async (tx) => {
    const page = await readPublicPage(tx, businessId);
    const service = page?.services.find((s) => s.id === serviceId);
    if (!page || !service) return null;
    const today = myDate(now);
    const start = from < today ? today : from;
    const reservations = await reservationsFor(tx, businessId, service.id, myInstant(start), myInstant(addDays(start, days)));
    const slots = openSlots({ service, hours: service.hours, settings: page.settings, reservations, now, from: start, days });
    const out: DayTimes[] = [];
    for (let offset = 0; offset < days; offset += 1) {
      const date = addDays(start, offset);
      out.push({ date, slots: slots.filter((slot) => myDate(slot.startsAt) === date) });
    }
    return { page, service, days: out };
  });
}
```

- [ ] **Step 4: Run the test.**

```bash
pnpm exec vitest run test/apps-public.test.ts
```

Expected: all pass. At 10:00 the service holds 2 of its 2 places, so that
slot is gone, and 11:00 and 12:00 remain.

- [ ] **Step 5: Typecheck and commit.**

```bash
pnpm typecheck
git add src/apps/bookings/public.ts test/apps-public.test.ts
git commit -m "feat(worker): public reads for booking pages: names, services, open times"
```

---

## Task 4: Creating a booking request

**Files:**
- Create: `worker/src/apps/bookings/reference.ts`
- Create: `worker/src/apps/bookings/request.ts`
- Test: `worker/test/apps-request.test.ts`

**Interfaces:**
- **Consumes:**
  - `reservationsFor` (Task 3)
  - `openSlots` (plan 1)
  - `normalizeMyPhone` (plan 1)
  - `whenText` and `Lang` (plan 1)
  - `createNotification` (plan 1)
  - `ownersOf(tx, businessId)` from `src/notifications/recipients.ts`
  - `withTenant` and `DatabaseEnv` (Task 2)
  - `addDays`, `myDate` and `myInstant` (plan 1)
- **Produces from `reference.ts`:**
  - `REFERENCE`, the regex
  - `newReference(random?): string`
- **Produces from `request.ts`, the types:**
  - `RequestInput` is
    `{ serviceId; startsAt: Date; partySize; name; phone; note: string | null; submissionKey }`.
  - `RequestField` is `'service' | 'start' | 'name' | 'phone' | 'partySize' | 'note' | 'submission'`.
  - `ParsedRequest` is
    `{ ok: true; value: RequestInput } | { ok: false; errors: RequestField[]; raw: Record<string, string> }`.
  - `CreateResult` is
    `{ kind: 'created'; reference; bookingId } | { kind: 'replayed'; reference } | { kind: 'changed' } | { kind: 'unavailable' } | { kind: 'daily_cap' } | { kind: 'service_gone' } | { kind: 'taken' }`.
- **Produces from `request.ts`, the functions and constant:**
  - `parseRequestForm(form: FormData): ParsedRequest`
  - `submissionDigest(input): Promise<string>`
  - `findSubmission(env, businessId, key, digest)`, which returns
    `Promise<{ kind: 'replayed'; reference } | { kind: 'changed' } | null>`
  - `createBookingRequest(env, businessId, input, digest, now): Promise<CreateResult>`
  - `DAILY_CAP = 200`
- **The lock order** is the installation, then the service `for update`,
  then bookings. **`created_at` is written as `now`,** so the daily count and
  the tests agree on what "today" means.

- [ ] **Step 1: Write the failing test** at `worker/test/apps-request.test.ts`.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { newReference, REFERENCE } from '../src/apps/bookings/reference';
import {
  createBookingRequest, DAILY_CAP, findSubmission, parseRequestForm, submissionDigest, type RequestInput,
} from '../src/apps/bookings/request';
import { asOwner, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const ENV = testEnv();
const NOW = new Date('2026-10-05T00:00:00Z'); // Mon 08:00 Malaysia
const TEN = new Date('2026-10-06T02:00:00Z'); // Tue 10:00 Malaysia
let service = '';
let second = '';
let owners: string[] = [];

beforeEach(async () => {
  await truncateAll();
  const ids = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded, lang) values (${A}, 'SEIDO Coffee', 'services', true, 'en')`;
    const users = await sql<{ id: string }[]>`insert into app_user (email, email_verified)
      values ('o1@example.com', true), ('o2@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${users[0].id}, ${A}, 'owner'), (${users[1].id}, ${A}, 'owner')`;
    await sql`insert into app_installation (business_id, app_key, public_slug) values (${A}, 'bookings', 'seido')`;
    await sql`insert into booking_settings (business_id, availability_acknowledged_at, min_notice_minutes, horizon_days)
      values (${A}, now(), 120, 30)`;
    const [s1] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
      values (${A}, 'Cupping class', 60, 1) returning id`;
    const [s2] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
      values (${A}, 'Espresso basics', 60, 5) returning id`;
    // Monday 08:00-11:00 exists only to test the notice: at NOW (Mon 08:00)
    // with 120 minutes' notice, 08:00 and 09:00 are too soon.
    await sql`insert into booking_hours (business_id, service_id, weekday, opens, closes)
      values (${A}, ${s1.id}, 2, '10:00', '13:00'), (${A}, ${s2.id}, 2, '10:00', '13:00'),
             (${A}, ${s1.id}, 1, '08:00', '11:00')`;
    return { s1: s1.id, s2: s2.id, owners: users.map((u) => u.id) };
  });
  service = ids.s1;
  second = ids.s2;
  owners = ids.owners;
});

const input = (over: Partial<RequestInput> = {}): RequestInput => ({
  serviceId: service, startsAt: TEN, partySize: 1, name: 'Aisyah', phone: '60123456789', note: null,
  submissionKey: crypto.randomUUID(), ...over,
});
const send = async (value: RequestInput) => createBookingRequest(ENV, A, value, await submissionDigest(value), NOW);

describe('booking references', () => {
  it('are six characters with no 0, O, 1 or I', () => {
    for (let i = 0; i < 200; i += 1) expect(newReference()).toMatch(REFERENCE);
    expect(newReference(() => new Uint8Array([0, 1, 2, 3, 30, 31]))).toBe('ABCD89');
  });
});

describe('parseRequestForm', () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const good = { service: '11111111-1111-4111-8111-111111111112', start: TEN.toISOString(), party: '2',
    name: '  Aisyah   binti Ali ', phone: '012-345 6789', note: '', submission_key: '11111111-1111-4111-8111-111111111113' };

  it('normalises a good form', () => {
    const parsed = parseRequestForm(form(good));
    expect(parsed).toEqual({ ok: true, value: {
      serviceId: good.service, startsAt: TEN, partySize: 2, name: 'Aisyah binti Ali', phone: '60123456789',
      note: null, submissionKey: good.submission_key,
    } });
  });

  it('names every bad field', () => {
    const parsed = parseRequestForm(form({ ...good, name: ' ', phone: '12345', party: '0', note: 'x'.repeat(501), start: 'tomorrow' }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.sort()).toEqual(['name', 'note', 'partySize', 'phone', 'start']);
  });
});

describe('createBookingRequest', () => {
  it('creates a pending booking with snapshots and tells every owner where it is', async () => {
    const result = await send(input({ partySize: 1, note: 'Window seat' }));
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') return;
    expect(result.reference).toMatch(REFERENCE);
    const [row] = await asOwner((sql) => sql<{ status: string; service_name: string; ends_at: Date; created_at: Date }[]>`
      select status, service_name, ends_at, created_at from booking where id = ${result.bookingId}`);
    expect(row).toMatchObject({ status: 'pending', service_name: 'Cupping class' });
    expect(row.ends_at.toISOString()).toBe('2026-10-06T03:00:00.000Z');
    expect(row.created_at.toISOString()).toBe(NOW.toISOString());
    const notes = await asOwner((sql) => sql<{ recipient_user_id: string; kind: string; url: string; body: string }[]>`
      select recipient_user_id, kind, url, body from notification order by recipient_user_id`);
    expect(notes.map((n) => n.recipient_user_id).sort()).toEqual([...owners].sort());
    expect(notes[0]).toMatchObject({ kind: 'booking_requested', url: `/app?view=apps&app=bookings&booking=${result.bookingId}` });
    expect(notes[0].body).toContain('Aisyah');
  });

  it('returns the original receipt for an identical replay, and refuses a changed one', async () => {
    const value = input();
    const first = await send(value);
    const again = await send(value);
    expect(again).toEqual({ kind: 'replayed', reference: first.kind === 'created' ? first.reference : '' });
    expect(await send({ ...value, name: 'Someone else' })).toEqual({ kind: 'changed' });
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(1);
    expect(await asOwner((sql) => sql`select 1 from notification`)).toHaveLength(2);
    expect(await findSubmission(ENV, A, value.submissionKey, await submissionDigest(value)))
      .toEqual({ kind: 'replayed', reference: first.kind === 'created' ? first.reference : '' });
  });

  it('creates one booking when the same form is sent twice at once', async () => {
    const value = input();
    const results = await Promise.all([send(value), send(value)]);
    expect(results.map((r) => r.kind).sort()).toEqual(['created', 'replayed']);
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(1);
  });

  it('gives the last place to exactly one of two customers', async () => {
    const results = await Promise.all([send(input()), send(input())]);
    expect(results.map((r) => r.kind).sort()).toEqual(['created', 'taken']);
  });

  it('refuses a start the page never offered, one inside the notice, and a party larger than the places left', async () => {
    expect((await send(input({ startsAt: new Date('2026-10-06T02:30:00Z') }))).kind).toBe('taken');
    expect((await send(input({ startsAt: new Date('2026-10-05T01:00:00Z') }))).kind).toBe('taken');
    expect((await send(input({ serviceId: second, partySize: 6 }))).kind).toBe('taken');
  });

  it('refuses when the owner has paused, even for a form opened before', async () => {
    await asOwner((sql) => sql`update booking_settings set accepting = false where business_id = ${A}`);
    expect((await send(input())).kind).toBe('unavailable');
    await asOwner((sql) => sql`update booking_settings set accepting = true where business_id = ${A}`);
    await asOwner((sql) => sql`update app_installation set state = 'paused' where business_id = ${A}`);
    expect((await send(input())).kind).toBe('unavailable');
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(0);
  });

  it('refuses a service that is no longer offered', async () => {
    await asOwner((sql) => sql`update booking_service set active = false where id = ${service}`);
    expect((await send(input())).kind).toBe('service_gone');
  });

  it('holds the daily cap across services, even when two requests race for the last one', async () => {
    await asOwner((sql) => sql`insert into booking (business_id, reference, submission_key, submission_hash, service_id,
      service_name, starts_at, ends_at, party_size, customer_name, customer_phone, status, created_at)
      select ${A}, 'Z' || translate(lpad(g::text, 5, '2'), '01', 'AB'), gen_random_uuid(), 'h', ${second}, 'Espresso basics',
        '2026-11-01T02:00:00Z', '2026-11-01T03:00:00Z', 1, 'Filler', '60123456789', 'declined', ${NOW}
      from generate_series(1, ${DAILY_CAP - 1}::int) g`);
    const results = await Promise.all([send(input()), send(input({ serviceId: second }))]);
    expect(results.map((r) => r.kind).sort()).toEqual(['created', 'daily_cap']);
    const created = results.find((r) => r.kind === 'created');
    expect(created).toBeDefined();
  });
});
```

The filler references map the digits 0 and 1 to `A` and `B`, so all 199
are distinct and each matches `^[A-HJ-NP-Z2-9]{6}$`.

- [ ] **Step 2: Run the test and confirm it fails.**

```bash
pnpm exec vitest run test/apps-request.test.ts
```

Expected: FAIL with `Cannot find module '../src/apps/bookings/reference'`.

- [ ] **Step 3: Create `worker/src/apps/bookings/reference.ts`.**

```ts
/* What a customer quotes back: six characters with no 0/O or 1/I, so it reads
   aloud and types cleanly. 32 symbols divide 256 exactly, so each byte maps
   to a symbol with no bias. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REFERENCE = /^[A-HJ-NP-Z2-9]{6}$/;

export function newReference(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return [...random(6)].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
}
```

- [ ] **Step 4: Create `worker/src/apps/bookings/request.ts`.**

```ts
import type postgres from 'postgres';
import { withTenant, type DatabaseEnv } from '../../db';
import { createNotification } from '../../notifications/store';
import { ownersOf } from '../../notifications/recipients';
import { whenText, type Lang } from './messages';
import { normalizeMyPhone } from './phone';
import { reservationsFor } from './public';
import { newReference } from './reference';
import { openSlots } from './slots';
import { addDays, myDate, myInstant } from './time';

/* A customer's booking request from the public page. Creation locks the
   installation first (which serialises it with config saves, decisions and
   the daily cap), then the service, then reads bookings; a submission key
   makes a retried or double-tapped form one request, not two. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const DAILY_CAP = 200;
const REFERENCE_ATTEMPTS = 5;

export interface RequestInput {
  serviceId: string;
  startsAt: Date;
  partySize: number;
  name: string;
  phone: string;
  note: string | null;
  submissionKey: string;
}

export type RequestField = 'service' | 'start' | 'name' | 'phone' | 'partySize' | 'note' | 'submission';
export type ParsedRequest =
  | { ok: true; value: RequestInput }
  | { ok: false; errors: RequestField[]; raw: Record<string, string> };

export type CreateResult =
  | { kind: 'created'; reference: string; bookingId: string }
  | { kind: 'replayed'; reference: string }
  | { kind: 'changed' }
  | { kind: 'unavailable' }
  | { kind: 'daily_cap' }
  | { kind: 'service_gone' }
  | { kind: 'taken' };

export function parseRequestForm(form: FormData): ParsedRequest {
  const raw: Record<string, string> = {};
  for (const key of ['service', 'start', 'party', 'name', 'phone', 'note', 'submission_key']) {
    const value = form.get(key);
    raw[key] = typeof value === 'string' ? value : '';
  }
  const errors: RequestField[] = [];
  const serviceId = UUID.test(raw.service) ? raw.service.toLowerCase() : '';
  if (!serviceId) errors.push('service');
  const startsAt = new Date(raw.start);
  const startOk = !Number.isNaN(startsAt.getTime()) && startsAt.getUTCSeconds() === 0 && startsAt.getUTCMilliseconds() === 0;
  if (!startOk) errors.push('start');
  const partySize = /^\d{1,2}$/.test(raw.party) ? Number(raw.party) : 0;
  if (partySize < 1 || partySize > 50) errors.push('partySize');
  const name = raw.name.replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 80) errors.push('name');
  const phone = normalizeMyPhone(raw.phone);
  if (!phone) errors.push('phone');
  const noteText = raw.note.trim();
  if (noteText.length > 500) errors.push('note');
  const submissionKey = UUID.test(raw.submission_key) ? raw.submission_key.toLowerCase() : '';
  if (!submissionKey) errors.push('submission');
  if (errors.length > 0) return { ok: false, errors, raw };
  return {
    ok: true,
    value: { serviceId, startsAt, partySize, name, phone: phone!, note: noteText || null, submissionKey },
  };
}

/** The normalized request, hashed. The Turnstile token is not part of it, so
    a replay with a fresh token still matches. */
export async function submissionDigest(input: RequestInput): Promise<string> {
  const text = JSON.stringify([input.serviceId, input.startsAt.toISOString(), input.name, input.phone, input.partySize, input.note ?? '']);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function matchSubmission(
  tx: postgres.TransactionSql,
  businessId: string,
  key: string,
  digest: string,
): Promise<{ kind: 'replayed'; reference: string } | { kind: 'changed' } | null> {
  const [row] = await tx<{ reference: string; submission_hash: string }[]>`
    select reference, submission_hash from booking where business_id = ${businessId} and submission_key = ${key}`;
  if (!row) return null;
  return row.submission_hash === digest ? { kind: 'replayed', reference: row.reference } : { kind: 'changed' };
}

/** A committed submission with this key, if any. Runs before Turnstile, since
    the original token may already have been spent. Only a generic receipt
    comes back, never customer data. */
export async function findSubmission(env: DatabaseEnv, businessId: string, key: string, digest: string) {
  return withTenant(env, businessId, (tx) => matchSubmission(tx, businessId, key, digest));
}

const NOTICE: Record<Lang, (name: string, when: string, service: string, party: number) => { title: string; body: string }> = {
  en: (name, when, service, party) => ({ title: 'New booking request', body: `${name} · ${when} · ${service} (${party})` }),
  bm: (name, when, service, party) => ({ title: 'Permintaan tempahan baharu', body: `${name} · ${when} · ${service} (${party})` }),
};

export async function createBookingRequest(
  env: DatabaseEnv,
  businessId: string,
  input: RequestInput,
  digest: string,
  now: Date,
): Promise<CreateResult> {
  return withTenant(env, businessId, async (tx): Promise<CreateResult> => {
    const [installed] = await tx<{ state: 'active' | 'paused' }[]>`
      select state from app_installation where business_id = ${businessId} and app_key = 'bookings' for update`;
    if (!installed) return { kind: 'unavailable' };
    const replay = await matchSubmission(tx, businessId, input.submissionKey, digest);
    if (replay) return replay;
    const [settings] = await tx<{ accepting: boolean; min_notice_minutes: number; horizon_days: number }[]>`
      select accepting, min_notice_minutes, horizon_days from booking_settings where business_id = ${businessId}`;
    if (installed.state !== 'active' || !settings?.accepting) return { kind: 'unavailable' };

    const [{ today }] = await tx<{ today: number }[]>`
      select count(*)::int as today from booking where business_id = ${businessId} and created_at >= ${myInstant(myDate(now))}`;
    if (today >= DAILY_CAP) return { kind: 'daily_cap' };

    const [service] = await tx<{ id: string; name: string; duration_minutes: number; capacity: number }[]>`
      select id, name, duration_minutes, capacity from booking_service
       where business_id = ${businessId} and id = ${input.serviceId} and active and duration_minutes > 0
       for update`;
    if (!service) return { kind: 'service_gone' };
    const hours = await tx<{ weekday: number; opens: string; closes: string }[]>`
      select weekday, to_char(opens, 'HH24:MI') as opens, to_char(closes, 'HH24:MI') as closes
        from booking_hours where business_id = ${businessId} and service_id = ${service.id}`;
    const date = myDate(input.startsAt);
    const reservations = await reservationsFor(tx, businessId, service.id, myInstant(date), myInstant(addDays(date, 1)));
    const slot = openSlots({
      service: { durationMinutes: service.duration_minutes, capacity: service.capacity },
      hours,
      settings: { minNoticeMinutes: settings.min_notice_minutes, horizonDays: settings.horizon_days },
      reservations,
      now,
      from: date,
      days: 1,
    }).find((s) => s.startsAt.getTime() === input.startsAt.getTime());
    if (!slot || slot.remaining < input.partySize) return { kind: 'taken' };

    for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
      const reference = newReference();
      const [row] = await tx<{ id: string }[]>`
        insert into booking (business_id, reference, submission_key, submission_hash, service_id, service_name,
          starts_at, ends_at, party_size, customer_name, customer_phone, note, created_at)
        values (${businessId}, ${reference}, ${input.submissionKey}, ${digest}, ${service.id}, ${service.name},
          ${slot.startsAt}, ${slot.endsAt}, ${input.partySize}, ${input.name}, ${input.phone}, ${input.note}, ${now})
        on conflict (business_id, reference) do nothing
        returning id`;
      if (!row) continue;
      const [business] = await tx<{ lang: Lang }[]>`select lang from business where id = ${businessId}`;
      const lang: Lang = business?.lang === 'bm' ? 'bm' : 'en';
      const notice = NOTICE[lang](input.name, whenText(slot.startsAt, lang), service.name, input.partySize);
      for (const owner of await ownersOf(tx, businessId)) {
        await createNotification(tx, businessId, {
          recipientUserId: owner,
          kind: 'booking_requested',
          title: notice.title,
          body: notice.body,
          sourceKey: `booking:${row.id}`,
          url: `/app?view=apps&app=bookings&booking=${row.id}`,
        });
      }
      return { kind: 'created', reference, bookingId: row.id };
    }
    throw new Error('could not allocate a booking reference');
  });
}
```

- [ ] **Step 5: Run the test.**

```bash
pnpm exec vitest run test/apps-request.test.ts
```

Expected: all pass.
- **The race tests hold because** `createBookingRequest` locks
  `app_installation` first, so the second transaction waits, then re-reads the
  submission key, the count and the reservations.
- **If the concurrency tests deadlock or fail,** check that nothing reads
  `booking` before the installation lock is taken.

- [ ] **Step 6: Typecheck and commit.**

```bash
pnpm typecheck
git add src/apps/bookings/reference.ts src/apps/bookings/request.ts test/apps-request.test.ts
git commit -m "feat(worker): customers request a booking: locked, capped and safe to retry"
```

---

## Task 5: Rendering the public pages

**Files:**
- Create: `worker/src/sites/render.ts`
- Test: `worker/test/sites-render.test.ts`

**Interfaces:**
- **Consumes:**
  - `PublicPage`, `PublicService` and `DayTimes` (Task 3)
  - `RequestField` (Task 4)
  - `myParts`, `myDate` and `weekday` (plan 1)
  - `Lang` (plan 1)
- **Produces, for headers and redirects:**
  - `escapeHtml(s)`
  - `SECURITY_HEADERS`
  - `page(html, status?)`, which returns a `Response` with every security
    header
  - `redirect(location, status: 301 | 303)`
- **Produces, for pages:** each of these returns an HTML string.
  - `servicesPage(input)`
  - `timesPage(input)`
  - `formPage(input)`
  - `donePage(input)`
  - `messagePage(input)`, with kinds
    `'not_found' | 'unavailable' | 'changed' | 'busy' | 'daily_cap'`
- **The input shapes** are defined in the code below.

- [ ] **Step 1: Write the failing test** at `worker/test/sites-render.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { donePage, escapeHtml, formPage, messagePage, page, redirect, servicesPage, timesPage } from '../src/sites/render';

const base = { slug: 'seido', lang: 'en' as const, businessName: 'SEIDO <script>alert(1)</script>' };
const service = { id: '11111111-1111-4111-8111-111111111112', name: 'Cupping <b>class</b>', durationMinutes: 60, capacity: 2, priceLabel: 'RM45 & up', hours: [] };

describe('escaping and responses', () => {
  it('escapes the five HTML characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('sends every security header and never a cookie', () => {
    const res = page('<p>hi</p>');
    expect(res.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const moved = redirect('/b/seido', 301);
    expect(moved.status).toBe(301);
    expect(moved.headers.get('Location')).toBe('/b/seido');
    expect(moved.headers.get('X-Robots-Tag')).toBe('noindex');
  });
});

describe('pages', () => {
  it('renders business and service names as text, never markup', () => {
    const html = servicesPage({ ...base, services: [service] });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('SEIDO &lt;script&gt;');
    expect(html).toContain('Cupping &lt;b&gt;class&lt;/b&gt;');
    expect(html).toContain('RM45 &amp; up');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain(`href="/b/seido?service=${service.id}&amp;lang=en"`);
  });

  it('switches language and marks Malay pages as ms', () => {
    const html = servicesPage({ ...base, lang: 'bm', services: [service] });
    expect(html).toContain('<html lang="ms">');
    expect(html).toContain('Pilih perkhidmatan');
    expect(html).toContain('href="/b/seido?lang=en"');
  });

  it('lists times with places left, and says when a day has none', () => {
    const html = timesPage({ ...base, service, selected: '2026-10-06', notice: 'taken', days: [
      { date: '2026-10-06', slots: [{ startsAt: new Date('2026-10-06T02:00:00Z'), endsAt: new Date('2026-10-06T03:00:00Z'), remaining: 1 }] },
      { date: '2026-10-07', slots: [] },
    ] });
    expect(html).toContain('10:00 am');
    expect(html).toContain('1 place left');
    expect(html).toContain('That time was just taken');
    expect(html).toContain('/b/seido/request?service=');
    const empty = timesPage({ ...base, service, selected: '2026-10-07', notice: null, days: [{ date: '2026-10-07', slots: [] }] });
    expect(empty).toContain('No open times on this day.');
  });

  it('shows the privacy notice in both languages, the widget only with a site key, and the submission key', () => {
    const input = { ...base, service, startsAt: new Date('2026-10-06T02:00:00Z'), remaining: 3, submissionKey: 'key-1',
      values: { name: '<Aisyah>', phone: '', note: '', party: '1' }, errors: [] as never[], siteKey: 'site-key' };
    const en = formPage(input);
    expect(en).toContain('Your name and phone number go to SEIDO &lt;script&gt;');
    expect(en).toContain('href="https://jentera.ai/privacy"');
    expect(en).toContain('class="cf-turnstile" data-sitekey="site-key" data-action="booking"');
    expect(en).toContain('name="submission_key" value="key-1"');
    expect(en).toContain('value="&lt;Aisyah&gt;"');
    expect(en).toContain('<option value="3">3</option>');
    expect(en).not.toContain('<option value="4">');
    const bm = formPage({ ...input, lang: 'bm', siteKey: undefined });
    expect(bm).toContain('Nama dan nombor telefon anda dihantar kepada SEIDO &lt;script&gt;');
    expect(bm).not.toContain('cf-turnstile');
  });

  it('shows field errors next to the fields', () => {
    const html = formPage({ ...base, service, startsAt: new Date('2026-10-06T02:00:00Z'), remaining: 2, submissionKey: 'k',
      values: { name: '', phone: '123', note: '', party: '1' }, errors: ['name', 'phone', 'turnstile'], siteKey: undefined });
    expect(html).toContain('Please enter your name.');
    expect(html).toContain('Please enter a Malaysian phone number.');
    expect(html).toContain('Please complete the check before sending.');
  });

  it('gives a generic receipt and plain messages', () => {
    const done = donePage({ ...base, reference: 'K7Q2MP' });
    expect(done).toContain('K7Q2MP');
    expect(done).toContain('will confirm on WhatsApp.');
    expect(messagePage({ ...base, kind: 'unavailable' })).toContain('Not taking bookings right now');
    expect(messagePage({ slug: null, lang: 'en', businessName: null, kind: 'not_found' })).toContain('Page not found');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

```bash
pnpm exec vitest run test/sites-render.test.ts
```

Expected: FAIL with `Cannot find module '../src/sites/render'`.

- [ ] **Step 3: Create `worker/src/sites/render.ts`.**

```ts
import type { DayTimes, PublicService } from '../apps/bookings/public';
import type { RequestField } from '../apps/bookings/request';
import type { Lang } from '../apps/bookings/messages';
import { myDate, myParts, weekday } from '../apps/bookings/time';

/* Server-rendered booking pages. Every business- or customer-supplied string
   goes through escapeHtml. No script of ours runs on these pages; the only
   script is Cloudflare's Turnstile widget. */

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
  'Cache-Control': 'no-store',
};

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function page(html: string, status = 200): Response {
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
}

export function redirect(location: string, status: 301 | 303): Response {
  return new Response(null, { status, headers: { Location: location, ...SECURITY_HEADERS } });
}

export type FormError = RequestField | 'turnstile' | 'busy' | 'daily_cap';

const T = {
  en: {
    chooseService: 'Choose a service', chooseTime: 'Choose a time', noTimes: 'No open times on this day.',
    placesLeft: (n: number) => (n === 1 ? '1 place left' : `${n} places left`), minutes: (n: number) => `${n} min`,
    yourDetails: 'Your details', name: 'Your name', phone: 'Phone number (WhatsApp)', party: 'How many people',
    note: 'Note (optional)', send: 'Send request', back: 'Back', otherLang: 'Bahasa Melayu', poweredBy: 'Bookings by Jentera',
    privacy: (b: string) => `Your name and phone number go to ${b} to handle this booking.`, privacyLink: 'Privacy',
    receivedTitle: 'Request received', received: (b: string) => `${b} will confirm on WhatsApp.`, reference: 'Reference',
    taken: 'That time was just taken. Please choose another.',
    titles: { not_found: 'Page not found', unavailable: 'Not taking bookings right now', changed: 'Please start a fresh request', busy: 'Please try again shortly', daily_cap: 'Please try again later' },
    bodies: {
      not_found: 'This booking page does not exist.',
      unavailable: 'Please check back later.',
      changed: 'This form was already sent with different details. Start again to send a new request.',
      busy: 'Too many requests from this connection. Wait a minute and try again.',
      daily_cap: 'This business has received many requests today. Please try again tomorrow.',
    },
    errors: {
      service: 'Please choose a service again.', start: 'Please choose a time again.', name: 'Please enter your name.',
      phone: 'Please enter a Malaysian phone number.', partySize: 'Please choose how many people.',
      note: 'Please keep the note under 500 characters.', submission: 'Please reload the page and try again.',
      turnstile: 'Please complete the check before sending.', busy: 'Too many requests. Please wait a minute and try again.',
      daily_cap: 'This business has received many requests today. Please try again tomorrow.',
    },
    days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },
  bm: {
    chooseService: 'Pilih perkhidmatan', chooseTime: 'Pilih masa', noTimes: 'Tiada masa kosong pada hari ini.',
    placesLeft: (n: number) => `${n} tempat lagi`, minutes: (n: number) => `${n} min`,
    yourDetails: 'Butiran anda', name: 'Nama anda', phone: 'Nombor telefon (WhatsApp)', party: 'Bilangan orang',
    note: 'Nota (pilihan)', send: 'Hantar permintaan', back: 'Kembali', otherLang: 'English', poweredBy: 'Tempahan oleh Jentera',
    privacy: (b: string) => `Nama dan nombor telefon anda dihantar kepada ${b} untuk menguruskan tempahan ini.`, privacyLink: 'Privasi',
    receivedTitle: 'Permintaan diterima', received: (b: string) => `${b} akan mengesahkan melalui WhatsApp.`, reference: 'Rujukan',
    taken: 'Masa itu baru sahaja diambil. Sila pilih masa lain.',
    titles: { not_found: 'Halaman tidak dijumpai', unavailable: 'Tidak menerima tempahan buat masa ini', changed: 'Sila mulakan permintaan baharu', busy: 'Sila cuba sebentar lagi', daily_cap: 'Sila cuba lagi kemudian' },
    bodies: {
      not_found: 'Halaman tempahan ini tidak wujud.',
      unavailable: 'Sila cuba lagi kemudian.',
      changed: 'Borang ini sudah dihantar dengan butiran lain. Mulakan semula untuk menghantar permintaan baharu.',
      busy: 'Terlalu banyak permintaan dari sambungan ini. Tunggu seminit dan cuba lagi.',
      daily_cap: 'Perniagaan ini telah menerima banyak permintaan hari ini. Sila cuba lagi esok.',
    },
    errors: {
      service: 'Sila pilih perkhidmatan semula.', start: 'Sila pilih masa semula.', name: 'Sila masukkan nama anda.',
      phone: 'Sila masukkan nombor telefon Malaysia.', partySize: 'Sila pilih bilangan orang.',
      note: 'Sila pastikan nota kurang daripada 500 aksara.', submission: 'Sila muat semula halaman dan cuba lagi.',
      turnstile: 'Sila lengkapkan semakan sebelum menghantar.', busy: 'Terlalu banyak permintaan. Sila tunggu seminit dan cuba lagi.',
      daily_cap: 'Perniagaan ini telah menerima banyak permintaan hari ini. Sila cuba lagi esok.',
    },
    days: ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'],
    months: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'],
  },
} as const;

const CSS = `body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#faf9f7;color:#1f2328}
main{max-width:34rem;margin:0 auto;padding:1.25rem 1rem 3rem}h1{font-size:1.4rem;margin:.25rem 0 1rem}h2{font-size:1.05rem;margin:1.25rem 0 .5rem}
a{color:#0b6e4f}.card{display:block;padding:.9rem 1rem;margin:.5rem 0;border:1px solid #e3e1dc;border-radius:.9rem;background:#fff;text-decoration:none;color:inherit}
.muted{color:#5f6368;font-size:.9rem}.days{display:flex;gap:.4rem;overflow-x:auto;padding-bottom:.25rem}.day{flex:0 0 auto;padding:.5rem .7rem;border:1px solid #e3e1dc;border-radius:.7rem;text-decoration:none;color:inherit;background:#fff;text-align:center}
.day[aria-current="date"]{border-color:#0b6e4f;background:#e7f4ee}.times{display:grid;grid-template-columns:repeat(auto-fill,minmax(7.5rem,1fr));gap:.5rem}
label{display:block;font-weight:600;margin:.9rem 0 .3rem}input,select,textarea{width:100%;box-sizing:border-box;font:inherit;padding:.65rem .75rem;border:1px solid #cfccc5;border-radius:.6rem;background:#fff}
button{width:100%;margin-top:1.1rem;font:inherit;font-weight:600;padding:.8rem;border:0;border-radius:.7rem;background:#0b6e4f;color:#fff}
.error{color:#b3261e;font-size:.9rem;margin:.25rem 0 0}.notice{padding:.7rem .9rem;border-radius:.7rem;background:#fdecea;color:#7a1d16}
.lang{float:right;font-size:.9rem}footer{margin-top:2rem;font-size:.8rem;color:#80868b;text-align:center}
@media (prefers-color-scheme:dark){body{background:#151515;color:#ececec}.card,.day,input,select,textarea{background:#1f1f1f;border-color:#333;color:inherit}.day[aria-current="date"]{background:#123326}.muted{color:#aaa}a{color:#5fd3a6}.notice{background:#3a1512;color:#f6c8c3}}`;

interface Base { slug: string; lang: Lang; businessName: string }
type Strings = (typeof T)[Lang];

function href(slug: string, path: '' | '/request' | '/done', params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return escapeHtml(`/b/${slug}${path}${query ? `?${query}` : ''}`);
}

function layout(input: { lang: Lang; title: string; body: string; langSwitch?: string; widget?: boolean }): string {
  const t = T[input.lang];
  return `<!doctype html><html lang="${input.lang === 'bm' ? 'ms' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(input.title)}</title><style>${CSS}</style>${input.widget ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}</head>
<body><main>${input.langSwitch ? `<a class="lang" href="${input.langSwitch}">${t.otherLang}</a>` : ''}${input.body}
<footer>${t.poweredBy}</footer></main></body></html>`;
}

const other = (lang: Lang): Lang => (lang === 'bm' ? 'en' : 'bm');

function clock(date: Date, lang: Lang): string {
  const p = myParts(date);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const minutes = String(p.minute).padStart(2, '0');
  if (lang === 'bm') {
    const period = p.hour < 12 ? 'pagi' : p.hour < 14 ? 'tengah hari' : p.hour < 19 ? 'petang' : 'malam';
    return `${hour12}.${minutes} ${period}`;
  }
  return `${hour12}:${minutes} ${p.hour < 12 ? 'am' : 'pm'}`;
}

function dayLabel(date: string, t: Strings): string {
  const [, month, day] = date.split('-').map(Number);
  return `${t.days[weekday(date)]} ${day} ${t.months[month - 1]}`;
}

export function servicesPage(input: Base & { services: PublicService[] }): string {
  const t = T[input.lang];
  const items = input.services.map((s) => `<a class="card" href="${href(input.slug, '', { service: s.id, lang: input.lang })}">
<strong>${escapeHtml(s.name)}</strong><div class="muted">${t.minutes(s.durationMinutes)}${s.priceLabel ? ` · ${escapeHtml(s.priceLabel)}` : ''}</div></a>`).join('');
  return layout({
    lang: input.lang, title: input.businessName,
    langSwitch: href(input.slug, '', { lang: other(input.lang) }),
    body: `<h1>${escapeHtml(input.businessName)}</h1><h2>${t.chooseService}</h2>${items}`,
  });
}

export function timesPage(input: Base & { service: PublicService; days: DayTimes[]; selected: string; notice: 'taken' | null }): string {
  const t = T[input.lang];
  const chosen = input.days.find((d) => d.date === input.selected) ?? input.days[0];
  const strip = input.days.map((d) => `<a class="day" href="${href(input.slug, '', { service: input.service.id, date: d.date, lang: input.lang })}"${d.date === chosen?.date ? ' aria-current="date"' : ''}>${dayLabel(d.date, t)}</a>`).join('');
  const times = chosen && chosen.slots.length > 0
    ? `<div class="times">${chosen.slots.map((s) => `<a class="card" href="${href(input.slug, '/request', { service: input.service.id, start: s.startsAt.toISOString(), lang: input.lang })}"><strong>${clock(s.startsAt, input.lang)}</strong><div class="muted">${t.placesLeft(s.remaining)}</div></a>`).join('')}</div>`
    : `<p class="muted">${t.noTimes}</p>`;
  return layout({
    lang: input.lang, title: `${input.service.name} · ${input.businessName}`,
    langSwitch: href(input.slug, '', { service: input.service.id, date: chosen?.date ?? input.selected, lang: other(input.lang) }),
    body: `<a href="${href(input.slug, '', { lang: input.lang })}">${t.back}</a><h1>${escapeHtml(input.service.name)}</h1>
${input.notice === 'taken' ? `<p class="notice">${t.taken}</p>` : ''}<h2>${t.chooseTime}</h2><nav class="days">${strip}</nav><h2>${chosen ? dayLabel(chosen.date, t) : ''}</h2>${times}`,
  });
}

export function formPage(input: Base & {
  service: PublicService;
  startsAt: Date;
  remaining: number;
  submissionKey: string;
  values: { name: string; phone: string; note: string; party: string };
  errors: FormError[];
  siteKey: string | undefined;
}): string {
  const t = T[input.lang];
  const err = (field: FormError) => (input.errors.includes(field) ? `<p class="error">${t.errors[field]}</p>` : '');
  const max = Math.min(input.remaining, 50);
  const options = Array.from({ length: max }, (_, i) => i + 1)
    .map((n) => `<option value="${n}"${String(n) === input.values.party ? ' selected' : ''}>${n}</option>`).join('');
  const general = (['service', 'start', 'submission', 'busy', 'daily_cap'] as FormError[]).map(err).join('');
  const date = input.startsAt.toISOString();
  return layout({
    lang: input.lang, title: `${input.service.name} · ${input.businessName}`, widget: Boolean(input.siteKey),
    langSwitch: href(input.slug, '/request', { service: input.service.id, start: date, lang: other(input.lang) }),
    body: `<a href="${href(input.slug, '', { service: input.service.id, lang: input.lang })}">${t.back}</a>
<h1>${escapeHtml(input.service.name)}</h1><p class="muted">${dayLabel(myDate(input.startsAt), t)} · ${clock(input.startsAt, input.lang)}</p>
${general}<form method="post" action="${href(input.slug, '/request', { lang: input.lang })}">
<input type="hidden" name="service" value="${escapeHtml(input.service.id)}"><input type="hidden" name="start" value="${escapeHtml(date)}">
<input type="hidden" name="submission_key" value="${escapeHtml(input.submissionKey)}">
<h2>${t.yourDetails}</h2>
<label for="name">${t.name}</label><input id="name" name="name" autocomplete="name" maxlength="80" required value="${escapeHtml(input.values.name)}">${err('name')}
<label for="phone">${t.phone}</label><input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" required value="${escapeHtml(input.values.phone)}">${err('phone')}
<label for="party">${t.party}</label><select id="party" name="party">${options}</select>${err('partySize')}
<label for="note">${t.note}</label><textarea id="note" name="note" maxlength="500" rows="3">${escapeHtml(input.values.note)}</textarea>${err('note')}
${input.siteKey ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(input.siteKey)}" data-action="booking" data-language="${input.lang === 'bm' ? 'ms' : 'en'}"></div>` : ''}${err('turnstile')}
<p class="muted">${escapeHtml(t.privacy(input.businessName))} <a href="https://jentera.ai/privacy">${t.privacyLink}</a></p>
<button type="submit">${t.send}</button></form>`,
  });
}

export function donePage(input: Base & { reference: string }): string {
  const t = T[input.lang];
  return layout({
    lang: input.lang, title: t.receivedTitle,
    body: `<h1>${t.receivedTitle}</h1><p>${escapeHtml(t.received(input.businessName))}</p>
<p class="card"><span class="muted">${t.reference}</span><br><strong>${escapeHtml(input.reference)}</strong></p>
<a href="${href(input.slug, '', { lang: input.lang })}">${t.back}</a>`,
  });
}

export function messagePage(input: { slug: string | null; lang: Lang; businessName: string | null; kind: 'not_found' | 'unavailable' | 'changed' | 'busy' | 'daily_cap' }): string {
  const t = T[input.lang];
  const heading = input.businessName ? `<p class="muted">${escapeHtml(input.businessName)}</p>` : '';
  const back = input.slug && input.kind !== 'not_found' ? `<a href="${href(input.slug, '', { lang: input.lang })}">${t.back}</a>` : '';
  return layout({
    lang: input.lang, title: t.titles[input.kind],
    body: `${heading}<h1>${t.titles[input.kind]}</h1><p>${t.bodies[input.kind]}</p>${back}`,
  });
}
```

- [ ] **Step 4: Run the test.**

```bash
pnpm exec vitest run test/sites-render.test.ts
```

Expected: all pass.

- [ ] **Step 5: Typecheck and commit.**

```bash
pnpm typecheck
git add src/sites/render.ts test/sites-render.test.ts
git commit -m "feat(worker): bilingual, escaped booking pages with the security headers"
```

---

## Task 6: The sites fetch handler

**Files:**
- Create: `worker/src/sites/index.ts`
- Test: `worker/test/sites.test.ts`

**Interfaces:**
- **Consumes:**
  - `SitesEnv` (Task 2)
  - `verifyTurnstile` with its expectation (Task 2)
  - `appsEnabledFor` (plan 1 and Task 2)
  - `resolvePublicSlug`, `loadPublicPage` and `loadOpenTimes` (Task 3)
  - `parseRequestForm`, `submissionDigest`, `findSubmission` and
    `createBookingRequest` (Task 4)
  - `REFERENCE` (Task 4)
  - every renderer in Task 5
  - `clientIp` from `src/ratelimit.ts`
  - `isDate` and `myDate` (plan 1)
- **Produces:**
  - `handleSites(request, env, deps?: { now?: () => Date; fetchImpl?: typeof fetch })`,
    returning `Promise<Response>`
  - a default export `{ fetch(request, env) }`

- [ ] **Step 1: Write the failing test** at `worker/test/sites.test.ts`.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { handleSites } from '../src/sites/index';
import type { SitesEnv } from '../src/sites/env';
import { SITEVERIFY } from '../src/turnstile';
import { asOwner, fetchFake, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-05T00:00:00Z'); // Mon 08:00 Malaysia
const TEN = '2026-10-06T02:00:00.000Z';       // Tue 10:00 Malaysia
let service = '';
let burstOk = true;

const env = (over: Partial<SitesEnv> = {}): SitesEnv => ({
  HYPERDRIVE: testEnv().HYPERDRIVE,
  APPS_ENABLED: 'true',
  APPS_BUSINESS_IDS: A,
  SITES_ORIGIN: 'https://sites.test',
  TURNSTILE_SITE_KEY: 'site-key',
  BOOKING_BURST: { limit: async () => ({ success: burstOk }) } as unknown as RateLimit,
  ...over,
});

beforeEach(async () => {
  burstOk = true;
  await truncateAll();
  service = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded, lang) values (${A}, 'SEIDO <Coffee>', 'services', true, 'en')`;
    const [u] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('o@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${u.id}, ${A}, 'owner')`;
    await sql`insert into app_installation (business_id, app_key, public_slug) values (${A}, 'bookings', 'seido')`;
    await sql`insert into app_slug (public_slug, business_id, app_key) values ('seido', ${A}, 'bookings'), ('seido-lama', ${A}, 'bookings')`;
    await sql`insert into booking_settings (business_id, availability_acknowledged_at, min_notice_minutes, horizon_days)
      values (${A}, now(), 120, 30)`;
    const [s] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
      values (${A}, 'Cupping class', 60, 2) returning id`;
    await sql`insert into booking_hours (business_id, service_id, weekday, opens, closes) values (${A}, ${s.id}, 2, '10:00', '13:00')`;
    return s.id;
  });
});

function get(path: string, e = env()) {
  return handleSites(new Request(`https://sites.test${path}`), e, { now: () => NOW });
}

function post(fields: Record<string, string>, e = env(), fetchImpl?: typeof fetch, path = '/b/seido/request?lang=en') {
  const body = new URLSearchParams(fields);
  const request = new Request(`https://sites.test${path}`, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '203.0.113.9' },
  });
  return handleSites(request, e, { now: () => NOW, fetchImpl });
}

const form = (over: Record<string, string> = {}) => ({
  service, start: TEN, party: '1', name: 'Aisyah', phone: '012-345 6789', note: '',
  submission_key: '33333333-3333-4333-8333-333333333333', ...over,
});

describe('sites: pages', () => {
  it('lists services with escaped names, the security headers and no cookie', async () => {
    const res = await get('/b/seido');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('SEIDO &lt;Coffee&gt;');
    expect(html).toContain('Cupping class');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('answers 404 outside /b/, for unknown names, and for a business off the pilot list', async () => {
    expect((await get('/api/me')).status).toBe(404);
    expect((await get('/')).status).toBe(404);
    expect((await get('/b/nobody')).status).toBe(404);
    const off = env({ APPS_BUSINESS_IDS: '22222222-2222-4222-8222-222222222222' });
    expect((await get('/b/seido', off)).status).toBe(404);
    expect((await get('/b/seido/done?ref=K7Q2MP', off)).status).toBe(404);
  });

  it('sends a name used before to the current page', async () => {
    const res = await get('/b/seido-lama?service=x&lang=bm');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/b/seido?service=x&lang=bm');
  });

  it('shows open times and keeps the language through the steps', async () => {
    const html = await (await get(`/b/seido?service=${service}&date=2026-10-06&lang=bm`)).text();
    expect(html).toContain('<html lang="ms">');
    expect(html).toContain('10.00 pagi');
    expect(html).toContain('lang=bm');
  });

  it('shows the form with the privacy notice, the widget and a submission key', async () => {
    const html = await (await get(`/b/seido/request?service=${service}&start=${encodeURIComponent(TEN)}`)).text();
    expect(html).toContain('Your name and phone number go to SEIDO &lt;Coffee&gt;');
    expect(html).toContain('data-action="booking"');
    expect(html).toMatch(/name="submission_key" value="[0-9a-f-]{36}"/);
  });

  it('sends a customer back to the times when the start is no longer offered', async () => {
    const res = await get(`/b/seido/request?service=${service}&start=${encodeURIComponent('2026-10-06T02:30:00.000Z')}`);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toContain('notice=taken');
  });

  it('says it is not taking bookings when paused, and gives a generic receipt only for a real reference', async () => {
    await asOwner((sql) => sql`update booking_settings set accepting = false where business_id = ${A}`);
    const paused = await get('/b/seido');
    expect(paused.status).toBe(200);
    expect(await paused.text()).toContain('Not taking bookings right now');
    expect((await get('/b/seido/done?ref=K7Q2MP')).status).toBe(200);
    expect((await get('/b/seido/done?ref=<b>')).status).toBe(404);
  });
});

describe('sites: sending a request', () => {
  it('creates the booking, notifies the owner and lands on the receipt', async () => {
    const res = await post(form());
    expect(res.status).toBe(303);
    const location = res.headers.get('Location')!;
    expect(location).toMatch(/^\/b\/seido\/done\?ref=[A-HJ-NP-Z2-9]{6}&lang=en$/);
    const [row] = await asOwner((sql) => sql<{ customer_phone: string; status: string }[]>`select customer_phone, status from booking`);
    expect(row).toEqual({ customer_phone: '60123456789', status: 'pending' });
    expect(await asOwner((sql) => sql`select 1 from notification where kind = 'booking_requested'`)).toHaveLength(1);
    const done = await (await get(location)).text();
    expect(done).toContain(location.split('ref=')[1].slice(0, 6));
    expect(done).not.toContain('Aisyah');
  });

  it('returns the same receipt for a replay, even with the check now failing, and 409 for changed details', async () => {
    const first = await post(form());
    const secret = env({ TURNSTILE_SECRET: 'ts-secret' });
    const replay = await post(form(), secret);
    expect(replay.headers.get('Location')).toBe(first.headers.get('Location'));
    const changed = await post(form({ name: 'Someone else' }), secret);
    expect(changed.status).toBe(409);
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(1);
  });

  it('shows the form again for bad fields, a missing check, a sign-in token, and a burst', async () => {
    const bad = await post(form({ name: ' ', phone: '123' }));
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('Please enter a Malaysian phone number.');
    const secret = env({ TURNSTILE_SECRET: 'ts-secret' });
    const missing = await post(form({ submission_key: '44444444-4444-4444-8444-444444444444' }), secret);
    expect(missing.status).toBe(400);
    expect(await missing.text()).toContain('Please complete the check before sending.');
    const signin = fetchFake(async (input) => (String(input) === SITEVERIFY
      ? Response.json({ success: true, action: 'signin', hostname: 'sites.test' }) : Response.json({})));
    const wrongToken = await post({ ...form({ submission_key: '55555555-5555-4555-8555-555555555555' }), 'cf-turnstile-response': 'tok' }, secret, signin as unknown as typeof fetch);
    expect(wrongToken.status).toBe(400);
    burstOk = false;
    expect((await post(form({ submission_key: '66666666-6666-4666-8666-666666666666' }))).status).toBe(429);
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(0);
  });

  it('refuses politely when paused after the form was opened, and when the time was taken', async () => {
    await asOwner((sql) => sql`update booking_settings set accepting = false where business_id = ${A}`);
    const paused = await post(form());
    expect(await paused.text()).toContain('Not taking bookings right now');
    await asOwner((sql) => sql`update booking_settings set accepting = true where business_id = ${A}`);
    await post(form({ party: '2', submission_key: '77777777-7777-4777-8777-777777777777' }));
    const taken = await post(form({ submission_key: '88888888-8888-4888-8888-888888888888' }));
    expect(taken.status).toBe(303);
    expect(taken.headers.get('Location')).toContain('notice=taken');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

```bash
pnpm exec vitest run test/sites.test.ts
```

Expected: FAIL with `Cannot find module '../src/sites/index'`.

- [ ] **Step 3: Create `worker/src/sites/index.ts`.**

```ts
import { appsEnabledFor } from '../apps/gating';
import type { Lang } from '../apps/bookings/messages';
import { loadOpenTimes, loadPublicPage, resolvePublicSlug, type PublicPage } from '../apps/bookings/public';
import { REFERENCE } from '../apps/bookings/reference';
import { createBookingRequest, findSubmission, parseRequestForm, submissionDigest } from '../apps/bookings/request';
import { isDate, myDate } from '../apps/bookings/time';
import { clientIp } from '../ratelimit';
import { verifyTurnstile } from '../turnstile';
import type { SitesEnv } from './env';
import { donePage, formPage, messagePage, page, redirect, servicesPage, timesPage, type FormError } from './render';

/* The public booking pages: the whole of the jentera-sites deploy. It never
   reads or sets a cookie and holds no credential; a business is found only
   through bookings_by_slug and everything after runs under withTenant. */

const PATH = /^\/b\/([a-z0-9][a-z0-9-]{1,38}[a-z0-9])(\/request|\/done)?\/?$/;
const DAYS_SHOWN = 7;

interface Deps { now?: () => Date; fetchImpl?: typeof fetch }

function langOf(url: URL, info: PublicPage | null): Lang {
  const asked = url.searchParams.get('lang');
  return asked === 'en' || asked === 'bm' ? asked : info?.lang ?? 'en';
}

function notFound(lang: Lang): Response {
  return page(messagePage({ slug: null, lang, businessName: null, kind: 'not_found' }), 404);
}

export async function handleSites(request: Request, env: SitesEnv, deps: Deps = {}): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  const url = new URL(request.url);
  const match = url.pathname.match(PATH);
  if (!match || (request.method !== 'GET' && request.method !== 'POST')) return notFound('en');
  const [, slug, sub = ''] = match;

  const found = await resolvePublicSlug(env, slug);
  if (!found || !appsEnabledFor(env, found.businessId)) return notFound(langOf(url, null));
  if (found.currentSlug !== slug) {
    return redirect(`/b/${found.currentSlug}${sub}${url.search}`, 301);
  }
  const businessId = found.businessId;
  const info = await loadPublicPage(env, businessId);
  if (!info) return notFound(langOf(url, null));
  const lang = langOf(url, info);
  const base = { slug, lang, businessName: info.businessName };

  if (sub === '/done') {
    const reference = url.searchParams.get('ref') ?? '';
    if (request.method !== 'GET' || !REFERENCE.test(reference)) return notFound(lang);
    return page(donePage({ ...base, reference }));
  }

  if (!info.open) return page(messagePage({ ...base, kind: 'unavailable' }), request.method === 'POST' ? 409 : 200);

  const timesUrl = (serviceId: string, date: string, taken: boolean) =>
    `/b/${slug}?${new URLSearchParams({ service: serviceId, date, lang, ...(taken ? { notice: 'taken' } : {}) })}`;

  if (sub === '' && request.method === 'GET') {
    const serviceId = url.searchParams.get('service');
    if (!serviceId) return page(servicesPage({ ...base, services: info.services }));
    const asked = url.searchParams.get('date');
    const from = asked && isDate(asked) ? asked : myDate(now);
    const times = await loadOpenTimes(env, businessId, serviceId, from, DAYS_SHOWN, now);
    if (!times) return redirect(`/b/${slug}?lang=${lang}`, 303);
    return page(timesPage({
      ...base, service: times.service, days: times.days, selected: times.days[0]?.date ?? from,
      notice: url.searchParams.get('notice') === 'taken' ? 'taken' : null,
    }));
  }

  /** The form for one offered start, or a redirect back to the times. */
  async function showForm(serviceId: string, startIso: string, values: { name: string; phone: string; note: string; party: string },
    errors: FormError[], submissionKey: string, status: number): Promise<Response> {
    const startsAt = new Date(startIso);
    if (Number.isNaN(startsAt.getTime())) return redirect(`/b/${slug}?lang=${lang}`, 303);
    const date = myDate(startsAt);
    const times = await loadOpenTimes(env, businessId, serviceId, date, 1, now);
    if (!times) return redirect(`/b/${slug}?lang=${lang}`, 303);
    const slot = times.days[0]?.slots.find((s) => s.startsAt.getTime() === startsAt.getTime());
    if (!slot) return redirect(timesUrl(serviceId, date, true), 303);
    return page(formPage({
      ...base, service: times.service, startsAt, remaining: slot.remaining, submissionKey,
      values, errors, siteKey: env.TURNSTILE_SITE_KEY,
    }), status);
  }

  if (sub === '/request' && request.method === 'GET') {
    return showForm(url.searchParams.get('service') ?? '', url.searchParams.get('start') ?? '',
      { name: '', phone: '', note: '', party: '1' }, [], crypto.randomUUID(), 200);
  }

  if (sub === '/request' && request.method === 'POST') {
    const form = await request.formData();
    const parsed = parseRequestForm(form);
    const values = {
      name: String(form.get('name') ?? ''), phone: String(form.get('phone') ?? ''),
      note: String(form.get('note') ?? ''), party: String(form.get('party') ?? '1'),
    };
    // A malformed key is replaced, so the form shown again can still be sent.
    const key = parsed.ok ? parsed.value.submissionKey
      : parsed.errors.includes('submission') ? crypto.randomUUID() : String(form.get('submission_key'));
    const serviceId = String(form.get('service') ?? '');
    const start = String(form.get('start') ?? '');
    if (!parsed.ok) return showForm(serviceId, start, values, parsed.errors, key, 400);

    const burst = env.BOOKING_BURST ? await env.BOOKING_BURST.limit({ key: `book:${clientIp(request)}` }) : { success: true };
    if (!burst.success) return showForm(serviceId, start, values, ['busy'], key, 429);

    const input = parsed.value;
    const digest = await submissionDigest(input);
    const earlier = await findSubmission(env, businessId, input.submissionKey, digest);
    if (earlier?.kind === 'replayed') return redirect(`/b/${slug}/done?ref=${earlier.reference}&lang=${lang}`, 303);
    if (earlier?.kind === 'changed') return page(messagePage({ ...base, kind: 'changed' }), 409);

    const verdict = await verifyTurnstile(env, form.get('cf-turnstile-response'), clientIp(request), deps.fetchImpl ?? fetch,
      { action: 'booking', hostnames: new Set([new URL(env.SITES_ORIGIN ?? 'https://invalid.invalid').hostname]) });
    if (verdict === 'missing' || verdict === 'rejected') return showForm(serviceId, start, values, ['turnstile'], key, 400);

    const result = await createBookingRequest(env, businessId, input, digest, now);
    switch (result.kind) {
      case 'created':
      case 'replayed':
        return redirect(`/b/${slug}/done?ref=${result.reference}&lang=${lang}`, 303);
      case 'changed':
        return page(messagePage({ ...base, kind: 'changed' }), 409);
      case 'unavailable':
        return page(messagePage({ ...base, kind: 'unavailable' }), 409);
      case 'daily_cap':
        return showForm(serviceId, start, values, ['daily_cap'], key, 429);
      case 'service_gone':
        return redirect(`/b/${slug}?lang=${lang}`, 303);
      case 'taken':
        return redirect(timesUrl(input.serviceId, myDate(input.startsAt), true), 303);
    }
  }

  return notFound(lang);
}

export default {
  async fetch(request: Request, env: SitesEnv): Promise<Response> {
    return handleSites(request, env);
  },
};
```

- [ ] **Step 4: Run the tests.**

```bash
pnpm exec vitest run test/sites.test.ts test/sites-render.test.ts test/apps-request.test.ts
```

Expected: all pass. In the "taken" test, the first request takes both
places at 10:00, so the second is sent back with `notice=taken`.

- [ ] **Step 5: Typecheck and commit.**

```bash
pnpm typecheck
git add src/sites/index.ts test/sites.test.ts
git commit -m "feat(worker): the public booking pages: browse, request, receipt"
```

---

## Task 7: The sites deploy and the flag-drift check

**Files:**
- Modify: `worker/wrangler.toml`. Append the `[env.sites]` block at the end
  of the file.
- Create: `worker/scripts/check-apps-flags.mjs`
- Create: `worker/scripts/check-apps-flags.test.mjs`
- Modify: `worker/package.json` (`predeploy`, plus a new `deploy:sites`)

**Interfaces:**
- **Produced:** `appsFlagProblems(tomlText): string[]` and
  `tomlSections(tomlText)`, both exported from the script.

- [ ] **Step 1: Write the failing test** at
  `worker/scripts/check-apps-flags.test.mjs`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appsFlagProblems } from './check-apps-flags.mjs';

const toml = (api, sites) => `name = "aisar-api"\n[vars]\n${api}\n\n[env.sites]\nname = "jentera-sites"\n\n[env.sites.vars]\n${sites}\n`;
const A = '4e8c2593-2af2-494f-b157-fec0295a50b5';
const B = '11111111-1111-4111-8111-111111111111';
const vars = (enabled, ids, origin = 'https://s.test') =>
  `APPS_ENABLED = "${enabled}"\nAPPS_BUSINESS_IDS = "${ids}"\nSITES_ORIGIN = "${origin}"`;

test('agrees when both deploys carry the same flags, in any order or case', () => {
  assert.deepEqual(appsFlagProblems(toml(vars('false', `${A},${B}`), vars('false', ` ${B.toUpperCase()} , ${A}`))), []);
});

test('fails when the switch, the list or the origin differ, or the sites block is missing', () => {
  assert.equal(appsFlagProblems(toml(vars('true', A), vars('false', A))).length, 1);
  assert.equal(appsFlagProblems(toml(vars('false', A), vars('false', `${A},${B}`))).length, 1);
  assert.equal(appsFlagProblems(toml(vars('false', A), vars('false', A, 'https/other.test'))).length, 1);
  assert.equal(appsFlagProblems(toml(vars('false', A, ''), vars('false', A, ''))).length, 2);
  assert.deepEqual(appsFlagProblems(`[vars]\n${vars('false', A)}\n`), ['[env.sites.vars] is missing from wrangler.toml']);
});

test('the real wrangler.toml agrees', () => {
  assert.deepEqual(appsFlagProblems(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')), []);
});
```

- [ ] **Step 2: Run it and confirm it fails.**

```bash
node --test scripts/check-apps-flags.test.mjs
```

Expected: FAIL with `Cannot find module … check-apps-flags.mjs`.

- [ ] **Step 3: Create `worker/scripts/check-apps-flags.mjs`.**

```js
#!/usr/bin/env node
/**
 * check-apps-flags.mjs — predeploy guard for the two deploys of worker/.
 *
 * aisar-api ([vars]) and jentera-sites ([env.sites.vars]) each carry the apps
 * pilot flags. If they drift, the pilot is half on: the public page is live
 * while the owner routes answer 404, or the reverse. Runs in `predeploy` and
 * in `deploy:sites`. Exit 0 = the two agree; exit 1 = do not deploy.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The key = "value" pairs of every [section] — enough for vars. */
export function tomlSections(text) {
  const sections = new Map([['', new Map()]]);
  let current = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const header = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (header) {
      current = header[1].trim();
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }
    const pair = line.match(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"/);
    if (pair) sections.get(current).set(pair[1], pair[2]);
  }
  return sections;
}

const idSet = (value) =>
  [...new Set((value ?? '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean))].sort().join(',');

export function appsFlagProblems(text) {
  const sections = tomlSections(text);
  const api = sections.get('vars') ?? new Map();
  const sites = sections.get('env.sites.vars');
  if (!sites) return ['[env.sites.vars] is missing from wrangler.toml'];
  const problems = [];
  if ((api.get('APPS_ENABLED') ?? '') !== (sites.get('APPS_ENABLED') ?? '')) {
    problems.push(`APPS_ENABLED differs: [vars] "${api.get('APPS_ENABLED') ?? ''}" vs [env.sites.vars] "${sites.get('APPS_ENABLED') ?? ''}"`);
  }
  if (idSet(api.get('APPS_BUSINESS_IDS')) !== idSet(sites.get('APPS_BUSINESS_IDS'))) {
    problems.push('APPS_BUSINESS_IDS differs between [vars] and [env.sites.vars]');
  }
  const apiOrigin = api.get('SITES_ORIGIN') ?? '';
  const sitesOrigin = sites.get('SITES_ORIGIN') ?? '';
  if (!apiOrigin) problems.push('SITES_ORIGIN is missing from [vars]');
  if (!sitesOrigin) problems.push('SITES_ORIGIN is missing from [env.sites.vars]');
  if (apiOrigin && sitesOrigin && apiOrigin !== sitesOrigin) problems.push('SITES_ORIGIN differs between [vars] and [env.sites.vars]');
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = appsFlagProblems(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'));
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL  ${problem}`);
    process.exit(1);
  }
  console.log('ok    apps flags agree between aisar-api and jentera-sites');
}
```

- [ ] **Step 4: Append the sites environment** to the end of
  `worker/wrangler.toml`.

```toml
# ---------------------------------------------------------------------------
# jentera-sites: the public Bookings pages, a second deploy of this code.
# docs/plans/2026-09-23-apps-shell-and-bookings-v1.md, "Public pages".
# Own origin, so the owner's session cookie is never in scope; no credential,
# vault, email, billing or runtime secret. Its only secret is TURNSTILE_SECRET
# (set it only after the sites hostname is added to the Turnstile widget).
# Deploy with `pnpm deploy:sites`, which first checks the apps flags below
# still match [vars] (scripts/check-apps-flags.mjs).
[env.sites]
name = "jentera-sites"
main = "src/sites/index.ts"
workers_dev = true
# Durable Object migrations are inherited too. This entry exports no
# RunStream class, so inheriting run-stream-v1 would fail the upload.
migrations = []

# Triggers are inherited, and the sites entry has no scheduled handler.
[env.sites.triggers]
crons = []

[env.sites.placement]
region = "aws:ap-southeast-1"

[[env.sites.hyperdrive]]
binding = "HYPERDRIVE"
id = "f77c72f8d6614bb0b6955170caadad07"

[env.sites.vars]
APPS_ENABLED = "false"
APPS_BUSINESS_IDS = "4e8c2593-2af2-494f-b157-fec0295a50b5"
SITES_ORIGIN = "https://jentera-sites.qhkmdev90.workers.dev"
TURNSTILE_SITE_KEY = "0x4AAAAAAEyClnNFPsv8OJBY"

[[env.sites.ratelimits]]
name = "BOOKING_BURST"
namespace_id = "1007"
  [env.sites.ratelimits.simple]
  limit = 10
  period = 60
```

  Before adding it, **confirm namespace `1007` is unused**:
  `/usr/bin/grep -n 'namespace_id' wrangler.toml`. If it is taken, use the
  next free number.

- [ ] **Step 5: Wire the scripts.** In `worker/package.json`:
  - Append `&& node --test scripts/check-apps-flags.test.mjs && node scripts/check-apps-flags.mjs`
    to the end of the `"predeploy"` value. Keep everything already there.
  - Add, after `"deploy"`:

```json
"deploy:sites": "node scripts/check-apps-flags.mjs && wrangler deploy --env sites",
```

- [ ] **Step 6: Run the checks, and a dry-run bundle of both deploys.** A dry
  run validates the config and bundles without deploying and without network
  access to Cloudflare.

```bash
node --test scripts/check-apps-flags.test.mjs && node scripts/check-apps-flags.mjs
pnpm exec wrangler deploy --dry-run --outdir "$TMPDIR/aisar-api-dry" 2>&1 | tail -5
pnpm exec wrangler deploy --env sites --dry-run --outdir "$TMPDIR/jentera-sites-dry" 2>&1 | tail -5
```

Expected: the tests pass, the check prints `ok …`, and both dry runs finish
without a config error. The sites dry run lists `HYPERDRIVE`,
`BOOKING_BURST` and the four vars as its bindings. It lists no Durable
Object, queue, R2, AI, service or analytics binding, and no migration.
Anything more means an inherited key leaked in: stop and fix it here, not at
deploy time.

- [ ] **Step 7: Commit.**

```bash
git add wrangler.toml scripts/check-apps-flags.mjs scripts/check-apps-flags.test.mjs package.json
git commit -m "feat(worker): the jentera-sites deploy, and a check that both deploys share the apps flags"
```

---

## Task 8: Full verification

- [ ] **Step 1: Run the whole worker suite and both typecheck passes.**

```bash
cd ~/.agent-worktree/workspaces/aisar-site-b726b8/bookings-v1/worker && pnpm typecheck && pnpm test && node --test scripts/check-apps-flags.test.mjs
```

Expected: everything passes. If an unrelated file fails, re-run that file
alone before suspecting this change.

- [ ] **Step 2: Confirm nothing is live.**

```bash
/usr/bin/grep -n '^APPS_ENABLED' wrangler.toml
```

Expected: `APPS_ENABLED = "false"` appears twice, once for each deploy.

- [ ] **Step 3: Record progress.** Add this line under the status line of
  `docs/plans/2026-09-23-apps-shell-and-bookings-v1.md`:

```
Plan 2 (public pages) built on branch bookings-v1: <last commit>.
```

  Commit it by named path.

---

## As built

Built on branch `bookings-v1`, commits `cef81d7..d365c5d`. Every task and
the final fix round were reviewed. The full worker suite passed at
`4b9321b`: 132 files, 1581 tests. The fix at `d365c5d` passed its focused
tests and typecheck. Nothing is deployed, and `APPS_ENABLED` is `"false"` in
both deploys.

**Where the build differs from the task text above:**
- **Hours are read in one place.** `src/apps/bookings/hours.ts`
  (`readHours`, `hoursFor`) is shared by `readConfig`, `readPublicPage` and
  `createBookingRequest`, instead of three copies of one query.
- **Dates and times are formatted in one place.** `messages.ts` exports
  `dateText` and `clockText`. `whenText` and `render.ts` both use them.
- **Requests are turned away before the database.** The sites handler
  answers 404 when `APPS_ENABLED` is not `"true"`. It then checks
  `SITES_BURST` for every request (60 per 60 s per address, namespace
  `1008`). For a form post, it then reads the body (form-encoded only, at
  most 8 KiB, read with a cap) and checks `BOOKING_BURST`. Only then does it
  resolve the link name. A braked request gets a static 429 page. So the
  burst limit now runs before validation, not after it.
- **A form already sent keeps its receipt.** The replay check runs before the
  paused gate. Turnstile gets an `idempotency_key` derived from the
  submission key and the token (`turnstileIdempotencyKey`), so a double-tap
  gets one booking and one receipt.
- **An old link name gets 307, not 301.** A business may return to an old
  name, and 307 keeps a form post's body.
- **Names and notes refuse control and bidi characters.** Tab, LF and CR are
  still allowed in notes.
- **Form fields with errors carry `aria-invalid` and `aria-describedby`.**
- **Any thrown error gets a plain 500.** It carries the security headers. The
  log line holds only the error's name and SQLSTATE.
- **`check-apps-flags.mjs` checks more than the plan asked.** It fails the
  deploy if either deploy's `SITES_ORIGIN` is not `https`, if
  `TURNSTILE_SITE_KEY` is empty, or if the `BOOKING_BURST` or `SITES_BURST`
  block is missing.

**Before the first `deploy:sites` (the release):**
- **Apply 065–068 in production before merging `bookings-v1`.** After 068,
  run a smoke test that resolves a held name through `bookings_by_slug`.
- **Set `TURNSTILE_SECRET` on `jentera-sites` before `APPS_ENABLED` flips.**
  Deploy the site key first, then the secret, as with the sign-in doors.
- **Consider a Hyperdrive config of the sites deploy's own.** Disable caching
  and set a low origin-connection cap, so a public flood cannot use up the
  pool `aisar-api` depends on.
- **Nothing in the release path runs the flags check except `deploy:sites`.**
  - `ship-runtime.sh` and the release playbook deploy `aisar-api` with
    `pnpm exec wrangler deploy`, which skips `predeploy`.
  - `pnpm deploy` is pnpm's own built-in command, not the script; use
    `pnpm run deploy`.
  - Add `node scripts/check-apps-flags.mjs` to the release gate.
  - A `ship-runtime.sh` release never deploys `jentera-sites`. Changes to
    shared code reach it only through `pnpm deploy:sites`.
- **Expect a conflict when merging.** `main` has since added
  `check-bundle-pin` to `predeploy`. Keep both.

**Plan 4 (owner UI and docs) must:**
- **Document the second deploy.** Put it in `CLAUDE.md`,
  `docs/architecture.md` and `docs/todo.md`:
  - `deploy:sites`
  - the Turnstile `booking` action
  - the two rate-limit bindings
  - the flag check
  - the PDPA retention row
- **Word `service_gone` and the paused state for owners** where they appear
  in the owner screens.

**Deferred minors, none blocking:**
- A link with capitals (`/b/SEIDO`) and HEAD requests answer 404.
- After choosing a later day, the day strip no longer shows earlier days.
- `service_gone` returns the customer to the list with no reason.
- Name and note lengths count UTF-16 units, so the check errs strict.
- The character guard misses U+061C, which matters for Jawi and Arabic
  names, and U+2028/U+2029.
- A POST to an old link name spends both brakes twice, once per hop.
- Times and form pages read the page twice, costing 3 DB connections.
- Tests missing:
  - the Malaysian day boundary for the daily cap
  - the reference-retry path
  - `sourceKey`, the title and the Malay notice
  - headers on a redirect or a 404
- Small cleanups:
  - `TurnstileEnv` restates two `Env` fields;
  - `/* */` is used where the neighbouring code uses `/** */`;
  - dense one-line templates in `render.ts`;
  - the notice text is built twice;
  - `readPublicPage` reads inactive services' hours;
  - the prefix match for rate-limit blocks has no boundary;
  - no test covers a `TURNSTILE_SITE_KEY` that is set but empty.
