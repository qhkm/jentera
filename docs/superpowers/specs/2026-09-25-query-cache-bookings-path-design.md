# A query cache for the Bookings path (TanStack Query, phase 1)

Status: design approved in conversation on 2026-09-25; built on branch query-cache (plan docs/superpowers/plans/2026-09-25-query-cache-bookings-path.md).

## Why

An owner felt the Bookings tab load slowly. Two measured causes are already
fixed: the waiting-request scan ran twice, then three calls became one
(`7ab3430`, `b4bc198`). What remains is structural. The app has about twenty
hand-written data-fetching sites. Each one has its own refresh-on-return,
polling and race guards, and there is no shared cache. So every screen
refetches from scratch when the owner returns to it, and a duplicate
request is easy to write by accident: the double scan was exactly that.

**The goal is instant revisits.** Returning to a screen shows the last data
at once and refreshes it quietly behind the scenes. Less code and fewer
requests follow from that, but they are not the measure.

## Decisions

| | Decision | Why |
|---|---|---|
| Library | `@tanstack/react-query` v5, under the existing API modules | A shared cache, deduplication, focus refetch, conditional polling and query cancellation are built in. SWR is lighter but weaker at mutations and races; a hand-rolled cache would rebuild all of this |
| Cache life | In memory only; nothing is persisted to the device | Booking data carries customer names and phone numbers, and a PDPA retention decision is still open (`docs/todo.md`). A full reload fetches fresh, as today |
| Order | The Bookings path first, the rest in a phase 2 plan | That is where the slowness was felt, and it proves the pattern on the hardest screen early |
| API modules | Unchanged: `lib/apps/api.ts`, `lib/notifications.ts` | Queries wrap them, so their typed errors (`AppsError`) and tests stay as they are |
| Public hooks | Keep their shape: `useApps()` and `useNotifications()` | Home, the bell, Needs you and the Bookings tab change their data source, not their code |

## Where things stand

From a read-only survey of `app/src` on 2026-09-25:

- **The business snapshot** (`lib/repo/context.tsx`) is loaded once per page and kept in memory, so reading it is already instant. `useMutate` writes, then reloads the whole snapshot. **Out of scope.**
- **`lib/apps/useApps.tsx`** holds `AppsProvider`, a context with the apps list and waiting requests. It refetches on `visibilitychange` and when the unread count rises, and uses a generation ref to drop stale responses.
- **`routes/views/apps/BookingsList.tsx`** is the heaviest fetch site:
  - filter-driven loads, and a per-booking re-read;
  - a 10 s poll while Calendar is syncing, and a `visibilitychange` reload;
  - an action epoch with owed reloads, a `decidedHere` set, and a busy set;
  - a one-shot seed from the shared scan.
- **`hooks/useNotifications.ts`** polls every 60 s while visible. It pages by cursor, marks read optimistically, and guards requests with a request-id ref. `Dashboard.tsx` owns one instance and passes `unread` to `AppsProvider`.
- **The anonymous demo** uses `LocalRepository`, where Apps are off. The bell only shows when signed in.
- **Tests:**
  - `fakeAppsApi` in `lib/apps/__tests__/fixtures.ts` gives every `AppsApi` method as a typed `vi.fn`;
  - about 25 test files stub global `fetch`;
  - there is no shared render helper.

## Design

### 1. The cache and how long it lives

- **One `QueryClient` per signed-in page.** `RepositoryGate` creates it only when it chooses `RemoteRepository`, and mounts it with `QueryClientProvider`. The anonymous demo gets no client and does not change.
- **The cache lives as long as the page.** Signing out already reloads the page. Every query key starts with the business id, `['biz', businessId, …]`, so a later business switch can never show one business's data under another. The id comes from the signed-in session the gate already holds (`/api/me`'s `businessId`), exposed once through a small hook rather than read per screen.
- **Defaults:**
  - `staleTime` 30 s: a revisit inside that window shows the cache without a request.
  - `gcTime` 30 min: unused data is dropped after that.
  - `refetchOnWindowFocus` on, which replaces the hand-written `visibilitychange` handlers.
- **Retries.**
  - A read retries **once**, and only on a failure that can be temporary: `AppsError` with `status === 0` (network), `status >= 500`, or `INVALID_RESPONSE`.
  - A 4xx never retries.
  - The notifications module throws a plain `Error` with no status, so a notifications read retries once on any failure.
  - **Mutations never retry.** Confirm, decline and cancel keep today's rule: a lost answer means re-read and show the truth, never send twice.
- **Tests** mount through one helper, `renderWithQuery`: a fresh client per test, `retry: false`, `gcTime: Infinity`, and the existing providers.

### 2. Apps, waiting requests and Alerts

**Keys and queries:**

