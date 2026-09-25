# Query Cache for the Bookings Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the Bookings path's server data (apps list, waiting requests, Bookings config, booking lists and single bookings, notifications) behind one in-memory TanStack Query cache per signed-in page. A revisit inside 30 s then shows content with no request, and a later return shows cached content at once while one background request refreshes it.

**Architecture:** `RepositoryGate` creates one `QueryClient` per signed-in page and mounts it with the session's business id (`QueryScope`). The anonymous demo gets no client. The existing API modules (`lib/apps/api.ts`, `lib/notifications.ts`) stay as they are. Query options in `lib/apps/queries.ts` and `hooks/useNotifications.ts` wrap them under keys that all start `['biz', businessId, …]`. The public hooks keep their shapes: `useApps()` / `AppsProvider` and `useNotifications()`. Booking actions become mutations that never retry. They cancel reads in flight, write the server's answer into every cached list, then read the lists again.

**Tech Stack:** React 19, TypeScript 7 (`tsc -b`), Vite 8, Vitest 4 + Testing Library (jsdom), `@tanstack/react-query` 5.103.2, and `@tanstack/react-query-devtools` 5.103.2 (dev only).

**Spec:** `docs/superpowers/specs/2026-09-25-query-cache-bookings-path-design.md`. It is the authority; read it before Task 1.

**Status:** Complete. Every code block below was run in a scratch copy of `app/`, one task at a time, in order:
- each task's listed tests pass;
- `pnpm typecheck` is clean;
- the full suite passes, apart from tests that read `../worker`, which the copy did not have;
- `pnpm build` succeeds with no devtools in `dist`.

## Global Constraints

- Library: `@tanstack/react-query` **exactly `5.103.2`** as a dependency; `@tanstack/react-query-devtools` **exactly `5.103.2`** as a devDependency. The devtools load only in development and never ship in the production bundle.
- Cache defaults, copied from the spec: `staleTime` **30 s**, `gcTime` **30 min**, `refetchOnWindowFocus` **on**. A read retries **once**, and only on a failure that can be temporary: an `AppsError` with `status === 0`, `status >= 500`, or code `INVALID_RESPONSE`, or any failure of a notifications read. A 4xx never retries. **Mutations never retry.**
- Every query key starts `['biz', businessId, …]` and is built only in `app/src/lib/query/keys.ts`. The spec fixes these keys: apps list `['biz', id, 'apps', 'list']`; waiting requests `['biz', id, 'apps', 'bookings', 'pending']`; config `['biz', id, 'apps', 'bookings', 'config']`; window `['biz', id, 'apps', 'bookings', 'window', from, days]`; one booking `['biz', id, 'apps', 'booking', bookingId]`; notifications `['biz', id, 'notifications']`.
- The cache lives in memory only. Nothing is persisted to device storage: no persister, and no `localStorage` writes of server data.
- One `QueryClient` per signed-in page, created by `RepositoryGate` for `RemoteRepository` only. The anonymous demo (`LocalRepository`) gets no client and must behave exactly as before.
- Public hook shapes are unchanged: `useApps()` returns `{ enabled, api, list, pending, loading, error, refresh }`, `AppsProvider` takes `{ api, unread, children }`, and `useNotifications()` returns `{ items, unread, nextCursor, loading, loadingMore, error, refresh, markRead, markAll, loadMore }`.
- The existing tests are the regression net. An assertion may change only in *how data is fetched*, never in *what the owner sees*. Name every changed assertion in the task report.
- House rules (`CLAUDE.md`):
  - TypeScript + React under `app/`, two-space indent, semicolons, single quotes, `@/` imports.
  - Conventional Commit subjects.
  - Stage **named paths only**, never `git add -A` / `git add .`.
  - Keep accessibility labels and `prefers-reduced-motion` handling.
  - Use `Button` from `@/components/ui`.
- Do not switch branches, push, merge or deploy. Work in `/Users/dr.noranizaahmad/.agent-worktree/workspaces/aisar-site-b726b8/bookings-v1` on branch `query-cache`.
- The shell is zsh, and an `rtk` hook rewrites some commands. Use `/usr/bin/grep`, `/bin/ls`, `/usr/bin/find` and `/bin/cat` when you need exact output.
- Commands run from `app/`:
  - `pnpm exec vitest run <files>`
  - `pnpm typecheck`
  - `pnpm build`
- Two full-suite failures are known and unrelated:
  - `src/routes/__tests__/launch-post.test.tsx` already fails on main.
  - `src/components/__tests__/workspace-modes.test.tsx` can fail under full-suite load and pass alone. Re-run it alone before blaming a change.

## Review Focus

The five failure modes most likely to reach an owner, each with the test that pins it:

1. **A decision leaves an older copy waiting in another cached list.** Examples: confirm in Needs you, then open a Today list cached before it; or confirm on Home's brief. Expected: the decided state shows at once, never a stale "Needs you" with Confirm. Tests:
   - Task 5, `writeBooking … every list that holds it`.
   - Task 2, `marks every cached Bookings window stale on a refresh`.
   - Task 6, `shows a decision in every cached list at once`.
2. **Every waiting request is decided, but an earlier scan is still cached.** Expected: Home, the brief and the Needs you chip count 0, with no scan request. Test: Task 2, `stops counting requests once the list says none wait`.
3. **A deep link to a booking that no longer exists (404).** Expected: "This booking could not be found." once, and no new request on every return to the app. Test: Task 6, `does not ask again for a booking that could not be found`.
4. **A query key without the business id.** Expected: one business's cached data never draws under another. Tests:
   - Task 1, `start with the business, for every key there is`.
   - Task 2, `never draws one business's apps under another`.
5. **Calendar polling after the Bookings tab closes, or while the app is hidden.** Expected: polling stops. Tests:
   - Task 6, `stops polling when the list is closed` and `stops polling once Calendar has synced`.
   - The existing `skips a poll tick while the tab is hidden`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `app/src/lib/query/client.ts` (new) | `createQueryClient()`, defaults, retry predicate | 1 |
| `app/src/lib/query/keys.ts` (new) | Every query/mutation key; `bookingListsFilter` | 1 |
| `app/src/lib/query/scope.tsx` (new) | `QueryScope` (provider + business id + dev-only devtools), `useBusinessId`, `useRequiredBusinessId` | 1 |
| `app/src/test-support/query.tsx` (new) | `createTestQueryClient`, `renderWithQuery`, `returnToApp`, `TEST_BUSINESS_ID` | 1 |
| `app/src/lib/repo/gate.tsx`, `app/src/lib/repo/remote.ts` | Client per signed-in page; business id from `/api/me` or the business a first sign-in creates | 1 |
| `app/src/lib/apps/queries.ts` (new) | Query options, `refreshApps`, config save mutation, booking cache writes and the action mutation | 2, 4, 5 |
| `app/src/lib/apps/useApps.tsx` | `AppsProvider` on queries (shape unchanged) | 2 |
| `app/src/hooks/useNotifications.ts` | One shared infinite query; optimistic reads | 3 |
| `app/src/routes/views/apps/BookingsApp.tsx`, `BookingsSettings.tsx`, `BookingPage.tsx` | Config as a query; saves through the mutation | 4 |
| `app/src/lib/apps/types.ts`, `app/src/routes/views/apps/BookingCard.tsx` | `BookingAction` moves to the lib layer | 5 |
| `app/src/lib/apps/bookings.ts` | `mergeBookingRows` (the decided-here rule as a pure function) | 5 |
| `app/src/routes/views/apps/BookingsList.tsx` | Reads and writes through the cache | 6 |
| `CLAUDE.md` | House rule for server data | 7 |

### Facts the spec did not state (read before starting)

- **There is no `AlertsBell.tsx`.** The "bell" is the Notifications nav badge that `Dashboard.tsx` draws from its one `useNotifications()` (`app/src/routes/Dashboard.tsx:119`, `:188`, `:363`), and the Alerts view is `NotificationsView`, which gets that same state as a prop.
- **The spec's config key sits under the lists' prefix.** `['biz', id, 'apps', 'bookings', 'config']` sits under `['biz', id, 'apps', 'bookings']`, the prefix the spec's `setQueriesData` targets. Lists are therefore reached through `bookingListsFilter` (pending + window only), and windows through `keys.bookingWindows`.
- **The waiting-requests list keeps only what still waits.** When `writeBooking` puts a decided booking into it, the booking is replaced and then filtered out (`status === 'pending' && !expired`, as `loadPendingBookings` does). The Needs you card stays on screen through the decided-here rule.
- **`/api/me` already sends `businessId`** (`worker/src/routes/session.ts:634` spreads `Identity`, `worker/src/auth.ts:501`). Only `MeResponse` in `app/src/lib/repo/remote.ts:76` lacks the field. On a first sign-in it is `null`, and the gate then uses the id `createBusiness` returned.
- **The dev preview still renders `Dashboard` without a signed-in session.** The spec says "the bell only shows when signed in", which holds in production because `RequireAuth` guards `/app` (`app/src/App.tsx:90-93`). The dev preview (`app/src/App.tsx:44`) and tests render `Dashboard` with `LocalRepository`. There, `useNotifications()` is inert: no request, and an empty inbox instead of today's failed request.
- **TanStack's focus listener sits on `window`.** It is registered with `window.addEventListener('visibilitychange', …)`. Browsers fire `visibilitychange` on `document` with `bubbles: true`, but the existing tests dispatch a non-bubbling `new Event('visibilitychange')` on `document`, which never reaches it. Tests that mean "the owner came back" use `returnToApp(client)` from `@/test-support/query`. It fires the bubbling event after marking the cache stale.

---
### Task 1: Query cache foundation

**Files:**
- Modify: `app/package.json`, `app/pnpm-lock.yaml` (through `pnpm add`)
- Create: `app/src/lib/query/client.ts`
- Create: `app/src/lib/query/keys.ts`
- Create: `app/src/lib/query/scope.tsx`
- Create: `app/src/test-support/query.tsx`
- Modify: `app/src/lib/repo/remote.ts` (`MeResponse` at `:76`, `createBusiness` near `:258`)
- Modify: `app/src/lib/repo/gate.tsx` (imports, `Chosen`, `choose()`, `RepositoryGate` render)
- Test: `app/src/lib/query/__tests__/client.test.ts`, `app/src/lib/query/__tests__/keys.test.ts`, `app/src/lib/repo/__tests__/gate-query.test.tsx`

**Interfaces:**
- Consumes: `AppsError` from `@/lib/apps/api` (`code`, `status`), `Repository` from `@/lib/repo/types`, `RepositoryProvider` from `@/lib/repo/context`, `I18nProvider` from `@/i18n/I18nProvider`.
- Produces (later tasks rely on these exact names):
  - `@/lib/query/client`: `STALE_MS = 30_000`, `GC_MS = 1_800_000`, `retryableRead(error: unknown): boolean`, `retryOnce(failureCount: number, error: unknown): boolean`, `createQueryClient(): QueryClient`.
  - `@/lib/query/keys`:
    - `keys.business(id)`, `keys.appsList(id)`, `keys.bookings(id)`, `keys.pendingBookings(id)`, `keys.bookingWindows(id)`
    - `keys.bookingWindow(id, from: string, days: number)`, `keys.bookingsConfig(id)`, `keys.booking(id, bookingId)`, `keys.notifications(id)`
    - All return readonly tuples starting `'biz', id`.
    - `mutationKeys.bookingAction(id)`.
    - `bookingListsFilter(businessId: string): QueryFilters`, which matches only the pending and window queries.
  - `@/lib/query/scope`: `QueryScope({ client: QueryClient; businessId: string | null; children })`, `useBusinessId(): string | null`, `useRequiredBusinessId(): string` (throws when null).
  - `@/test-support/query`:
    - `TEST_BUSINESS_ID = 'biz-test'` and `createTestQueryClient(): QueryClient`.
    - `renderWithQuery(ui, { client?, businessId?, repository? }): Promise<RenderResult & { client: QueryClient }>`.
    - `returnToApp(client: QueryClient): Promise<void>`.
  - `RemoteRepository.createdBusinessId: string | null`; `MeResponse.businessId?: string | null`.

- [ ] **Step 1: Confirm `node_modules` is this worktree's own, then add the dependencies**

`pnpm add` rewrites `node_modules`. In a worktree whose `app/node_modules` is a symlink to the main checkout, that would rewrite another session's install. Stop and ask if it is a link.

Run:
```bash
cd /Users/dr.noranizaahmad/.agent-worktree/workspaces/aisar-site-b726b8/bookings-v1/app
test -L node_modules && echo "SYMLINK - stop" || echo "own directory"
pnpm add --save-exact @tanstack/react-query@5.103.2
pnpm add --save-exact -D @tanstack/react-query-devtools@5.103.2
/usr/bin/grep -n tanstack package.json
```
Expected: `own directory`, then `package.json` lists `"@tanstack/react-query": "5.103.2"` under dependencies and `"@tanstack/react-query-devtools": "5.103.2"` under devDependencies. Each `pnpm add` can take a few minutes.

- [ ] **Step 2: Write the failing tests**

Create `app/src/lib/query/__tests__/client.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { AppsError } from '@/lib/apps/api';
import { createQueryClient, GC_MS, retryOnce, STALE_MS } from '../client';

describe('the page query client', () => {
  it('keeps data fresh for 30 s, drops it after 30 min unused, reads again on focus, and never retries a write', () => {
    const defaults = createQueryClient().getDefaultOptions();
    expect(STALE_MS).toBe(30_000);
    expect(GC_MS).toBe(1_800_000);
    expect(defaults.queries).toMatchObject({ staleTime: STALE_MS, gcTime: GC_MS, refetchOnWindowFocus: true, retry: retryOnce });
    expect(defaults.mutations).toMatchObject({ retry: false });
  });

  it('retries a read once, and only on a failure that can be temporary', () => {
    expect(retryOnce(0, new AppsError('NETWORK', 0, false))).toBe(true);
    expect(retryOnce(0, new AppsError('REQUEST_FAILED', 503))).toBe(true);
    expect(retryOnce(0, new AppsError('INVALID_RESPONSE', 200))).toBe(true);
    expect(retryOnce(0, new AppsError('NOT_FOUND', 404))).toBe(false);
    expect(retryOnce(0, new AppsError('FORBIDDEN', 403))).toBe(false);
    // Notifications throw a plain Error with no status: once on any failure.
    expect(retryOnce(0, new Error('Could not load notifications.'))).toBe(true);
    // Never a second retry.
    expect(retryOnce(1, new AppsError('NETWORK', 0, false))).toBe(false);
    expect(retryOnce(1, new Error('Could not load notifications.'))).toBe(false);
  });
});
```

Create `app/src/lib/query/__tests__/keys.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { bookingListsFilter, keys, mutationKeys } from '../keys';

const BIZ = 'biz-1';
const ID = '11111111-1111-4111-8111-111111111111';

describe('query keys', () => {
  it('start with the business, for every key there is', () => {
    const all = [
      keys.business(BIZ), keys.appsList(BIZ), keys.bookings(BIZ), keys.pendingBookings(BIZ), keys.bookingWindows(BIZ),
      keys.bookingWindow(BIZ, '2026-10-05', 1), keys.bookingsConfig(BIZ), keys.booking(BIZ, ID), keys.notifications(BIZ),
      mutationKeys.bookingAction(BIZ),
    ];
    for (const key of all) expect(key.slice(0, 2)).toEqual(['biz', BIZ]);
  });

  it('reach the lists of bookings without the config that shares their prefix, and nothing of another business', () => {
    const client = new QueryClient();
    for (const key of [
      keys.pendingBookings(BIZ), keys.bookingWindow(BIZ, '2026-10-05', 1), keys.bookingWindow(BIZ, '2026-11-05', 31),
      keys.bookingsConfig(BIZ), keys.booking(BIZ, ID), keys.appsList(BIZ), keys.pendingBookings('biz-2'),
    ]) client.setQueryData(key, []);
    const found = client.getQueryCache().findAll(bookingListsFilter(BIZ)).map((query) => query.queryKey);
    expect(found).toHaveLength(3);
    expect(found).toEqual(expect.arrayContaining([
      keys.pendingBookings(BIZ), keys.bookingWindow(BIZ, '2026-10-05', 1), keys.bookingWindow(BIZ, '2026-11-05', 31),
    ]));
  });
});
```

