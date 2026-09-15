# Chat Attachments: Storage and Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer can upload a file, attach it to an ask, and see it in Files — stored under RLS with bytes in R2, visible to exactly the people who may read the run it belongs to.

**Architecture:** An `attachment` row is `staged` when uploaded and `attached` once an ask names it, because upload precedes the ask and `visibleRunPredicate` needs a run that does not exist yet. A `run_attachment` junction links a file to every run that used it, so a later turn can refer to yesterday's invoice. Staged rows expire after 24 hours; attached rows are kept. Everything mirrors the artifact module, which already solves the same problems in the other direction.

**Tech Stack:** TypeScript, Cloudflare Workers, R2, Neon Postgres with forced RLS, vitest with a throwaway Postgres in Docker.

**Spec:** `docs/superpowers/specs/2026-09-15-chat-attachments-design.md`

## Global Constraints

- **`worker/` only.** No `app/`, no `runner/`, no `mobile/`. Another session works in this checkout; check `git status` before you start and do not commit files you did not change.
- TypeScript, two-space indent, semicolons, single quotes, camelCase.
- Conventional Commit subjects, one visible behaviour per commit.
- `cd worker && pnpm test` needs Docker. `pnpm typecheck` runs twice (src, then src + test); both must be clean. The suite fails **5 pre-existing tests** (`orchestration.test.ts` ×3, `runtime-runner.test.ts` ×2, all streaming) — confirm that count before you start and do not chase them; anything beyond it is yours.
- **Assert as `aisar_app`, arrange as `owner`** (`worker/test/harness.ts`). RLS does not exist for a superuser, so a test that asserts as the owner passes while production leaks.
- Tests import the production queries rather than copying their SQL.
- The next free migration number is **047**; re-check `ls worker/migrations | tail -1` before creating it, since another session may land one first.
- Follow `src/artifacts.ts` and `src/routes/artifacts.ts` wherever this plan is silent. They are the same problem solved in the other direction and were reviewed hard.
- **No route may read a business id from a request body** — `resolveTenant` is the only source.

---

### Task 1: The tables

**Files:**
- Create: `worker/migrations/047_attachment.sql`

**Interfaces:**
- Produces: table `attachment` (id, business_id, uploaded_by, state, name, content_type, size_bytes, r2_key, sha256, created_at, expires_at) and junction `run_attachment (business_id, run_id, attachment_id)`. Later tasks insert, claim and read these.

- [ ] **Step 1: Write the migration**

Create `worker/migrations/047_attachment.sql`:

```sql
-- Files a person hands the agent, the mirror of `artifact` (migration 032),
-- which is files the agent hands the person.
--
-- Two states, because the upload happens before the ask that uses it. A
-- `staged` row has no run, so visibleRunPredicate — which joins run to
-- chat_session — cannot say who may see it; the uploader alone may, until an
-- ask claims it. Staged rows expire: every abandoned composer and refused ask
-- would otherwise leave a billed R2 object that the Files tab, listed by run,
-- never shows.
create table if not exists attachment (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references business(id) on delete cascade,
  uploaded_by  uuid not null references app_user(id) on delete cascade,
  state        text not null default 'staged' check (state in ('staged', 'attached')),
  name         text not null check (name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'),
  content_type text not null check (char_length(content_type) between 3 and 120),
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  r2_key       text not null unique check (char_length(r2_key) <= 400),
  sha256       text check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  -- Set on upload, cleared when the row is claimed by an ask.
  expires_at   timestamptz
);

-- A file can be used by more than one run: "the invoice I sent you yesterday"
-- is a second ask naming the same id, so the link cannot be a column.
create table if not exists run_attachment (
  business_id   uuid not null references business(id) on delete cascade,
  run_id        uuid not null references run(id) on delete cascade,
  attachment_id uuid not null references attachment(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (run_id, attachment_id)
);

create index if not exists idx_attachment_business_created
  on attachment (business_id, created_at desc, id desc);
-- The sweep's scan: staged rows past their expiry, nothing else.
create index if not exists idx_attachment_expiring
  on attachment (expires_at) where state = 'staged';
create index if not exists idx_run_attachment_run
  on run_attachment (business_id, run_id);

alter table attachment enable row level security;
alter table attachment force row level security;
drop policy if exists attachment_tenant on attachment;
create policy attachment_tenant on attachment
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid);

alter table run_attachment enable row level security;
alter table run_attachment force row level security;
drop policy if exists run_attachment_tenant on run_attachment;
create policy run_attachment_tenant on run_attachment
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
```