| Data | Key | How it loads |
|---|---|---|
| Apps list | `['biz', id, 'apps', 'list']` | `api.list()` |
| Waiting requests | `['biz', id, 'apps', 'bookings', 'pending']` | `loadPendingBookings` (one call). Enabled only when the list shows Bookings installed with `pending > 0`; otherwise `pending` is `[]` with no request |
| Bookings config | `['biz', id, 'apps', 'bookings', 'config']` | `api.bookingsConfig()` |
| Notifications | `['biz', id, 'notifications']` | An infinite query over `fetchNotifications(cursor)` |

**`useApps()`** keeps its return shape: `{ enabled, api, list, pending, loading, error, refresh }`.
- `refresh()` invalidates the list and pending queries, which then refetch in the background.
- A rising unread count still calls `refresh()`.

**Notifications:**
- The bell and the Alerts view read the one query.
- `refetchInterval` is 60 s, and it does not run in the background.
- `markRead` and `markAll` are mutations. They update the cache first, restore it on error, and confirm with the server after.

**Saving the config** writes the server's answer into the config query, and invalidates the apps list and waiting requests. The Paused label and the counts then update everywhere.

### 3. The Bookings list

Every behaviour below exists today and must survive.

**Filters and the default filter**
- The default is decided once: Needs you when anything is waiting, otherwise Today. It never switches away from under the owner.
- **Needs you reads the shared waiting-requests query directly**, so the duplicate scan cannot recur.
- Today, Upcoming (31-day pages, with offset) and a picked date are each a query keyed by their window, e.g. `['biz', id, 'apps', 'bookings', 'window', from, days]`.

**Each booking also has its own query**, `['biz', id, 'apps', 'booking', bookingId]`.
- **The pinned card** (deep link from a notification) uses it:
  - 404 shows "could not be found";
  - any other failure shows the load error and is retried when the owner returns to the app.
- **Calendar polling:** `refetchInterval` 10 s while that booking's `calendar.status` is `pending`, and never in the background. It stops by itself once synced.

**Actions (confirm, decline, cancel, Retry Calendar)** are mutations:
1. `onMutate` cancels in-flight list and booking queries, so a read that began before the decision cannot land after it.
2. On success, write the returned booking into its own query, and into every cached list that holds it (`setQueriesData` over `['biz', id, 'apps', 'bookings']`, replacing by id).
3. `onSettled` invalidates the lists.

**The decided-here rule stays.** A booking decided in this view is shown from the action's result: decided, with its WhatsApp link. A list read that began before the decision cannot put it back to pending. The rule only takes in later reads of that one booking, such as a Calendar poll.

**On failure**, re-read the booking. Then:
- show it "as it stands" when the re-read works;
- show the plain error when the re-read also fails;
- never resend.

**Busy state is per booking**, taken from the mutations in flight. Two bookings can be acted on at once.

**Honest empty text** keeps its rule: it follows the loaded rows, not the rows left after removing the pinned card.

### 4. Dependency, testing and rollout

**Dependency:** `@tanstack/react-query` v5. `@tanstack/react-query-devtools` is loaded only in development and never ships in the production bundle.

**Existing tests are the regression net.**
- The 26 `BookingsList` tests, and the Home, brief, `useApps`, notifications and workspace-modes tests, must pass.
- An assertion may change only about how data is fetched, never about what the owner sees.
- Each changed assertion is named in the task report and in review.

**New tests:**
- **Instant revisit:** unmount and remount inside 30 s, and the data shows with no new request.
- **Quiet refresh:** after 30 s, cached data shows while exactly one background request runs.
- **One fetch:** the bell and the Alerts view together make a single notifications request.
- **Business isolation:** data under one business id never renders under another.
- **No resend:** a failed confirm is not repeated, and the re-read shows the booking as it stands.
- **Calendar polling:** polling stops once synced, and does not run while the app is hidden.

**Rollout** changes only the app, with no API or database change.
- Build from `main` after checking the live Pages source is contained in it, so no other session's live work is rolled back.
- Measure afterwards: requests when opening Bookings, time to content on a revisit, and the `Server-Timing` numbers on Apps responses.

**Codebase rule**, a short `CLAUDE.md` note: server data on these screens goes through queries keyed `['biz', businessId, …]`, and writes are mutations that update the cache from the server's answer.

## Out of scope

- The business snapshot and `useMutate`.
- The chat's live answer streaming (`useAsk`, `RemoteRepository` streams).
- Persisting the cache to the device.
- The native app's bearer token for the Apps API.

**Phase 2, a separate plan:**
- Activity (`useActivity`);
- Routines (`useRoutines`, which polls while work is queued);
- Goals, Team and Skills;
- Connections (`useConnections`, with its 3 s Telegram pairing poll);
- shared chats (`useSharedChats`).

## Acceptance

- Returning to Bookings, Home or Alerts inside 30 s shows content with no request; after 30 s, content shows at once and one background request refreshes it.
- Opening Bookings with requests waiting sends one waiting-requests call in total, shared by Home, the brief and Needs you.
- Every existing Bookings behaviour listed in section 3 still holds, proven by the existing tests plus the new ones.
- No customer data is written to device storage.
- The anonymous demo behaves exactly as before.