Create `app/src/lib/repo/__tests__/gate-query.test.tsx`:
```tsx
import { StrictMode, useContext } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Fresh modules per test (the gate reads VITE_API_URL at import), so the
   gate, the scope and the query library are all imported after the reset. */
describe('the query cache under RepositoryGate', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'https://api.jentera.test');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('gives a signed-in page one client, keyed by the session business, even under StrictMode', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ ok: true, userId: 'user-1', businessId: 'biz-1' }))
      .mockResolvedValueOnce(json({ snapshot: { onboarded: true } })));
    const { RepositoryGate } = await import('@/lib/repo/gate');
    const { useBusinessId } = await import('@/lib/query/scope');
    const { QueryClientContext } = await import('@tanstack/react-query');
    const seen = new Set<unknown>();
    function Probe() {
      seen.add(useContext(QueryClientContext));
      return <p>business {useBusinessId() ?? 'none'}</p>;
    }
    render(<StrictMode><RepositoryGate><Probe /></RepositoryGate></StrictMode>);
    expect(await screen.findByText('business biz-1')).toBeInTheDocument();
    expect(seen.size).toBe(1);
    expect([...seen][0]).toBeDefined();
  });

  it('gives the anonymous demo no client and no business', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ ok: false, err: 'not signed in' }, 401)));
    const { RepositoryGate } = await import('@/lib/repo/gate');
    const { useBusinessId } = await import('@/lib/query/scope');
    const { QueryClientContext } = await import('@tanstack/react-query');
    function Probe() {
      const client = useContext(QueryClientContext);
      return <p>{client ? 'client' : 'no client'} / {useBusinessId() ?? 'none'}</p>;
    }
    render(<RepositoryGate><Probe /></RepositoryGate>);
    expect(await screen.findByText('no client / none')).toBeInTheDocument();
  });

  it('keys a first sign-in by the business it has just created', async () => {
    let created = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/me')) return json({ ok: true, userId: 'user-2', businessId: null });
      if (url.endsWith('/api/state/business') && init?.method === 'POST') {
        created = true;
        return json({ ok: true, businessId: 'biz-new' });
      }
      if (url.endsWith('/api/state')) return created ? json({ snapshot: { onboarded: false } }) : json({ ok: false, code: 'NO_BUSINESS' }, 404);
      throw new TypeError('offline');
    }));
    const { RepositoryGate } = await import('@/lib/repo/gate');
    const { useBusinessId } = await import('@/lib/query/scope');
    function Probe() { return <p>business {useBusinessId() ?? 'none'}</p>; }
    render(<RepositoryGate><Probe /></RepositoryGate>);
    expect(await screen.findByText('business biz-new')).toBeInTheDocument();
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm exec vitest run src/lib/query src/lib/repo/__tests__/gate-query.test.tsx`
Expected:
- `client.test.ts` and `keys.test.ts` FAIL to import `../client` / `../keys`.
- `gate-query.test.tsx` FAILS to import `@/lib/query/scope`.

- [ ] **Step 4: Create the client, the keys and the scope**

Create `app/src/lib/query/client.ts`:
```ts
import { QueryClient } from '@tanstack/react-query';
import { AppsError } from '@/lib/apps/api';

/* The server-data cache for a signed-in page (docs/superpowers/specs/
   2026-09-25-query-cache-bookings-path-design.md). One client per page,
   created by RepositoryGate, kept in memory only: nothing here is ever
   written to device storage, and a full reload starts empty. */

/** A revisit inside this window shows the cache without a request. */
export const STALE_MS = 30_000;
/** Data no screen has shown for this long is dropped. */
export const GC_MS = 30 * 60_000;

/** Whether a failed read can be worth one more try. Apps reads say so
    through AppsError: a network failure (status 0), a 5xx, or an answer we
    could not read. A 4xx never changes on retry. The notifications module
    throws a plain Error with no status, so its reads retry on any failure. */
export function retryableRead(error: unknown): boolean {
  if (error instanceof AppsError) {
    return error.status === 0 || error.status >= 500 || error.code === 'INVALID_RESPONSE';
  }
  return true;
}

/** A read retries once, and only when `retryableRead` allows it. */
export function retryOnce(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && retryableRead(error);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_MS,
        gcTime: GC_MS,
        refetchOnWindowFocus: true,
        retry: retryOnce,
      },
      /* Confirm, decline, cancel and a settings save are never sent twice:
         a lost answer means re-read and show the truth. */
      mutations: { retry: false },
    },
  });
}
```

Create `app/src/lib/query/keys.ts`:
```ts
import type { QueryFilters } from '@tanstack/react-query';

/* Every query key starts with the business it belongs to, so data read for
   one business can never be drawn under another. Build keys here only. */

export const keys = {
  business: (businessId: string) => ['biz', businessId] as const,
  appsList: (businessId: string) => ['biz', businessId, 'apps', 'list'] as const,
  /** Prefix of every Bookings list AND the Bookings config: use
      `bookingListsFilter` to reach the lists alone. */
  bookings: (businessId: string) => ['biz', businessId, 'apps', 'bookings'] as const,
  pendingBookings: (businessId: string) => ['biz', businessId, 'apps', 'bookings', 'pending'] as const,
  /** Prefix of every window (Today, Upcoming, a picked date). */
  bookingWindows: (businessId: string) => ['biz', businessId, 'apps', 'bookings', 'window'] as const,
  bookingWindow: (businessId: string, from: string, days: number) =>
    ['biz', businessId, 'apps', 'bookings', 'window', from, days] as const,
  bookingsConfig: (businessId: string) => ['biz', businessId, 'apps', 'bookings', 'config'] as const,
  booking: (businessId: string, bookingId: string) => ['biz', businessId, 'apps', 'booking', bookingId] as const,
  notifications: (businessId: string) => ['biz', businessId, 'notifications'] as const,
};

/** Mutation keys live apart from query keys, scoped the same way. */
export const mutationKeys = {
  bookingAction: (businessId: string) => ['biz', businessId, 'apps', 'booking-action'] as const,
};

/** Every cached list of bookings (the waiting requests and each window),
    and not the config that shares their prefix. */
export function bookingListsFilter(businessId: string): QueryFilters {
  return {
    queryKey: keys.bookings(businessId),
    predicate: (query) => query.queryKey[4] === 'pending' || query.queryKey[4] === 'window',
  };
}
```

Create `app/src/lib/query/scope.tsx`:
```tsx
import { createContext, lazy, Suspense, useContext, type ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';

const BusinessIdContext = createContext<string | null>(null);

/* Development only. A production build replaces import.meta.env.DEV with
   false, so this branch and its dynamic import leave the bundle; tests run
   in MODE 'test' and never render it either. */
const Devtools = import.meta.env.DEV && import.meta.env.MODE !== 'test'
  ? lazy(() => import('@tanstack/react-query-devtools').then((module) => ({ default: module.ReactQueryDevtools })))
  : null;

/** The page's query cache and the business every key starts with. Mounted
    by RepositoryGate for a signed-in page only, and by tests. */
export function QueryScope({ client, businessId, children }: {
  client: QueryClient;
  businessId: string | null;
  children: ReactNode;
}) {
  return <QueryClientProvider client={client}>
    <BusinessIdContext.Provider value={businessId}>
      {children}
      {Devtools && <Suspense fallback={null}><Devtools initialIsOpen={false} /></Suspense>}
    </BusinessIdContext.Provider>
  </QueryClientProvider>;
}

/** The signed-in business, from the session the gate already holds, or null
    (the anonymous demo, or a session /api/me reported no business for). */
export function useBusinessId(): string | null {
  return useContext(BusinessIdContext);
}

/** For screens that only exist inside a signed-in business (Apps). */
export function useRequiredBusinessId(): string {
  const businessId = useContext(BusinessIdContext);
  if (!businessId) throw new Error('This screen reads the query cache and needs a signed-in business above it (QueryScope).');
  return businessId;
}
```

- [ ] **Step 5: Carry the business id through the session**

In `app/src/lib/repo/remote.ts`, add the field at the end of `interface MeResponse`, after `userId?: string;`:
```ts
  /** The session's business; null on a first sign-in, before one exists.
      Every query cache key starts with it (lib/query/keys.ts). */
  businessId?: string | null;
```
In the same file, directly above the doc comment of `async createBusiness(p: {`, add:
```ts
  /** The business `createBusiness` made on this page, for a first sign-in
      whose /api/me answered before there was one. */
  createdBusinessId: string | null = null;

```
and inside `createBusiness`, replace `    return businessId;` with:
```ts
    this.createdBusinessId = businessId;
    return businessId;
```

- [ ] **Step 6: Give each signed-in page one client in `RepositoryGate`**

In `app/src/lib/repo/gate.tsx`:

1. After `import type { ReactNode } from 'react';` add `import type { QueryClient } from '@tanstack/react-query';`.
2. After `import { PageLoading } from '@/components/ui';` add:
```ts
import { createQueryClient } from '@/lib/query/client';
import { QueryScope } from '@/lib/query/scope';
```
3. At the end of `type Chosen = { … }`, after `email?: string | null;`, add:
```ts
  /** The page's query cache: signed in only. The demo gets none. */
  client?: QueryClient;
  /** The business every query key starts with; null when there is none. */
  businessId?: string | null;
```
4. In `choose()`, directly after `if (me) remote.prime({ me });` add:
```ts
  let businessId = typeof me?.businessId === 'string' && me.businessId ? me.businessId : null;
```
5. In the `NoBusinessError` branch, after `await migrateLocalToRemote(new LocalRepository(), remote);` add:
```ts
      /* /api/me answered before the business existed. */
      businessId = remote.createdBusinessId;
```
6. In the final `return { repo: remote, mode: 'remote', … }`, add after `mode: 'remote',`:
```ts
    /* Made here, once per page: choose() runs once even under StrictMode
       (the `started` ref below), so there is never a second cache. */
    client: createQueryClient(),
    businessId,
```
7. Replace the final `return ( <SignedInProvider …> … </SignedInProvider> );` of `RepositoryGate` with:
```tsx
  const session = (
    <SignedInProvider value={chosen.mode === 'remote'} account={chosen.account} email={chosen.email} routinesVersion={chosen.routinesVersion} teamVersion={chosen.teamVersion} appsVersion={chosen.appsVersion}>
      <RepositoryProvider repository={chosen.repo}>{children}</RepositoryProvider>
    </SignedInProvider>
  );
  /* The query cache is for signed-in pages only; the anonymous demo gets no
     client and runs exactly as it always has. */
  return chosen.client
    ? <QueryScope client={chosen.client} businessId={chosen.businessId ?? null}>{session}</QueryScope>
    : session;
```

- [ ] **Step 7: Create the shared test helper**

Create `app/src/test-support/query.tsx`:
```tsx
import { act, render, type RenderResult } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { I18nProvider } from '@/i18n/I18nProvider';
import { createQueryClient } from '@/lib/query/client';
import { QueryScope } from '@/lib/query/scope';
import { RepositoryProvider } from '@/lib/repo/context';
import type { Repository } from '@/lib/repo/types';

export const TEST_BUSINESS_ID = 'biz-test';

/** Production defaults (30 s fresh, focus refetch), except that a failure
    shows at once instead of retrying, and nothing is dropped mid-test. */
export function createTestQueryClient(): QueryClient {
  const client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    queries: { ...defaults.queries, retry: false, gcTime: Infinity },
    mutations: { ...defaults.mutations, retry: false },
  });
  return client;
}

export interface RenderWithQueryOptions {
  /** Pass one to share a cache between mounts (a revisit); a fresh test client otherwise. */
  client?: QueryClient;
  /** The signed-in business; null for a session with none. */
  businessId?: string | null;
  /** Also mount RepositoryProvider and I18nProvider, as most view tests need. */
  repository?: Repository;
}

/** Renders inside a query cache (and, with `repository`, the app's
    providers), then flushes the first microtasks: LocalRepository.load()
    and the first queries settle there. The wrapper survives `rerender`. */
export async function renderWithQuery(ui: ReactElement, options: RenderWithQueryOptions = {}): Promise<RenderResult & { client: QueryClient }> {
  const client = options.client ?? createTestQueryClient();
  const businessId = options.businessId === undefined ? TEST_BUSINESS_ID : options.businessId;
  const repository = options.repository;
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryScope client={client} businessId={businessId}>
      {repository ? <RepositoryProvider repository={repository}><I18nProvider>{children}</I18nProvider></RepositoryProvider> : children}
    </QueryScope>;
  }
  const view = render(ui, { wrapper: Wrapper });
  await act(async () => {});
  return { ...view, client };
}

/** The owner comes back to the app after the 30 s window: every cached query
    is past it, and the browser fires visibilitychange. It bubbles to window,
    as the HTML spec says, which is where the query cache listens; the
    non-bubbling Event older tests dispatch on document never reaches it. */
export async function returnToApp(client: QueryClient): Promise<void> {
  await act(async () => {
    await client.invalidateQueries({ refetchType: 'none' });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
}
```

- [ ] **Step 8: Run the new and existing gate tests**

Run: `pnpm exec vitest run src/lib/query src/lib/repo/__tests__/gate-query.test.tsx src/lib/repo/__tests__/gate.test.tsx src/lib/repo/__tests__/gate-apps.test.tsx`
Expected: 5 files pass, 19 tests.

- [ ] **Step 9: Typecheck, and prove the devtools never reach the production bundle**

Run:
```bash
pnpm typecheck
pnpm exec vite build >/dev/null
/usr/bin/grep -rl 'ReactQueryDevtools\|TanstackQueryDevtools' dist | wc -l
```
Expected:
- The typecheck exits 0 with no errors.
- The build succeeds.
- The count is `0`.

Leave `dist/` as it was: it is not tracked, so do not stage it.

- [ ] **Step 10: Commit**

