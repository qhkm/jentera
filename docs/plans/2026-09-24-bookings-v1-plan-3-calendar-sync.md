# Bookings v1, plan 3: durable Calendar sync

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the owner confirms a booking, its event appears in their Google
Calendar. When they cancel it, the event goes away. Both happen reliably,
through timeouts, crashes, lost responses and a cancel that races the create,
without the owner's tap ever waiting on Google.

**Architecture:** Plan 1 already commits a `booking_calendar_job` row, desired
`present` or `absent`, in the same transaction as the decision. This plan adds
the only thing that acts on it: `processBookingCalendarJob` in
`src/apps/bookings/calendar-sync.ts`. It works in three steps:
1. **Claim.** One transaction locks the installation, then the booking, then
   the job. It takes a lease, counts the attempt and reads the credential.
2. **Call Google.** Outside any transaction, create or delete the event's
   deterministic id within an 8-second budget.
3. **Complete.** A second transaction takes the same locks and writes the
   result only if the lease is still this attempt's and the revision has not
   moved.

The processor runs from two places: right after the owner's request commits
(`ctx.waitUntil`, from the placed HTTP invocation), and from the minute cron
for retries. The owner also gets a retry route for a sync that failed.

**Tech stack:** Cloudflare Workers (TypeScript), postgres.js through
Hyperdrive, Neon Postgres with forced RLS, the Google Calendar v3 REST API
behind `src/connectors/google-calendar.ts`, and Vitest with a throwaway Docker
Postgres and faked `fetch`.

**Spec:**
- [`docs/plans/2026-09-23-apps-shell-and-bookings-v1.md`](2026-09-23-apps-shell-and-bookings-v1.md):
  the sections "Deciding and cancelling", "Durable Calendar sync" and "Calendar
  deleted-id verification", and the retry row of the owner-routes table.
- Plan 1's as-built notes, at the end of
  [`2026-09-23-bookings-v1-plan-1-worker-foundation.md`](2026-09-23-bookings-v1-plan-1-worker-foundation.md),
  list what this plan must honour. Each note maps to a Global Constraint below.

**Branch:** keep working on `bookings-v1` in the worktree at
`~/.agent-worktree/workspaces/aisar-site-b726b8/bookings-v1`. Do not merge,
push or deploy.

## Global constraints

- **Lock order.** Every transaction that touches a booking's Calendar state
  locks `app_installation`, then (when it changes the booking itself) the
  service, then the booking, then `booking_calendar_job`. The processor never
  locks the job row first; that would deadlock against `cancelBooking`.
- **No network call inside a transaction.** Google is called between the
  claim and completion transactions.
- **The budget is 8 seconds.** One `AbortSignal` covers the token refresh, the
  create or delete, and the read after a 409. A bare `Promise.race` without
  cancellation is not acceptable.
- **Attempts:**
  - At most **8**, with capped exponential backoff: 1, 2, 4, 8, 16, 32 and 60
    minutes, the same schedule as the push outbox.
  - `CALENDAR_MAX_ATTEMPTS` must equal the `attempts < 8` hard-coded in
    `booking_calendar_due`; a test compares them.
  - After exhaustion, the booking shows `failed` and the owner may retry.
- **Stale results are never written.**
  - Completion writes `booking.calendar_status` only when the job's
    `lease_token` is still this attempt's and its `revision` is the one
    claimed.
  - A cancel during a create bumps the revision. The late `created` is
    dropped, and removal stays due.
- **A `cancelled` event status is a deletion marker, never `created`.**
  - Desired `present` with a marker: the owner deleted the event in Google.
    Show `failed` with an explicit message. Never recreate it and never
    generate a replacement id.
  - Desired `absent`: a 404, a 410, or an already deleted event counts as
    removed.
- **Never switch Calendar accounts silently.**
  - A job whose pinned `calendar_connection_id` is null, or whose connection
    is no longer connected, is terminal for owner attention. The processor
    never chooses another connection.
  - The retry route pins a connection only for a booking that was confirmed
    while nothing was connected (`not_connected`).
- **A switched-off pilot defers work; it does not drop it.**
  - With `APPS_ENABLED` not `"true"`, the cron does not scan at all.
  - For a business off the pilot list, the processor pushes the job's
    `next_attempt_at` forward by an hour without spending an attempt, so the
    due scan cannot starve.
  - Pausing public bookings does not stop sync.
- **Sync never changes a booking's status and never messages the customer.**
- **Clear the stale error when cleanup is queued.** `cancelBooking` sets
  `booking.calendar_error = null` whenever it queues cleanup.
- **Errors:**
  - `calendar_error` and `last_error` are owner-facing English sentences of at
    most 300 characters, taken from `GoogleCalendarError.message` or from this
    plan's constants. They never contain secrets.
  - Logs carry business and booking ids and an error's name and code, never
    customer names, phone numbers or notes.
- **The sites deploy never reaches the executor.** Nothing reachable from
  `src/sites/index.ts` may import `src/connections.ts`, `src/connectors/*` or
  `calendar-sync.ts`. A test walks the import graph.
- **Tests:**
  - Arrange as the owner (`asOwner`), assert as `aisar_app` where isolation
    matters.
  - Google is always a `fetchFake`. No test touches the network.
- **Workflow:**
  - Stage named paths only.
  - Run single files with `pnpm exec vitest run <files>` from `worker/`.
  - Run `pnpm typecheck` (two passes) before committing. Docker must be
    running.

## Review focus

1. **The owner cancels while the create is still in flight.** The booking
   never shows `created`; the event is removed on the next attempt. (Task 2,
   race test.)
2. **The owner double-taps, or the cron fires while the first attempt is
   running.** One executor owns the job; Google sees one create. (Task 2
   `busy` test; Task 4 retry deduplication.)
3. **Google hangs.** The attempt is aborted at the budget and retried later.
   The owner's confirm returns at once. (Task 2 timeout test; Task 4 checks the
   response does not wait for the scheduled work.)
4. **The owner deletes the event in Google, then something retries.** It is
   not resurrected, and the owner is told why. (Task 2, removed-in-Google
   test.)
5. **The owner disconnects Google after confirming, then cancels.** Nothing is
   deleted through another account. The owner is told to delete the event by
   hand, and a retry is refused. (Task 2, disconnected-cleanup test; Task 4,
   `CALENDAR_DISCONNECTED`.)

## Not in this plan