Check `migrations/000_role.sql` for how grants reach `aisar_app` and match the sibling migrations — `032_artifact.sql` is the one to copy.

- [ ] **Step 2: Apply it by running any worker test**

Run: `cd worker && pnpm vitest run test/native-bearer.test.ts`
Expected: PASS. The harness applies `migrations/` in order, so a SQL error surfaces here as a setup failure.

- [ ] **Step 3: Commit**

```bash
git add worker/migrations/047_attachment.sql
git commit -m "feat: add the attachment tables"
```

---

### Task 2: The attachment module

**Files:**
- Create: `worker/src/attachments.ts`
- Test: `worker/test/attachments.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `src/db`, the `Env` type.
- Produces, all used by Tasks 3-5:
  - `MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024`
  - `MAX_ATTACHMENT_BYTES_PER_RUN = 60 * 1024 * 1024`
  - `STAGED_TTL_MS = 24 * 60 * 60 * 1000`
  - `attachmentKey(businessId: string, id: string, name: string): string`
  - `safeAttachmentName(value: unknown): string | null` — reuse `safeArtifactName`'s rule
  - `recordAttachment(tx, businessId, input): Promise<AttachmentRow>`
  - `getAttachment(tx, businessId, id): Promise<AttachmentRow | null>`
  - `claimAttachments(tx, businessId, runId, ids, askerId): Promise<{ claimed: string[]; refused: string[] }>`
  - `sweepStagedAttachments(env, now): Promise<string[]>` — returns r2 keys to delete

- [ ] **Step 1: Write the failing test**

Create `worker/test/attachments.test.ts` with the harness arrange block used by `test/native-bearer.test.ts` (a business, a verified owner, a membership), then:

```typescript
describe('storing an attachment', () => {
  it('keys bytes under the tenant so deletion is a prefix', () => {
    expect(attachmentKey(BUSINESS_ID, 'abc', 'invoice.pdf'))
      .toBe(`${BUSINESS_ID}/attachments/abc/invoice.pdf`);
  });

  it('records a staged row with an expiry', async () => {
    const row = await asTenant(BUSINESS_ID, (tx) => recordAttachment(tx, BUSINESS_ID, {
      uploadedBy: ownerId, name: 'invoice.pdf', contentType: 'application/pdf',
      size: 1234, r2Key: `${BUSINESS_ID}/attachments/a/invoice.pdf`,
      expiresAt: new Date(Date.now() + STAGED_TTL_MS),
    }));
    expect(row.state).toBe('staged');
    const [stored] = await asApp((sql) => sql<{ state: string; expires_at: Date | null }[]>`
      select state, expires_at from attachment where id = ${row.id}`);
    expect(stored.state).toBe('staged');
    expect(stored.expires_at).not.toBeNull();
  });

  /* An id is not a bearer credential: a staged row belongs to its uploader
     until an ask claims it, so nobody else can carry it into their own chat. */
  it('refuses to claim a staged row for someone who did not upload it', async () => {
    const row = await asTenant(BUSINESS_ID, (tx) => recordAttachment(tx, BUSINESS_ID, {
      uploadedBy: ownerId, name: 'a.txt', contentType: 'text/plain', size: 10,
      r2Key: `${BUSINESS_ID}/attachments/b/a.txt`,
      expiresAt: new Date(Date.now() + STAGED_TTL_MS),
    }));
    const result = await asTenant(BUSINESS_ID, (tx) =>
      claimAttachments(tx, BUSINESS_ID, runId, [row.id], strangerId));
    expect(result.claimed).toEqual([]);
    expect(result.refused).toEqual([row.id]);
  });

  it('claims for the uploader, clears the expiry, and links the run', async () => {
    const row = await asTenant(BUSINESS_ID, (tx) => recordAttachment(tx, BUSINESS_ID, {
      uploadedBy: ownerId, name: 'b.txt', contentType: 'text/plain', size: 10,
      r2Key: `${BUSINESS_ID}/attachments/c/b.txt`,
      expiresAt: new Date(Date.now() + STAGED_TTL_MS),
    }));
    const result = await asTenant(BUSINESS_ID, (tx) =>
      claimAttachments(tx, BUSINESS_ID, runId, [row.id], ownerId));
    expect(result.claimed).toEqual([row.id]);
    const [stored] = await asApp((sql) => sql<{ state: string; expires_at: Date | null }[]>`
      select state, expires_at from attachment where id = ${row.id}`);
    expect(stored.state).toBe('attached');
    expect(stored.expires_at).toBeNull();
    const links = await asApp((sql) => sql<{ run_id: string }[]>`
      select run_id from run_attachment where attachment_id = ${row.id}`);
    expect(links).toHaveLength(1);
  });

  it('refuses a run whose total would exceed the per-run cap', async () => {
    // Record rows summing past MAX_ATTACHMENT_BYTES_PER_RUN, claim them, and
    // assert the last is refused. The cap matches the runner's own 60 MB
    // per-task ceiling (runner/src/server.mjs:2513).
  });

  it('sweeps a staged row past its expiry and leaves an attached one', async () => {
    // One staged row with expires_at in the past, one attached row.
    // sweepStagedAttachments returns the staged row's r2 key only.
  });
});
```

Fill the two sketched bodies before running — a test that asserts nothing is worse than a missing test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && pnpm vitest run test/attachments.test.ts`
Expected: FAIL on the import — `src/attachments.ts` does not exist.