```bash
git add app/package.json app/pnpm-lock.yaml app/src/lib/query/client.ts app/src/lib/query/keys.ts app/src/lib/query/scope.tsx \
  app/src/lib/query/__tests__/client.test.ts app/src/lib/query/__tests__/keys.test.ts app/src/test-support/query.tsx \
  app/src/lib/repo/gate.tsx app/src/lib/repo/remote.ts app/src/lib/repo/__tests__/gate-query.test.tsx
git commit -m "feat(app): one in-memory query cache per signed-in page

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 2: Apps list and waiting requests on queries

**Files:**
- Create: `app/src/lib/apps/queries.ts`
- Modify: `app/src/lib/apps/useApps.tsx` (whole file)
- Test: `app/src/lib/apps/__tests__/useApps.test.tsx` (whole file)
- Modify (mount only): `app/src/routes/views/__tests__/AppsView.test.tsx`, `app/src/routes/views/__tests__/HomeView.apps.test.tsx`, `app/src/routes/views/apps/__tests__/BookingsApp.test.tsx`, `app/src/routes/views/apps/__tests__/BookingsList.test.tsx`, `app/src/components/__tests__/workspace-modes.test.tsx`

**Interfaces:**
- Consumes (Task 1): `keys`, `useBusinessId`, `renderWithQuery`, `returnToApp`, `TEST_BUSINESS_ID`, `createTestQueryClient`; `loadPendingBookings(api, now)` from `./bookings`.
- Produces:
  - `@/lib/apps/queries`:
    - `appsListQuery(api: AppsApi, businessId: string)` and `pendingBookingsQuery(api: AppsApi, businessId: string)`, both `queryOptions` objects.
    - `refreshApps(client: QueryClient, businessId: string): Promise<void>`. It reads the apps list, then the waiting requests only if the fresh list says `pending > 0`, and marks every cached window stale.
  - `AppsProvider` / `useApps()` / `useHomeApps()`: unchanged signatures. An `AppsProvider` with a non-null `api` now needs a `QueryScope` above it with a non-null business id, or it stays off (`enabled: false`).
  - Test mounts (Tasks 4 and 6 rely on these):
    - `BookingsList.test.tsx`'s `mount(api, bookingId?, { delay?, client? })` returns `{ onConnectCalendar, user, client, unmount }`.
    - `BookingsApp.test.tsx`'s `mount(api?, section?, client?)` returns `{ api, onSection, onBack, user, client, unmount }`.

Why `refreshApps` is sequential: the old provider read the list first and scanned only when it said something waits. Reading both at once would scan once more every time the last request was just decided.

- [ ] **Step 1: Write the failing tests**

Replace `app/src/lib/apps/__tests__/useApps.test.tsx` with:
```tsx
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppsProvider, useApps, useHomeApps } from '../useApps';
import { bookingFixture, fakeAppsApi } from './fixtures';
import { keys } from '@/lib/query/keys';
import { renderWithQuery, returnToApp, TEST_BUSINESS_ID } from '@/test-support/query';
import type { AppsApi, AppsList, BookingsQuery } from '../types';

function Probe() {
  const apps = useApps();
  const home = useHomeApps();
  return <output>{JSON.stringify({ enabled: apps.enabled, apps: apps.list?.apps.length ?? null, pending: apps.pending?.length ?? null, home: home?.length ?? null })}</output>;
}
const bookingsApp = (pending: number) => ({ key: 'bookings' as const, state: 'active' as const, accepting: true, publicUrl: 'https://s.test/b/x', pending });
const installed = (pending: number) => vi.fn(async (): Promise<AppsList> => ({ apps: [bookingsApp(pending)], available: ['bookings'] }));
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

afterEach(() => { vi.useRealTimers(); });

describe('AppsProvider', () => {
  it('stays off and silent without an API', () => {
    render(<AppsProvider api={null}><Probe /></AppsProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('{"enabled":false,"apps":null,"pending":null,"home":null}');
  });

  it('stays off without a signed-in business to key the cache by', async () => {
    const api = fakeAppsApi({ list: installed(1) });
    await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>, { businessId: null });
    expect(screen.getByRole('status')).toHaveTextContent('"enabled":false');
    expect(api.list).not.toHaveBeenCalled();
  });

  it('loads installed apps and pending requests, and reads them again when the owner returns after 30 s', async () => {
    const api = fakeAppsApi({
      list: installed(1),
      bookings: vi.fn(async ({ from }: BookingsQuery) => ({ bookings: from ? [bookingFixture({ startsAt: tomorrow() })] : [], nextCursor: null })),
    });
    const { client } = await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    expect(screen.getByRole('status')).toHaveTextContent('"home":1');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"pending":1'));
    expect(api.list).toHaveBeenCalledTimes(1);
    await returnToApp(client);
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('skips the waiting-request scan when the apps list already says none are waiting', async () => {
    const api = fakeAppsApi({ list: installed(0) });
    await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    expect(screen.getByRole('status')).toHaveTextContent('"pending":0');
    expect(api.bookings).not.toHaveBeenCalled();
  });

  it('refreshes once each time the unread alerts count rises, and not while it is unknown or falls', async () => {
    const api = fakeAppsApi();
    const view = (unread: number | null) => <AppsProvider api={api} unread={unread}><Probe /></AppsProvider>;
    const { rerender } = await renderWithQuery(view(null));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    // The first known count is what the mount-time load already covered.
    await act(async () => { rerender(view(2)); });
    await act(async () => { rerender(view(2)); });
    expect(api.list).toHaveBeenCalledTimes(1);
    await act(async () => { rerender(view(3)); });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    // A poll in flight reads as unknown; the same count after it is no rise.
    await act(async () => { rerender(view(null)); });
    await act(async () => { rerender(view(3)); });
    await act(async () => { rerender(view(1)); });
    expect(api.list).toHaveBeenCalledTimes(2);
    await act(async () => { rerender(view(2)); });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3));
  });

  it('keeps today\'s Home when nothing is installed', async () => {
    const api = fakeAppsApi();
    await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":0'));
    expect(screen.getByRole('status')).toHaveTextContent('"home":null');
    expect(api.bookings).not.toHaveBeenCalled();
  });

  it('shows the apps again on a revisit inside 30 s without asking the server', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
    const api = fakeAppsApi({ list: installed(0) });
    const first = await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    first.unmount();
    vi.setSystemTime(new Date('2026-10-05T00:00:29Z'));
    await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>, { client: first.client });
    expect(screen.getByRole('status')).toHaveTextContent('"apps":1');
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('shows cached apps at once after 30 s, while one background request refreshes them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
    let answer!: (list: AppsList) => void;
    const list = vi.fn<AppsApi['list']>()
      .mockResolvedValueOnce({ apps: [bookingsApp(0)], available: ['bookings'] })
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const api = fakeAppsApi({ list });
    const first = await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    first.unmount();
    vi.setSystemTime(new Date('2026-10-05T00:00:31Z'));
    await renderWithQuery(<AppsProvider api={api}><Probe /></AppsProvider>, { client: first.client });
    // The cached list is on screen while the refresh is still in flight.
    expect(screen.getByRole('status')).toHaveTextContent('"apps":1');
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => { answer({ apps: [], available: ['bookings'] }); });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":0'));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('never draws one business\'s apps under another', async () => {
    const a = fakeAppsApi({ list: installed(2) });
    const first = await renderWithQuery(<AppsProvider api={a}><Probe /></AppsProvider>, { businessId: 'biz-a' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    first.unmount();
    let answer!: (list: AppsList) => void;
    const b = fakeAppsApi({ list: vi.fn<AppsApi['list']>(() => new Promise((resolve) => { answer = resolve; })) });
    await renderWithQuery(<AppsProvider api={b}><Probe /></AppsProvider>, { client: first.client, businessId: 'biz-b' });
    // Business B has nothing yet, not business A's list.
    expect(screen.getByRole('status')).toHaveTextContent('"apps":null');
    await act(async () => { answer({ apps: [], available: ['bookings'] }); });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":0'));
  });

  it('stops counting requests once the list says none wait, whatever an earlier scan left cached', async () => {
    let waiting = 1;
    const api = fakeAppsApi({
      list: vi.fn(async (): Promise<AppsList> => ({ apps: [bookingsApp(waiting)], available: ['bookings'] })),
      bookings: vi.fn(async () => ({ bookings: [bookingFixture({ startsAt: tomorrow() })], nextCursor: null })),
    });
    const view = (unread: number) => <AppsProvider api={api} unread={unread}><Probe /></AppsProvider>;
    const { client, rerender } = await renderWithQuery(view(0));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"pending":1'));
    // Decided elsewhere; a new alert makes the provider read the list again.
    waiting = 0;
    await act(async () => { rerender(view(1)); });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"pending":0'));
    expect(client.getQueryData(keys.pendingBookings(TEST_BUSINESS_ID))).toHaveLength(1);
    expect(api.bookings).toHaveBeenCalledTimes(1);
  });

  it('marks every cached Bookings window stale on a refresh, so a decision made on Home shows there', async () => {
    const api = fakeAppsApi({ list: installed(0) });
    const view = (unread: number) => <AppsProvider api={api} unread={unread}><Probe /></AppsProvider>;
    const { client, rerender } = await renderWithQuery(view(0));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    client.setQueryData(keys.bookingWindow(TEST_BUSINESS_ID, '2026-10-05', 1), [bookingFixture()]);
    await act(async () => { rerender(view(1)); });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(client.getQueryState(keys.bookingWindow(TEST_BUSINESS_ID, '2026-10-05', 1))?.isInvalidated).toBe(true);
  });
});
```

Changed assertion, fetching only: the foreground test now returns through `returnToApp(client)`, "after 30 s", instead of a non-bubbling `visibilitychange` on `document`. A return inside 30 s now makes no request, which is the spec's instant revisit.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/lib/apps/__tests__/useApps.test.tsx`
Expected: 5 FAIL and 6 pass. The five that fail:
- `stays off without a signed-in business to key the cache by`
- `shows the apps again on a revisit inside 30 s…`
- `shows cached apps at once after 30 s…`
- `stops counting requests once the list says none wait…`
- `marks every cached Bookings window stale on a refresh…`

The other six guard behaviour that must not change.

- [ ] **Step 3: Create the query options**

Create `app/src/lib/apps/queries.ts`:
```ts
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { keys } from '@/lib/query/keys';
import { loadPendingBookings } from './bookings';
import type { AppsApi, AppsList } from './types';

/* The Apps API as cached queries. Every screen that reads the same data
   reads it through the same options here, so the page's cache shares one
   answer between Home, the brief, Needs you and the Bookings tab. */

export function appsListQuery(api: AppsApi, businessId: string) {
  return queryOptions({ queryKey: keys.appsList(businessId), queryFn: () => api.list() });
}

/** Every request still waiting on the owner, soonest first: one request for
    the whole 91-day horizon. */
export function pendingBookingsQuery(api: AppsApi, businessId: string) {
  return queryOptions({ queryKey: keys.pendingBookings(businessId), queryFn: () => loadPendingBookings(api, new Date()) });
}

/** Reads the apps list again, then the waiting requests only if the fresh
    list says any wait (at 0 the scan is a wasted round trip), and marks
    every cached Bookings window stale: the one on screen reads again now,
    the rest when next shown. After any change, and when a new alert may
    mean a new request. */
export async function refreshApps(client: QueryClient, businessId: string): Promise<void> {
  const windows = client.invalidateQueries({ queryKey: keys.bookingWindows(businessId) });
  await client.invalidateQueries({ queryKey: keys.appsList(businessId) });
  const fresh = client.getQueryData<AppsList>(keys.appsList(businessId));
  const waiting = fresh?.apps.find((app) => app.key === 'bookings')?.pending ?? 0;
  await Promise.all([
    windows,
    client.invalidateQueries({ queryKey: keys.pendingBookings(businessId), refetchType: waiting > 0 ? 'active' : 'none' }),
  ]);
}
```

- [ ] **Step 4: Put `AppsProvider` on queries**

Replace `app/src/lib/apps/useApps.tsx` with:
```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessId } from '@/lib/query/scope';
import { appsListQuery, pendingBookingsQuery, refreshApps } from './queries';
import type { AppsApi, AppsList, Booking, InstalledApp } from './types';

/* One source for the business's apps, so Home, the bell, the daily brief and
   the Bookings screen agree. The list and the waiting requests are queries
   in the page's cache (lib/query): a revisit inside 30 s shows them with no
   request, and a return to the app after that reads them again quietly.
   They are also read again when the unread alerts count rises (a new
   booking request arrives as an alert, and the bell polls while the app
   stays on screen), and after any change (refresh). */

export interface AppsState {
  /** Apps are on for this owner and the repository can reach them. */
  enabled: boolean;
  api: AppsApi | null;
  list: AppsList | null;
  /** Pending requests the owner can still decide, soonest first; null until known or when Bookings is not installed. */
  pending: Booking[] | null;
  loading: boolean;
  error: boolean;
  refresh(): Promise<void>;
}

const OFF: AppsState = {
  enabled: false, api: null, list: null, pending: null, loading: false, error: false, refresh: async () => {},
};
/** One empty list, so "nothing waits" keeps its identity between renders. */
const NONE: Booking[] = [];
const AppsContext = createContext<AppsState>(OFF);

export function AppsProvider({ api, unread = null, children }: {
  api: AppsApi | null;
  /** The bell's unread count, or null while it is unknown (loading). */
  unread?: number | null;
  children: ReactNode;
}) {
  const businessId = useBusinessId();
  /* Off without an API (the demo, or apps not on for this owner) or without
     a signed-in business to key the cache by. Neither changes while a page
     is open, so this never swaps a mounted tree for another. */
  if (!api || !businessId) return <AppsContext.Provider value={OFF}>{children}</AppsContext.Provider>;
  return <LiveAppsProvider api={api} businessId={businessId} unread={unread}>{children}</LiveAppsProvider>;
}

function LiveAppsProvider({ api, businessId, unread, children }: {
  api: AppsApi;
  businessId: string;
  unread: number | null;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const list = useQuery(appsListQuery(api, businessId));
  const bookings = list.data?.apps.find((app) => app.key === 'bookings');
  /* The list's count is every pending request not yet started, which is
     everything the scan could find. At 0 there is nothing to ask for, and
     whatever an earlier scan left in the cache no longer waits. */
  const scanning = (bookings?.pending ?? 0) > 0;
  const scan = useQuery({ ...pendingBookingsQuery(api, businessId), enabled: scanning });
  const pending = !bookings ? null : !scanning ? NONE : scan.data ?? null;

  const refresh = useCallback(() => refreshApps(client, businessId), [client, businessId]);

  /* The first known count is what the mount-time load already covered; after
     that, each rise is something new. A count that falls (read) or goes
     unknown (a poll in flight) is not. */
  const lastUnread = useRef<number | null>(null);
  useEffect(() => {
    if (unread === null) return;
    const before = lastUnread.current;
    lastUnread.current = unread;
    if (before !== null && unread > before) void refresh();
  }, [unread, refresh]);

  const listData = list.data ?? null;
  const loading = list.isFetching || (scanning && scan.isFetching);
  const error = list.isError || (scanning && scan.isError);
  const value = useMemo<AppsState>(
    () => ({ enabled: true, api, list: listData, pending, loading, error, refresh }),
    [api, listData, pending, loading, error, refresh],
  );
  return <AppsContext.Provider value={value}>{children}</AppsContext.Provider>;
}

export function useApps(): AppsState {
  return useContext(AppsContext);
}

/** Home's option B (spec D2): the installed apps, or null to keep today's Home. */
export function useHomeApps(): InstalledApp[] | null {
  const apps = useApps();
  return apps.enabled && apps.list && apps.list.apps.length > 0 ? apps.list.apps : null;
}
```

- [ ] **Step 5: Run the provider tests**

Run: `pnpm exec vitest run src/lib/apps/__tests__/useApps.test.tsx`
Expected: PASS, 11 tests.

- [ ] **Step 6: Mount every other `AppsProvider` test inside a query scope**

These tests render `AppsProvider` with a real `api`, so it needs a client. Only the mounts change; no assertion changes.