- **The live experiment for deleted ids** (spec, "Calendar deleted-id
  verification"). It needs a real Google account and a disposable test
  calendar, so it is a release step for the owner and is listed in Task 5's
  status note. The processor already treats a 409 followed by a `cancelled`
  read-back as a deletion marker, and tests pin that, whatever the live
  experiment shows.
- **Owner screens for Calendar state and the retry button.** Those are plan 4.
- **Documentation.** `CLAUDE.md`, `docs/architecture.md` and `docs/todo.md`
  are written at the end of plan 4.

---

## File structure

**Created:**
- `worker/src/apps/bookings/calendar-sync.ts`: the processor
  (`processBookingCalendarJob`), a wrapper that logs and never throws
  (`runCalendarJob`), the sweep (`sweepBookingCalendar`), and the constants.
- `worker/test/apps-calendar-sync.test.ts`: tests for the processor and the
  sweep.
- `worker/test/sites-bundle.test.ts`: a test that the sites entry never
  reaches the Calendar executor.

**Modified:**
- `worker/src/connectors/google-calendar.ts`: `calendarEventId`,
  `deleteGoogleCalendarEvent`, and an optional `signal` passed to every fetch.
- `worker/test/google-calendar.test.ts`: connector tests.
- `worker/src/apps/bookings/bookings.ts`: `retryCalendar`; `cancelBooking`
  clears a stale error; `DecideResult` gains two codes.
- `worker/src/routes/apps.ts`: the retry route, and the first attempt after
  commit through `waitUntil`.
- `worker/src/index.ts`: passes `waitUntil` to `handleApps`; the minute cron
  runs the sweep.
- `worker/test/apps-bookings-route.test.ts`: route tests.

---

## Task 0: Workspace (controller)

- [ ] **Step 1: Confirm the branch state.**

```bash
cd ~/.agent-worktree/workspaces/aisar-site-b726b8/bookings-v1/worker
git status --short && git log --oneline -1
docker info >/dev/null && pnpm typecheck && pnpm exec vitest run test/google-calendar.test.ts test/apps-bookings-route.test.ts
```

Expected: a clean tree, and every listed test passing.

---

## Task 1: Connector: a budget, and removal

**Files:**
- Modify: `worker/src/connectors/google-calendar.ts`: `accessToken`,
  `createGoogleCalendarEvent`, a new `calendarEventId`, and a new
  `deleteGoogleCalendarEvent` after `createGoogleCalendarEvent`.
- Test: `worker/test/google-calendar.test.ts`.

**Interfaces:**
- **Produces:**
  - `calendarEventId(requestId: string): string`, which gives
    `jentera<hex of requestId's UTF-8 bytes>`, the id create already uses.
  - `createGoogleCalendarEvent(env, rawSecret, event, fetcher = fetch, signal?: AbortSignal)`.
  - `deleteGoogleCalendarEvent(env, rawSecret, requestId, fetcher = fetch, signal?: AbortSignal): Promise<'deleted' | 'already_absent'>`.
  - When `signal` is given, every fetch receives it, the token refresh
    included.
- **Unchanged:** a 409 still reads the id back and returns its view, status
  included. Callers must check `status === 'cancelled'`. Task 2 does.

- [ ] **Step 1: Write the failing tests.**
  - Add `calendarEventId` and `deleteGoogleCalendarEvent` to the import list
    at the top of `worker/test/google-calendar.test.ts`, and add
    `GoogleCalendarError` if it is not already imported.
  - Append:

```ts
describe('Google Calendar budget and removal', () => {
  const secret = calendarSecret(profile);
  const event = {
    requestId: '0f4c9b7e-1111-4111-8111-111111111111',
    summary: 'Cupping class · Aisyah (2)',
    start: '2026-10-06T10:00:00+08:00',
    end: '2026-10-06T11:00:00+08:00',
    timeZone: 'Asia/Kuala_Lumpur',
  };

  function google(answer: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'access' });
      return answer(url, init);
    });
    return { fetcher, calls };
  }

  it('addresses one event per request id, for create and delete alike', async () => {
    const { fetcher, calls } = google(() => Response.json({ id: calendarEventId(event.requestId), status: 'confirmed' }));
    await createGoogleCalendarEvent(env, secret, event, fetcher);
    expect(JSON.parse(String(calls[1].init?.body)).id).toBe(calendarEventId(event.requestId));
    expect(calendarEventId(event.requestId)).toMatch(/^jentera[0-9a-f]+$/);
  });

  it('passes one budget signal to the token refresh, the create and the read-back', async () => {
    const { fetcher, calls } = google((url, init) => (init?.method === 'POST'
      ? new Response('{}', { status: 409 })
      : Response.json({ id: calendarEventId(event.requestId), status: 'confirmed' })));
    const signal = AbortSignal.timeout(5_000);
    await createGoogleCalendarEvent(env, secret, event, fetcher, signal);
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.init?.signal).toBe(signal);
  });

  it('gives up when the budget runs out instead of waiting on Google', async () => {
    const { fetcher } = google((_url, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    }));
    await expect(createGoogleCalendarEvent(env, secret, event, fetcher, AbortSignal.timeout(20))).rejects.toThrow();
  });

  it('reports a read-back of a deleted event as cancelled, for the caller to refuse', async () => {
    const { fetcher } = google((_url, init) => (init?.method === 'POST'
      ? new Response('{}', { status: 409 })
      : Response.json({ id: calendarEventId(event.requestId), status: 'cancelled' })));
    expect((await createGoogleCalendarEvent(env, secret, event, fetcher)).status).toBe('cancelled');
  });

  it('removes the event, and treats an event that is already gone as removed', async () => {
    const removed = google(() => new Response(null, { status: 204 }));
    expect(await deleteGoogleCalendarEvent(env, secret, event.requestId, removed.fetcher)).toBe('deleted');
    expect(removed.calls[1].url).toBe(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${calendarEventId(event.requestId)}?sendUpdates=none`);
    expect(removed.calls[1].init?.method).toBe('DELETE');
    for (const status of [404, 410]) {
      const gone = google(() => new Response('{}', { status }));
      expect(await deleteGoogleCalendarEvent(env, secret, event.requestId, gone.fetcher)).toBe('already_absent');
    }
  });

  it('turns other delete failures into errors the caller can act on', async () => {
    const broken = google(() => new Response('{}', { status: 500 }));
    await expect(deleteGoogleCalendarEvent(env, secret, event.requestId, broken.fetcher))
      .rejects.toMatchObject({ auth: false });
    const refused = google(() => new Response('{}', { status: 401 }));
    await expect(deleteGoogleCalendarEvent(env, secret, event.requestId, refused.fetcher))
      .rejects.toBeInstanceOf(GoogleCalendarError);
    await expect(deleteGoogleCalendarEvent(env, secret, event.requestId, refused.fetcher))
      .rejects.toMatchObject({ auth: true });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
pnpm exec vitest run test/google-calendar.test.ts
```

Expected: FAIL. `calendarEventId` and `deleteGoogleCalendarEvent` are not
exported.

- [ ] **Step 3: Implement.** In `worker/src/connectors/google-calendar.ts`:

  a. Add this function above `accessToken`:

```ts
/** The provider id for one Jentera request. Deterministic, so a retried
    create and a later delete address the same event even when an earlier
    response was lost. Google accepts lowercase a-v and 0-9; this is
    "jentera" and hex. */
export function calendarEventId(requestId: string): string {
  const encoded = [...new TextEncoder().encode(requestId)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `jentera${encoded}`;
}
```

  b. Give `accessToken` a last parameter, `signal?: AbortSignal`, and add
  `...(signal ? { signal } : {}),` to its `fetcher(TOKEN, { … })` init.

  c. Replace `createGoogleCalendarEvent` with:

```ts
export async function createGoogleCalendarEvent(
  env: Env,
  rawSecret: string,
  event: CalendarEventInput,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<CalendarEventView> {
  const budget = signal ? { signal } : {};
  const token = await accessToken(env, rawSecret, fetcher, signal);
  // A stable provider id makes a retry safe even if the first response is lost.
  const id = calendarEventId(event.requestId);
  const response = await fetcher(`${API}/calendars/primary/events?sendUpdates=none`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id,
      summary: event.summary,
      start: { dateTime: event.start, timeZone: event.timeZone },
      end: { dateTime: event.end, timeZone: event.timeZone },
      ...(event.location ? { location: event.location } : {}),
      ...(event.description ? { description: event.description } : {}),
    }),
    ...budget,
  });
  if (response.status === 409) {
    /* The deterministic id makes an uncertain retry safe. A 409 means Google
       has, or had, this exact Jentera request: read it back. A `cancelled`
       status there is a deletion marker, not a live event, and is returned
       as is. The caller must not record it as created. */
    const existing = await fetcher(`${API}/calendars/primary/events/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      ...budget,
    });
    if (!existing.ok) throw providerError(existing);
    const body = await existing.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new GoogleCalendarError('Google Calendar returned an incomplete event.');
    return view(body);
  }
  if (!response.ok) throw providerError(response);
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) throw new GoogleCalendarError('Google Calendar returned an incomplete event.');
  return view(body);
}

/** Remove the event a Jentera request created. An event that is already
    gone counts as success. It may never have been created, the owner may
    have deleted it, or an earlier attempt's answer may have been lost; 404
    and 410 both mean there is nothing left to remove. */
export async function deleteGoogleCalendarEvent(
  env: Env,
  rawSecret: string,
  requestId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<'deleted' | 'already_absent'> {
  const token = await accessToken(env, rawSecret, fetcher, signal);
  const response = await fetcher(
    `${API}/calendars/primary/events/${calendarEventId(requestId)}?sendUpdates=none`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, ...(signal ? { signal } : {}) },
  );
  if (response.status === 404 || response.status === 410) return 'already_absent';
  if (!response.ok) throw providerError(response);
  return 'deleted';
}
```

- [ ] **Step 4: Run the tests.**

```bash
pnpm exec vitest run test/google-calendar.test.ts test/google-calendar-runtime.test.ts
```

Expected: all pass, the existing ones included.

- [ ] **Step 5: Typecheck and commit.**

```bash
pnpm typecheck
git add src/connectors/google-calendar.ts test/google-calendar.test.ts
git commit -m "feat(worker): Calendar calls inside a budget, and removal by the same event id"
```

---

## Task 2: The Calendar job processor

**Files:**
- Create: `worker/src/apps/bookings/calendar-sync.ts`
- Test: `worker/test/apps-calendar-sync.test.ts`
- Test: `worker/test/sites-bundle.test.ts`

**Interfaces:**
- **Consumes:**
  - From Task 1: `calendarEventId`, `createGoogleCalendarEvent`, and
    `deleteGoogleCalendarEvent`.
  - From `src/connections.ts`:
    - `findConnectionById(tx, id)`
    - `useCredential(env, tx, connectionId)`
    - `markConnectionHealthy(tx, id)`
    - `markConnectionExpired(tx, id, why)`
    - `markConnectionProblem(tx, id, why)`
  - `appsEnabledFor(env, businessId)`.
  - `myIso` and `MY_TIME_ZONE` from `./time`.
  - `normaliseCalendarEvent`, which validates the event it is given.
- **Produces:**
  - Constants:
    - `CALENDAR_MAX_ATTEMPTS = 8`
    - `CALENDAR_BUDGET_MS = 8000`
    - `CALENDAR_RECONNECT`
    - `CALENDAR_REMOVED_IN_GOOGLE`
    - `CALENDAR_DISCONNECTED_CLEANUP`
  - Types:
    - `CalendarOutcome = 'created' | 'removed' | 'retrying' | 'failed' | 'stale' | 'busy' | 'idle' | 'deferred'`
    - `CalendarDeps = { fetch?: typeof fetch; now?: () => Date; budgetMs?: number }`
  - `processBookingCalendarJob(env: Env, businessId: string, bookingId: string, deps?: CalendarDeps): Promise<CalendarOutcome>`
  - `runCalendarJob(env, businessId, bookingId, deps?)`, returning
    `Promise<void>`. It never rejects: it logs by id and error name.
  - Task 3 adds the sweep, and Task 4 calls `runCalendarJob` and imports
    `CALENDAR_MAX_ATTEMPTS`.

- [ ] **Step 1: Write the failing test** at
  `worker/test/apps-calendar-sync.test.ts`.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { cancelBooking } from '../src/apps/bookings/bookings';
import {
  CALENDAR_DISCONNECTED_CLEANUP, CALENDAR_MAX_ATTEMPTS, CALENDAR_REMOVED_IN_GOOGLE, processBookingCalendarJob,
} from '../src/apps/bookings/calendar-sync';
import { saveConnection } from '../src/connections';
import { GOOGLE_CALENDAR_SCOPES, calendarEventId, calendarSecret } from '../src/connectors/google-calendar';
import { asApp, asOwner, asTenant, fetchFake, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const ENV = testEnv({
  APPS_ENABLED: 'true', APPS_BUSINESS_IDS: A,
  GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-secret',
});
const NOW = new Date('2026-10-05T00:00:00Z');   // Monday 08:00 in Malaysia
const at = (ms = 0) => () => new Date(NOW.getTime() + ms);
let owner = '';
let service = '';
let bookingId = '';
let connectionId = '';

beforeEach(async () => {
  await truncateAll();
  const ids = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded) values (${A}, 'SEIDO Coffee', 'services', true)`;
    const [u] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('o@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${u.id}, ${A}, 'owner')`;
    await sql`insert into app_installation (business_id, app_key, public_slug) values (${A}, 'bookings', 'seido')`;
    const [s] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
      values (${A}, 'Cupping class', 60, 4) returning id`;
    return { owner: u.id, service: s.id };
  });
  owner = ids.owner;
  service = ids.service;
  const connection = await asTenant(A, (tx) => saveConnection(ENV, tx, A, {
    connector: 'google', method: 'oauth', externalId: 'account-1', displayName: 'owner@example.com',
    secret: calendarSecret({
      subject: 'account-1', email: 'owner@example.com', name: 'Owner', refreshToken: 'refresh-secret',
      scopes: [...GOOGLE_CALENDAR_SCOPES],
    }),
    connectedBy: owner, scopes: [...GOOGLE_CALENDAR_SCOPES],
  }));
  connectionId = connection.id;
  bookingId = await asOwner(async (sql) => {
    const [b] = await sql<{ id: string }[]>`insert into booking (business_id, reference, submission_key, submission_hash,
        service_id, service_name, starts_at, ends_at, party_size, customer_name, customer_phone, note, status,
        decided_at, decided_by, calendar_status, calendar_connection_id)
      values (${A}, 'K7Q2MP', gen_random_uuid(), 'h', ${service}, 'Cupping class',
        '2026-10-06T02:00:00Z', '2026-10-06T03:00:00Z', 2, 'Aisyah', '60123456789', 'Window seat', 'confirmed',
        ${NOW}, ${owner}, 'pending', ${connectionId})
      returning id`;
    await sql`insert into booking_calendar_job (business_id, booking_id, desired, next_attempt_at)
      values (${A}, ${b.id}, 'present', ${NOW})`;
    return b.id;
  });
});

type Handler = (init?: RequestInit) => Response | Promise<Response>;

/** A fake Google. The token endpoint answers first; then POST creates, DELETE
    removes, and GET reads an event back. */
function google(over: { token?: Handler; create?: Handler; read?: Handler; remove?: Handler } = {}) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const fake = fetchFake(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url === 'https://oauth2.googleapis.com/token') {
      return over.token ? over.token(init) : Response.json({ access_token: 'access' });
    }
    if (method === 'POST') {
      return over.create ? over.create(init) : Response.json({ id: calendarEventId(bookingId), status: 'confirmed' });
    }
    if (method === 'DELETE') return over.remove ? over.remove(init) : new Response(null, { status: 204 });
    return over.read ? over.read(init) : Response.json({ id: calendarEventId(bookingId), status: 'confirmed' });
  });
  const creates = () => calls.filter((c) => c.method === 'POST' && c.url.includes('/events'));
  return { fetch: fake as unknown as typeof fetch, calls, creates };
}

async function state() {
  const [row] = await asOwner((sql) => sql<{
    calendar_status: string; calendar_error: string | null; calendar_event_id: string | null;
    desired: string; attempts: number; revision: number; completed_revision: number | null;
    next_attempt_at: Date; lease_token: string | null; last_error: string | null;
  }[]>`
    select b.calendar_status, b.calendar_error, b.calendar_event_id, j.desired, j.attempts, j.revision,
           j.completed_revision, j.next_attempt_at, j.lease_token, j.last_error
      from booking b join booking_calendar_job j on j.business_id = b.business_id and j.booking_id = b.id
     where b.id = ${bookingId}`);
  return row;
}

async function cancelInDatabase() {
  await asOwner(async (sql) => {
    await sql`update booking set status = 'cancelled', cancelled_at = ${NOW}, cancelled_by = ${owner} where id = ${bookingId}`;
    await sql`update booking_calendar_job set desired = 'absent', revision = revision + 1 where booking_id = ${bookingId}`;
  });
}

describe('processBookingCalendarJob', () => {
  it('creates the event once, records it, and leaves nothing due', async () => {
    const g = google();
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('created');
    expect(await state()).toMatchObject({
      calendar_status: 'created', calendar_error: null, calendar_event_id: calendarEventId(bookingId),
      attempts: 1, revision: 1, completed_revision: 1, lease_token: null,
    });
    const sent = JSON.parse(g.creates()[0].body!);
    expect(sent).toMatchObject({
      id: calendarEventId(bookingId),
      summary: 'Cupping class · Aisyah (2)',
      start: { dateTime: '2026-10-06T10:00:00+08:00', timeZone: 'Asia/Kuala_Lumpur' },
      end: { dateTime: '2026-10-06T11:00:00+08:00', timeZone: 'Asia/Kuala_Lumpur' },
    });
    expect(sent.description).toBe('Ref K7Q2MP\nPhone +60123456789\nNote: Window seat');
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at(1_000) })).toBe('idle');
    expect(g.creates()).toHaveLength(1);
  });

  it('removes the event for a cancelled booking, and counts an event already gone as removed', async () => {
    await cancelInDatabase();
    const g = google();
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('removed');
    expect(g.calls.find((c) => c.method === 'DELETE')!.url)
      .toContain(`/events/${calendarEventId(bookingId)}?sendUpdates=none`);
    expect(await state()).toMatchObject({ calendar_status: 'removed', calendar_error: null, completed_revision: 2 });
    expect(g.creates()).toHaveLength(0);

    await cancelInDatabase();   // another revision to reconcile
    const gone = google({ remove: () => new Response('{}', { status: 410 }) });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: gone.fetch, now: at(1_000) })).toBe('removed');
  });

  it('never records a create that a cancel overtook, and removes the event on the next attempt', async () => {
    const g = google({
      create: async () => {
        // The owner cancels while Google is still answering the create.
        await asTenant(A, (tx) => cancelBooking(tx, A, bookingId, owner, NOW));
        return Response.json({ id: calendarEventId(bookingId), status: 'confirmed' });
      },
    });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('stale');
    expect(await state()).toMatchObject({
      calendar_status: 'pending', calendar_event_id: null, desired: 'absent', revision: 2,
      completed_revision: null, lease_token: null,
    });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at(1_000) })).toBe('removed');
    expect(g.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(await state()).toMatchObject({ calendar_status: 'removed', completed_revision: 2 });
  });

  it('picks up a job whose executor died holding the lease, and syncs even while bookings are paused', async () => {
    await asOwner(async (sql) => {
      await sql`update booking_calendar_job
        set attempts = 1, lease_token = gen_random_uuid(), lease_expires_at = ${new Date(NOW.getTime() - 1_000)}`;
      await sql`update app_installation set state = 'paused'`;
      await sql`insert into booking_settings (business_id, availability_acknowledged_at, accepting) values (${A}, now(), false)`;
    });
    const g = google();
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('created');
    expect(await state()).toMatchObject({ attempts: 2, lease_token: null, calendar_status: 'created' });
  });

  it('lets one executor at a time own a job', async () => {
    let second: string | null = null;
    const g = google({
      create: async () => {
        second = await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at(500) });
        return Response.json({ id: calendarEventId(bookingId), status: 'confirmed' });
      },
    });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('created');
    expect(second).toBe('busy');
    expect(g.creates()).toHaveLength(1);
  });

  it('abandons a slow Google at the budget and tries again later', async () => {
    const g = google({
      create: (init) => new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      }),
    });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at(), budgetMs: 50 })).toBe('retrying');
    const row = await state();
    expect(row).toMatchObject({
      calendar_status: 'pending', attempts: 1, lease_token: null, last_error: 'Google Calendar did not answer in time.',
    });
    expect(row.next_attempt_at.toISOString()).toBe(new Date(NOW.getTime() + 60_000).toISOString());
  });

  it('backs off after a failure and gives up after the last attempt', async () => {
    const g = google({ create: () => new Response('{}', { status: 500 }) });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('retrying');
    await asOwner((sql) => sql`update booking_calendar_job set attempts = ${CALENDAR_MAX_ATTEMPTS - 1}, next_attempt_at = ${NOW}`);
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('failed');
    expect(await state()).toMatchObject({
      calendar_status: 'failed', attempts: CALENDAR_MAX_ATTEMPTS,
      calendar_error: 'Google Calendar could not complete that request (500).',
    });
    const due = await asApp((sql) => sql`select * from public.booking_calendar_due(${new Date(NOW.getTime() + 86_400_000)}, 50)`);
    expect(due).toHaveLength(0);
    const [connection] = await asOwner((sql) => sql<{ status: string; last_error: string | null }[]>`
      select status, last_error from connection where id = ${connectionId}`);
    expect(connection.status).toBe('connected');
    expect(connection.last_error).toContain('(500)');
  });

  it('asks for a reconnect when Google refuses the grant, without retrying', async () => {
    const g = google({ token: () => new Response('{}', { status: 400 }) });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('failed');
    expect(await state()).toMatchObject({
      calendar_status: 'failed', attempts: CALENDAR_MAX_ATTEMPTS,
      calendar_error: 'Google Calendar access expired. Reconnect it to continue.',
    });
    const [connection] = await asOwner((sql) => sql<{ status: string }[]>`select status from connection where id = ${connectionId}`);
    expect(connection.status).toBe('expired');
  });

  it('does not re-add an event the owner deleted in Google', async () => {
    const g = google({
      create: () => new Response('{}', { status: 409 }),
      read: () => Response.json({ id: calendarEventId(bookingId), status: 'cancelled' }),
    });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('failed');
    expect(await state()).toMatchObject({
      calendar_status: 'failed', calendar_error: CALENDAR_REMOVED_IN_GOOGLE, calendar_event_id: null, completed_revision: 1,
    });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at(1_000) })).toBe('idle');
  });

  it('never removes through another account once the original connection is gone', async () => {
    await cancelInDatabase();
    await asOwner((sql) => sql`update booking set calendar_connection_id = null where id = ${bookingId}`);
    const g = google();
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('failed');
    expect(await state()).toMatchObject({ calendar_status: 'failed', calendar_error: CALENDAR_DISCONNECTED_CLEANUP });
    expect(g.calls).toHaveLength(0);
  });

  it('waits for a pilot that is switched off without spending an attempt', async () => {
    const off = testEnv({ ...ENV, APPS_BUSINESS_IDS: '22222222-2222-4222-8222-222222222222' });
    const g = google();
    expect(await processBookingCalendarJob(off, A, bookingId, { fetch: g.fetch, now: at() })).toBe('deferred');
    const row = await state();
    expect(row.attempts).toBe(0);
    expect(row.next_attempt_at.toISOString()).toBe(new Date(NOW.getTime() + 3_600_000).toISOString());
    expect(g.calls).toHaveLength(0);
  });

  it('matches the due scan on the attempt limit', async () => {
    const [{ def }] = await asOwner((sql) => sql<{ def: string }[]>`
      select pg_get_functiondef('public.booking_calendar_due(timestamptz, integer)'::regprocedure) as def`);
    expect(def).toContain(`attempts < ${CALENDAR_MAX_ATTEMPTS}`);
  });
});
```

- [ ] **Step 2: Write the failing import-graph test** at
  `worker/test/sites-bundle.test.ts`.

```ts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/** Every source file a runtime import can reach from `entry`. Type-only
    imports are skipped: they never reach the bundle. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/^(?:import|export)\s+(?!type\s)[^;]*?from\s+'(\.{1,2}\/[^']+)'/gms)) {
      const base = resolve(dirname(file), match[1]);
      const next = [`${base}.ts`, `${base}/index.ts`, base].find((candidate) => existsSync(candidate) && candidate.endsWith('.ts'));
      if (next) visit(next);
    }
  };
  visit(entry);
  return seen;
}

describe('the sites deploy', () => {
  it('never reaches the Calendar executor or any credential code', () => {
    const files = [...reachable(resolve(SRC, 'sites/index.ts'))].map((file) => file.slice(SRC.length + 1));
    expect(files).toContain('sites/render.ts');
    expect(files.filter((file) => file === 'connections.ts' || file.startsWith('connectors/') ||
      file === 'apps/bookings/calendar-sync.ts' || file === 'apps/bookings/bookings.ts')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run both and confirm they fail.**

```bash
pnpm exec vitest run test/apps-calendar-sync.test.ts test/sites-bundle.test.ts
```

Expected:
- `apps-calendar-sync` fails with
  `Cannot find module '../src/apps/bookings/calendar-sync'`.
- `sites-bundle` passes already. It is a guard, and it must still pass after
  Step 4. At `9a862c5` the sites entry reaches 20 files, none of them
  `connections.ts`, a connector or bookings.ts.
- If it fails, stop and report the path it found.

- [ ] **Step 4: Create `worker/src/apps/bookings/calendar-sync.ts`.**

```ts
import type postgres from 'postgres';
import type { Env } from '../../env';
import { withTenant } from '../../db';
import {
  findConnectionById,
  markConnectionExpired,
  markConnectionHealthy,
  markConnectionProblem,
  useCredential,
} from '../../connections';
import {
  GOOGLE_CALENDAR_CONNECTOR,
  GoogleCalendarError,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  normaliseCalendarEvent,
  type CalendarEventInput,
} from '../../connectors/google-calendar';
import { appsEnabledFor } from '../gating';
import { MY_TIME_ZONE, myIso } from './time';

/* A booking's Google Calendar event, kept in step with the booking.

   The owner's confirm or cancel commits a booking_calendar_job row in the
   same transaction as the decision. This module is the only thing that acts
   on it. The first attempt runs right after the decision commits
   (ctx.waitUntil in the placed HTTP invocation); the minute cron picks up
   retries and anything a crash left behind. Both go through
   processBookingCalendarJob, so both claim the same lease and check the
   same revision.

   Each attempt has three steps, and Google is only called between
   transactions:
     1. claim    - lock the installation, the booking and the job (the
                   common lock order, never the job first); take a lease;
                   count the attempt; read the credential.
     2. Google   - create or delete the event's deterministic id, within a
                   budget that covers the token refresh too.
     3. complete - lock again in the same order; write the result only if
                   the lease is still ours and the revision has not moved.
                   A cancel that landed during step 2 bumps the revision,
                   so a late "created" is never recorded over it. */

export const CALENDAR_MAX_ATTEMPTS = 8;
export const CALENDAR_BUDGET_MS = 8_000;
const LEASE_MS = 120_000;
const DISABLED_DEFER_MS = 60 * 60_000;

export const CALENDAR_RECONNECT = 'Reconnect Google Calendar, then retry.';
export const CALENDAR_REMOVED_IN_GOOGLE =
  'This event was deleted in Google Calendar, so Jentera did not add it again.';
export const CALENDAR_DISCONNECTED_CLEANUP =
  'Google Calendar was disconnected, so this event could not be removed. Delete it in Google Calendar.';

/** What one call did. The first four ran an attempt; the rest recorded nothing about Google. */
export type CalendarOutcome = 'created' | 'removed' | 'retrying' | 'failed' | 'stale' | 'busy' | 'idle' | 'deferred';

export interface CalendarDeps {
  fetch?: typeof fetch;
  now?: () => Date;
  budgetMs?: number;
}

interface SyncBooking {
  id: string;
  reference: string;
  service_name: string;
  starts_at: Date;
  ends_at: Date;
  party_size: number;
  customer_name: string;
  customer_phone: string;
  note: string | null;
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled';
  calendar_connection_id: string | null;
}

interface SyncJob {
  desired: 'present' | 'absent';
  revision: number;
  completed_revision: number | null;
  attempts: number;
  next_attempt_at: Date;
  lease_token: string | null;
  lease_expires_at: Date | null;
}

interface Claim {
  token: string;
  revision: number;
  desired: 'present' | 'absent';
  attempts: number;
  connectionId: string;
  secret: string;
  booking: SyncBooking;
}

type ProviderResult =
  | { kind: 'created'; eventId: string }
  | { kind: 'removed' }
  | { kind: 'removed_in_google' }
  | { kind: 'error'; auth: boolean; message: string };

/** 1, 2, 4 … minutes, capped at an hour: the push outbox's schedule. */
function retryDelayMs(attempts: number): number {
  return Math.min(60, 2 ** (attempts - 1)) * 60_000;
}

function errorLabel(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} ${code}` : name;
}

/** The common lock order: the installation, then the booking, then the job. */
async function lockJob(
  tx: postgres.TransactionSql,
  businessId: string,
  bookingId: string,
): Promise<{ booking: SyncBooking; job: SyncJob } | null> {
  const [installed] = await tx`select 1 from app_installation
    where business_id = ${businessId} and app_key = 'bookings' for update`;
  if (!installed) return null;
  const [booking] = await tx<SyncBooking[]>`
    select id, reference, service_name, starts_at, ends_at, party_size, customer_name, customer_phone, note,
           status, calendar_connection_id
      from booking where business_id = ${businessId} and id = ${bookingId} for update`;
  if (!booking) return null;
  const [job] = await tx<SyncJob[]>`
    select desired, revision, completed_revision, attempts, next_attempt_at, lease_token, lease_expires_at
      from booking_calendar_job where business_id = ${businessId} and booking_id = ${bookingId} for update`;
  return job ? { booking, job } : null;
}

/** Stop retrying and tell the owner why. The owner's retry starts it again. */
async function giveUp(
  tx: postgres.TransactionSql,
  businessId: string,
  bookingId: string,
  why: string,
  now: Date,
): Promise<void> {
  const message = why.slice(0, 300);
  await tx`update booking_calendar_job
    set attempts = ${CALENDAR_MAX_ATTEMPTS}, lease_token = null, lease_expires_at = null,
        last_error = ${message}, updated_at = ${now}
    where business_id = ${businessId} and booking_id = ${bookingId}`;
  await tx`update booking set calendar_status = 'failed', calendar_error = ${message}
    where business_id = ${businessId} and id = ${bookingId}`;
}

async function claim(
  env: Env,
  businessId: string,
  bookingId: string,
  now: Date,
): Promise<{ kind: 'claimed'; claim: Claim } | { kind: 'done'; outcome: CalendarOutcome }> {
  return withTenant(env, businessId, async (tx) => {
    const locked = await lockJob(tx, businessId, bookingId);
    if (!locked) return { kind: 'done', outcome: 'idle' };
    const { booking, job } = locked;
    if (job.completed_revision === job.revision || job.attempts >= CALENDAR_MAX_ATTEMPTS) {
      return { kind: 'done', outcome: 'idle' };
    }
    if (job.lease_expires_at && job.lease_expires_at.getTime() > now.getTime()) return { kind: 'done', outcome: 'busy' };
    if (job.next_attempt_at.getTime() > now.getTime()) return { kind: 'done', outcome: 'idle' };
    if (!appsEnabledFor(env, businessId)) {
      // Kept for when the pilot comes back, and moved out of the due scan's way meanwhile.
      await tx`update booking_calendar_job
        set next_attempt_at = ${new Date(now.getTime() + DISABLED_DEFER_MS)}, updated_at = ${now}
        where business_id = ${businessId} and booking_id = ${bookingId}`;
      return { kind: 'done', outcome: 'deferred' };
    }
    if (booking.status !== (job.desired === 'present' ? 'confirmed' : 'cancelled')) {
      // Only a confirmed booking has an event to add and only a cancelled one has one to remove.
      await tx`update booking_calendar_job
        set completed_revision = revision, lease_token = null, lease_expires_at = null, updated_at = ${now}
        where business_id = ${businessId} and booking_id = ${bookingId}`;
      return { kind: 'done', outcome: 'idle' };
    }
    const connection = booking.calendar_connection_id
      ? await findConnectionById(tx, booking.calendar_connection_id)
      : null;
    if (!connection || connection.connector !== GOOGLE_CALENDAR_CONNECTOR) {
      // Never pick another connection: that could create or delete in a different account.
      await giveUp(tx, businessId, bookingId, job.desired === 'absent' ? CALENDAR_DISCONNECTED_CLEANUP : CALENDAR_RECONNECT, now);
      return { kind: 'done', outcome: 'failed' };
    }
    if (connection.status !== 'connected') {
      await giveUp(tx, businessId, bookingId, CALENDAR_RECONNECT, now);
      return { kind: 'done', outcome: 'failed' };
    }
    let secret: string;
    try {
      secret = await useCredential(env, tx, connection.id);
    } catch {
      await giveUp(tx, businessId, bookingId, CALENDAR_RECONNECT, now);
      return { kind: 'done', outcome: 'failed' };
    }
    const token = crypto.randomUUID();
    await tx`update booking_calendar_job
      set lease_token = ${token}, lease_expires_at = ${new Date(now.getTime() + LEASE_MS)},
          attempts = attempts + 1, updated_at = ${now}
      where business_id = ${businessId} and booking_id = ${bookingId}`;
    return {
      kind: 'claimed',
      claim: {
        token, revision: job.revision, desired: job.desired, attempts: job.attempts + 1,
        connectionId: connection.id, secret, booking,
      },
    };
  });
}

/** What the owner sees in Google: the service, who, and how many; the
    reference, phone and note in the description. */
function bookingEvent(booking: SyncBooking): CalendarEventInput {
  const lines = [`Ref ${booking.reference}`, `Phone +${booking.customer_phone}`];
  if (booking.note) lines.push(`Note: ${booking.note}`);
  return normaliseCalendarEvent({
    requestId: booking.id,
    summary: `${booking.service_name} · ${booking.customer_name} (${booking.party_size})`,
    start: myIso(booking.starts_at),
    end: myIso(booking.ends_at),
    timeZone: MY_TIME_ZONE,
    description: lines.join('\n'),
  });
}

async function callGoogle(env: Env, work: Claim, deps: CalendarDeps): Promise<ProviderResult> {
  const signal = AbortSignal.timeout(deps.budgetMs ?? CALENDAR_BUDGET_MS);
  const fetcher = deps.fetch ?? fetch;
  try {
    if (work.desired === 'present') {
      const event = await createGoogleCalendarEvent(env, work.secret, bookingEvent(work.booking), fetcher, signal);
      // A 409 read-back of a deleted event: the owner removed it in Google. Not a live event.
      return event.status === 'cancelled' ? { kind: 'removed_in_google' } : { kind: 'created', eventId: event.id };
    }
    await deleteGoogleCalendarEvent(env, work.secret, work.booking.id, fetcher, signal);
    return { kind: 'removed' };
  } catch (error) {
    if (error instanceof GoogleCalendarError) return { kind: 'error', auth: error.auth, message: error.message };
    return {
      kind: 'error',
      auth: false,
      message: signal.aborted ? 'Google Calendar did not answer in time.' : 'Google Calendar could not be reached.',
    };
  }
}

async function complete(
  env: Env,
  businessId: string,
  bookingId: string,
  work: Claim,
  result: ProviderResult,
  now: Date,
): Promise<CalendarOutcome> {
  return withTenant(env, businessId, async (tx) => {
    const locked = await lockJob(tx, businessId, bookingId);
    if (!locked) return 'stale';
    const { job } = locked;
    const ours = job.lease_token === work.token;
    if (!ours || job.revision !== work.revision) {
      /* Someone else owns the job now, or the booking wants something else
         (a cancel during a create). Record nothing; if the lease is still
         ours, release it and leave the new revision due at once. */
      if (ours) {
        await tx`update booking_calendar_job
          set lease_token = null, lease_expires_at = null, next_attempt_at = ${now}, updated_at = ${now}
          where business_id = ${businessId} and booking_id = ${bookingId}`;
      }
      return 'stale';
    }
    const done = async (lastError: string | null) => {
      await tx`update booking_calendar_job
        set completed_revision = revision, lease_token = null, lease_expires_at = null,
            last_error = ${lastError}, updated_at = ${now}
        where business_id = ${businessId} and booking_id = ${bookingId}`;
    };
    switch (result.kind) {
      case 'created':
        await done(null);
        await tx`update booking set calendar_status = 'created', calendar_event_id = ${result.eventId}, calendar_error = null
          where business_id = ${businessId} and id = ${bookingId}`;
        await markConnectionHealthy(tx, work.connectionId);
        return 'created';
      case 'removed':
        await done(null);
        await tx`update booking set calendar_status = 'removed', calendar_error = null
          where business_id = ${businessId} and id = ${bookingId}`;
        await markConnectionHealthy(tx, work.connectionId);
        return 'removed';
      case 'removed_in_google':
        // Final: the same id cannot come back, and a new id would be a second event.
        await done(CALENDAR_REMOVED_IN_GOOGLE);
        await tx`update booking set calendar_status = 'failed', calendar_error = ${CALENDAR_REMOVED_IN_GOOGLE}
          where business_id = ${businessId} and id = ${bookingId}`;
        await markConnectionHealthy(tx, work.connectionId);
        return 'failed';
      case 'error': {
        if (result.auth) {
          await markConnectionExpired(tx, work.connectionId, result.message);
          await giveUp(tx, businessId, bookingId, result.message, now);
          return 'failed';
        }
        await markConnectionProblem(tx, work.connectionId, result.message);
        if (work.attempts >= CALENDAR_MAX_ATTEMPTS) {
          await giveUp(tx, businessId, bookingId, result.message, now);
          return 'failed';
        }
        await tx`update booking_calendar_job
          set lease_token = null, lease_expires_at = null, last_error = ${result.message.slice(0, 300)},
              next_attempt_at = ${new Date(now.getTime() + retryDelayMs(work.attempts))}, updated_at = ${now}
          where business_id = ${businessId} and booking_id = ${bookingId}`;
        return 'retrying';
      }
    }
  });
}

/** One attempt at the booking's Calendar job. Safe to call from anywhere, any
    number of times: the lease, the revision and the backoff decide whether it
    does anything. May throw on a database error; callers that must not throw
    use runCalendarJob. */
export async function processBookingCalendarJob(
  env: Env,
  businessId: string,
  bookingId: string,
  deps: CalendarDeps = {},
): Promise<CalendarOutcome> {
  const now = () => deps.now?.() ?? new Date();
  const claimed = await claim(env, businessId, bookingId, now());
  if (claimed.kind === 'done') return claimed.outcome;
  const result = await callGoogle(env, claimed.claim, deps);
  return complete(env, businessId, bookingId, claimed.claim, result, now());
}

/** For ctx.waitUntil: never rejects, and logs ids and the error's name only. */
export async function runCalendarJob(
  env: Env,
  businessId: string,
  bookingId: string,
  deps: CalendarDeps = {},
): Promise<void> {
  try {
    await processBookingCalendarJob(env, businessId, bookingId, deps);
  } catch (error) {
    console.error(`[bookings-calendar] business=${businessId} booking=${bookingId} ${errorLabel(error)}`);
  }
}
```

- [ ] **Step 5: Run the tests.**

```bash
pnpm exec vitest run test/apps-calendar-sync.test.ts test/sites-bundle.test.ts test/google-calendar.test.ts
```

Expected: all pass. Run `apps-calendar-sync` twice; the race and `busy` tests
must not be flaky. If `runCalendarJob` or `errorLabel` is reported unused,
leave them: Tasks 3 and 4 use them.

- [ ] **Step 6: Typecheck and commit.**

```bash
pnpm typecheck
git add src/apps/bookings/calendar-sync.ts test/apps-calendar-sync.test.ts test/sites-bundle.test.ts
git commit -m "feat(worker): a booking's Calendar event follows the booking, one lease and revision at a time"
```

---

## Task 3: The minute cron sweep

**Files:**
- Modify: `worker/src/apps/bookings/calendar-sync.ts`: append the sweep, and
  add `connect` to the `../../db` import.
- Modify: `worker/src/index.ts`: in `scheduled`, right after the push-outbox
  block.
- Test: `worker/test/apps-calendar-sync.test.ts`: append a `describe`.

**Interfaces:**
- **Consumes:**
  - `processBookingCalendarJob` and `errorLabel` from Task 2.
  - `public.booking_calendar_due(p_now, p_limit)`, a security definer that
    returns `(business_id, booking_id)` for jobs where all of these hold:
    - the job is not completed;
    - `next_attempt_at <= p_now`;
    - `attempts < 8`;
    - no live lease.
- **Produces:**
  - `CalendarSweepSummary = { processed; created; removed; retrying; failed; errors }`.
  - `sweepBookingCalendar(env, deps?: CalendarDeps & { limit?: number }): Promise<CalendarSweepSummary>`.
    It does nothing, and opens no connection, unless
    `env.APPS_ENABLED === 'true'`.

- [ ] **Step 1: Write the failing tests.**
  - Add `sweepBookingCalendar` and `CALENDAR_RECONNECT` to the
    `calendar-sync` import at the top of `worker/test/apps-calendar-sync.test.ts`.
  - Append:

```ts
describe('sweepBookingCalendar', () => {
  const B = '22222222-2222-4222-8222-222222222222';

  /** Business B, with a confirmed booking whose connection is gone:
      processing it asks for a reconnect without calling Google. */
  async function secondBusiness(dueAt: Date) {
    return asOwner(async (sql) => {
      await sql`insert into business (id, name, playbook_key, onboarded) values (${B}, 'Beta', 'salon', true)`;
      await sql`insert into app_installation (business_id, app_key, public_slug) values (${B}, 'bookings', 'beta')`;
      const [s] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
        values (${B}, 'Haircut', 30, 1) returning id`;
      const [b] = await sql<{ id: string }[]>`insert into booking (business_id, reference, submission_key, submission_hash,
          service_id, service_name, starts_at, ends_at, party_size, customer_name, customer_phone, status, calendar_status)
        values (${B}, 'M8R3NQ', gen_random_uuid(), 'h', ${s.id}, 'Haircut',
          '2026-10-06T02:00:00Z', '2026-10-06T02:30:00Z', 1, 'Aina', '60123456780', 'confirmed', 'pending')
        returning id`;
      await sql`insert into booking_calendar_job (business_id, booking_id, desired, next_attempt_at)
        values (${B}, ${b.id}, 'present', ${dueAt})`;
      return b.id;
    });
  }

  it('works through due jobs across businesses', async () => {
    const both = testEnv({ ...ENV, APPS_BUSINESS_IDS: `${A},${B}` });
    const other = await secondBusiness(NOW);
    const g = google();
    const summary = await sweepBookingCalendar(both, { fetch: g.fetch, now: at(1_000) });
    expect(summary).toEqual({ processed: 2, created: 1, removed: 0, retrying: 0, failed: 1, errors: 0 });
    const [row] = await asOwner((sql) => sql<{ calendar_error: string | null }[]>`
      select calendar_error from booking where id = ${other}`);
    expect(row.calendar_error).toBe(CALENDAR_RECONNECT);
    expect((await sweepBookingCalendar(both, { fetch: g.fetch, now: at(2_000) })).processed).toBe(0);
  });

  it('takes a bounded batch, and a switched-off pilot does not block the others', async () => {
    // A (off the list) is due first; B (on it) second. One job per sweep.
    const onlyB = testEnv({ ...ENV, APPS_BUSINESS_IDS: B });
    await secondBusiness(new Date(NOW.getTime() + 500));
    const g = google();
    const first = await sweepBookingCalendar(onlyB, { fetch: g.fetch, now: at(1_000), limit: 1 });
    expect(first).toMatchObject({ processed: 1, failed: 0 });   // A was deferred an hour
    const second = await sweepBookingCalendar(onlyB, { fetch: g.fetch, now: at(1_000), limit: 1 });
    expect(second).toMatchObject({ processed: 1, failed: 1 });  // B's turn
    expect(g.calls).toHaveLength(0);
  });

  it('leaves a job alone while another executor holds its lease', async () => {
    await asOwner((sql) => sql`update booking_calendar_job
      set lease_token = gen_random_uuid(), lease_expires_at = ${new Date(NOW.getTime() + 60_000)}`);
    const g = google();
    expect((await sweepBookingCalendar(ENV, { fetch: g.fetch, now: at(1_000) })).processed).toBe(0);
    expect(g.calls).toHaveLength(0);
  });

  it('does not touch the database while apps are switched off', async () => {
    const off = testEnv({
      APPS_ENABLED: 'false',
      HYPERDRIVE: { connectionString: 'postgres://nobody:nothing@127.0.0.1:1/none' },
    });
    expect(await sweepBookingCalendar(off)).toEqual({ processed: 0, created: 0, removed: 0, retrying: 0, failed: 0, errors: 0 });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
pnpm exec vitest run test/apps-calendar-sync.test.ts
```

Expected: FAIL. `sweepBookingCalendar` is not exported.

- [ ] **Step 3: Implement the sweep.** In
  `worker/src/apps/bookings/calendar-sync.ts`:
  - Change the db import to `import { connect, withTenant } from '../../db';`.
  - Add `const SWEEP_LIMIT = 10;` beside the other constants.
  - Append:

```ts
export interface CalendarSweepSummary {
  processed: number;
  created: number;
  removed: number;
  retrying: number;
  failed: number;
  errors: number;
}

/** The minute cron's part: retries, and whatever a crash or a lost
    waitUntil left due. One cross-tenant read of ids through the security
    definer; each job is then claimed inside its own tenant. The batch is
    small because the cron runs far from Neon. */
export async function sweepBookingCalendar(
  env: Env,
  deps: CalendarDeps & { limit?: number } = {},
): Promise<CalendarSweepSummary> {
  const summary: CalendarSweepSummary = { processed: 0, created: 0, removed: 0, retrying: 0, failed: 0, errors: 0 };
  if (env.APPS_ENABLED !== 'true') return summary;
  const now = deps.now?.() ?? new Date();
  const sql = connect(env);
  let due: { business_id: string; booking_id: string }[];
  try {
    due = await sql<{ business_id: string; booking_id: string }[]>`
      select business_id, booking_id
        from public.booking_calendar_due(${now.toISOString()}::timestamptz, ${deps.limit ?? SWEEP_LIMIT})`;
  } finally {
    await sql.end();
  }
  for (const job of due) {
    try {
      const outcome = await processBookingCalendarJob(env, job.business_id, job.booking_id, deps);
      summary.processed += 1;
      if (outcome === 'created' || outcome === 'removed' || outcome === 'retrying' || outcome === 'failed') {
        summary[outcome] += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error(`[bookings-calendar] business=${job.business_id} booking=${job.booking_id} ${errorLabel(error)}`);
    }
  }
  return summary;
}
```

- [ ] **Step 4: Run the sweep from the minute cron.** In `worker/src/index.ts`:
  - Add `import { sweepBookingCalendar } from './apps/bookings/calendar-sync';`
    beside the `sweepPushOutbox` import.
  - In `scheduled`, directly after the push-outbox `try { … } catch { … }`
    block, add:

```ts
      /* Booking Calendar jobs the first attempt did not finish: retries,
         a cancel that raced its create, and anything a crash left leased. */
      try {
        const calendar = await sweepBookingCalendar(env);
        if (calendar.processed || calendar.errors) {
          console.log(
            `[bookings-calendar] processed=${calendar.processed} created=${calendar.created} ` +
            `removed=${calendar.removed} retrying=${calendar.retrying} failed=${calendar.failed} errors=${calendar.errors}`,
          );
        }
      } catch (err) {
        console.error(`[bookings-calendar] sweep ${err instanceof Error ? err.name : 'error'}`);
      }
```

- [ ] **Step 5: Run the tests.**

```bash
pnpm exec vitest run test/apps-calendar-sync.test.ts
```

Expected: all pass.

- [ ] **Step 6: Typecheck and commit.**

```bash
pnpm typecheck
git add src/apps/bookings/calendar-sync.ts src/index.ts test/apps-calendar-sync.test.ts
git commit -m "feat(worker): the minute cron retries due booking Calendar jobs"
```

---

## Task 4: The owner's side: first attempt after commit, and retry

**Files:**
- Modify: `worker/src/apps/bookings/bookings.ts`:
  - `DecideResult`
  - `cancelBooking`
  - a new `retryCalendar` after `cancelBooking`
- Modify: `worker/src/routes/apps.ts`: the `handleApps` signature, and the
  `/bookings/:id` action block.
- Modify: `worker/src/index.ts`: the `handleApps` call.
- Test: `worker/test/apps-bookings-route.test.ts`.

**Interfaces:**
- **Consumes:**
  - `runCalendarJob`, `CALENDAR_MAX_ATTEMPTS`, `CALENDAR_RECONNECT` and
    `CALENDAR_DISCONNECTED_CLEANUP` from Task 2.
  - `processBookingCalendarJob`, in the tests.
- **Produces:**
  - `handleApps(request, env, url, cors, execution?: { waitUntil(promise: Promise<unknown>): void })`.
  - `POST /api/apps/bookings/bookings/:id/calendar/retry`, under
    `bookings.decide`. It answers 200 `{ ok, booking, whatsappUrl }`, or
    409 `{ code }` with `NOT_RETRYABLE` or `CALENDAR_DISCONNECTED`, or 404.
  - `retryCalendar(tx, businessId, id, now): Promise<DecideResult>`.
  - `DecideResult` codes gain `'NOT_RETRYABLE' | 'CALENDAR_DISCONNECTED'`.
- **The retry rules (spec, "Durable Calendar sync"):**
  - Only a confirmed booking (desired `present`) or a cancelled one (desired
    `absent`) can retry.
  - A job that is still queued, meaning not completed and with attempts
    left, is left exactly as it is. Its backoff is not reset.
  - Finished work (`created`, `removed`) is a no-op.
  - A booking confirmed while `not_connected` pins the connection found now.
  - A job whose pinned connection is gone answers `CALENDAR_DISCONNECTED`.

- [ ] **Step 1: Write the failing tests.** In
  `worker/test/apps-bookings-route.test.ts`:

  a. Add these imports:

```ts
import {
  CALENDAR_DISCONNECTED_CLEANUP, CALENDAR_RECONNECT, processBookingCalendarJob,
} from '../src/apps/bookings/calendar-sync';
```

  b. Replace the `call` helper with:

```ts
async function call(
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
  withOrigin = true,
  execution?: { waitUntil(promise: Promise<unknown>): void },
) {
  const shaped = req(method, path, { cookie, body });
  const headers = new Headers(shaped.request.headers);
  if (withOrigin) headers.set('Origin', CORS['Access-Control-Allow-Origin']);
  const res = await handleApps(new Request(shaped.request, { headers }), ENV, shaped.url, CORS, execution);
  if (!res) throw new Error('apps route did not handle the request');
  return res;
}

/** Collects what a route hands to waitUntil, without waiting for it. */
function recorder() {
  const scheduled: Promise<unknown>[] = [];
  return { execution: { waitUntil: (promise: Promise<unknown>) => { scheduled.push(promise); } }, scheduled };
}

const connectGoogle = () => asOwner((sql) => sql<{ id: string }[]>`insert into connection (business_id, connector, method, status)
  values (${A}, 'google', 'oauth', 'connected') returning id`);
const calendarRow = async (id: string) => {
  const [row] = await asOwner((sql) => sql<{ calendar_status: string; calendar_error: string | null; calendar_connection_id: string | null }[]>`
    select calendar_status, calendar_error, calendar_connection_id from booking where id = ${id}`);
  return row;
};
const jobRow = () => asOwner((sql) => sql`select desired, revision, attempts from booking_calendar_job`);
```

  c. Append:

```ts
describe('Calendar sync from the owner side', () => {
  it('starts the first attempt after the decision commits, without waiting for it', async () => {
    await connectGoogle();
    const id = await booking(inDays(2));
    const r = recorder();
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' }, true, r.execution);
    expect((await jsonOf<Json>(res)).booking.calendar.status).toBe('pending');
    expect(r.scheduled).toHaveLength(1);
    await Promise.all(r.scheduled);
    // This connection has no stored credential, so the attempt asks for a reconnect.
    expect(await calendarRow(id)).toMatchObject({ calendar_status: 'failed', calendar_error: CALENDAR_RECONNECT });

    const repeat = recorder();
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' }, true, repeat.execution);
    expect(repeat.scheduled).toHaveLength(0);
    const declined = await booking(inDays(3), { ref: 'QQQQQQ' });
    const d = recorder();
    await call('POST', `/api/apps/bookings/bookings/${declined}/decide`, ownerA, { decision: 'decline' }, true, d.execution);
    expect(d.scheduled).toHaveLength(0);
  });

  it('retries a failed sync once, leaves a queued one alone, and does nothing for finished work', async () => {
    await connectGoogle();
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    await asOwner(async (sql) => {
      await sql`update booking_calendar_job set attempts = 8, last_error = 'x'`;
      await sql`update booking set calendar_status = 'failed', calendar_error = 'x' where id = ${id}`;
    });
    const r = recorder();
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA, undefined, true, r.execution);
    expect(res.status).toBe(200);
    expect((await jsonOf<Json>(res)).booking.calendar.status).toBe('pending');
    expect(r.scheduled).toHaveLength(1);
    await Promise.all(r.scheduled);

    // Queued and not yet attempted: a second tap changes nothing.
    await asOwner((sql) => sql`update booking_calendar_job set attempts = 0, completed_revision = null`);
    const before = await jobRow();
    const twice = recorder();
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA, undefined, true, twice.execution)).status).toBe(200);
    expect(twice.scheduled).toHaveLength(0);
    expect(await jobRow()).toEqual(before);

    // Done: the event exists.
    await asOwner(async (sql) => {
      await sql`update booking_calendar_job set completed_revision = revision`;
      await sql`update booking set calendar_status = 'created', calendar_error = null where id = ${id}`;
    });
    const done = recorder();
    await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA, undefined, true, done.execution);
    expect(done.scheduled).toHaveLength(0);
    expect((await calendarRow(id)).calendar_status).toBe('created');
  });

  it('pins a Calendar connected after the booking was confirmed', async () => {
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA)).status).toBe(200);
    expect(await calendarRow(id)).toMatchObject({ calendar_status: 'not_connected', calendar_connection_id: null });
    expect(await jobRow()).toHaveLength(0);

    const [connection] = await connectGoogle();
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA);
    expect((await jsonOf<Json>(res)).booking.calendar.status).toBe('pending');
    expect(await calendarRow(id)).toMatchObject({ calendar_status: 'pending', calendar_connection_id: connection.id });
    expect(await jobRow()).toEqual([{ desired: 'present', revision: 1, attempts: 0 }]);
  });

  it('refuses retry for bookings that cannot have an event, and cleanup whose connection is gone', async () => {
    const pending = await booking(inDays(2));
    const notRetryable = await call('POST', `/api/apps/bookings/bookings/${pending}/calendar/retry`, ownerA);
    expect(notRetryable.status).toBe(409);
    expect(await notRetryable.json()).toMatchObject({ code: 'NOT_RETRYABLE' });

    await connectGoogle();
    const id = await booking(inDays(3), { ref: 'QQQQQQ' });
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    await asOwner(async (sql) => {
      await sql`update booking_calendar_job set completed_revision = revision`;
      await sql`update booking set calendar_status = 'created' where id = ${id}`;
      await sql`delete from connection`;   // the pin becomes null
    });
    await call('POST', `/api/apps/bookings/bookings/${id}/cancel`, ownerA);
    expect(await processBookingCalendarJob(ENV, A, id)).toBe('failed');
    expect((await calendarRow(id)).calendar_error).toBe(CALENDAR_DISCONNECTED_CLEANUP);
    const refused = await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'CALENDAR_DISCONNECTED' });
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, staffA)).status).toBe(403);
  });

  it('clears an old Calendar error when a cancel queues cleanup', async () => {
    await connectGoogle();
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    await asOwner((sql) => sql`update booking set calendar_status = 'failed',
      calendar_error = 'Google Calendar could not complete that request (500).' where id = ${id}`);
    const r = recorder();
    await call('POST', `/api/apps/bookings/bookings/${id}/cancel`, ownerA, undefined, true, r.execution);
    expect(r.scheduled).toHaveLength(1);
    expect(await calendarRow(id)).toMatchObject({ calendar_status: 'pending', calendar_error: null });
    await Promise.all(r.scheduled);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
pnpm exec vitest run test/apps-bookings-route.test.ts
```

Expected:
- The new tests FAIL: the retry path answers 404, and nothing is scheduled.
- The existing tests still pass.

- [ ] **Step 3: Update `worker/src/apps/bookings/bookings.ts`.**

  a. Add `import { CALENDAR_MAX_ATTEMPTS } from './calendar-sync';` to the
  imports.

  b. Replace `DecideResult` with:

```ts
export type DecideResult =
  | { ok: true; row: BookingRow; changed: boolean; calendarQueued: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_DECIDED' | 'EXPIRED' | 'NOT_RETRYABLE' | 'CALENDAR_DISCONNECTED' };
```

  c. In `cancelBooking`, replace the `update booking … returning` statement
  with:

```ts
  const [updated] = await tx<BookingRow[]>`update booking
    set status = 'cancelled', cancelled_at = ${now}, cancelled_by = ${userId},
        calendar_status = ${eventMayExist ? 'pending' : row.calendar_status},
        calendar_error = ${eventMayExist ? null : row.calendar_error}
    where business_id = ${businessId} and id = ${id} and status = 'confirmed'
    returning ${tx(COLUMNS)}`;
```

  d. Append after `cancelBooking`:

```ts
/** The owner's retry: queue the Calendar state the booking should be in
    again, but only when nothing is already on its way. A queued or in-flight
    job keeps its backoff; a finished one is left alone. */
export async function retryCalendar(
  tx: postgres.TransactionSql,
  businessId: string,
  id: string,
  now: Date,
): Promise<DecideResult> {
  const row = await lockForChange(tx, businessId, id);
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (row.status !== 'confirmed' && row.status !== 'cancelled') return { ok: false, code: 'NOT_RETRYABLE' };
  const desired = row.status === 'confirmed' ? 'present' : 'absent';
  const unchanged: DecideResult = { ok: true, row, changed: false, calendarQueued: false };
  const [job] = await tx<{ revision: number; completed_revision: number | null; attempts: number }[]>`
    select revision, completed_revision, attempts from booking_calendar_job
     where business_id = ${businessId} and booking_id = ${id} for update`;
  if (job && job.completed_revision !== job.revision && job.attempts < CALENDAR_MAX_ATTEMPTS) return unchanged;
  if (job && job.completed_revision === job.revision && row.calendar_status !== 'failed') return unchanged;
  const [pin] = await tx<{ calendar_connection_id: string | null }[]>`
    select calendar_connection_id from booking where business_id = ${businessId} and id = ${id}`;
  let connectionId = pin.calendar_connection_id;
  if (!job) {
    // No job means no event could exist: a cancel has nothing to clean, and
    // only a booking confirmed while nothing was connected can be added now.
    if (desired === 'absent' || row.calendar_status !== 'not_connected') return unchanged;
    const connection = await findConnection(tx, GOOGLE_CALENDAR_CONNECTOR);
    if (!connection) return unchanged;
    connectionId = connection.id;
  } else if (!connectionId) {
    // The account this booking used is gone; never switch to another one.
    return { ok: false, code: 'CALENDAR_DISCONNECTED' };
  }
  const [updated] = await tx<BookingRow[]>`update booking
    set calendar_status = 'pending', calendar_error = null, calendar_connection_id = ${connectionId}
    where business_id = ${businessId} and id = ${id}
    returning ${tx(COLUMNS)}`;
  await queueCalendarJob(tx, businessId, id, desired, now);
  return { ok: true, row: updated, changed: true, calendarQueued: true };
}
```

- [ ] **Step 4: Update `worker/src/routes/apps.ts`.**

  a. Add `retryCalendar` to the `../apps/bookings/bookings` import, and add
  `import { runCalendarJob } from '../apps/bookings/calendar-sync';`.

  b. Change the `handleApps` signature to:

```ts
export async function handleApps(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  execution?: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response | null> {
```

  c. Replace everything from the `const match = url.pathname.match(…)` line
  through the end of the `if (action && request.method === 'POST') { … }`
  block with:

```ts
    const match = url.pathname.match(/^\/api\/apps\/bookings\/bookings\/([0-9a-f-]{36})(?:\/(decide|cancel|calendar\/retry))?$/i);
    if (!match) return notFound(cors);
    const [, id, action] = match;

    if (!action && request.method === 'GET') {
      const found = await withTenant(env, businessId, async (tx) => {
        const ctx = await context(tx);
        const row = ctx ? await getBooking(tx, businessId, id) : null;
        return ctx && row ? bookingJson(row, ctx) : null;
      });
      return found ? json({ ok: true, booking: found }, {}, cors) : notFound(cors);
    }

    if (action && request.method === 'POST') {
      let decision: 'confirm' | 'decline' | null = null;
      if (action === 'decide') {
        const body = (await request.json().catch(() => null)) as { decision?: unknown } | null;
        decision = body?.decision === 'confirm' || body?.decision === 'decline' ? body.decision : null;
        if (!decision) return json({ ok: false, err: 'decision must be confirm or decline' }, { status: 400 }, cors);
      }
      const outcome = await withTenant(env, businessId, async (tx) => {
        const ctx = await context(tx);
        if (!ctx) return { ok: false as const, code: 'NOT_FOUND' as const };
        const result = decision
          ? await decideBooking(tx, businessId, id, decision, identity.userId, now)
          : action === 'cancel'
            ? await cancelBooking(tx, businessId, id, identity.userId, now)
            : await retryCalendar(tx, businessId, id, now);
        return result.ok
          ? { ok: true as const, booking: bookingJson(result.row, ctx), calendarQueued: result.calendarQueued }
          : result;
      });
      if (!outcome.ok) {
        return outcome.code === 'NOT_FOUND' ? notFound(cors)
          : json({ ok: false, code: outcome.code }, { status: 409 }, cors);
      }
      /* The transaction has committed: start the first Calendar attempt now,
         in this invocation near the database, without holding the answer for
         it. The minute cron is the backstop if this never runs. */
      if (outcome.calendarQueued) execution?.waitUntil(runCalendarJob(env, businessId, id));
      return json({ ok: true, booking: outcome.booking, whatsappUrl: outcome.booking.whatsappUrl }, {}, cors);
    }
```

- [ ] **Step 5: Pass `waitUntil` from the Worker.** In `worker/src/index.ts`,
  change `const apps = await handleApps(request, env, url, headers);` to:

```ts
    const apps = await handleApps(request, env, url, headers, {
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
```

- [ ] **Step 6: Run the tests.**

```bash
pnpm exec vitest run test/apps-bookings-route.test.ts test/apps-calendar-sync.test.ts test/cors.test.ts
```

Expected: all pass.
- `cors.test.ts` scans the routes against the CORS lists. The new route is a
  POST, which both lists already allow.
- If a new test is flaky, the likely cause is a scheduled promise still
  running when `truncateAll` starts. Every test above awaits what it
  schedules. Keep it that way.

- [ ] **Step 7: Typecheck and commit.**

```bash
pnpm typecheck
git add src/apps/bookings/bookings.ts src/routes/apps.ts src/index.ts test/apps-bookings-route.test.ts
git commit -m "feat(worker): the first Calendar attempt starts after the owner's tap commits, and the owner can retry"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run the whole worker suite and both typecheck passes.**

```bash
cd ~/.agent-worktree/workspaces/aisar-site-b726b8/bookings-v1/worker && pnpm typecheck && pnpm test 2>&1 | tail -8
```

Expected: everything passes.
- If an unrelated file fails, re-run it alone first.
- If many unrelated files fail at once, compare the Docker VM clock with the
  host's before anything else: `docker run --rm alpine date -u +%s` against
  `date -u +%s`.

- [ ] **Step 2: Record progress.** In
  `docs/plans/2026-09-23-apps-shell-and-bookings-v1.md`, directly under the
  `Plan 2 (public pages) built …` line, add:

```
Plan 3 (durable Calendar sync) built on branch bookings-v1: <last commit>. Before release: run the deleted-id experiment in "Calendar deleted-id verification" against a disposable test calendar.
```

  Commit it by named path.
