# Document Upload Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `POST /api/runs/ingest/file` actually work from a browser, so uploading a document from jentera.ai succeeds and the phone camera has a working target later.

**Architecture:** Two independent faults sit in front of a route that is itself correct. The browser's preflight refuses the request because `Access-Control-Allow-Headers` does not name `X-Aisar-File-Name`; and the pre-route guard refuses the body because its flat 128 KiB cap applies to every path, making the route's own 8 MiB limit unreachable. Fix one header, give the guard a per-path cap, and cover both with tests that can see them — no route test can, which is why the faults survived.

**Tech Stack:** TypeScript, Cloudflare Workers, vitest (plain node pool), Postgres in Docker for the suite.

**Spec:** `docs/superpowers/specs/2026-09-14-mobile-apps-design.md`, section "What must be true before any of this ships".

## Global Constraints

- TypeScript, two-space indent, semicolons, single quotes, camelCase.
- Conventional Commit subjects, one visible behaviour per commit.
- `cd worker && pnpm test` needs Docker running, and so does a single-file run: `vitest.config.ts` sets a `globalSetup` that starts a throwaway Postgres for every invocation, even for a test that never touches it. `pnpm typecheck` runs twice (src alone, then src + test); both passes must be clean.
- Tests assert as `aisar_app` and arrange as `owner`, per `test/harness.ts`. A test that asserts as the owner passes while production leaks.
- **`worker/src/index.ts` cannot be imported from a test.** The suite is plain node vitest (`worker/vitest.config.ts`), and `src/index.ts` re-exports `RunStream` from `src/run-stream.ts`, which imports `cloudflare:workers` — unresolvable outside the Workers runtime. So the guard is tested by calling `guardApiRequest` directly and the CORS answer by scanning source text, the way `test/cors.test.ts` already does. Do not spend time trying to boot the whole Worker.
- Do not add `Authorization` to the allow-list in this plan. It belongs to the native auth work and has no caller yet.

---

### Task 1: The request header the browser refuses

`app/src/lib/repo/remote.ts:341` sends `X-Aisar-File-Name`, which is not a CORS-safelisted request header, so every upload from a real browser dies in preflight before the Worker sees it. `test/cors.test.ts` already scans source text for exactly this class of bug — it compares the methods routes handle against the two lists that gate them — and gains a third scan here.

**Files:**
- Modify: `worker/test/cors.test.ts` (append a new `describe`)
- Modify: `worker/src/index.ts:69`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks rely on. `corsAllowHeaders(): Promise<string[]>` stays local to the test file.

- [ ] **Step 1: Write the failing test**

Append to `worker/test/cors.test.ts`:

```typescript
async function corsAllowHeaders(): Promise<string[]> {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const match = source.match(/'Access-Control-Allow-Headers':\s*'([A-Za-z0-9,\- ]+)'/);
  if (!match) throw new Error('index.ts no longer states Access-Control-Allow-Headers');
  return match[1].split(',').map((name) => name.trim().toLowerCase());
}

/** Every custom request header the client sends, by name. */
async function clientHeaders(): Promise<string[]> {
  const source = await readFile(
    new URL('../../app/src/lib/repo/remote.ts', import.meta.url), 'utf8');
  return [...new Set([...source.matchAll(/'(X-[A-Za-z0-9-]+)':/g)].map((m) => m[1]))];
}

/* A custom request header has to be named in the CORS answer or the
   browser's preflight refuses the request outright, and no test of the
   route can see it: curl sends the header happily and the route's own
   tests call the handler directly. X-Aisar-File-Name was missing from
   13 September, so document upload had never once worked from
   jentera.ai while its route tests passed. */
describe('a custom request header the client sends', () => {
  it('is named in the CORS preflight answer', async () => {
    const allowed = await corsAllowHeaders();
    const missing = (await clientHeaders()).filter((name) => !allowed.includes(name.toLowerCase()));
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && pnpm vitest run test/cors.test.ts`
Expected: FAIL — `expected [ 'X-Aisar-File-Name' ] to deeply equal []`

- [ ] **Step 3: Write minimal implementation**

In `worker/src/index.ts`, in the `cors()` return object (line 69), change:

```typescript
    'Access-Control-Allow-Headers': 'Content-Type',
```

to:

```typescript
    /* X-Aisar-File-Name carries the uploaded document's name on
       /api/runs/ingest/file. A custom request header must be named here or
       the preflight refuses the request; test/cors.test.ts scans the client
       for these so the next one cannot be forgotten. */
    'Access-Control-Allow-Headers': 'Content-Type,X-Aisar-File-Name',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && pnpm vitest run test/cors.test.ts`