`app/src/routes/views/__tests__/AppsView.test.tsx`, replace the whole file with:
```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AppsView from '../AppsView';
import { LocalRepository } from '@/lib/repo/local';
import { AppsProvider } from '@/lib/apps/useApps';
import { fakeAppsApi } from '@/lib/apps/__tests__/fixtures';
import { renderWithQuery } from '@/test-support/query';

async function mount(api = fakeAppsApi()) {
  const onOpen = vi.fn();
  await renderWithQuery(<AppsProvider api={api}>
    <AppsView app={null} bookingId={null} section={null} onOpen={onOpen} onConnectCalendar={vi.fn()} />
  </AppsProvider>, { repository: new LocalRepository() });
  return { api, onOpen, user: userEvent.setup() };
}

describe('AppsView', () => {
  it('offers Bookings to set up when nothing is installed', async () => {
    const { onOpen, user } = await mount();
    await user.click(await screen.findByRole('button', { name: /Set up/ }));
    expect(onOpen).toHaveBeenCalledWith({ app: 'bookings' });
    expect(screen.queryByRole('heading', { name: 'Your apps' })).toBeNull();
  });

  it('lists an installed app with its waiting requests, and does not offer it again', async () => {
    const api = fakeAppsApi({
      list: vi.fn(async () => ({ apps: [{ key: 'bookings' as const, state: 'active' as const, accepting: true, publicUrl: 'https://s.test/b/x', pending: 2 }], available: ['bookings' as const] })),
    });
    const { onOpen, user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: /Bookings.*2 waiting/ }));
    expect(onOpen).toHaveBeenCalledWith({ app: 'bookings' });
    expect(screen.queryByRole('button', { name: /Set up/ })).toBeNull();
    expect(screen.getByText('Every available app is set up.')).toBeInTheDocument();
  });

  it('says Paused, not live, once the owner has stopped taking bookings', async () => {
    await mount(fakeAppsApi({
      list: vi.fn(async () => ({ apps: [{ key: 'bookings' as const, state: 'active' as const, accepting: false, publicUrl: 'https://s.test/b/x', pending: 0 }], available: ['bookings' as const] })),
    }));
    expect(await screen.findByRole('button', { name: /Bookings.*Paused/ })).toBeInTheDocument();
    expect(screen.queryByText('Your booking page is live')).toBeNull();
  });

  it('says so when the apps cannot be loaded, and retries', async () => {
    const api = fakeAppsApi({ list: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ apps: [], available: ['bookings'] }) });
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });
});
```

`app/src/routes/views/__tests__/HomeView.apps.test.tsx`:
1. Change the first import to `import { screen, waitFor } from '@testing-library/react';`.
2. Add `import { renderWithQuery } from '@/test-support/query';` after the `AppsApi, BookingsQuery` type import.
3. Replace the body of `mount` from `const onNavigate = vi.fn();` to its `return` with:
```tsx
  const onNavigate = vi.fn();
  const onOpenApp = vi.fn();
  // The repository and the apps list load on microtasks; renderWithQuery flushes them inside act.
  await renderWithQuery(<MemoryRouter><SignedInProvider value account="home-apps-test"><RepositoryProvider repository={repo}>
    <I18nProvider><ToastProvider><ActivityProvider><AppsProvider api={api}>
      <Harness onNavigate={onNavigate} onOpenApp={onOpenApp} />
    </AppsProvider></ActivityProvider></ToastProvider></I18nProvider>
  </RepositoryProvider></SignedInProvider></MemoryRouter>);
  return { onNavigate, onOpenApp, user: userEvent.setup() };
```

`app/src/routes/views/apps/__tests__/BookingsApp.test.tsx`:
1. Change the first import to `import { screen, waitFor } from '@testing-library/react';`.
2. After the `vitest` import add `import type { QueryClient } from '@tanstack/react-query';`.
3. Delete the `I18nProvider` and `RepositoryProvider` imports.
4. After the fixtures import add `import { renderWithQuery } from '@/test-support/query';`.
5. Replace `mount` with:
```tsx
async function mount(api = fakeAppsApi(), section: string | null = null, client?: QueryClient) {
  const repo = new LocalRepository();
  await repo.setBizType('restaurant');
  await repo.setBizProfile({ name: 'Kedai Kita', loc: 'Shah Alam' });
  const onSection = vi.fn();
  const onBack = vi.fn();
  const view = await renderWithQuery(<AppsProvider api={api}>
    <BookingsApp bookingId={null} section={section} onSection={onSection} onBack={onBack} onConnectCalendar={vi.fn()} />
  </AppsProvider>, { repository: repo, client });
  return { api, onSection, onBack, user: userEvent.setup(), client: view.client, unmount: view.unmount };
}
```

`app/src/routes/views/apps/__tests__/BookingsList.test.tsx`:
1. Change the first import to `import { act, screen, waitFor, within } from '@testing-library/react';`.
2. Replace the `I18nProvider` and `RepositoryProvider` imports with `import type { QueryClient } from '@tanstack/react-query';`, keeping the `LocalRepository` import.
3. After the `Booking, BookingsQuery` type import add `import { renderWithQuery } from '@/test-support/query';`.
4. Replace the comment above `mount` and `mount` itself with:
```tsx
/* The real I18nProvider calls useSnapshot(), which throws without a
   RepositoryProvider above it — so every mount passes a repository, and
   renderWithQuery flushes LocalRepository.load()'s microtask before the
   first assertion. Pass `client` to mount again over the same cache. */
async function mount(api: ReturnType<typeof fakeAppsApi>, bookingId: string | null = null, options: { delay?: number | null; client?: QueryClient } = {}) {
  const onConnectCalendar = vi.fn();
  /* `delay: null` when a test needs to click under fake timers — userEvent's
     default pacing waits on real setTimeout, which fake timers never fire
     unless explicitly advanced, and this file only fakes time to drive this
     component's own poll. */
  const user = userEvent.setup(options.delay !== undefined ? { delay: options.delay } : undefined);
  const view = await renderWithQuery(<AppsProvider api={api}>
    <BookingsList api={api} bookingId={bookingId} onConnectCalendar={onConnectCalendar} now={() => NOW} />
  </AppsProvider>, { repository: new LocalRepository(), client: options.client });
  return { onConnectCalendar, user, client: view.client, unmount: view.unmount };
}
```
5. In `does not fetch Today before the default filter is decided`, replace the four lines from `const onConnectCalendar = vi.fn();` through `await act(async () => {});` with `await mount(api);`. Keep every assertion.

`app/src/components/__tests__/workspace-modes.test.tsx`:
1. After the fixtures import add `import { renderWithQuery } from '@/test-support/query';`.
2. In `mount`, change `return render(` to `const tree = (`.
3. On the line that closes the tree, change `</MemoryRouter>,` to `</MemoryRouter>` (drop the comma; the `);` on the next line stays).
4. Before the closing `}` of `mount`, add:
```tsx
  /* A signed-in page has a query cache (RepositoryGate); the anonymous demo has none. */
  return options.signedIn === false ? render(tree) : renderWithQuery(tree);
```

- [ ] **Step 7: Run the regression net for this task**

Run: `pnpm exec vitest run src/routes/views/apps src/lib/apps src/routes/views/__tests__/HomeView.apps.test.tsx src/routes/views/__tests__/AppsView.test.tsx src/components/__tests__/workspace-modes.test.tsx`
Expected: 10 files pass (122 tests). `BookingsList` and `BookingsApp` still run their old fetch code here and pass unchanged. If `workspace-modes` alone fails, re-run that file by itself first.

- [ ] **Step 8: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/apps/queries.ts app/src/lib/apps/useApps.tsx app/src/lib/apps/__tests__/useApps.test.tsx \
  app/src/routes/views/__tests__/AppsView.test.tsx app/src/routes/views/__tests__/HomeView.apps.test.tsx \
  app/src/routes/views/apps/__tests__/BookingsApp.test.tsx app/src/routes/views/apps/__tests__/BookingsList.test.tsx \
  app/src/components/__tests__/workspace-modes.test.tsx
git commit -m "feat(apps): read the apps list and waiting requests through the query cache

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 3: Notifications on one shared infinite query

**Files:**
- Modify: `app/src/hooks/useNotifications.ts` (whole file)
- Test: `app/src/hooks/__tests__/useNotifications.test.tsx` (new)
- Unchanged, but must pass: `app/src/routes/views/__tests__/NotificationsView.test.tsx`, `app/src/components/__tests__/workspace-modes.test.tsx`, `app/src/lib/__tests__/notifications.test.ts`

**Interfaces:**
- Consumes (Task 1): `keys.notifications`, `useBusinessId`, `renderWithQuery`. From `@/lib/notifications`, unchanged: `fetchNotifications(cursor?: string): Promise<NotificationPage>`, `readNotification(id)`, `readAllNotifications()`, and the types `AppNotification` and `NotificationPage`.
- Produces:
  - `useNotifications(): NotificationsState` with the same fields as today.
  - `export interface NotificationsState`, `export type NotificationPages`, and `NOTIFICATIONS_POLL_MS = 60_000`.
  - Pure `markOneRead(data, id, at)` and `markEveryRead(data, at)`.
  - `Dashboard.tsx` and `NotificationsView.tsx` need no change: `NotificationsView` types its prop as `ReturnType<typeof useNotifications>`, which is still this shape.

Behaviour this keeps, and the changes:
- `loading` is true while a read that is not "load more" is in flight. `Dashboard` passes `unread={loading ? null : unread}` to `AppsProvider`, so a rise is still detected after each poll.
- `unread` and `nextCursor` come from the last page, which is the newest read.
- Rows are deduplicated by id, as `loadMore` did.
- `markRead` still returns early for an unknown or already-read row.
- The 60 s poll now refetches every loaded page instead of dropping all but the first.
- Reads are optimistic: the cache changes first, is restored on error, and the list is read again after either outcome to confirm.
- Without a signed-in cache (the dev preview, and tests with no scope) the hook is inert: no request, `loading: false`, empty inbox.

- [ ] **Step 1: Write the failing tests**

Create `app/src/hooks/__tests__/useNotifications.test.tsx`:
```tsx
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNotifications } from '../useNotifications';
import { renderWithQuery } from '@/test-support/query';

const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const row = (id: string, title: string, readAt: string | null) => ({
  id, kind: 'booking_requested', title, body: 'Aisyah · Tue 6 Oct', runId: null, routineId: null, occurrenceId: null,
  url: null, readAt, createdAt: '2026-10-05T00:00:00.000Z',
});
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A server with one page of one notification that remembers reads; `read`
    replaces the answer to a read (one or all), `pages` the list. */
function serve(options: { read?: () => Promise<Response>; pages?: (cursor: string | null) => Response } = {}) {
  let read = false;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://api.test');
    if (url.pathname.endsWith('/read') || url.pathname.endsWith('/read-all')) {
      if (options.read) return options.read();
      read = true;
      return json({ ok: true });
    }
    if (options.pages) return options.pages(url.searchParams.get('cursor'));
    return json({ ok: true, notifications: [row(FIRST, 'New booking request', read ? '2026-10-05T01:00:00.000Z' : null)], unread: read ? 0 : 1, nextCursor: null });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function Bell() {
  const state = useNotifications();
  return <p>bell {state.loading ? 'loading' : state.unread}</p>;
}
function Inbox() {
  const state = useNotifications();
  return <div>
    <p>inbox {state.items.map((item) => `${item.title}:${item.readAt ? 'read' : 'unread'}`).join(', ')}</p>
    <button type="button" onClick={() => void state.markRead(FIRST).catch(() => undefined)}>open</button>
    <button type="button" onClick={() => void state.markAll().catch(() => undefined)}>read all</button>
    <button type="button" onClick={() => void state.loadMore()}>more</button>
  </div>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('useNotifications', () => {
  it('makes one request for the bell and the Alerts view together', async () => {
    const fetch = serve();
    await renderWithQuery(<><Bell /><Inbox /></>);
    expect(await screen.findByText('bell 1')).toBeInTheDocument();
    expect(screen.getByText('inbox New booking request:unread')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reads the list again every 60 s while the app is on screen, and not while it is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = serve();
    await renderWithQuery(<Bell />);
    await screen.findByText('bell 1');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('marks one read at once, and puts it back when the server refuses', async () => {
    let refuse!: () => void;
    serve({ read: () => new Promise<Response>((resolve) => { refuse = () => resolve(json({ ok: false, err: 'down' }, 500)); }) });
    await renderWithQuery(<><Bell /><Inbox /></>);
    await screen.findByText('bell 1');
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    // Read before the server has answered.
    expect(await screen.findByText('bell 0')).toBeInTheDocument();
    expect(screen.getByText('inbox New booking request:read')).toBeInTheDocument();
    await act(async () => { refuse(); });
    expect(await screen.findByText('bell 1')).toBeInTheDocument();
    expect(screen.getByText('inbox New booking request:unread')).toBeInTheDocument();
  });

  it('marks everything read at once, and the server confirms it', async () => {
    const fetch = serve();
    await renderWithQuery(<><Bell /><Inbox /></>);
    await screen.findByText('bell 1');
    await userEvent.click(screen.getByRole('button', { name: 'read all' }));
    expect(await screen.findByText('inbox New booking request:read')).toBeInTheDocument();
    // The read, then one list read to confirm it.
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(screen.getByText('bell 0')).toBeInTheDocument();
  });

  it('loads the next page after the first, keeping every row once and the newest count', async () => {
    serve({
      pages: (cursor) => (cursor === null
        ? json({ ok: true, notifications: [row(FIRST, 'First', null)], unread: 2, nextCursor: 'c1' })
        : json({ ok: true, notifications: [row(FIRST, 'First', null), row(SECOND, 'Second', null)], unread: 3, nextCursor: null })),
    });
    await renderWithQuery(<><Bell /><Inbox /></>);
    await screen.findByText('bell 2');
    await userEvent.click(screen.getByRole('button', { name: 'more' }));
    expect(await screen.findByText('inbox First:unread, Second:unread')).toBeInTheDocument();
    expect(screen.getByText('bell 3')).toBeInTheDocument();
  });

  it('asks nothing outside a signed-in business', async () => {
    const fetch = serve();
    render(<Bell />);
    await renderWithQuery(<Inbox />, { businessId: null });
    expect(screen.getByText('bell 0')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/hooks/__tests__/useNotifications.test.tsx`
Expected: FAIL.
- The old hook makes one request per consumer (2, not 1).
- It marks read only after the server answers, so `bell 0` never appears before `refuse()`.
- It fetches with no scope.

- [ ] **Step 3: Replace the hook**