- [ ] **Step 3: Write the module**

Create `worker/src/attachments.ts`, following `src/artifacts.ts` closely for row types, name validation and query style. The parts this plan fixes rather than copies:

```typescript
/** One file. Matches the artifact ceiling. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/* All files on one run. The runner refuses more than 60 MB for a task's
   outputs (runner/src/server.mjs:2513) and a sprite's disk is the same disk,
   so inputs get the same ceiling rather than 20 files x 20 MB. */
export const MAX_ATTACHMENT_BYTES_PER_RUN = 60 * 1024 * 1024;

/** A staged upload nobody asked with is rubbish after a day. */
export const STAGED_TTL_MS = 24 * 60 * 60 * 1000;

/* No run in the key: a file can belong to several runs, and the tenant prefix
   is what makes account deletion a prefix delete. */
export function attachmentKey(businessId: string, id: string, name: string): string {
  return `${businessId}/attachments/${id}/${name}`;
}
```

`claimAttachments` is the security-bearing one. For each id, in one transaction:

1. Read the row under the tenant. Missing → refused.
2. `state = 'staged'` → the asker must be `uploaded_by`, else refused.
3. `state = 'attached'` → `runVisibleTo(tx, businessId, <a run already linked>, askerId)` must be true, else refused. Import it from `src/chat-sessions.ts` rather than writing the predicate again.
4. Sum `size_bytes` of everything already linked to this run plus the claims; over `MAX_ATTACHMENT_BYTES_PER_RUN` → refused.
5. Insert into `run_attachment`, set `state = 'attached'`, `expires_at = null`.

Refusals are returned, never thrown: the caller decides whether a partial claim is an error.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && pnpm vitest run test/attachments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/attachments.ts worker/test/attachments.test.ts
git commit -m "feat: add the attachment store"
```

---

### Task 3: The upload route

**Files:**
- Create: `worker/src/routes/attachments.ts`
- Modify: `worker/src/index.ts` (mount it), `worker/src/request-guard.ts` (body cap)
- Test: `worker/test/attachment-routes.test.ts`

**Interfaces:**
- Consumes: Task 2's module; `resolveTenant`, `hasBusiness` from `src/tenancy.ts`.
- Produces: `handleAttachments(request, env, url, cors)` returning `Promise<Response | null>`; `POST /api/attachments` answering `{ ok: true, id, name, size }`.

- [ ] **Step 1: Write the failing test**

Cover, at minimum: a 201/200 with a valid body and `X-Aisar-File-Name`; 400 on a bad name; 413 over `MAX_ATTACHMENT_BYTES`; 401 with no session; and — the one that matters — **a body of 200 KiB succeeds**, which fails until the guard is amended.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && pnpm vitest run test/attachment-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the route and the guard arm**

The route mirrors `routes/artifacts.ts`'s upload half: read `X-Aisar-File-Name`, validate the name and declared length, buffer the bytes, SHA-256 them, `put` to R2 under `attachmentKey`, and `recordAttachment` inside `withTenant`. Owner and staff may both upload — a colleague sending an invoice is the point — so no `can()` check beyond `hasBusiness`.

In `worker/src/request-guard.ts`, extend `bodyCapFor` so the upload path gets `MAX_ATTACHMENT_BYTES` plus headroom, exactly as the ingest path already does:

```typescript
function bodyCapFor(method: string, pathname: string): number {
  if (method !== 'POST') return MAX_API_BODY_BYTES;
  if (pathname === INGEST_FILE_PATH) return MAX_UPLOAD_BODY_BYTES;
  if (pathname === ATTACHMENTS_PATH) return MAX_ATTACHMENT_BODY_BYTES;
  return MAX_API_BODY_BYTES;
}
```

Export `ATTACHMENTS_PATH` from the route module and import it here, the way `INGEST_FILE_PATH` is imported from `routes/runs.ts` — a literal in two files is the drift this guard exists to prevent.

Mount `handleAttachments` in `index.ts` **after** `guardApiRequest`, beside `handleArtifacts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && pnpm vitest run test/attachment-routes.test.ts`

- [ ] **Step 5: Commit**

```bash
git add worker/src worker/test
git commit -m "feat: accept an uploaded attachment"
```

---

### Task 4: Serving it back

**Files:**
- Modify: `worker/src/routes/attachments.ts`
- Test: `worker/test/attachment-routes.test.ts`

**Interfaces:**
- Produces: `GET /api/attachments/:id` answering the bytes as an attachment.

- [ ] **Step 1: Write the failing test**

- The uploader gets their staged file.
- **Another member does not** — 404, not 403, so the id alone confirms nothing.
- Once attached, whoever may read the run may read the file; whoever may not, gets 404.
- The response carries `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.