Expected: PASS, all three describes green.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts worker/test/cors.test.ts
git commit -m "fix: name X-Aisar-File-Name in the CORS answer

Document upload had never worked from a browser: the header is not
safelisted, so the preflight refused every request while curl and the
route's own tests passed. The scan in test/cors.test.ts now reads the
client's custom headers the way it already reads route methods."
```

---

### Task 2: The 128 KiB cap the route can never see

`request-guard.ts` caps every body at `MAX_API_BODY_BYTES` (128 KiB) and `index.ts:117` runs it before `handleRuns` at `:141` with no path exemption, so `UPLOAD_DOCUMENT_LIMIT` (8 MiB, `routes/runs.ts:815`) is unreachable and a phone photo would 413 before the route ran. The runner's own artifact upload is unaffected — `index.ts` dispatches `RUNTIME_ARTIFACTS_PATH` above the guard.

**Files:**
- Modify: `worker/src/request-guard.ts:5-7` and `:92-126`
- Create: `worker/test/request-guard-body.test.ts`

**Interfaces:**
- Consumes: `testEnv` from `test/harness.ts`; `guardApiRequest`, `MAX_API_BODY_BYTES` from `src/request-guard.ts`.
- Produces: `MAX_UPLOAD_BODY_BYTES: number` exported from `src/request-guard.ts`, the per-path cap for document upload. Nothing else changes signature: `guardApiRequest(request, env, url, cors)` keeps returning `Promise<Response | null>`.

- [ ] **Step 1: Write the failing test**

Create `worker/test/request-guard-body.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { guardApiRequest, MAX_API_BODY_BYTES, MAX_UPLOAD_BODY_BYTES } from '../src/request-guard';
import { testEnv } from './harness';

const INGEST = 'https://api.test/api/runs/ingest/file';
const ASK = 'https://api.test/api/runs/ask';

function upload(url: string, bytes: number, declareLength = true): Request {
  const body = new Uint8Array(bytes);
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-Aisar-File-Name': 'menu.pdf',
      ...(declareLength ? { 'Content-Length': String(bytes) } : {}),
    },
    body,
  });
}

async function guard(request: Request): Promise<Response | null> {
  return guardApiRequest(request, testEnv(), new URL(request.url), {});
}

/* The guard runs before every route, so a route's own limit is only
   reachable if the guard agrees. Document upload's 8 MiB limit sat behind
   a flat 128 KiB cap until 14 September and could never be reached; the
   route's tests could not see it because they call the handler directly. */