Replace `app/src/hooks/useNotifications.ts` with:
```ts
import { useCallback, useContext, useMemo } from 'react';
import {
  QueryClient, QueryClientContext, useInfiniteQuery, useMutation, type InfiniteData,
} from '@tanstack/react-query';
import { keys } from '@/lib/query/keys';
import { useBusinessId } from '@/lib/query/scope';
import {
  fetchNotifications,
  readAllNotifications,
  readNotification,
  type AppNotification,
  type NotificationPage,
} from '@/lib/notifications';

/** How often the list is read again while the app is on screen. */
export const NOTIFICATIONS_POLL_MS = 60_000;

export interface NotificationsState {
  items: AppNotification[];
  unread: number;
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: Error | null;
  refresh(): Promise<void>;
  markRead(id: string): Promise<void>;
  markAll(): Promise<void>;
  loadMore(): Promise<void>;
}

export type NotificationPages = InfiniteData<NotificationPage, string | null>;

/* Only the dev preview and tests render Dashboard without a signed-in cache
   (production's /app is behind RequireAuth). They get this client so the
   hooks below can be called, with the query disabled and nothing sent. */
const INERT = new QueryClient();

/** One notification read: its row, and every page's unread count, once. */
export function markOneRead(data: NotificationPages, id: string, at: string): NotificationPages {
  let found = false;
  const pages = data.pages.map((page) => ({
    ...page,
    notifications: page.notifications.map((item) => {
      if (item.id !== id || item.readAt) return item;
      found = true;
      return { ...item, readAt: at };
    }),
  }));
  if (!found) return data;
  return { ...data, pages: pages.map((page) => ({ ...page, unread: Math.max(0, page.unread - 1) })) };
}

/** Everything read. */
export function markEveryRead(data: NotificationPages, at: string): NotificationPages {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      unread: 0,
      notifications: page.notifications.map((item) => (item.readAt ? item : { ...item, readAt: at })),
    })),
  };
}

/** The page's one notifications query: the bell and the Alerts view read the
    same cache entry, so together they make one request. It is read again
    every 60 s while the app is on screen, never in the background. Marking
    read changes the cache first, puts it back if the server refuses, and
    then reads the list again to confirm. */
export function useNotifications(): NotificationsState {
  const scoped = useContext(QueryClientContext);
  const businessId = useBusinessId();
  const live = scoped !== undefined && businessId !== null;
  const client = scoped ?? INERT;
  const key = keys.notifications(businessId ?? 'none');

  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchNotifications(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: NOTIFICATIONS_POLL_MS,
    refetchIntervalInBackground: false,
    enabled: live,
  }, client);

  const optimistic = (change: (data: NotificationPages) => NotificationPages) => async () => {
    await client.cancelQueries({ queryKey: key });
    const before = client.getQueryData<NotificationPages>(key);
    if (before) client.setQueryData<NotificationPages>(key, change(before));
    return { before };
  };
  const restore = (_error: Error, _variables: unknown, context: { before?: NotificationPages } | undefined) => {
    if (context?.before) client.setQueryData<NotificationPages>(key, context.before);
  };
  const confirm = () => { void client.invalidateQueries({ queryKey: key }); };

  const readOne = useMutation({
    mutationFn: (id: string) => readNotification(id),
    onMutate: (id: string) => optimistic((data) => markOneRead(data, id, new Date().toISOString()))(),
    onError: restore,
    onSettled: confirm,
  }, client);
  const readAll = useMutation({
    mutationFn: () => readAllNotifications(),
    onMutate: optimistic((data) => markEveryRead(data, new Date().toISOString())),
    onError: restore,
    onSettled: confirm,
  }, client);

  const pages = query.data?.pages;
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (pages ?? []).flatMap((page) => page.notifications).filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [pages]);
  /* Pages are read in order, so the last one holds the newest count. */
  const last = pages?.[pages.length - 1];

  const { refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const refresh = useCallback(async () => {
    if (live) await refetch();
  }, [live, refetch]);
  const readOneAsync = readOne.mutateAsync;
  const markRead = useCallback(async (id: string) => {
    const target = items.find((item) => item.id === id);
    if (!live || !target || target.readAt) return;
    await readOneAsync(id);
  }, [live, items, readOneAsync]);
  const readAllAsync = readAll.mutateAsync;
  const markAll = useCallback(async () => {
    if (live) await readAllAsync();
  }, [live, readAllAsync]);
  const loadMore = useCallback(async () => {
    if (!live || !hasNextPage || isFetchingNextPage) return;
    await fetchNextPage();
  }, [live, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    items,
    unread: last?.unread ?? 0,
    nextCursor: last?.nextCursor ?? null,
    loading: live && query.isFetching && !isFetchingNextPage,
    loadingMore: isFetchingNextPage,
    error: query.error,
    refresh,
    markRead,
    markAll,
    loadMore,
  };
}
```

- [ ] **Step 4: Run the notifications tests and the Dashboard test that depends on the unread count**

Run: `pnpm exec vitest run src/hooks/__tests__/useNotifications.test.tsx src/routes/views/__tests__/NotificationsView.test.tsx src/lib/__tests__/notifications.test.ts src/components/__tests__/workspace-modes.test.tsx`
Expected: all pass (6 new tests). `re-reads apps when a new alert arrives while the app stays open` in `workspace-modes` is the end-to-end check that a rising unread count still refreshes apps.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add app/src/hooks/useNotifications.ts app/src/hooks/__tests__/useNotifications.test.tsx
git commit -m "feat(notifications): one shared query for the bell and Alerts, marked read at once

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: Bookings config as a query, saved through a mutation

**Files:**
- Modify: `app/src/lib/apps/queries.ts` (imports, plus two exports appended)
- Modify: `app/src/routes/views/apps/BookingsApp.tsx`
- Modify: `app/src/routes/views/apps/BookingsSettings.tsx`
- Modify: `app/src/routes/views/apps/BookingPage.tsx`
- Test: `app/src/routes/views/apps/__tests__/BookingsApp.test.tsx`, `BookingsSettings.test.tsx` and `BookingPage.test.tsx`

**Interfaces:**
- Consumes: `refreshApps` (Task 2), `keys.bookingsConfig` and `useRequiredBusinessId` (Task 1), and `mount(api?, section?, client?)` in `BookingsApp.test.tsx` (Task 2).
- Produces:
  - `bookingsConfigQuery(api: AppsApi, businessId: string)`, a `queryOptions` object.
  - `useSaveBookingsConfig(api: AppsApi)`, a `useMutation` whose `mutateAsync(input: BookingsConfigInput): Promise<BookingsConfig>` writes the answer into `keys.bookingsConfig` and calls `refreshApps`.
  - The `BookingsSettings` and `BookingPage` props are unchanged (`api`, `config`, `onSaved`/`onChange`, `onReload`).

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('BookingsApp', …)` block of `app/src/routes/views/apps/__tests__/BookingsApp.test.tsx`:
```tsx
  it('shows the settings again on a revisit inside 30 s without asking the server', async () => {
    const first = await mount(fakeAppsApi(), 'page');
    expect(await screen.findByRole('heading', { name: 'Your booking page' })).toBeInTheDocument();
    first.unmount();
    await mount(first.api, 'page', first.client);
    expect(screen.getByRole('heading', { name: 'Your booking page' })).toBeInTheDocument();
    expect(first.api.bookingsConfig).toHaveBeenCalledTimes(1);
  });

  it('shows a saved switch at once from the server\'s answer, without reading the settings again', async () => {
    const api = fakeAppsApi({
      saveBookingsConfig: vi.fn(async () => configFixture({ settings: { ...configFixture().settings!, accepting: false } })),
    });
    const { user } = await mount(api, 'page');
    await user.click(await screen.findByRole('checkbox', { name: 'Taking bookings' }));
    expect(await screen.findByText(/^Paused\./)).toBeInTheDocument();
    expect(api.bookingsConfig).toHaveBeenCalledTimes(1);
  });
```

In `app/src/routes/views/apps/__tests__/BookingPage.test.tsx`:
1. Change the first import to `import { screen } from '@testing-library/react';`.
2. Delete the `I18nProvider` and `RepositoryProvider` imports.
3. After the fixtures import add:
```tsx
import { keys } from '@/lib/query/keys';
import { renderWithQuery, TEST_BUSINESS_ID } from '@/test-support/query';
```
4. Replace `mount` with:
```tsx
async function mount(api = fakeAppsApi(), config = configFixture()) {
  const onChange = vi.fn();
  const onReload = vi.fn();
  const user = userEvent.setup();
  const { client } = await renderWithQuery(<BookingPage api={api} config={config} onChange={onChange} onReload={onReload} />,
    { repository: new LocalRepository() });
  return { api, onChange, onReload, user, client };
}
```
5. Replace the test `pauses with the saved version, and hands back the saved config` with:
```tsx
  it('pauses with the saved version, and hands back the saved config', async () => {
    const paused = configFixture({ settings: { ...configFixture().settings!, accepting: false } });
    const api = fakeAppsApi({ saveBookingsConfig: vi.fn(async () => paused) });
    const { client, onChange, user } = await mount(api);
    await user.click(screen.getByRole('checkbox', { name: 'Taking bookings' }));
    expect(api.saveBookingsConfig).toHaveBeenCalledWith(expect.objectContaining({ version: 3, accepting: false, slug: 'seido' }));
    expect(onChange).toHaveBeenCalledWith(paused);
    // The answer is the cached config now, with no second read.
    expect(client.getQueryData(keys.bookingsConfig(TEST_BUSINESS_ID))).toEqual(paused);
    expect(api.bookingsConfig).not.toHaveBeenCalled();
  });
```

In `app/src/routes/views/apps/__tests__/BookingsSettings.test.tsx`:
1. Change the first import to `import { cleanup, fireEvent, screen } from '@testing-library/react';`.
2. After the `vitest` import add `import type { QueryClient } from '@tanstack/react-query';`.
3. Delete the `I18nProvider` and `RepositoryProvider` imports.
4. After the `BookingsConfig` type import add:
```tsx
import { createQueryClient } from '@/lib/query/client';
import { renderWithQuery } from '@/test-support/query';
```
5. Replace `mount` with:
```tsx
async function mount(config: BookingsConfig, api = fakeAppsApi(), client?: QueryClient) {
  const repo = new LocalRepository();
  await repo.setBizType('restaurant');
  await repo.setBizProfile({ name: 'Kedai Kita', loc: 'Shah Alam' });
  const onSaved = vi.fn();
  const onReload = vi.fn();
  // The repository loads asynchronously (LocalRepository.load() resolves on
  // a microtask); renderWithQuery flushes it, so every test's first
  // assertion, not only one that happens to use findBy*, sees the form.
  await renderWithQuery(<BookingsSettings api={api} config={config} onSaved={onSaved} onReload={onReload} />, { repository: repo, client });
  return { api, onSaved, onReload, user: userEvent.setup() };
}
```
6. Append inside `describe('BookingsSettings', …)`:
```tsx
  it('never sends a save twice, even when its answer was lost', async () => {
    const api = fakeAppsApi({ saveBookingsConfig: vi.fn().mockRejectedValue(new AppsError('NETWORK', 0, true)) });
    // The production client: only its no-retry rule for writes is under test.
    const { user } = await mount(configFixture(), api, createQueryClient());
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('We could not confirm the save. Reload to check what was saved.')).toBeInTheDocument();
    expect(api.saveBookingsConfig).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/routes/views/apps/__tests__/BookingsApp.test.tsx src/routes/views/apps/__tests__/BookingPage.test.tsx src/routes/views/apps/__tests__/BookingsSettings.test.tsx`
Expected:
- The revisit test FAILS: `bookingsConfig` is called twice.
- `pauses with the saved version…` FAILS: nothing is cached.
- The switch and no-resend tests already pass. They guard behaviour this change must keep.

- [ ] **Step 3: Add the config query and the save mutation**

In `app/src/lib/apps/queries.ts`, replace the import block with:
```ts
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { keys } from '@/lib/query/keys';
import { useRequiredBusinessId } from '@/lib/query/scope';
import { loadPendingBookings } from './bookings';
import type { AppsApi, AppsList, BookingsConfigInput } from './types';
```
and append:
```ts
export function bookingsConfigQuery(api: AppsApi, businessId: string) {
  return queryOptions({ queryKey: keys.bookingsConfig(businessId), queryFn: () => api.bookingsConfig() });
}

/** Saves the Bookings settings. The server's answer becomes the cached
    config at once (no second read), and the apps list and waiting requests
    are read again, so the Paused label and the counts agree everywhere.
    Never retried: a lost answer is for the owner to reload, not resend. */
export function useSaveBookingsConfig(api: AppsApi) {
  const client = useQueryClient();
  const businessId = useRequiredBusinessId();
  return useMutation({
    mutationFn: (input: BookingsConfigInput) => api.saveBookingsConfig(input),
    onSuccess: (config) => {
      client.setQueryData(keys.bookingsConfig(businessId), config);
      void refreshApps(client, businessId);
    },
  });
}
```

- [ ] **Step 4: Read the config through the query in `BookingsApp`**

In `app/src/routes/views/apps/BookingsApp.tsx`:
1. Replace `import { useCallback, useEffect, useState } from 'react';` with `import { useQuery } from '@tanstack/react-query';`.
2. Replace `import type { BookingsConfig } from '@/lib/apps/types';` with:
```ts
import { bookingsConfigQuery } from '@/lib/apps/queries';
import { useRequiredBusinessId } from '@/lib/query/scope';
```
3. Replace everything from `const [config, setConfig] = useState…` down to the closing `}` of `function saved(…)` with:
```tsx
  const businessId = useRequiredBusinessId();
  /* A revisit inside 30 s shows the cached settings with no request. */
  const read = useQuery(bookingsConfigQuery(api, businessId));
  const config = read.data ?? null;
  /* A retry in flight shows the loading state, not the failure again. */
  const failed = read.isError && !config && !read.isFetching;
  const reload = () => { void read.refetch(); };

  const installed = config?.installation != null;
  const active: BookingsSection = !installed ? 'settings' : section === 'page' || section === 'settings' ? section : 'bookings';

  /* The save itself put the answer in the cache and refreshed the apps
     list (useSaveBookingsConfig). This is called with the config from the
     render the save started in, so a first publish still moves to the page. */
  function saved() {
    if (!installed) onSection('page');
  }