That last one is not decoration: an owner-uploaded HTML file served inline at the API origin would run as the API origin.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write the handler**

Copy the serve half of `routes/artifacts.ts:129-148` — the header block there is already correct — and replace its visibility check with: staged → `row.uploaded_by === identity.userId`; attached → `runVisibleTo` on any run linked in `run_attachment`.

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: serve an attachment to whoever may read its run"
```

---

### Task 5: Attaching on the ask, and the sweep

**Files:**
- Modify: `worker/src/routes/runs.ts` (the ask path), `worker/src/index.ts` (cron)
- Test: `worker/test/attachment-routes.test.ts`

**Interfaces:**
- Consumes: `claimAttachments`, `sweepStagedAttachments`.
- Produces: `/api/runs/ask` accepting `attachmentIds: string[]`; the minute cron sweeping staged rows.

- [ ] **Step 1: Write the failing test**

- An ask naming a staged id the asker uploaded links it to the run and returns normally.
- An ask naming an id belonging to someone else's staged upload is **refused with 400**, not silently ignored. Silence is how the agent ends up answering about a file it never received.
- An ask naming more than the per-run cap is refused.
- The sweep deletes a staged row past its expiry and its R2 object, and leaves attached rows alone.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement**

In the ask route, parse `attachmentIds` (array of uuid strings, at most 20), and after the run row exists, call `claimAttachments` inside the same tenant transaction. **Any refusal fails the ask with 400** naming how many were refused — never proceed with a partial set.

In `index.ts`'s minute cron, beside the other sweeps, call `sweepStagedAttachments` and delete the returned keys from R2. Deleting bytes before the row is the safe order only if the row is deleted in the same pass; do the row first inside the tenant transaction, then the bytes, and let a failed byte delete leave an orphan the next sweep picks up rather than a row pointing at nothing.

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Run the whole suite and both typecheck passes**

Run: `cd worker && pnpm test && pnpm typecheck`
Expected: the 5 pre-existing failures and no others.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: attach uploaded files to an ask"
```

---

## What this plan does not cover

Each is its own plan, and the first one gates the second.

- **The image-path spike.** Which of `vision_analyze` (auxiliary), the native path with `model.supports_vision` pinned on, or a worker-side proxy call with an extraction prompt actually reads a receipt correctly. Until that is measured, nothing may claim receipt accuracy. It also has to establish what `supports_vision` is set to across the fleet, since it is currently hand-set on one sprite and in no bundle.
- **Delivery to the sprite.** `GET /v1/runtime/attachments/:id` task-bound, the inputs folder, cleanup, the runtime-release gate so an old runner refuses rather than ignores, and fetching after admission rather than inside a 30-second `start`.
- **The composer control and the Files tab** in `app/`.
- **The Telegram stopgap** — one branch in `parseUpdate` replying "I can't read photos here yet" instead of dropping the update with a 200.
- **Deleting an attachment**, which needs a route and a `permissions.ts` row.
- **Reconciling with the mini-apps `attachment` table** so there are not two stores with two visibility rules.