describe('the pre-route body cap', () => {
  it('lets a document through to the upload route', async () => {
    expect(await guard(upload(INGEST, 1024 * 1024))).toBeNull();
  });

  it('still refuses a document past the upload route own limit', async () => {
    const response = await guard(upload(INGEST, MAX_UPLOAD_BODY_BYTES + 1));
    expect(response?.status).toBe(413);
  });

  it('holds every other path to the small JSON cap', async () => {
    const response = await guard(upload(ASK, MAX_API_BODY_BYTES + 1));
    expect(response?.status).toBe(413);
  });

  it('measures an undeclared body against the path own cap', async () => {
    expect(await guard(upload(INGEST, 1024 * 1024, false))).toBeNull();
    const response = await guard(upload(ASK, MAX_API_BODY_BYTES + 1, false));
    expect(response?.status).toBe(413);
  });

  it('leaves a small JSON command alone', async () => {
    const request = new Request(ASK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(await guard(request)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && pnpm vitest run test/request-guard-body.test.ts`
Expected: FAIL — first on the import (`MAX_UPLOAD_BODY_BYTES` is not exported), and once that exists, on "lets a document through" returning a 413 rather than null.

- [ ] **Step 3: Write minimal implementation**

In `worker/src/request-guard.ts`, below the existing `MAX_API_BODY_BYTES` declaration:

```typescript
/** API payloads in this product are small JSON commands. Files belong in
    object storage, not in a Worker request that will be buffered and parsed. */
export const MAX_API_BODY_BYTES = 128 * 1024;

/** The one exception: a document the owner uploads to be read. The route
    (routes/runs.ts) enforces the same ceiling again and decides what kinds
    of file are allowed; this only stops the guard from refusing a body the
    route would have accepted. Runner artifact uploads do not appear here
    because index.ts dispatches them above the guard. */
export const MAX_UPLOAD_BODY_BYTES = 8 * 1024 * 1024;

function bodyCapFor(method: string, pathname: string): number {
  return method === 'POST' && pathname === '/api/runs/ingest/file'
    ? MAX_UPLOAD_BODY_BYTES
    : MAX_API_BODY_BYTES;
}
```

Then in `guardApiRequest`, replace the body-length block (currently lines 92-126) with the same code reading `cap` instead of the constant:

```typescript
  const cap = bodyCapFor(request.method, url.pathname);
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isFinite(length) || length < 0 || length > cap) {
      return response(413, 'request body too large', cors);
    }
  } else if (request.body !== null) {
    /* No Content-Length (e.g. Transfer-Encoding: chunked) bypassed the
       check above. Measure the real body through a clone — reading the
       clone leaves the original intact for the route — and refuse
       anything over the cap. A bounded read also prevents a slow trickle
       from pinning the isolate forever; the stream only makes progress
       while we pull. */
    const probe = request.clone();
    try {
      // The enclosing else-if already proved request.body !== null, so the
      // clone's stream exists.
      const reader = probe.body!.getReader();
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > cap) break;
      }
      await reader.cancel().catch(() => {});
      if (total > cap) {
        return response(413, 'request body too large', cors);
      }
    } catch {
      /* Unreadable body — hand it to the route, whose JSON parse will
         fail loudly rather than accept garbage. */
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && pnpm vitest run test/request-guard-body.test.ts`
Expected: PASS, five tests.

- [ ] **Step 5: Run the whole suite and both typecheck passes**

Run: `cd worker && pnpm test && pnpm typecheck`
Expected: PASS. Docker must be running. If `test/ingest-file.test.ts` fails, the change broke the route's own limit — the guard must stay at or above `UPLOAD_DOCUMENT_LIMIT`, never below.

- [ ] **Step 6: Commit**

```bash
git add worker/src/request-guard.ts worker/test/request-guard-body.test.ts
git commit -m "fix: let an uploaded document past the pre-route body cap

The guard held every path to 128 KiB, so the upload route 8 MiB limit
was unreachable and any real document 413'd before the route ran. The
cap is now per path, and tested through guardApiRequest, which is the
only place that can see it: route tests call the handler directly."
```

---

### Task 3: Prove it against production

Both faults were invisible to the suite, so the suite passing is not evidence the upload works. CLAUDE.md asks for an end-to-end run against the deployed API for anything touching routes, asserting status codes on every write.

**Files:**
- Modify: `docs/todo.md` (move the "Document upload" row from "Shipped, never exercised on production" to "Closed")

**Interfaces:**
- Consumes: Tasks 1 and 2 deployed.
- Produces: nothing in code.

- [ ] **Step 1: Deploy the worker**

Run: `cd worker && pnpm run deploy`
Expected: `predeploy` (`scripts/check-transfer-fields.mjs`) passes, then a successful `wrangler deploy`. A predeploy failure means an unrelated transfer field has outrun the pinned bundle — stop and read `docs/release-playbook.md` rather than forcing past it.

- [ ] **Step 2: Upload a real document from the browser**

On https://jentera.ai, signed in as an owner, open Knowledge and upload one PDF and one CSV.
Expected: both succeed; facts land unconfirmed with the file name as their source. A 413 means Task 2 did not deploy; a CORS error in the console means Task 1 did not.

- [ ] **Step 3: Confirm the rows from the database side**

Run: `./worker/scripts/stats.sh sql "select source_ref, key, confirmed_by from fact where source = 'agent' order by created_at desc limit 10"`
Expected: rows naming both uploaded files, `confirmed_by` null.

- [ ] **Step 4: Record it**

In `docs/todo.md`, delete the "Document upload" row from the "Shipped, never exercised on production" table and add to "Closed":

```markdown
- 14 Sep — Document upload works from a browser for the first time. Two faults in front of a correct route: `X-Aisar-File-Name` was not in `Access-Control-Allow-Headers` so the preflight refused every request, and the pre-route guard's flat 128 KiB cap made the route's 8 MiB limit unreachable. Both are now scanned or tested outside the route, which could not see either.
```

- [ ] **Step 5: Commit**

```bash
git add docs/todo.md
git commit -m "docs: record document upload working on production"
```

---

## What this plan does not cover

The spec's other prerequisites are separate plans, each producing working software on its own:

- **Account deletion** — needs its own spec first: it ends a business, its RLS-scoped rows, R2 artifacts and a Fly sprite. Store gate for both listings.
- **Privacy policy page** — bilingual, PDPA-aware, needs the owner's input on what is collected.
- **Proving web push on a real device** — no code; `push_subscription` is still empty.
- **The native app itself** — shell and auth, then push, then camera and the version gate.