```
4. Replace the three `() => void load()` handlers (the retry `Button`, `BookingPage`'s `onReload` and `BookingsSettings`'s `onReload`) with `reload`, so they read `onClick={reload}` and `onReload={reload}`.

- [ ] **Step 5: Save through the mutation**

In `app/src/routes/views/apps/BookingsSettings.tsx`:
- Add `import { useSaveBookingsConfig } from '@/lib/apps/queries';` after the `AppsError` import.
- Add `const saveConfig = useSaveBookingsConfig(api);` right after `const { business } = useBusiness();`.
- Replace `onSaved(await api.saveBookingsConfig(input));` with `onSaved(await saveConfig.mutateAsync(input));`.

In `app/src/routes/views/apps/BookingPage.tsx`:
- Add `import { useSaveBookingsConfig } from '@/lib/apps/queries';` after the `configToInput` import.
- Add `const saveConfig = useSaveBookingsConfig(api);` right after `const { t } = useI18n();`.
- Replace `onChange(await api.saveBookingsConfig({ ...configToInput(config), accepting: next }));` with `onChange(await saveConfig.mutateAsync({ ...configToInput(config), accepting: next }));`.

The error handling in both stays as it is: `mutateAsync` rejects with the same `AppsError`.

- [ ] **Step 6: Run the Bookings screens and the rest of the net**

Run: `pnpm exec vitest run src/routes/views/apps src/lib/apps src/routes/views/__tests__/HomeView.apps.test.tsx src/routes/views/__tests__/AppsView.test.tsx src/components/__tests__/workspace-modes.test.tsx`
Expected: 10 files pass (125 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/apps/queries.ts app/src/routes/views/apps/BookingsApp.tsx app/src/routes/views/apps/BookingsSettings.tsx \
  app/src/routes/views/apps/BookingPage.tsx app/src/routes/views/apps/__tests__/BookingsApp.test.tsx \
  app/src/routes/views/apps/__tests__/BookingsSettings.test.tsx app/src/routes/views/apps/__tests__/BookingPage.test.tsx
git commit -m "feat(bookings): cache the Bookings settings and save them as a mutation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 5: Booking reads and writes in the cache

This is the library layer the Bookings list will stand on: query options for a window and for one booking, the cache writes an action makes, the action mutation, and the decided-here rule as a pure function. A reviewer can accept it on its own tests before the component changes.

**Files:**
- Modify: `app/src/lib/apps/types.ts` (add `BookingAction`)
- Modify: `app/src/routes/views/apps/BookingCard.tsx` (re-export `BookingAction` from the lib)
- Modify: `app/src/lib/apps/bookings.ts` (add `OwnRead`, `mergeBookingRows`)
- Modify: `app/src/lib/apps/queries.ts` (imports; append the booking section)
- Test: `app/src/lib/apps/__tests__/bookings.test.ts` (append), `app/src/lib/apps/__tests__/queries.test.tsx` (new)

**Interfaces:**
- Consumes: `keys`, `mutationKeys` and `bookingListsFilter` (Task 1); `useRequiredBusinessId` and `QueryScope` (Task 1); `createQueryClient` (Task 1); `createTestQueryClient` and `TEST_BUSINESS_ID` (Task 1); `refreshApps` (Task 2); `loadWindow(api, { from, days })` from `./bookings`.
- Produces (Task 6 uses every one):
  - `type BookingAction = 'confirm' | 'decline' | 'cancel' | 'retry'` in `@/lib/apps/types`. `BookingCard.tsx` still exports it too.
  - In `@/lib/apps/bookings`:
    - `interface OwnRead { booking: Booking; updatedAt: number }`.
    - `mergeBookingRows(list: Booking[] | null, listUpdatedAt: number, own: ReadonlyMap<string, OwnRead>, kept: ReadonlySet<string>): Booking[] | null`.
  - In `@/lib/apps/queries`:
    - `bookingWindowQuery(api, businessId, from: string, days: number)` and `bookingQuery(api, businessId, bookingId: string)`, both `queryOptions`.
    - `cancelBookingReads(client, businessId, bookingId): Promise<void>`.
    - `writeBooking(client, businessId, booking: Booking): void`.
    - `rereadBooking(client, api, businessId, bookingId): Promise<Booking>`.
    - `interface BookingActionVars { id: string; action: BookingAction }`.
    - `runBookingAction(api, vars): Promise<BookingActionResult>`.
    - `useBookingAction(api)`, a `useMutation` keyed `mutationKeys.bookingAction(businessId)`, with `mutateAsync(vars: BookingActionVars): Promise<BookingActionResult>`.

- [ ] **Step 1: Write the failing tests**

In `app/src/lib/apps/__tests__/bookings.test.ts`:
1. Add `mergeBookingRows` and `type OwnRead` to the `../bookings` import, so it ends `loadPendingBookings, loadWindow, mergeBookingRows, statusTag, whatsappKey, type OwnRead,`.
2. Change `import type { BookingsQuery } from '../types';` to `import type { Booking, BookingsQuery } from '../types';`.
3. Append:
```ts
describe('the rows a Bookings list shows', () => {
  const soon = bookingFixture({ id: '11111111-1111-4111-8111-00000000000a', startsAt: '2026-10-06T02:00:00.000Z' });
  const later = bookingFixture({ id: '11111111-1111-4111-8111-00000000000b', customerName: 'Aina', startsAt: '2026-10-07T02:00:00.000Z' });
  const own = (entries: [Booking, number][]) => new Map<string, OwnRead>(entries.map(([booking, updatedAt]) => [booking.id, { booking, updatedAt }]));

  it('waits for the list itself', () => {
    expect(mergeBookingRows(null, 0, own([[soon, 5]]), new Set([soon.id]))).toBeNull();
  });

  it('draws any other row from whichever read it last, soonest first', () => {
    const polled = { ...soon, calendar: { ...soon.calendar, status: 'created' as const } };
    expect(mergeBookingRows([later, soon], 100, own([[polled, 200]]), new Set())).toEqual([polled, later]);
    expect(mergeBookingRows([later, soon], 300, own([[polled, 200]]), new Set())).toEqual([soon, later]);
  });

  it('draws a booking decided here from its own read, even when a list read later still says pending', () => {
    const confirmed = { ...soon, status: 'confirmed' as const };
    expect(mergeBookingRows([soon, later], 300, own([[confirmed, 200]]), new Set([soon.id]))).toEqual([confirmed, later]);
  });

  it('keeps a booking decided here when a later list leaves it out, and no other', () => {
    const confirmed = { ...soon, status: 'confirmed' as const };
    const other = { ...later, status: 'confirmed' as const };
    expect(mergeBookingRows([], 300, own([[confirmed, 200], [other, 200]]), new Set([soon.id]))).toEqual([confirmed]);
  });
});
```

Create `app/src/lib/apps/__tests__/queries.test.tsx`:
```tsx
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppsError } from '../api';
import { cancelBookingReads, rereadBooking, useBookingAction, writeBooking } from '../queries';
import { BOOKING_ID, bookingFixture, configFixture, fakeAppsApi } from './fixtures';
import { createQueryClient } from '@/lib/query/client';
import { keys } from '@/lib/query/keys';
import { QueryScope } from '@/lib/query/scope';
import { createTestQueryClient, TEST_BUSINESS_ID as BIZ } from '@/test-support/query';
import type { QueryClient } from '@tanstack/react-query';
import type { Booking } from '../types';

const OTHER_ID = '11111111-1111-4111-8111-00000000000e';
const TODAY = keys.bookingWindow(BIZ, '2026-10-05', 1);
const UPCOMING = keys.bookingWindow(BIZ, '2026-10-05', 31);
const LATER = keys.bookingWindow(BIZ, '2026-11-05', 31);

function scope(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryScope client={client} businessId={BIZ}>{children}</QueryScope>;
}

describe('writing a booking into the cache', () => {
  it('puts the answer in its own query and in every list that holds it, and leaves everything else alone', () => {
    const client = createTestQueryClient();
    const booking = bookingFixture();
    const other = bookingFixture({ id: OTHER_ID, customerName: 'Aina' });
    client.setQueryData(TODAY, [booking, other]);
    client.setQueryData(UPCOMING, [booking, other]);
    client.setQueryData(LATER, [other]);
    client.setQueryData(keys.pendingBookings(BIZ), [booking, other]);
    client.setQueryData(keys.bookingsConfig(BIZ), configFixture());
    client.setQueryData(keys.pendingBookings('biz-other'), [booking]);
    const laterBefore = client.getQueryState(LATER)!.dataUpdatedAt;
    const confirmed = bookingFixture({ status: 'confirmed' });

    writeBooking(client, BIZ, confirmed);

    expect(client.getQueryData(keys.booking(BIZ, BOOKING_ID))).toEqual(confirmed);
    expect(client.getQueryData(TODAY)).toEqual([confirmed, other]);
    expect(client.getQueryData(UPCOMING)).toEqual([confirmed, other]);
    // The waiting requests keep only what still waits.
    expect(client.getQueryData(keys.pendingBookings(BIZ))).toEqual([other]);
    expect(client.getQueryData(LATER)).toEqual([other]);
    expect(client.getQueryState(LATER)!.dataUpdatedAt).toBe(laterBefore);
    expect(client.getQueryData(keys.bookingsConfig(BIZ))).toEqual(configFixture());
    expect(client.getQueryData(keys.pendingBookings('biz-other'))).toEqual([booking]);
  });

  it('cancels a list read in flight, so what it read before a decision never lands', async () => {
    const client = createTestQueryClient();
    let answer!: (rows: Booking[]) => void;
    const read = client.fetchQuery({ queryKey: TODAY, queryFn: () => new Promise<Booking[]>((resolve) => { answer = resolve; }) })
      .catch(() => 'cancelled');
    await cancelBookingReads(client, BIZ, BOOKING_ID);
    answer([bookingFixture()]);
    expect(await read).toBe('cancelled');
    expect(client.getQueryData(TODAY)).toBeUndefined();
  });

  it('re-reads a booking whose action failed and writes it everywhere', async () => {
    const client = createTestQueryClient();
    client.setQueryData(keys.pendingBookings(BIZ), [bookingFixture()]);
    const declined = bookingFixture({ status: 'declined' });
    const api = fakeAppsApi({ booking: vi.fn(async () => declined) });
    await expect(rereadBooking(client, api, BIZ, BOOKING_ID)).resolves.toEqual(declined);
    expect(client.getQueryData(keys.booking(BIZ, BOOKING_ID))).toEqual(declined);
    expect(client.getQueryData(keys.pendingBookings(BIZ))).toEqual([]);
  });
});

describe('a booking action', () => {
  it('writes the answer everywhere and marks the lists to be read again', async () => {
    const client = createTestQueryClient();
    client.setQueryData(TODAY, [bookingFixture()]);
    client.setQueryData(keys.pendingBookings(BIZ), [bookingFixture()]);
    const confirmed = bookingFixture({ status: 'confirmed' });
    const api = fakeAppsApi({ decide: vi.fn(async () => ({ booking: confirmed, whatsappUrl: null, calendarQueued: false })) });
    const { result } = renderHook(() => useBookingAction(api), { wrapper: scope(client) });
    await act(async () => { await result.current.mutateAsync({ id: BOOKING_ID, action: 'confirm' }); });
    expect(api.decide).toHaveBeenCalledWith(BOOKING_ID, 'confirm');
    expect(client.getQueryData(TODAY)).toEqual([confirmed]);
    expect(client.getQueryData(keys.pendingBookings(BIZ))).toEqual([]);
    expect(client.getQueryState(TODAY)!.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.appsList(BIZ))).toBeUndefined();
  });

  it('is never sent twice, whatever the failure, even with the production retry rules', async () => {
    const client = createQueryClient();
    const api = fakeAppsApi({ decide: vi.fn().mockRejectedValue(new AppsError('NETWORK', 0, true)) });
    const { result } = renderHook(() => useBookingAction(api), { wrapper: scope(client) });
    await act(async () => {
      await expect(result.current.mutateAsync({ id: BOOKING_ID, action: 'confirm' })).rejects.toBeInstanceOf(AppsError);
    });
    expect(api.decide).toHaveBeenCalledTimes(1);
  });

  it('sends cancel and Retry Calendar to their own endpoints', async () => {
    const client = createTestQueryClient();
    const api = fakeAppsApi();
    const { result } = renderHook(() => useBookingAction(api), { wrapper: scope(client) });
    await act(async () => { await result.current.mutateAsync({ id: BOOKING_ID, action: 'cancel' }); });
    await act(async () => { await result.current.mutateAsync({ id: BOOKING_ID, action: 'retry' }); });
    expect(api.cancel).toHaveBeenCalledWith(BOOKING_ID);
    expect(api.retryCalendar).toHaveBeenCalledWith(BOOKING_ID);
    expect(api.decide).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/lib/apps/__tests__/bookings.test.ts src/lib/apps/__tests__/queries.test.tsx`
Expected: FAIL. `mergeBookingRows`, `writeBooking`, `cancelBookingReads`, `rereadBooking` and `useBookingAction` do not exist yet.

- [ ] **Step 3: Move `BookingAction` into the lib layer**

In `app/src/lib/apps/types.ts`, directly above `export interface BookingActionResult {`, add:
```ts
/** What the owner can do to one booking from its card. */
export type BookingAction = 'confirm' | 'decline' | 'cancel' | 'retry';

```
In `app/src/routes/views/apps/BookingCard.tsx`, replace
```ts
import type { Booking } from '@/lib/apps/types';

export type BookingAction = 'confirm' | 'decline' | 'cancel' | 'retry';
```
with
```ts
import type { Booking, BookingAction } from '@/lib/apps/types';

export type { BookingAction };
```

- [ ] **Step 4: Add the decided-here rule as a pure function**

In `app/src/lib/apps/bookings.ts`, directly above `/** The saved settings as a save request for the same version. */`, add:
```ts
/** A booking as its own query last read it, and when (ms since epoch). */
export interface OwnRead {
  booking: Booking;
  updatedAt: number;
}

/** The rows a Bookings list shows, soonest first, or null while the list
    itself has not loaded.
    - A booking decided in this view (`kept`) is drawn from its own query:
      the action's answer, then only later reads of that one booking (a
      Calendar poll). No list read can put it back to pending, and it stays
      when a later list leaves it out: Needs you's pending-only scan drops a
      card the moment it is decided, WhatsApp link and all.
    - Any other row is drawn from whichever read it last: the list, or its
      own query (a Calendar poll). */
export function mergeBookingRows(
  list: Booking[] | null,
  listUpdatedAt: number,
  own: ReadonlyMap<string, OwnRead>,
  kept: ReadonlySet<string>,
): Booking[] | null {
  if (list === null) return null;
  const listed = new Set(list.map((booking) => booking.id));
  const rows = list.map((booking) => {
    const read = own.get(booking.id);
    return read && (kept.has(booking.id) || read.updatedAt > listUpdatedAt) ? read.booking : booking;
  });
  for (const id of kept) {
    const read = own.get(id);
    if (read && !listed.has(id)) rows.push(read.booking);
  }
  return rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
```

- [ ] **Step 5: Add the booking reads, writes and the action mutation**

In `app/src/lib/apps/queries.ts`, replace the import block with:
```ts
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { bookingListsFilter, keys, mutationKeys } from '@/lib/query/keys';
import { useRequiredBusinessId } from '@/lib/query/scope';
import { loadPendingBookings, loadWindow } from './bookings';
import type {
  AppsApi, AppsList, Booking, BookingAction, BookingActionResult, BookingsConfigInput,
} from './types';
```
and append:
```ts
/** Every booking in one window of Malaysian days (Today, a picked date, or
    31 days of Upcoming). */
export function bookingWindowQuery(api: AppsApi, businessId: string, from: string, days: number) {
  return queryOptions({ queryKey: keys.bookingWindow(businessId, from, days), queryFn: () => loadWindow(api, { from, days }) });
}

/** One booking, as the server has it now. */
export function bookingQuery(api: AppsApi, businessId: string, bookingId: string) {
  return queryOptions({ queryKey: keys.booking(businessId, bookingId), queryFn: () => api.booking(bookingId) });
}

/** Stops every read in flight that could hold this booking as it was before
    a decision: every list, and the booking's own query. A cancelled read
    never lands; each query keeps what it had. */
export async function cancelBookingReads(client: QueryClient, businessId: string, bookingId: string): Promise<void> {
  await Promise.all([
    client.cancelQueries(bookingListsFilter(businessId)),
    client.cancelQueries({ queryKey: keys.booking(businessId, bookingId), exact: true }),
  ]);
}

const stillWaiting = (booking: Booking) => booking.status === 'pending' && !booking.expired;

/** The server's answer for one booking, written where every screen reads it:
    its own query, and every cached list that holds it. The waiting-requests
    list keeps only what still waits, as the scan itself does. A list that
    does not hold the booking is left exactly as it was. */
export function writeBooking(client: QueryClient, businessId: string, booking: Booking): void {
  client.setQueryData(keys.booking(businessId, booking.id), booking);
  const holds = (rows: Booking[] | undefined): rows is Booking[] => !!rows && rows.some((row) => row.id === booking.id);
  const replace = (rows: Booking[]) => rows.map((row) => (row.id === booking.id ? booking : row));
  client.setQueriesData<Booking[]>({ queryKey: keys.bookingWindows(businessId) }, (rows) => (holds(rows) ? replace(rows) : undefined));
  client.setQueryData<Booking[]>(keys.pendingBookings(businessId), (rows) => (holds(rows) ? replace(rows).filter(stillWaiting) : undefined));
}

/** The booking as the server has it now, after an action that failed or got
    no answer, written everywhere like an action's answer. Rejects when that
    read fails too. */
export async function rereadBooking(client: QueryClient, api: AppsApi, businessId: string, bookingId: string): Promise<Booking> {
  const fresh = await client.fetchQuery({ ...bookingQuery(api, businessId, bookingId), staleTime: 0 });
  writeBooking(client, businessId, fresh);
  return fresh;
}

export interface BookingActionVars {
  id: string;
  action: BookingAction;
}

export function runBookingAction(api: AppsApi, { id, action }: BookingActionVars): Promise<BookingActionResult> {
  return action === 'confirm' || action === 'decline' ? api.decide(id, action)
    : action === 'cancel' ? api.cancel(id) : api.retryCalendar(id);
}

/** Confirm, decline, cancel and Retry Calendar. Reads already in flight are
    cancelled before the request goes and again when the answer arrives, so
    a read that began before the decision cannot land after it; the answer
    is written into the booking's query and every list that holds it; then
    the lists and the apps list are read again. Never retried: a lost answer
    means re-read and show the truth (`rereadBooking`), never send twice.
    Each call is its own mutation, so two bookings can be acted on at once. */
export function useBookingAction(api: AppsApi) {
  const client = useQueryClient();
  const businessId = useRequiredBusinessId();
  return useMutation({
    mutationKey: mutationKeys.bookingAction(businessId),
    mutationFn: (vars: BookingActionVars) => runBookingAction(api, vars),
    onMutate: (vars) => cancelBookingReads(client, businessId, vars.id),
    onSuccess: async (result, vars) => {
      await cancelBookingReads(client, businessId, vars.id);
      writeBooking(client, businessId, result.booking);
    },
    onSettled: () => { void refreshApps(client, businessId); },
    retry: false,
  });
}
```

The ordering in `useBookingAction` is load-bearing:
- `onMutate` cancels reads in flight before the request goes.
- `onSuccess` cancels again, so no read that began while the request was out lands after the answer, and only then writes the answer.
- `onSettled` returns nothing (`void refreshApps(…)`), so `mutateAsync` resolves without waiting for the lists to be read again.

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run src/lib/apps`
Expected: 4 files pass (41 tests).

- [ ] **Step 7: Typecheck, and check that nothing else broke**

Run:
```bash
pnpm typecheck
pnpm exec vitest run src/routes/views/apps src/routes/views/__tests__/HomeView.apps.test.tsx
```
Expected: typecheck exits 0, and the Bookings screen tests still pass. `BookingsList` has not changed yet; it imports `BookingAction` from `./BookingCard`, which still exports it.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/apps/types.ts app/src/routes/views/apps/BookingCard.tsx app/src/lib/apps/bookings.ts app/src/lib/apps/queries.ts \
  app/src/lib/apps/__tests__/bookings.test.ts app/src/lib/apps/__tests__/queries.test.tsx
git commit -m "feat(bookings): booking reads, writes and actions in the query cache

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 6: The Bookings list on the cache

**Files:**
- Modify: `app/src/routes/views/apps/BookingsList.tsx` (whole file)
- Test: `app/src/routes/views/apps/__tests__/BookingsList.test.tsx` (imports, six changed tests, six new tests)

**Interfaces:**
- Consumes:
  - Task 1: `keys`, `mutationKeys`, `useRequiredBusinessId`, `createQueryClient`, `returnToApp`.
  - Task 2: `useApps()`, where `pending` is the shared waiting-requests query and `refresh()` is `refreshApps`; and `mount(api, bookingId?, { delay?, client? })` returning `{ onConnectCalendar, user, client, unmount }`.
  - Task 5:
    - `bookingWindowQuery`, `bookingQuery`, `useBookingAction`, `rereadBooking` and `type BookingActionVars` from `@/lib/apps/queries`.
    - `mergeBookingRows` and `type OwnRead` from `@/lib/apps/bookings`.
    - `type BookingAction` from `@/lib/apps/types`.
- Produces: `BookingsList` with unchanged props `{ api, bookingId, onConnectCalendar, now? }`. `BookingsApp.tsx` needs no change.

How each behaviour listed in the spec's section 3 survives:

| Today (hand-written) | After |
|---|---|
| Default filter decided once from `apps.pending` / `apps.error` | Same `useEffect`, minus the seed |
| `seed` avoids a second Needs you scan | Needs you *is* `apps.pending`, the shared query, so no second scan can exist |
| Filter/offset/date loads, `generation` drops stale answers | One window query per `(from, days)`; the key is the generation |
| `actionEpoch` + `actionsInFlight` discard reads that span an action | `useBookingAction` cancels list and booking reads in `onMutate` and again in `onSuccess`; a cancelled read never lands |
| `reloadOwed` / `refetchFocusedOwed` retry what was discarded | `onSettled` → `refreshApps` reads the lists again (and the apps list) |
| `decidedHere` keeps a decided card through quiet reloads | `decided` state scoped to the window + `mergeBookingRows`: a kept booking is drawn from its own query (the answer, then polls) |
| Per-booking 10 s poll, skipped while hidden | `useQueries` over syncing + kept ids with `refetchInterval` while `calendar.status === 'pending'`, `refetchIntervalInBackground: false`; seeded from the row, so no request at mount |
| `visibilitychange` reload of list and pinned card | `refetchOnWindowFocus` (after 30 s); the pinned query refetches on focus unless it 404'd |
| Deep-link retry on return for non-404 only | `refetchOnWindowFocus: unlessNotFound` on the pinned query |
| `busy` Set | `useMutationState` over pending `bookingAction` mutations, so two bookings can be acted on at once |
| Failure → re-read → "as it stands" or plain error, never resend | Same `catch`, through `rereadBooking` (which writes the truth everywhere); mutations have `retry: false` |
| Empty text follows loaded rows, not rows minus the pinned card | Unchanged (`rows` vs `shown`) |

- [ ] **Step 1: Update the existing tests and write the new ones**

In `app/src/routes/views/apps/__tests__/BookingsList.test.tsx`, replace `import { renderWithQuery } from '@/test-support/query';` with:
```tsx
import { createQueryClient } from '@/lib/query/client';
import { renderWithQuery, returnToApp } from '@/test-support/query';
```

Replace each of these six tests whole. Each changed assertion concerns fetching only; every assertion about what the owner sees is kept.

1. `opens Needs you on the scan that decided it, without scanning again`. Returning to Needs you inside 30 s now makes **no** second scan: `pendingScans()` stays `1`, where it was `2`.
```tsx
  it('opens Needs you on the scan that decided it, without scanning again', async () => {
    const api = fakeAppsApi({ list: installed(1), bookings: serve([bookingFixture()]) });
    await mount(api);
    await screen.findByRole('article', { name: 'Aisyah' });
    const pendingScans = () => api.bookings.mock.calls.filter(([query]) => query.status === 'pending').length;
    // One scan (one request since the API takes the 91-day horizon at once), not two.
    expect(pendingScans()).toBe(1);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Today/ }));
    await user.click(screen.getByRole('button', { name: /^Needs you/ }));
    await screen.findByRole('article', { name: 'Aisyah' });
    // Back inside 30 s: Needs you is the shared scan's answer, not a new scan.
    expect(pendingScans()).toBe(1);
  });
```
2. `keeps a confirmed card in Needs you after a foreground reload`. The return is now `returnToApp(client)`:
```tsx
  it('keeps a confirmed card in Needs you after a foreground reload', async () => {
    const confirmed = bookingFixture({ status: 'confirmed', whatsappUrl: WA, calendar: calendar('created') });
    let decided = false;
    const bookings = vi.fn(async (query: BookingsQuery) => ({
      bookings: query.status === 'pending' ? (decided ? [] : [bookingFixture()]) : [],
      nextCursor: null,
    }));
    const api = fakeAppsApi({
      list: installed(1), bookings,
      decide: vi.fn(async () => { decided = true; return { booking: confirmed, whatsappUrl: WA, calendarQueued: false }; }),
    });
    const { client, user } = await mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ });
    await returnToApp(client);
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(card).getByText('Confirmed')).toBeInTheDocument());
    expect(within(card).getByRole('link', { name: /Send confirmation on WhatsApp/ })).toHaveAttribute('href', WA);
    expect(screen.queryByText('No requests are waiting for you.')).toBeNull();
  });
```
3. `does not let a stale reload undo a fresh decision`. The held reload is now started by `returnToApp(client)`:
```tsx
  it('does not let a stale reload undo a fresh decision', async () => {
    let current = bookingFixture();
    let releaseStale: (() => void) | null = null;
    let calls = 0;
    const confirmed = bookingFixture({ status: 'confirmed', whatsappUrl: WA });
    const bookings = vi.fn(async (query: BookingsQuery) => {
      if (query.status === 'pending') return { bookings: [], nextCursor: null };
      calls += 1;
      const snapshot = current;
      if (calls === 2) await new Promise<void>((resolve) => { releaseStale = resolve; });
      return { bookings: [snapshot], nextCursor: null };
    });
    const api = fakeAppsApi({
      list: installed(0), bookings,
      decide: vi.fn(async () => { current = confirmed; return { booking: confirmed, whatsappUrl: WA, calendarQueued: false }; }),
    });
    const { client, user } = await mount(api);
    await screen.findByRole('article', { name: 'Aisyah' });

    // A quiet reload starts and its read is held open, before the write.
    await returnToApp(client);
    // `calls` counts only the window reads this test cares about; a
    // pending-status scan goes through the early-return branch above.
    await waitFor(() => expect(calls).toBe(2));

    // The action resolves while that reload is still in flight.
    await user.click(within(screen.getByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ });

    // Now the stale reload resolves with the pre-confirm snapshot.
    releaseStale!();
    await waitFor(() => expect(calls).toBe(3));
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(card).getByText('Confirmed')).toBeInTheDocument());
    expect(within(card).queryByRole('button', { name: 'Confirm' })).toBeNull();
  });
```
4. `shows the failed state, not a forever spinner, when a quiet reload is first to fail` is renamed. The cache joins a second read to the one already in flight, so "a reload overtakes the first load" cannot happen. What the owner sees (the failed card, not a spinner) is still asserted. Replace the test and the comment above it with:
```tsx
  /* Fix round 1, item 10: a load that fails before any rows arrived must
     show the failed state rather than leave the spinner forever. (The old
     trigger, a foreground reload overtaking the first load, cannot happen
     any more: the cache joins a second read to the one in flight.) */
  it('shows the failed state, not a forever spinner, when the list cannot be read', async () => {
    const bookings = vi.fn(async (query: BookingsQuery) => {
      if (query.status === 'pending') return { bookings: [], nextCursor: null };
      throw new AppsError('NETWORK', 0, false);
    });
    const api = fakeAppsApi({ list: installed(0), bookings });
    await mount(api);
    expect(await screen.findByText('Could not load bookings.')).toBeInTheDocument();
    expect(screen.queryByText('Loading bookings…')).toBeNull();
  });
```
5. `clears the failed state once a later quiet load succeeds` is renamed, for the same reason. The same owner-visible assertions stay.
```tsx
  it('clears the failed state once a later read succeeds', async () => {
    let calls = 0;
    const bookings = vi.fn(async (query: BookingsQuery) => {
      if (query.status === 'pending') return { bookings: [], nextCursor: null };
      calls += 1;
      if (calls === 1) throw new AppsError('NETWORK', 0, false);
      return { bookings: [], nextCursor: null };
    });
    const api = fakeAppsApi({ list: installed(0), bookings });
    const { client } = await mount(api);
    expect(await screen.findByText('Could not load bookings.')).toBeInTheDocument();

    // The owner comes back to the app and the read succeeds: the failed card goes away.
    await returnToApp(client);
    await waitFor(() => expect(screen.queryByText('Could not load bookings.')).toBeNull());
    expect(await screen.findByText('No bookings today.')).toBeInTheDocument();
  });
```
6. `retries a non-404 deep-link failure on a foreground reload`. The return is now `returnToApp(client)`:
```tsx
  it('retries a non-404 deep-link failure on a foreground reload', async () => {
    let calls = 0;
    const booking = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new AppsError('NETWORK', 0, true);
      return bookingFixture();
    });
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], []), booking });
    const { client } = await mount(api, BOOKING_ID);
    expect(await screen.findByText('Could not load bookings.')).toBeInTheDocument();

    await returnToApp(client);
    await waitFor(() => expect(screen.getByRole('region', { name: 'From your notification' })).toBeInTheDocument());
    expect(screen.queryByText('Could not load bookings.')).toBeNull();
  });
```

Then append inside `describe('BookingsList', …)`, after the last test:
```tsx
  it('shows the Bookings tab again on a revisit inside 30 s without asking the server', async () => {
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], [bookingFixture({ status: 'confirmed' })]) });
    const first = await mount(api);
    await screen.findByRole('article', { name: 'Aisyah' });
    first.unmount();
    await mount(api, null, { client: first.client });
    expect(await screen.findByRole('article', { name: 'Aisyah' })).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.bookings).toHaveBeenCalledTimes(1);
  });

  it('never sends a confirm twice, and shows the booking as it stands', async () => {
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn().mockRejectedValue(new AppsError('NETWORK', 0, true)),
      booking: vi.fn(async () => bookingFixture({ status: 'confirmed', whatsappUrl: WA })),
    });
    // The production client: only its no-retry rule for writes is under test.
    const { user } = await mount(api, null, { client: createQueryClient() });
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(card).getByRole('alert')).toHaveTextContent('We did not hear back'));
    expect(within(card).getByText('Confirmed')).toBeInTheDocument();
    expect(api.decide).toHaveBeenCalledTimes(1);
  });

  it('stops polling once Calendar has synced', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const syncing = bookingFixture({ status: 'confirmed', calendar: calendar('pending') });
    const api = fakeAppsApi({
      list: installed(0), bookings: serve([], [syncing]),
      booking: vi.fn(async () => bookingFixture({ status: 'confirmed', calendar: calendar('created') })),
    });
    await mount(api, null, { delay: null });
    await screen.findByRole('article', { name: 'Aisyah' });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await waitFor(() => expect(screen.getByText('Added to Google Calendar')).toBeInTheDocument());
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(api.booking).toHaveBeenCalledTimes(1);
  });

  it('stops polling when the list is closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const syncing = bookingFixture({ status: 'confirmed', calendar: calendar('pending') });
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], [syncing]) });
    const { unmount } = await mount(api, null, { delay: null });
    await screen.findByRole('article', { name: 'Aisyah' });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(api.booking).not.toHaveBeenCalled();
  });

  it('does not ask again for a booking that could not be found when the owner returns', async () => {
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], []), booking: vi.fn().mockRejectedValue(new AppsError('NOT_FOUND', 404)) });
    const { client } = await mount(api, BOOKING_ID);
    expect(await screen.findByText('This booking could not be found.')).toBeInTheDocument();
    await returnToApp(client);
    await screen.findByText('No bookings today.');
    expect(api.booking).toHaveBeenCalledTimes(1);
    expect(screen.getByText('This booking could not be found.')).toBeInTheDocument();
  });

  it('shows a decision in every cached list at once, not only the one it was made in', async () => {
    let decided = false;
    let holdToday: (() => void) | null = null;
    const confirmed = bookingFixture({ status: 'confirmed', whatsappUrl: WA });
    const bookings = vi.fn(async (query: BookingsQuery) => {
      if (query.status === 'pending') return { bookings: decided ? [] : [bookingFixture()], nextCursor: null };
      // Today's second read (after the decision) is held, so the card below comes from the cache.
      if (decided) await new Promise<void>((resolve) => { holdToday = resolve; });
      return { bookings: [decided ? confirmed : bookingFixture()], nextCursor: null };
    });
    const api = fakeAppsApi({
      list: installed(1), bookings,
      decide: vi.fn(async () => { decided = true; return { booking: confirmed, whatsappUrl: WA, calendarQueued: false }; }),
    });
    const { user } = await mount(api);
    await screen.findByRole('article', { name: 'Aisyah' });
    // Today is read once and cached, with the request still waiting.
    await user.click(screen.getByRole('button', { name: /^Today/ }));
    expect(within(await screen.findByRole('article', { name: 'Aisyah' })).getByText('Needs you')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Needs you/ }));
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ });
    // Back to Today: decided at once, while its own read is still in flight.
    await user.click(screen.getByRole('button', { name: /^Today/ }));
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    expect(within(card).getByText('Confirmed')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Confirm' })).toBeNull();
    await waitFor(() => expect(holdToday).not.toBeNull());
    await act(async () => { holdToday!(); });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/routes/views/apps/__tests__/BookingsList.test.tsx`
Expected: 3 FAIL against the old component:
- `opens Needs you on the scan that decided it…` (it scans again);
- `shows the Bookings tab again on a revisit…` (it reads again);
- `shows a decision in every cached list at once…` (it has no cache).

The rest pass already. They guard behaviour the rewrite must keep: no resend, polling that stops, a 404 not asked for again, and every older test.

- [ ] **Step 3: Rewrite the component**

Replace `app/src/routes/views/apps/BookingsList.tsx` with:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutationState, useQueries, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { Button, Card, Chip, LoadingState } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useApps } from '@/lib/apps/useApps';
import { AppsError } from '@/lib/apps/api';
import {
  actionErrorKey, addDays, groupByDay, mergeBookingRows, unconfirmedErrorKey, WINDOW_DAYS, type OwnRead,
} from '@/lib/apps/bookings';
import {
  bookingQuery, bookingWindowQuery, rereadBooking, useBookingAction, type BookingActionVars,
} from '@/lib/apps/queries';
import { keys, mutationKeys } from '@/lib/query/keys';
import { useRequiredBusinessId } from '@/lib/query/scope';
import { malaysiaDay } from '@/lib/daily-brief';
import type { AppsApi, Booking, BookingAction } from '@/lib/apps/types';
import BookingCard from './BookingCard';

type Filter = 'needs' | 'today' | 'upcoming' | 'date';
type BookingKey = ReturnType<typeof keys.booking>;
const POLL_MS = 10_000;
/** Upcoming reaches 90 days ahead in three windows. */
const UPCOMING_OFFSETS = [0, 31, 62];

/** A booking's own query polls while its Calendar event is still being
    written, and stops by itself once it is synced. Never in the background. */
const pollWhileSyncing = (query: { state: { data?: Booking } }) =>
  (query.state.data?.calendar.status === 'pending' ? POLL_MS : false);
/** A deep link that 404'd will not change on retry; any other failure may. */
const unlessNotFound = (query: { state: { error: unknown } }) =>
  !(query.state.error instanceof AppsError && query.state.error.status === 404);

export default function BookingsList({ api, bookingId, onConnectCalendar, now = () => new Date() }: {
  api: AppsApi;
  bookingId: string | null;
  onConnectCalendar: () => void;
  now?: () => Date;
}) {
  const { t, lang } = useI18n();
  const apps = useApps();
  const client = useQueryClient();
  const businessId = useRequiredBusinessId();
  const action = useBookingAction(api);
  const clock = useRef(now);
  clock.current = now;
  const [chosen, setChosen] = useState<Filter | null>(null);
  const filter: Filter = chosen ?? 'today';
  const [offset, setOffset] = useState(0);
  const [date, setDate] = useState(() => malaysiaDay(now()));
  const [messages, setMessages] = useState<Record<string, string>>({});
  /** Bookings confirmed, declined or cancelled here, for the window they
      were decided in (`scope`). Choosing another window starts afresh. */
  const [decided, setDecided] = useState<{ scope: string; ids: string[] }>({ scope: '', ids: [] });

  /* Needs you when requests wait, otherwise Today — decided once, so
     confirming the last request does not pull the view away from it. Also
     resolved (to Today) if the apps list itself failed, so this does not
     wait forever on a count that will never arrive. */
  useEffect(() => {
    if (chosen === null && (apps.pending !== null || apps.error)) {
      setChosen(apps.pending !== null && apps.pending.length > 0 ? 'needs' : 'today');
    }
  }, [chosen, apps.pending, apps.error]);

  const today = malaysiaDay(clock.current());
  const range = filter === 'upcoming' ? { from: addDays(today, offset), days: WINDOW_DAYS }
    : filter === 'date' ? { from: date, days: 1 } : { from: today, days: 1 };
  const needs = filter === 'needs';
  const scope = needs ? 'needs' : `${range.from}/${range.days}`;
  const kept = useMemo(() => new Set(decided.scope === scope ? decided.ids : []), [decided, scope]);

  /* Needs you is the shared waiting-requests query (useApps), so opening it
     never scans again; every other filter is a window query. Nothing is
     asked for until the default filter is decided. */
  const windowRead = useQuery({
    ...bookingWindowQuery(api, businessId, range.from, range.days),
    enabled: chosen !== null && !needs,
  });
  const list: Booking[] | null = needs ? apps.pending : windowRead.data ?? null;
  const listUpdatedAt = needs
    ? client.getQueryState(keys.pendingBookings(businessId))?.dataUpdatedAt ?? 0
    : windowRead.dataUpdatedAt;

  /* Each booking decided here, and each whose Calendar is syncing, is
     watched through its own query: the action's answer and later polls land
     there. Seeded from the list, so watching starts without a request. */
  const syncing = (list ?? []).filter((booking) => booking.calendar.status === 'pending').map((booking) => booking.id);
  const watched = [...new Set([...kept, ...syncing])].sort();
  const reads: UseQueryOptions<Booking, Error, Booking, BookingKey>[] = watched.map((id) => {
    const row = list?.find((booking) => booking.id === id);
    return {
      ...bookingQuery(api, businessId, id),
      initialData: row,
      initialDataUpdatedAt: row ? listUpdatedAt : undefined,
      refetchInterval: pollWhileSyncing,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
    };
  });
  const ownReads = useQueries({ queries: reads });
  const own = new Map<string, OwnRead>();
  watched.forEach((id, index) => {
    const read = ownReads[index];
    if (read?.data) own.set(id, { booking: read.data, updatedAt: read.dataUpdatedAt });
  });
  const rows = mergeBookingRows(list, listUpdatedAt, own, kept);

  /* The booking a notification opened, pinned above the list whatever the
     filter. A 404 says so and is not asked for again on return; any other
     failure is read again when the owner comes back to the app. */
  const pinned = useQuery({
    ...bookingQuery(api, businessId, bookingId ?? ''),
    enabled: bookingId !== null,
    refetchInterval: pollWhileSyncing,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: unlessNotFound,
  });
  const focused = bookingId ? pinned.data ?? null : null;
  const focusedError = bookingId && !focused && pinned.isError
    ? (pinned.error instanceof AppsError && pinned.error.status === 404 ? 'bookings.error.notFound' : 'bookings.error.load')
    : null;

  /* A read in flight after a failure shows the loading state again. */
  const failed = needs
    ? apps.error && apps.pending === null && !apps.loading
    : windowRead.isError && windowRead.data === undefined && !windowRead.isFetching;

  /* Busy per booking: whichever actions are in flight right now. */
  const busyIds = useMutationState({
    filters: { mutationKey: mutationKeys.bookingAction(businessId), status: 'pending' },
    select: (mutation) => (mutation.state.variables as BookingActionVars | undefined)?.id ?? '',
  });
  const busy = new Set(busyIds);

  async function act(booking: Booking, kind: BookingAction) {
    if (kind === 'cancel' && !window.confirm(t('bookings.cancel.confirm', { name: booking.customerName }))) return;
    /* Kept in this window from now on, even once a later list leaves it
       out: Needs you's pending-only scan drops a card the moment it is
       decided, and its WhatsApp link with it. */
    if (kind !== 'retry' && (rows ?? []).some((row) => row.id === booking.id)) {
      setDecided((current) => ({
        scope,
        ids: current.scope === scope ? [...new Set([...current.ids, booking.id])] : [booking.id],
      }));
    }
    setMessages((current) => {
      const next = { ...current };
      delete next[booking.id];
      return next;
    });
    try {
      const result = await action.mutateAsync({ id: booking.id, action: kind });
      if (kind === 'retry' && !result.calendarQueued && result.booking.calendar.status === 'not_connected') {
        /* Retry answers "nothing to do" while no Calendar is connected; say so
           rather than let the tap look ignored. */
        setMessages((current) => ({ ...current, [booking.id]: 'bookings.calendar.stillNotConnected' }));
      }
    } catch (error) {
      const key = actionErrorKey(error);
      /* Someone else decided, or the answer was lost: show the booking as
         the server has it now. Never send the action again. */
      try {
        await rereadBooking(client, api, businessId, booking.id);
        setMessages((current) => ({ ...current, [booking.id]: key }));
      } catch {
        /* The re-read failed too — do not claim to be showing the booking
           "as it stands" when we could not confirm what that is. */
        setMessages((current) => ({ ...current, [booking.id]: unconfirmedErrorKey(key) }));
      }
    }
  }

  function retry() {
    if (needs) void apps.refresh();
    else void windowRead.refetch();
  }

  const locale = lang === 'bm' ? 'ms-MY' : 'en-MY';
  const dayTitle = (day: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${day}T00:00:00Z`));
  const card = (booking: Booking) => <BookingCard key={booking.id} booking={booking} busy={busy.has(booking.id)}
    message={messages[booking.id] ? t(messages[booking.id]) : null} now={clock.current()}
    onAct={(kind) => void act(booking, kind)} onConnectCalendar={onConnectCalendar} />;
  /* The empty text follows the loaded rows, not the rows left once the
     pinned card is taken out of them. */
  const shown = (rows ?? []).filter((booking) => booking.id !== focused?.id);
  const waiting = apps.pending?.length ?? 0;

  return <div className="bookings-list">
    <div className="bookings-filters" role="group" aria-label={t('bookings.filters')}>
      {(['needs', 'today', 'upcoming'] as const).map((option) => <Chip key={option} active={filter === option} aria-pressed={filter === option}
        onClick={() => { setChosen(option); setOffset(0); }}>
        {t(`bookings.filter.${option}`)}{option === 'needs' && waiting > 0 ? ` (${waiting})` : ''}
      </Chip>)}
      <label className="bookings-date">{t('bookings.date.pick')}
        <input className="input" type="date" value={date}
          onChange={(event) => { if (event.target.value) { setDate(event.target.value); setChosen('date'); } }} />
      </label>
    </div>
    {focused && <section className="bookings-focused" aria-labelledby="bookings-focused-title">
      <h2 id="bookings-focused-title">{t('bookings.focused')}</h2>
      {card(focused)}
    </section>}
    {focusedError && <p role="alert">{t(focusedError)}</p>}
    {failed && <Card role="alert" className="bookings-state">
      <p>{t('bookings.error.load')}</p>
      <Button variant="outline" onClick={retry}>{t('apps.retry')}</Button>
    </Card>}
    {!failed && rows === null && <LoadingState title={t('bookings.loading')} />}
    {rows !== null && rows.length === 0 && <p className="bookings-empty">{t(`bookings.empty.${filter}`)}</p>}
    {rows !== null && shown.length > 0 && (filter === 'upcoming'
      ? groupByDay(shown).map(([day, group]) => <section key={day} className="bookings-day-group" aria-label={dayTitle(day)}>
        <h3>{dayTitle(day)}</h3>{group.map(card)}
      </section>)
      : <div className="bookings-cards">{shown.map(card)}</div>)}
    {filter === 'upcoming' && <div className="bookings-window">
      <Button variant="ghost" disabled={offset === UPCOMING_OFFSETS[0]}
        onClick={() => setOffset((value) => UPCOMING_OFFSETS[Math.max(0, UPCOMING_OFFSETS.indexOf(value) - 1)])}>{t('bookings.window.earlier')}</Button>
      <span>{t('bookings.window.range', { from: dayTitle(addDays(today, offset)), to: dayTitle(addDays(today, offset + WINDOW_DAYS - 1)) })}</span>
      <Button variant="ghost" disabled={offset === UPCOMING_OFFSETS[UPCOMING_OFFSETS.length - 1]}
        onClick={() => setOffset((value) => UPCOMING_OFFSETS[Math.min(UPCOMING_OFFSETS.length - 1, UPCOMING_OFFSETS.indexOf(value) + 1)])}>{t('bookings.window.later')}</Button>
    </div>}
  </div>;
}
```

- [ ] **Step 4: Run the list tests**

Run: `pnpm exec vitest run src/routes/views/apps/__tests__/BookingsList.test.tsx`
Expected: PASS, 32 tests. Some use fake timers (`vi.useFakeTimers({ shouldAdvanceTime: true })`); the file's `afterEach` restores real timers.

- [ ] **Step 5: Run everything that renders the Bookings path**

Run: `pnpm exec vitest run src/routes/views/apps src/lib/apps src/lib/query src/hooks/__tests__/useNotifications.test.tsx src/routes/views/__tests__/HomeView.apps.test.tsx src/routes/views/__tests__/AppsView.test.tsx src/routes/views/__tests__/NotificationsView.test.tsx src/components/__tests__/workspace-modes.test.tsx`
Expected: all pass. `workspace-modes` covers opening a booking from its notification link through `Dashboard`; if it alone fails, re-run it by itself first.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add app/src/routes/views/apps/BookingsList.tsx app/src/routes/views/apps/__tests__/BookingsList.test.tsx
git commit -m "feat(bookings): the Bookings list reads and writes through the query cache

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: House rule and full verification

**Files:**
- Modify: `CLAUDE.md` (a new bullet at the end of the "React rebuild (`app/`)" list, directly before `## Native shell (\`mobile/\`)`)

**Interfaces:**
- Consumes: everything above.
- Produces: the rule later work (phase 2) follows.

- [ ] **Step 1: Add the rule**

In `CLAUDE.md`, directly after the bullet that starts `- **Playbook figures are for the anonymous demo only.**` and before the blank line and `## Native shell (\`mobile/\`)`, add:
```markdown
- **Server data on the Bookings path goes through one query cache**
  (`app/src/lib/query/`, TanStack Query v5; spec
  `docs/superpowers/specs/2026-09-25-query-cache-bookings-path-design.md`).
  Every key starts `['biz', businessId, …]` and is built only in
  `lib/query/keys.ts`, so one business's data can never draw under another.
  Writes are mutations that never retry and put the server's answer into the
  cache (`writeBooking` in `lib/apps/queries.ts`); a lost answer is re-read,
  never resent. The cache lives in memory for the page, with nothing persisted
  to the device, and `RepositoryGate` makes it for signed-in pages only: the
  demo gets none. Tests mount through `renderWithQuery`
  (`src/test-support/query.tsx`) and say "the owner came back" with
  `returnToApp(client)`. The cache listens for `visibilitychange` on
  `window`, and the non-bubbling `new Event('visibilitychange')` older tests
  dispatch on `document` never reaches it. Activity, Routines, Goals,
  Connections and shared chats still fetch by hand until phase 2.
```

- [ ] **Step 2: Typecheck the whole app**

Run (from `app/`): `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 3: Run the full app suite**

Run (from `app/`): `pnpm exec vitest run`
Expected: everything passes except the known unrelated `src/routes/__tests__/launch-post.test.tsx`, which fails on main already. If `src/components/__tests__/workspace-modes.test.tsx` fails under load, run `pnpm exec vitest run src/components/__tests__/workspace-modes.test.tsx` alone. It must pass alone before any change is blamed. Report any other failure; do not wave it through.

- [ ] **Step 4: Build, and prove the devtools stay out of production**

Run (from `app/`):
```bash
pnpm build
/usr/bin/grep -rl 'ReactQueryDevtools\|TanstackQueryDevtools' dist | wc -l
```
Expected: the build exits 0 and the count is `0`. Do not stage `dist/`.

- [ ] **Step 5: Check that no customer data goes to device storage**

Run (from `app/`): `/usr/bin/grep -rn "persist\|localStorage\|sessionStorage\|indexedDB" src/lib/query src/lib/apps/queries.ts src/hooks/useNotifications.ts src/test-support/query.tsx`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: server data on the Bookings path goes through the query cache

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Rollout is not part of this plan: no deploy, no push. The spec's rollout, measurements and "build from main after checking the live Pages source" happen after review.
