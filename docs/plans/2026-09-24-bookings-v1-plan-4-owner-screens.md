# Bookings v1, plan 4: owner screens

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner of a pilot business sees Bookings in the Jentera app and
runs it from there:
- sets up the booking page and shares its link;
- confirms, declines and cancels requests, then sends the prepared WhatsApp
  message;
- sees Google Calendar state and retries it;
- opens a booking straight from its notification.

Home shows the business's apps in place of the four action tiles, with Alerts
moving to a bell in the top bar. Setup, the link, confirming and the Calendar
all stay inside the app. The last task writes the feature's documentation.

**Architecture:**
- **Data:** a remote-only `apps` API on the repository
  (`app/src/lib/apps/`), discovered through `/api/me`
  (`features.apps.apiVersion === 1`) like Routines. It uses its own `call()`,
  so the Worker's error codes reach the screen.
- **Shared state:** one `AppsProvider` inside `Dashboard` holds the installed
  apps and the pending requests. Home, the bell, the daily brief and the
  Bookings screen all read it and refresh it.
- **Screens:**
  - `view=apps` renders `AppsView`.
  - `view=apps&app=bookings` renders `BookingsApp`, with three tabs
    (Bookings, Booking page, Settings).
  - `view=apps&app=bookings&booking=<id>` is the deep link that
    notifications already carry.

**Tech stack:** React 19 with react-router, Vite, TypeScript, Phosphor icons,
and the app's own `@/components/ui`. Tests use Vitest with Testing Library.
The Worker is Cloudflare Workers with Vitest and Docker Postgres.

**Spec:**
- [`docs/plans/2026-09-23-apps-shell-and-bookings-v1.md`](2026-09-23-apps-shell-and-bookings-v1.md):
  - "App (`app/`)"
  - the App part of "Tests"
  - "Documentation to update in the same change"
- Plan 3's "As built" notes, at the end of
  [`2026-09-24-bookings-v1-plan-3-calendar-sync.md`](2026-09-24-bookings-v1-plan-3-calendar-sync.md),
  list what this plan must honour. Each note maps to a task or a Global
  Constraint here.

**Branch:** `bookings-v1`, in the worktree at
`~/.agent-worktree/workspaces/aisar-site-b726b8/bookings-v1`. Never merge,
push or deploy.

## Global constraints

- **Never visible to people who must not see it.**
  - The anonymous demo: `LocalRepository` has no `apps`.
  - A business off the pilot list: `/api/me` sends no `features.apps`.
  - Staff: the Worker sends `features.apps` to owners only.
  - A view appears only when `useAppsEnabled() && !!repository.apps`, the
    same double check as Routines (`Dashboard.tsx`).
- **The notification link is fixed.** The Worker already writes
  `/app?view=apps&app=bookings&booking=<id>` into every `booking_requested`
  notification and push. The app must open exactly that.
- **Strings.** Every visible string lives in `app/src/i18n/pages.ts`, in both
  `en` and `bm`, with `{name}` placeholders. English and Malay are in exact
  parity today (1146 keys each), and Task 11 adds a test that keeps them so.
- **Components.**
  - Use `<Button>` from `@/components/ui`, never a bare `.btn`. Anchors that
    look like buttons write out `btn btn-outline` in full.
  - Never put `text-*` or `py-*` on a `.btn` or `.input`.
  - Booleans are a plain `<input type="checkbox">` inside a `<label>`, as in
    `RoutinesView`.
  - A destructive confirmation is `window.confirm(t(…))`, as in
    `BusinessBrowser`.
  - There is no shared dialog, switch or badge component. Do not invent one.
- **Calendar state is shown from `calendar.status`, `calendar.reason` and
  `calendar.canRetry`,** never by matching the English `calendar.error`.
- **Text never claims more than happened.**
  - "Removed from Google Calendar" appears only when `calendar.status` is
    `removed`.
  - A WhatsApp link is a link the owner taps, never "sent".
  - Playbook figures never appear to a signed-in owner.
- **Motion and accessibility.** Keep `prefers-reduced-motion` handling and
  accessibility labels. Every icon-only button has an `aria-label`.
- **Time.** Show every time in Malaysian time (`BUSINESS_TIME_ZONE` from
  `@/lib/daily-brief`). A "day" is `malaysiaDay(date)`.
- **Tests.**
  - Run app tests from `app/`: `pnpm exec vitest run <files>` for single
    files, then `pnpm test`, `pnpm typecheck` and `pnpm build`.
  - The `app/` suite can flake under full-suite load (`workspace-modes`, the
    routine gates). Re-run the file alone before blaming a change.
  - Worker tests need Docker. Check the Docker VM clock first:
    `docker run --rm alpine date -u +%s` against `date -u +%s`.
- **Git.** Stage named paths only. Every commit ends with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Coordination.** Another session is changing
  `app/src/lib/notifications.ts` on `main`, adding a `KINDS` const and
  `work_finished`. This plan edits the same file, so expect a small merge
  conflict at release, and keep both kinds.

## Review focus

1. **An owner taps a push for a request about 60 days out.** The booking
   opens at once, even though it lies outside today's list.
   (Task 7, deep-link test. Task 8, the Dashboard deep-link test.)
2. **The answer to a confirm is lost on a bad connection.** The card shows
   the booking as the server now holds it, with its WhatsApp link, and does
   not offer Confirm again. (Task 7, lost-answer test.)
3. **A second device decides first.** The first device gets "Already
   decided" and the current state, not an error with a stale card.
   (Task 7, 409 test.)
4. **The owner edits settings on two devices.** The second save gets a clear
   "changed elsewhere" message and a Reload, never a silent overwrite.
   (Task 5, stale-version test. Task 6, the switch test.)
5. **A cancelled booking whose event is still being removed.** The card says
   Cancelled and "Removing from Google Calendar", and never "Removed" until
   removal is confirmed. (Task 3, `calendarTag` test. Task 7, the card test.)

## Decisions made in this plan

Each of these settles something the spec left open or assumed differently.
Each is recorded where it is built.

- **Apps uses its own `call()`** (Task 2), not `remote.ts`'s shared
  `call<T>`. The shared one drops the Worker's error `code`, and the screens
  need it (`CONFIG_CHANGED`, `ALREADY_DECIDED`, …). Routines does the same.
- **No embedded preview of the customer page** (Task 6). The sites deploy
  sends `frame-ancestors 'none'`, so the tab lists what customers choose
  from and links to the real page.
- **Needs you scans 91 Malaysian days** (Task 3): today plus the longest
  horizon. Needs you therefore never depends on the business's current
  horizon setting.
- **The retrying job's `last_error` is not shown** (plan 3's open question).
  A syncing booking reads "Syncing" until it succeeds or fails, up to about
  2 hours, and then shows its reason. Showing interim errors can come later
  if owners ask.
- **A link to apps that are off opens Home** (Task 4, test). This is the
  "safe fallback for a disabled feature".
- **Cancel confirms with `window.confirm`**, as other destructive actions in
  the app do (Task 7).

---

## File structure

**Worker (Task 1):**
- `worker/src/apps/bookings/bookings.ts`: `canRetry` rules.
- `worker/src/connectors/google-calendar.ts`: one more transient reason.
- `worker/src/index.ts` and `worker/src/apps/bookings/calendar-sync.ts`: two
  comments.

**App data (Tasks 2–3), new:**
- `app/src/lib/apps/types.ts`
- `app/src/lib/apps/api.ts`
- `app/src/lib/apps/bookings.ts`, holding the pure helpers
- `app/src/lib/apps/useApps.tsx`, holding the provider
- `app/src/lib/apps/__tests__/fixtures.ts`

**App data, modified:**
- `app/src/lib/repo/types.ts`, `remote.ts` and `gate.tsx`

**Screens (Tasks 4–10), new:**
- `app/src/routes/views/AppsView.tsx`
- `app/src/routes/views/apps/BookingsApp.tsx`
- `app/src/routes/views/apps/BookingsSettings.tsx`
- `app/src/routes/views/apps/BookingPage.tsx`
- `app/src/routes/views/apps/BookingsList.tsx`
- `app/src/routes/views/apps/BookingCard.tsx`
- `app/src/components/AlertsBell.tsx`
- `app/src/components/BookingsNeedsYou.tsx`

**Screens, modified:**
- `app/src/routes/Dashboard.tsx`
- `app/src/components/Icon.tsx`
- `app/src/routes/views/HomeView.tsx`
- `app/src/components/DailyBrief.tsx`
- `app/src/lib/notifications.ts`
- `app/src/routes/views/NotificationsView.tsx`
- `app/src/i18n/pages.ts`
- `app/src/styles/dashboard.css`

**Docs (Task 11):**
- `CLAUDE.md`
- `docs/architecture.md`
- `docs/todo.md`
- the spec's status line

---

## Task 0: Workspace (controller)

- [ ] **Step 1:** Confirm the tree is clean on `bookings-v1`, and that the
  app suite, typecheck and build pass as a baseline.

```bash
cd ~/.agent-worktree/workspaces/aisar-site-b726b8/bookings-v1
git status --short && git log --oneline -1
cd app && pnpm typecheck && pnpm test 2>&1 | tail -5
```

Expected: a clean tree and a passing suite. If a file flakes, re-run it
alone.

---

## Task 1: Worker follow-ups from plan 3

**Files:**
- Modify: `worker/src/apps/bookings/bookings.ts`
  - `BookingRow` and `COLUMNS` gain `calendar_account`;
  - the `canRetry` expression in `bookingJson`.
- Modify: `worker/src/connectors/google-calendar.ts`: `RATE_LIMIT_REASONS`.
- Modify: `worker/src/index.ts`: the comment above the Calendar sweep block.
- Modify: `worker/src/apps/bookings/calendar-sync.ts`: the comment on
  `SWEEP_TIME_BUDGET_MS`.
- Test: `worker/test/apps-bookings-route.test.ts`
- Test: `worker/test/google-calendar.test.ts`

**Interfaces:**
- **Produces:**
  - `BookingJson.calendar.canRetry` is true only where a retry can work:
    - status `failed`, except when the reason is `removed_in_google`, or the
      reason is `disconnected` with no recorded Google account;
    - status `not_connected` on a confirmed booking.
  - A 403 `dailyLimitExceeded` from Google is transient.
- `calendar_account` (the Google subject) is read for the rule but never put
  into the JSON.

- [ ] **Step 1: Write the failing tests.**
  - If the `Json` type at the top of `worker/test/apps-bookings-route.test.ts`
    types `calendar` as `{ status: string }`, widen it to
    `{ status: string; reason?: string | null; canRetry?: boolean; account?: string | null }`.
  - Append:

```ts
describe('Calendar retry offer', () => {
  it('offers retry only where it can work', async () => {
    const cancelled = await booking(inDays(2), { status: 'cancelled' });
    await asOwner((sql) => sql`update booking set calendar_status = 'not_connected' where id = ${cancelled}`);
    const a = await jsonOf<Json>(await call('GET', `/api/apps/bookings/bookings/${cancelled}`, ownerA));
    expect(a.booking.calendar).toMatchObject({ status: 'not_connected', canRetry: false });

    const lost = await booking(inDays(3), { status: 'confirmed', ref: 'QQQQQQ' });
    await asOwner((sql) => sql`update booking set calendar_status = 'failed', calendar_reason = 'disconnected',
      calendar_account = null where id = ${lost}`);
    const b = await jsonOf<Json>(await call('GET', `/api/apps/bookings/bookings/${lost}`, ownerA));
    expect(b.booking.calendar).toMatchObject({ status: 'failed', reason: 'disconnected', canRetry: false });

    await asOwner((sql) => sql`update booking set calendar_account = 'google-subject-1' where id = ${lost}`);
    const c = await jsonOf<Json>(await call('GET', `/api/apps/bookings/bookings/${lost}`, ownerA));
    expect(c.booking.calendar.canRetry).toBe(true);
    expect(JSON.stringify(c)).not.toContain('google-subject-1');

    const waiting = await booking(inDays(4), { status: 'confirmed', ref: 'RRRRRR' });
    await asOwner((sql) => sql`update booking set calendar_status = 'not_connected' where id = ${waiting}`);
    const d = await jsonOf<Json>(await call('GET', `/api/apps/bookings/bookings/${waiting}`, ownerA));
    expect(d.booking.calendar.canRetry).toBe(true);
  });
});
```

  - In `worker/test/google-calendar.test.ts`, inside
    `describe('Google Calendar budget and removal', …)`, directly after the
    test "reads a rate-limit 403 as busy and any other 403 as a reconnect",
    add:

```ts
  it('reads a daily quota 403 as busy too', async () => {
    const daily = google(() => Response.json({ error: { errors: [{ reason: 'dailyLimitExceeded' }] } }, { status: 403 }));
    await expect(createGoogleCalendarEvent(env, secret, event, daily.fetcher))
      .rejects.toMatchObject({ auth: false, message: 'Google Calendar is busy. Jentera will try again.' });
  });
```

- [ ] **Step 2: Run the tests and confirm they fail.**

```bash
cd worker && pnpm exec vitest run test/apps-bookings-route.test.ts test/google-calendar.test.ts
```

Expected: FAIL. `canRetry` is true for the cancelled `not_connected` booking,
and `dailyLimitExceeded` reads as auth.

- [ ] **Step 3: Implement.**
  - In `bookings.ts`:
    - Add `calendar_account: string | null;` to `BookingRow`.
    - Add `'calendar_account'` to `COLUMNS`, beside `'calendar_account_label'`.
    - Replace the `canRetry` expression in `bookingJson` with the block
      below. Keep `account: row.calendar_account_label` as it is; the subject
      itself never goes into the JSON.

```ts
      canRetry: (row.calendar_status === 'failed' && row.calendar_reason !== 'removed_in_google'
          && !(row.calendar_reason === 'disconnected' && row.calendar_account === null))
        || (row.calendar_status === 'not_connected' && row.status === 'confirmed'),
```

  - In `google-calendar.ts`, add `'dailyLimitExceeded'` to the
    `RATE_LIMIT_REASONS` set.
  - In `index.ts`, the Calendar sweep comment says it "may take up to its
    40-second budget". Change that to: the sweep stops *starting* jobs after
    40 seconds, and a job already started may run past that. Leases make an
    overlapping tick safe.
  - In `calendar-sync.ts`, make the comment on `SWEEP_TIME_BUDGET_MS` say the
    same. Drop the claim that it cannot keep one tick running into the next.

- [ ] **Step 4: Run the tests.**

```bash
pnpm exec vitest run test/apps-bookings-route.test.ts test/google-calendar.test.ts test/apps-calendar-sync.test.ts
```

Expected: all pass.

- [ ] **Step 5: Typecheck and commit.**

```bash
pnpm typecheck
git add src/apps/bookings/bookings.ts src/connectors/google-calendar.ts src/index.ts src/apps/bookings/calendar-sync.ts test/apps-bookings-route.test.ts test/google-calendar.test.ts
git commit -m "fix(worker): offer Calendar retry only where it can work; a daily quota retries"
```

---

## Task 2: The apps API, and discovery

**Files:**
- Create: `app/src/lib/apps/types.ts`
- Create: `app/src/lib/apps/api.ts`
- Modify: `app/src/lib/repo/types.ts`: add the `apps?` member next to
  `routines?`.
- Modify: `app/src/lib/repo/remote.ts`: add `MeResponse.features.apps`, and
  `readonly apps` on `RemoteRepository`.
- Modify: `app/src/lib/repo/gate.tsx`:
  - `AppsContext` and `useAppsEnabled`;
  - `appsVersion` in `Chosen`, `SignedInProvider`, `choose()` and
    `RepositoryGate`.
- Test: `app/src/lib/apps/__tests__/api.test.ts`
- Test: `app/src/lib/repo/__tests__/gate-apps.test.tsx`

**Interfaces:**
- **Produces:**
  - All of `types.ts`, as written below.
  - `AppsError(code, status, uncertain, serviceId, message)`.
  - `RemoteAppsApi implements AppsApi`.
  - `Repository.apps?: AppsApi`.
  - `useAppsEnabled(): boolean`.
  - `SignedInProvider`'s new `appsVersion?: number` prop.
- **Worker response shapes, as served on this branch:**
  - `GET /api/apps` returns `{ ok, apps: InstalledApp[], available: ['bookings'] }`.
  - `GET` and `PUT /api/apps/bookings/config` return
    `{ ok, config: BookingsConfig }`.
  - `GET …/bookings?from&days&status&cursor&limit` returns
    `{ ok, bookings, nextCursor }`.
  - `GET …/bookings/:id` returns `{ ok, booking }`.
  - `POST …/:id/decide|cancel|calendar/retry` returns
    `{ ok, booking, whatsappUrl, calendarQueued }`.
  - Failures:
    - 409 `{ ok:false, code, serviceId? }`;
    - 400 `{ ok:false, err }` or `{ ok:false, code:'ACK_REQUIRED' }`;
    - 404 `{ ok:false, err:'not found' }`.

- [ ] **Step 1: Write the failing tests.**

`app/src/lib/apps/__tests__/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppsError, RemoteAppsApi } from '../api';

const ID = '11111111-1111-4111-8111-111111111111';
const BOOKING = {
  id: ID, reference: 'K7Q2MP', serviceId: '22222222-2222-4222-8222-222222222222', serviceName: 'Cupping class',
  startsAt: '2026-10-06T02:00:00.000Z', endsAt: '2026-10-06T03:00:00.000Z', partySize: 2, customerName: 'Aisyah',
  customerPhone: '60123456789', note: null, status: 'confirmed', expired: false, decidedAt: '2026-10-05T00:00:00.000Z',
  cancelledAt: null, calendar: { status: 'pending', error: null, reason: null, canRetry: false, account: null },
  whatsappUrl: 'https://wa.me/60123456789?text=Hi', createdAt: '2026-10-04T00:00:00.000Z',
};

function answer(status: number, body: unknown) {
  const fake = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fake);
  return fake;
}
afterEach(() => vi.unstubAllGlobals());

describe('RemoteAppsApi', () => {
  it('lists installed and available apps', async () => {
    answer(200, { ok: true, apps: [{ key: 'bookings', state: 'active', publicUrl: 'https://s.test/b/seido', pending: 2 }], available: ['bookings'] });
    expect(await new RemoteAppsApi().list()).toEqual({
      apps: [{ key: 'bookings', state: 'active', publicUrl: 'https://s.test/b/seido', pending: 2 }], available: ['bookings'],
    });
  });

  it('asks for a window of bookings with the filters in the query', async () => {
    const fake = answer(200, { ok: true, bookings: [BOOKING], nextCursor: 'next' });
    const page = await new RemoteAppsApi().bookings({ from: '2026-10-06', days: 31, status: 'pending', cursor: 'abc' });
    expect(page).toEqual({ bookings: [BOOKING], nextCursor: 'next' });
    const url = new URL(String(fake.mock.calls[0][0]), 'https://x.test');
    expect(url.pathname).toBe('/api/apps/bookings/bookings');
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: '2026-10-06', days: '31', limit: '50', status: 'pending', cursor: 'abc' });
    expect(fake.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
  });

  it('decides with a JSON body and says whether Calendar work was queued', async () => {
    const fake = answer(200, { ok: true, booking: BOOKING, whatsappUrl: BOOKING.whatsappUrl, calendarQueued: true });
    const result = await new RemoteAppsApi().decide(ID, 'confirm');
    expect(result).toEqual({ booking: BOOKING, whatsappUrl: BOOKING.whatsappUrl, calendarQueued: true });
    expect(String(fake.mock.calls[0][0])).toContain(`/api/apps/bookings/bookings/${ID}/decide`);
    expect(fake.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"decision":"confirm"}' });
  });

  it('keeps the Worker code of a refusal', async () => {
    answer(409, { ok: false, code: 'ALREADY_DECIDED' });
    await expect(new RemoteAppsApi().decide(ID, 'decline'))
      .rejects.toMatchObject({ name: 'AppsError', code: 'ALREADY_DECIDED', status: 409, uncertain: false });
  });

  it('carries the service a config refusal is about', async () => {
    answer(409, { ok: false, code: 'CAPACITY_BELOW_RESERVED', serviceId: 's-1' });
    await expect(new RemoteAppsApi().saveBookingsConfig({
      version: 3, slug: 'seido', accepting: true, minNoticeMinutes: 120, horizonDays: 30,
      acknowledgeAvailabilityLimits: true, services: [],
    })).rejects.toMatchObject({ code: 'CAPACITY_BELOW_RESERVED', serviceId: 's-1' });
  });

  it('marks a write that got no answer as uncertain, and a read as certain', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(new RemoteAppsApi().cancel(ID)).rejects.toMatchObject({ code: 'NETWORK', uncertain: true });
    await expect(new RemoteAppsApi().list()).rejects.toMatchObject({ code: 'NETWORK', uncertain: false });
  });

  it('refuses a malformed id without calling the server', async () => {
    const fake = answer(200, { ok: true });
    await expect(new RemoteAppsApi().booking('not-an-id')).rejects.toBeInstanceOf(AppsError);
    expect(fake).not.toHaveBeenCalled();
  });

  it('rejects a booking that is not what the Worker promises', async () => {
    answer(200, { ok: true, booking: { ...BOOKING, whatsappUrl: 'https://evil.test/' } });
    await expect(new RemoteAppsApi().booking(ID)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
```

`app/src/lib/repo/__tests__/gate-apps.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SignedInProvider, useAppsEnabled } from '../gate';

function Probe() {
  return <output>{useAppsEnabled() ? 'on' : 'off'}</output>;
}

describe('apps discovery', () => {
  it.each([
    [true, 1, 'on'],
    [true, 2, 'off'],
    [true, undefined, 'off'],
    [false, 1, 'off'],
  ] as const)('signed in %s with apiVersion %s reads %s', (value, appsVersion, expected) => {
    render(<SignedInProvider value={value} appsVersion={appsVersion}><Probe /></SignedInProvider>);
    expect(screen.getByRole('status')).toHaveTextContent(expected);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

```bash
cd app && pnpm exec vitest run src/lib/apps/__tests__/api.test.ts src/lib/repo/__tests__/gate-apps.test.tsx
```

Expected: FAIL.
- `Cannot find module '../api'`.
- `useAppsEnabled` is not exported.

- [ ] **Step 3: Create `app/src/lib/apps/types.ts`.**

```ts
/* Business apps, as the Worker serves them (worker/src/routes/apps.ts).
   Remote only: LocalRepository has no `apps`, so the anonymous demo never
   shows any of this. */

export type AppKey = 'bookings';

export interface InstalledApp {
  key: AppKey;
  state: 'active' | 'paused';
  publicUrl: string;
  /** Pending requests whose time has not started. */
  pending: number;
}

export interface AppsList {
  apps: InstalledApp[];
  available: AppKey[];
}

export type BookingStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled';
export type CalendarStatus = 'none' | 'pending' | 'created' | 'failed' | 'not_connected' | 'removed';
export type CalendarReason = 'reconnect' | 'disconnected' | 'removed_in_google' | 'unconfirmed' | 'provider';

export interface Booking {
  id: string;
  reference: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  partySize: number;
  customerName: string;
  customerPhone: string;
  note: string | null;
  status: BookingStatus;
  /** Pending, but its start has passed: it can no longer be confirmed. */
  expired: boolean;
  decidedAt: string | null;
  cancelledAt: string | null;
  calendar: {
    status: CalendarStatus;
    error: string | null;
    reason: CalendarReason | null;
    canRetry: boolean;
    /** The Google account's email, kept across a disconnect. */
    account: string | null;
  };
  /** A prefilled message the owner opens; never proof that anything was sent. */
  whatsappUrl: string | null;
  createdAt: string;
}

export interface BookingsPage {
  bookings: Booking[];
  nextCursor: string | null;
}

export interface BookingsQuery {
  /** A Malaysian date, YYYY-MM-DD. */
  from: string;
  /** 1–31 Malaysian days. */
  days: number;
  status?: 'pending';
  cursor?: string;
}

export interface BookingActionResult {
  booking: Booking;
  whatsappUrl: string | null;
  calendarQueued: boolean;
}

export interface WeeklyHours {
  /** 0 = Sunday. */
  weekday: number;
  opens: string;
  closes: string;
}

export interface BookingService {
  id: string;
  name: string;
  durationMinutes: number;
  capacity: number;
  priceLabel: string | null;
  active: boolean;
  hours: WeeklyHours[];
}

export interface BookingsConfig {
  installation: { slug: string; state: 'active' | 'paused'; publicUrl: string } | null;
  version: number | null;
  settings: { accepting: boolean; minNoticeMinutes: number; horizonDays: number; availabilityAcknowledgedAt: string } | null;
  services: BookingService[];
}

export interface BookingServiceInput extends Omit<BookingService, 'id'> {
  /** null for a service not saved yet. */
  id: string | null;
}

export interface BookingsConfigInput {
  version: number | null;
  slug: string;
  accepting: boolean;
  minNoticeMinutes: number;
  horizonDays: number;
  acknowledgeAvailabilityLimits: boolean;
  services: BookingServiceInput[];
}

export interface AppsApi {
  list(): Promise<AppsList>;
  bookingsConfig(): Promise<BookingsConfig>;
  saveBookingsConfig(input: BookingsConfigInput): Promise<BookingsConfig>;
  bookings(query: BookingsQuery): Promise<BookingsPage>;
  booking(id: string): Promise<Booking>;
  decide(id: string, decision: 'confirm' | 'decline'): Promise<BookingActionResult>;
  cancel(id: string): Promise<BookingActionResult>;
  retryCalendar(id: string): Promise<BookingActionResult>;
}
```

- [ ] **Step 4: Create `app/src/lib/apps/api.ts`.**

```ts
import type {
  AppsApi, AppsList, Booking, BookingActionResult, BookingsConfig, BookingsConfigInput, BookingsPage, BookingsQuery,
} from './types';

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A failed apps request, keeping what the screen needs to explain it:
    the Worker's code (CONFIG_CHANGED, ALREADY_DECIDED, …, or NETWORK /
    NOT_FOUND / INVALID_RESPONSE / REQUEST_FAILED), and whether a write may
    have happened although no answer arrived. The shared `call<T>` in
    remote.ts drops the code, so apps has its own, like Routines. */
export class AppsError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 0,
    public readonly uncertain = false,
    public readonly serviceId: string | null = null,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AppsError';
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

async function call(path: string, write?: { method: 'POST' | 'PUT'; body: unknown }): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/apps${path}`, {
      method: write?.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      ...(write ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(write.body) } : {}),
    });
  } catch {
    throw new AppsError('NETWORK', 0, write !== undefined);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !object(data) || data.ok !== true) {
    const body = object(data) ? data : {};
    throw new AppsError(
      typeof body.code === 'string' ? body.code : response.status === 404 ? 'NOT_FOUND' : 'REQUEST_FAILED',
      response.status,
      write !== undefined && response.status >= 500,
      typeof body.serviceId === 'string' ? body.serviceId : null,
      typeof body.err === 'string' ? body.err : undefined,
    );
  }
  return data;
}

function isBooking(value: unknown): value is Booking {
  return object(value) && typeof value.id === 'string' && UUID.test(value.id)
    && typeof value.reference === 'string' && typeof value.customerName === 'string'
    && typeof value.serviceName === 'string'
    && typeof value.startsAt === 'string' && Number.isFinite(Date.parse(value.startsAt))
    && ['pending', 'confirmed', 'declined', 'cancelled'].includes(String(value.status))
    && typeof value.expired === 'boolean'
    && object(value.calendar) && typeof value.calendar.status === 'string'
    && typeof value.calendar.canRetry === 'boolean'
    && (value.whatsappUrl === null
      || (typeof value.whatsappUrl === 'string' && value.whatsappUrl.startsWith('https://wa.me/')));
}

function isConfig(value: unknown): value is BookingsConfig {
  return object(value) && Array.isArray(value.services)
    && (value.installation === null || (object(value.installation)
      && typeof value.installation.slug === 'string' && typeof value.installation.publicUrl === 'string'))
    && (value.version === null || Number.isInteger(value.version));
}

function bookingPath(id: string): string {
  if (!UUID.test(id)) throw new AppsError('NOT_FOUND', 404);
  return `/bookings/bookings/${encodeURIComponent(id)}`;
}

function action(data: Record<string, unknown>): BookingActionResult {
  if (!isBooking(data.booking) || typeof data.calendarQueued !== 'boolean') {
    throw new AppsError('INVALID_RESPONSE', 200, true);
  }
  return { booking: data.booking, whatsappUrl: data.booking.whatsappUrl, calendarQueued: data.calendarQueued };
}

export class RemoteAppsApi implements AppsApi {
  async list(): Promise<AppsList> {
    const data = await call('');
    if (!Array.isArray(data.apps) || !Array.isArray(data.available)) throw new AppsError('INVALID_RESPONSE');
    return { apps: data.apps as AppsList['apps'], available: data.available as AppsList['available'] };
  }

  async bookingsConfig(): Promise<BookingsConfig> {
    const data = await call('/bookings/config');
    if (!isConfig(data.config)) throw new AppsError('INVALID_RESPONSE');
    return data.config;
  }

  async saveBookingsConfig(input: BookingsConfigInput): Promise<BookingsConfig> {
    const data = await call('/bookings/config', { method: 'PUT', body: input });
    if (!isConfig(data.config)) throw new AppsError('INVALID_RESPONSE', 200, true);
    return data.config;
  }

  async bookings(query: BookingsQuery): Promise<BookingsPage> {
    const params = new URLSearchParams({
      from: query.from, days: String(query.days), limit: '50',
      ...(query.status ? { status: query.status } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    const data = await call(`/bookings/bookings?${params}`);
    if (!Array.isArray(data.bookings) || !data.bookings.every(isBooking)
      || !(data.nextCursor === null || typeof data.nextCursor === 'string')) {
      throw new AppsError('INVALID_RESPONSE');
    }
    return { bookings: data.bookings, nextCursor: data.nextCursor as string | null };
  }

  async booking(id: string): Promise<Booking> {
    const data = await call(bookingPath(id));
    if (!isBooking(data.booking)) throw new AppsError('INVALID_RESPONSE');
    return data.booking;
  }

  async decide(id: string, decision: 'confirm' | 'decline'): Promise<BookingActionResult> {
    return action(await call(`${bookingPath(id)}/decide`, { method: 'POST', body: { decision } }));
  }

  async cancel(id: string): Promise<BookingActionResult> {
    return action(await call(`${bookingPath(id)}/cancel`, { method: 'POST', body: {} }));
  }

  async retryCalendar(id: string): Promise<BookingActionResult> {
    return action(await call(`${bookingPath(id)}/calendar/retry`, { method: 'POST', body: {} }));
  }
}
```

  `bookingPath` throws synchronously. Inside an `async` method, that becomes
  a rejected promise, which is what the malformed-id test expects.

- [ ] **Step 5: Wire it into the repository and discovery.**
  - `app/src/lib/repo/types.ts`, in `Repository`, directly under
    `routines?: …`:

```ts
  /** Remote only; callers must also require /api/me apps discovery. */
  apps?: import('@/lib/apps/types').AppsApi;
```

  - `app/src/lib/repo/remote.ts`:
    - Add `apps?: { apiVersion?: number };` to `MeResponse.features`.
    - Add `import { RemoteAppsApi } from '@/lib/apps/api';`.
    - Add `readonly apps = new RemoteAppsApi();` in `RemoteRepository`,
      next to `readonly routines = …`.
  - `app/src/lib/repo/gate.tsx`:
    - Add `appsVersion?: number;` to `Chosen`.
    - Beside `TeamContext`, add:

```ts
/* Apps (Bookings) is a pilot. The Worker sends the flag to owners only, so
   staff never learn the feature exists. */
const AppsContext = createContext(false);

/** Discovery only: whether the apps pilot is on for this owner. */
export function useAppsEnabled(): boolean {
  return useContext(AppsContext);
}
```

    - Give `SignedInProvider` an `appsVersion?: number` prop, and nest
      `<AppsContext.Provider value={value && appsVersion === 1}>` inside
      `TeamContext.Provider`, around `{children}`.
    - In `choose()`'s final return, add
      `appsVersion: me?.features?.apps?.apiVersion,`.
    - In `RepositoryGate`, pass `appsVersion={chosen.appsVersion}` to
      `SignedInProvider`.

- [ ] **Step 6: Run the tests.**

```bash
pnpm exec vitest run src/lib/apps/__tests__/api.test.ts src/lib/repo/__tests__/gate-apps.test.tsx
```

Expected: all pass.

- [ ] **Step 7: Typecheck and commit.**

```bash
pnpm typecheck
git add src/lib/apps/types.ts src/lib/apps/api.ts src/lib/apps/__tests__/api.test.ts src/lib/repo/types.ts src/lib/repo/remote.ts src/lib/repo/gate.tsx src/lib/repo/__tests__/gate-apps.test.tsx
git commit -m "feat(app): an apps API that keeps the Worker's error codes, discovered from /api/me"
```

---

## Task 3: Shared apps state and booking helpers

**Files:**
- Create: `app/src/lib/apps/bookings.ts`
- Create: `app/src/lib/apps/useApps.tsx`
- Create: `app/src/lib/apps/__tests__/fixtures.ts`
- Test: `app/src/lib/apps/__tests__/bookings.test.ts`
- Test: `app/src/lib/apps/__tests__/useApps.test.tsx`

**Interfaces:**
- **Consumes:** Task 2's types, `AppsError`, and `malaysiaDay` and
  `BUSINESS_TIME_ZONE` from `@/lib/daily-brief`.
- **Produces, from `bookings.ts`:**
  - Constants: `WINDOW_DAYS = 31` and `PENDING_SCAN_DAYS = 91`.
  - Loading:
    - `addDays(date, n)`;
    - `loadWindow(api, query)` returns every page as `Booking[]`;
    - `loadPendingBookings(api, now)` returns the pending, not-expired
      requests across 91 Malaysian days from today, soonest first.
  - Labels:
    - `calendarTag(booking)` returns `{ key, tone } | null`;
    - `calendarReasonKey(reason)`;
    - `statusTag(booking)` returns `{ key, tone }`;
    - `whatsappKey(booking)` returns a key or null;
    - `actionErrorKey(error)` returns a key.
  - Formatting and grouping:
    - `bookingWhen(iso, lang)` returns e.g. "Tue 6 Oct, 10:00 am";
    - `groupByDay(bookings)` returns `[day, Booking[]][]`.
  - `configToInput(config)` returns `BookingsConfigInput`.
- **Produces, from `useApps.tsx`:**
  - `AppsProvider({ api, children })`.
  - `useApps()` returns `AppsState`:
    `{ enabled, api, list, pending, loading, error, refresh }`.
  - `useHomeApps()` returns `InstalledApp[] | null`. That is the installed
    apps when option B applies, otherwise null.
- **Produces, from `fixtures.ts`:** `bookingFixture(over)`,
  `configFixture(over)` and `fakeAppsApi(over)`, which later tasks' tests
  reuse.
- **Why `PENDING_SCAN_DAYS` is 91:** the longest horizon is 90 days, and the
  Worker's last bookable day is today plus the horizon, counting today as
  day 0. So a pending request can start up to 90 days out, which is 91
  Malaysian dates. That makes three windows: 31, 31 and 29 days.

- [ ] **Step 1: Create `app/src/lib/apps/__tests__/fixtures.ts`.**

```ts
import { vi } from 'vitest';
import type { AppsApi, Booking, BookingsConfig } from '../types';

export const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
export const SERVICE_ID = '22222222-2222-4222-8222-222222222222';

export function bookingFixture(over: Partial<Booking> = {}): Booking {
  return {
    id: BOOKING_ID, reference: 'K7Q2MP', serviceId: SERVICE_ID, serviceName: 'Cupping class',
    startsAt: '2026-10-06T02:00:00.000Z', endsAt: '2026-10-06T03:00:00.000Z', partySize: 2,
    customerName: 'Aisyah', customerPhone: '60123456789', note: null, status: 'pending', expired: false,
    decidedAt: null, cancelledAt: null,
    calendar: { status: 'none', error: null, reason: null, canRetry: false, account: null },
    whatsappUrl: null, createdAt: '2026-10-04T00:00:00.000Z',
    ...over,
  };
}

export function configFixture(over: Partial<BookingsConfig> = {}): BookingsConfig {
  return {
    installation: { slug: 'seido', state: 'active', publicUrl: 'https://sites.test/b/seido' },
    version: 3,
    settings: { accepting: true, minNoticeMinutes: 120, horizonDays: 30, availabilityAcknowledgedAt: '2026-10-01T00:00:00.000Z' },
    services: [{
      id: SERVICE_ID, name: 'Cupping class', durationMinutes: 60, capacity: 4, priceLabel: 'RM45', active: true,
      hours: [{ weekday: 2, opens: '10:00', closes: '13:00' }],
    }],
    ...over,
  };
}

/** Every method a vi.fn with a harmless default; override what a test needs. */
export function fakeAppsApi(over: Partial<{ [K in keyof AppsApi]: AppsApi[K] }> = {}) {
  const api = {
    list: vi.fn(async () => ({ apps: [], available: ['bookings' as const] })),
    bookingsConfig: vi.fn(async () => configFixture()),
    saveBookingsConfig: vi.fn(async () => configFixture()),
    bookings: vi.fn(async () => ({ bookings: [], nextCursor: null })),
    booking: vi.fn(async () => bookingFixture()),
    decide: vi.fn(async () => ({ booking: bookingFixture({ status: 'confirmed' }), whatsappUrl: null, calendarQueued: false })),
    cancel: vi.fn(async () => ({ booking: bookingFixture({ status: 'cancelled' }), whatsappUrl: null, calendarQueued: false })),
    retryCalendar: vi.fn(async () => ({ booking: bookingFixture({ status: 'confirmed' }), whatsappUrl: null, calendarQueued: true })),
    ...over,
  };
  return api as typeof api & AppsApi;
}
```

- [ ] **Step 2: Write the failing tests.**

`app/src/lib/apps/__tests__/bookings.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AppsError } from '../api';
import {
  actionErrorKey, addDays, bookingWhen, calendarReasonKey, calendarTag, configToInput, groupByDay,
  loadPendingBookings, loadWindow, statusTag, whatsappKey,
} from '../bookings';
import { bookingFixture, configFixture, fakeAppsApi } from './fixtures';
import type { BookingsQuery } from '../types';

describe('loading bookings', () => {
  it('follows cursors to the end of a window', async () => {
    const api = fakeAppsApi({
      bookings: vi.fn()
        .mockResolvedValueOnce({ bookings: [bookingFixture({ id: '11111111-1111-4111-8111-000000000001' })], nextCursor: 'c1' })
        .mockResolvedValueOnce({ bookings: [bookingFixture({ id: '11111111-1111-4111-8111-000000000002' })], nextCursor: null }),
    });
    const rows = await loadWindow(api, { from: '2026-10-06', days: 1 });
    expect(rows.map((b) => b.id.slice(-1))).toEqual(['1', '2']);
    expect(api.bookings).toHaveBeenLastCalledWith({ from: '2026-10-06', days: 1, cursor: 'c1' });
  });

  it('scans 91 Malaysian days for pending requests the owner can still decide, soonest first', async () => {
    const later = bookingFixture({ id: '11111111-1111-4111-8111-00000000000a', startsAt: '2026-12-01T02:00:00.000Z' });
    const sooner = bookingFixture({ id: '11111111-1111-4111-8111-00000000000b', startsAt: '2026-10-07T02:00:00.000Z' });
    const expired = bookingFixture({ id: '11111111-1111-4111-8111-00000000000c', expired: true });
    const api = fakeAppsApi({
      bookings: vi.fn(async ({ from }: BookingsQuery) => ({
        bookings: from === '2026-11-05' ? [later] : from === '2026-10-05' ? [sooner, expired] : [],
        nextCursor: null,
      })),
    });
    // 20:00 UTC on 4 Oct is 04:00 on 5 Oct in Malaysia.
    const rows = await loadPendingBookings(api, new Date('2026-10-04T20:00:00Z'));
    expect(api.bookings.mock.calls.map(([q]) => [q.from, q.days, q.status])).toEqual([
      ['2026-10-05', 31, 'pending'], ['2026-11-05', 31, 'pending'], ['2026-12-06', 29, 'pending'],
    ]);
    expect(rows.map((b) => b.id.slice(-1))).toEqual(['b', 'a']);
  });

  it('adds days across a month end', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('labels', () => {
  it('tags Calendar state honestly, including cleanup still running after a cancel', () => {
    const tag = (over: Parameters<typeof bookingFixture>[0]) => calendarTag(bookingFixture(over));
    const cal = (status: string) => ({ status, error: null, reason: null, canRetry: false, account: null }) as never;
    expect(tag({ status: 'pending' })).toBeNull();
    expect(tag({ status: 'confirmed', calendar: cal('pending') })).toEqual({ key: 'bookings.calendar.syncing', tone: 'neutral' });
    expect(tag({ status: 'cancelled', calendar: cal('pending') })).toEqual({ key: 'bookings.calendar.removing', tone: 'neutral' });
    expect(tag({ status: 'confirmed', calendar: cal('created') })).toEqual({ key: 'bookings.calendar.added', tone: 'green' });
    expect(tag({ status: 'cancelled', calendar: cal('removed') })).toEqual({ key: 'bookings.calendar.removed', tone: 'neutral' });
    expect(tag({ status: 'confirmed', calendar: cal('not_connected') })).toEqual({ key: 'bookings.calendar.notConnected', tone: 'amber' });
    expect(tag({ status: 'confirmed', calendar: cal('failed') })).toEqual({ key: 'bookings.calendar.attention', tone: 'red' });
    expect(calendarReasonKey('removed_in_google')).toBe('bookings.calendar.reason.removed_in_google');
    expect(calendarReasonKey(null)).toBe('bookings.calendar.reason.provider');
  });

  it('names status and the WhatsApp action by what was decided', () => {
    expect(statusTag(bookingFixture())).toEqual({ key: 'bookings.status.needsYou', tone: 'amber' });
    expect(statusTag(bookingFixture({ expired: true }))).toEqual({ key: 'bookings.status.expired', tone: 'neutral' });
    expect(statusTag(bookingFixture({ status: 'confirmed' }))).toEqual({ key: 'bookings.status.confirmed', tone: 'green' });
    expect(whatsappKey(bookingFixture({ status: 'confirmed', whatsappUrl: 'https://wa.me/6012?text=x' }))).toBe('bookings.whatsapp.confirm');
    expect(whatsappKey(bookingFixture({ status: 'declined', whatsappUrl: 'https://wa.me/6012?text=x' }))).toBe('bookings.whatsapp.decline');
    expect(whatsappKey(bookingFixture({ status: 'cancelled', whatsappUrl: 'https://wa.me/6012?text=x' }))).toBe('bookings.whatsapp.cancel');
    expect(whatsappKey(bookingFixture({ status: 'confirmed', whatsappUrl: null }))).toBeNull();
  });

  it('explains a refused action by its code', () => {
    expect(actionErrorKey(new AppsError('ALREADY_DECIDED', 409))).toBe('bookings.error.alreadyDecided');
    expect(actionErrorKey(new AppsError('EXPIRED', 409))).toBe('bookings.error.expired');
    expect(actionErrorKey(new AppsError('CALENDAR_DISCONNECTED', 409))).toBe('bookings.error.calendarDisconnected');
    expect(actionErrorKey(new AppsError('NETWORK', 0, true))).toBe('bookings.error.uncertain');
    expect(actionErrorKey(new Error('boom'))).toBe('bookings.error.generic');
  });

  it('formats a time in Malaysia and groups by Malaysian day', () => {
    expect(bookingWhen('2026-10-06T02:00:00.000Z', 'en')).toMatch(/Tue.*6.*Oct.*10:00/);
    const late = bookingFixture({ id: '11111111-1111-4111-8111-00000000000d', startsAt: '2026-10-06T17:00:00.000Z' });
    expect(groupByDay([late, bookingFixture()]).map(([day, rows]) => [day, rows.length])).toEqual([['2026-10-06', 1], ['2026-10-07', 1]]);
  });

  it('turns a saved config back into a save request for the same version', () => {
    expect(configToInput(configFixture())).toEqual({
      version: 3, slug: 'seido', accepting: true, minNoticeMinutes: 120, horizonDays: 30,
      acknowledgeAvailabilityLimits: true,
      services: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Cupping class', durationMinutes: 60, capacity: 4,
        priceLabel: 'RM45', active: true, hours: [{ weekday: 2, opens: '10:00', closes: '13:00' }] }],
    });
  });
});
```

`app/src/lib/apps/__tests__/useApps.test.tsx`:

```tsx
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppsProvider, useApps, useHomeApps } from '../useApps';
import { bookingFixture, fakeAppsApi } from './fixtures';
import type { BookingsQuery } from '../types';

function Probe() {
  const apps = useApps();
  const home = useHomeApps();
  return <output>{JSON.stringify({ enabled: apps.enabled, apps: apps.list?.apps.length ?? null, pending: apps.pending?.length ?? null, home: home?.length ?? null })}</output>;
}

describe('AppsProvider', () => {
  it('stays off and silent without an API', () => {
    render(<AppsProvider api={null}><Probe /></AppsProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('{"enabled":false,"apps":null,"pending":null,"home":null}');
  });

  it('loads installed apps and pending requests, and refreshes when the app returns to the foreground', async () => {
    const api = fakeAppsApi({
      list: vi.fn(async () => ({ apps: [{ key: 'bookings' as const, state: 'active' as const, publicUrl: 'https://s.test/b/x', pending: 1 }], available: ['bookings' as const] })),
      bookings: vi.fn(async ({ from }: BookingsQuery) => ({ bookings: from ? [bookingFixture({ startsAt: new Date(Date.now() + 86_400_000).toISOString() })] : [], nextCursor: null })),
    });
    render(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":1'));
    expect(screen.getByRole('status')).toHaveTextContent('"home":1');
    expect(api.list).toHaveBeenCalledTimes(1);
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('keeps today\'s Home when nothing is installed', async () => {
    const api = fakeAppsApi();
    render(<AppsProvider api={api}><Probe /></AppsProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"apps":0'));
    expect(screen.getByRole('status')).toHaveTextContent('"home":null');
    expect(api.bookings).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them and confirm they fail.**

```bash
pnpm exec vitest run src/lib/apps/__tests__/bookings.test.ts src/lib/apps/__tests__/useApps.test.tsx
```

Expected: FAIL. The modules do not exist yet.

- [ ] **Step 4: Create `app/src/lib/apps/bookings.ts`.**

```ts
import { BUSINESS_TIME_ZONE, malaysiaDay } from '@/lib/daily-brief';
import { AppsError } from './api';
import type { AppsApi, Booking, BookingsConfig, BookingsConfigInput, BookingsQuery, CalendarReason } from './types';

/* What the Bookings screens need that is not a network call: loading every
   page of a window, the Needs you scan, and the words for each state. */

/** The Worker serves at most 31 Malaysian days per request. */
export const WINDOW_DAYS = 31;
/** Today plus the longest horizon (90 days), counting today as day 0. */
export const PENDING_SCAN_DAYS = 91;
/** A runaway cursor stops here rather than looping forever. */
const MAX_PAGES = 20;

export type Tone = 'neutral' | 'green' | 'red' | 'amber';

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Every booking in one window, following cursors to the end. */
export async function loadWindow(api: AppsApi, query: Omit<BookingsQuery, 'cursor'>): Promise<Booking[]> {
  const rows: Booking[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await api.bookings(cursor ? { ...query, cursor } : query);
    rows.push(...result.bookings);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return rows;
}

/** Requests waiting on the owner that can still be confirmed, soonest first. */
export async function loadPendingBookings(api: AppsApi, now: Date): Promise<Booking[]> {
  const today = malaysiaDay(now);
  const windows: Omit<BookingsQuery, 'cursor'>[] = [];
  for (let offset = 0; offset < PENDING_SCAN_DAYS; offset += WINDOW_DAYS) {
    windows.push({ from: addDays(today, offset), days: Math.min(WINDOW_DAYS, PENDING_SCAN_DAYS - offset), status: 'pending' });
  }
  const pages = await Promise.all(windows.map((query) => loadWindow(api, query)));
  const seen = new Set<string>();
  return pages.flat()
    .filter((booking) => booking.status === 'pending' && !booking.expired && !seen.has(booking.id) && Boolean(seen.add(booking.id)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** What the owner should know about the booking's Google Calendar event.
    "Removed" only once removal is confirmed; a cancel still cleaning up
    says so. */
export function calendarTag(booking: Booking): { key: string; tone: Tone } | null {
  switch (booking.calendar.status) {
    case 'none': return null;
    case 'pending':
      return booking.status === 'cancelled'
        ? { key: 'bookings.calendar.removing', tone: 'neutral' }
        : { key: 'bookings.calendar.syncing', tone: 'neutral' };
    case 'created': return { key: 'bookings.calendar.added', tone: 'green' };
    case 'removed': return { key: 'bookings.calendar.removed', tone: 'neutral' };
    case 'not_connected': return { key: 'bookings.calendar.notConnected', tone: 'amber' };
    case 'failed': return { key: 'bookings.calendar.attention', tone: 'red' };
  }
}

export function calendarReasonKey(reason: CalendarReason | null): string {
  return `bookings.calendar.reason.${reason ?? 'provider'}`;
}

export function statusTag(booking: Booking): { key: string; tone: Tone } {
  if (booking.status === 'pending') {
    return booking.expired ? { key: 'bookings.status.expired', tone: 'neutral' } : { key: 'bookings.status.needsYou', tone: 'amber' };
  }
  if (booking.status === 'confirmed') return { key: 'bookings.status.confirmed', tone: 'green' };
  return { key: `bookings.status.${booking.status}`, tone: 'neutral' };
}

/** The label for the prepared message, or null when there is none. */
export function whatsappKey(booking: Booking): string | null {
  if (!booking.whatsappUrl) return null;
  if (booking.status === 'confirmed') return 'bookings.whatsapp.confirm';
  if (booking.status === 'declined') return 'bookings.whatsapp.decline';
  if (booking.status === 'cancelled') return 'bookings.whatsapp.cancel';
  return null;
}

export function actionErrorKey(error: unknown): string {
  if (error instanceof AppsError) {
    switch (error.code) {
      case 'ALREADY_DECIDED': return 'bookings.error.alreadyDecided';
      case 'EXPIRED': return 'bookings.error.expired';
      case 'NOT_RETRYABLE': return 'bookings.error.notRetryable';
      case 'CALENDAR_DISCONNECTED': return 'bookings.error.calendarDisconnected';
      case 'NOT_FOUND': return 'bookings.error.notFound';
    }
    if (error.uncertain) return 'bookings.error.uncertain';
  }
  return 'bookings.error.generic';
}

export function bookingWhen(iso: string, lang: 'en' | 'bm'): string {
  return new Intl.DateTimeFormat(lang === 'bm' ? 'ms-MY' : 'en-MY', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(iso));
}

export function groupByDay(bookings: Booking[]): [string, Booking[]][] {
  const days = new Map<string, Booking[]>();
  for (const booking of [...bookings].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const day = malaysiaDay(new Date(booking.startsAt));
    days.set(day, [...(days.get(day) ?? []), booking]);
  }
  return [...days.entries()];
}

/** The saved settings as a save request for the same version. */
export function configToInput(config: BookingsConfig): BookingsConfigInput {
  return {
    version: config.version,
    slug: config.installation?.slug ?? '',
    accepting: config.settings?.accepting ?? true,
    minNoticeMinutes: config.settings?.minNoticeMinutes ?? 120,
    horizonDays: config.settings?.horizonDays ?? 30,
    acknowledgeAvailabilityLimits: config.settings !== null,
    services: config.services.map((service) => ({ ...service, hours: service.hours.map((range) => ({ ...range })) })),
  };
}
```

- [ ] **Step 5: Create `app/src/lib/apps/useApps.tsx`.**

```tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { loadPendingBookings } from './bookings';
import type { AppsApi, AppsList, Booking, InstalledApp } from './types';

/* One source for the business's apps, so Home, the bell, the daily brief and
   the Bookings screen agree. It loads when apps are on, again when the app
   returns to the foreground, and again after any change (refresh). */

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
const AppsContext = createContext<AppsState>(OFF);

export function AppsProvider({ api, children }: { api: AppsApi | null; children: ReactNode }) {
  const [list, setList] = useState<AppsList | null>(null);
  const [pending, setPending] = useState<Booking[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (!api) return;
    const mine = ++generation.current;
    setLoading(true);
    try {
      const next = await api.list();
      const installed = next.apps.some((app) => app.key === 'bookings');
      const nextPending = installed ? await loadPendingBookings(api, new Date()) : null;
      if (mine !== generation.current) return;
      setList(next);
      setPending(nextPending);
      setError(false);
    } catch {
      if (mine === generation.current) setError(true);
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api) {
      setList(null);
      setPending(null);
      return;
    }
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [api, refresh]);

  const value: AppsState = api ? { enabled: true, api, list, pending, loading, error, refresh } : OFF;
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

- [ ] **Step 6: Run the tests.**

```bash
pnpm exec vitest run src/lib/apps/__tests__/bookings.test.ts src/lib/apps/__tests__/useApps.test.tsx
```

Expected: all pass. The time-format regex allows for Intl variation, for
example "Tue, 6 Oct" or "Tue 6 Oct".

- [ ] **Step 7: Typecheck and commit.**

```bash
pnpm typecheck
git add src/lib/apps/bookings.ts src/lib/apps/useApps.tsx src/lib/apps/__tests__/fixtures.ts src/lib/apps/__tests__/bookings.test.ts src/lib/apps/__tests__/useApps.test.tsx
git commit -m "feat(app): one shared view of the business's apps and waiting requests"
```

---

## Task 4: Apps in navigation, and the Apps list

**Files:**
- Create: `app/src/routes/views/AppsView.tsx`
- Modify: `app/src/routes/Dashboard.tsx`:
  - `View`, `NAV` and the nav filtering;
  - wrap the workspace in `AppsProvider`;
  - the `view === 'apps'` render block.
- Modify: `app/src/components/Icon.tsx`: import `SquaresFour` and add
  `apps: SquaresFour` to `CHROME`.
- Modify: `app/src/i18n/pages.ts`: the keys below, in both `en` and `bm`.
- Test: `app/src/routes/views/__tests__/AppsView.test.tsx`
- Test: `app/src/components/__tests__/workspace-modes.test.tsx`

**Interfaces:**
- **Consumes:** `useAppsEnabled` (Task 2), and `AppsProvider` and `useApps`
  (Task 3).
- **Produces:**
  - `View` includes `'apps'`.
  - `AppsView({ onOpen })`, where `onOpen(params: Record<string, string>)`
    sets `view=apps` plus those params.
  - Dashboard reads the search params `app`, `booking` and `section` for
    `view=apps`, and passes `onOpen` down.
  - Task 8 adds the `app === 'bookings'` branch to `AppsView`. Until then,
    the list is all `AppsView` shows.
- **Navigation order:** the Apps item goes directly after `work`. With apps
  on, the phone bar reads Home · Activity · Chat · Apps · More, and Skills
  moves into More. With apps off, nothing changes.

**Strings**, added to `en` and `bm` in the same relative place (after the
`routines.*` block):

| Key | English | Malay |
|---|---|---|
| `nav.apps` | Apps | Aplikasi |
| `apps.title` | Apps | Aplikasi |
| `apps.intro` | Tools that run part of your business, connected to Jentera. | Alat yang menjalankan sebahagian perniagaan anda, bersambung dengan Jentera. |
| `apps.installed` | Your apps | Aplikasi anda |
| `apps.add.title` | Add an app | Tambah aplikasi |
| `apps.bookings.name` | Bookings | Tempahan |
| `apps.bookings.detail` | A booking page for your customers. You confirm each request with one tap. | Halaman tempahan untuk pelanggan anda. Anda sahkan setiap permintaan dengan satu ketikan. |
| `apps.setup` | Set up | Sediakan |
| `apps.open` | Open | Buka |
| `apps.pending` | {n} waiting | {n} menunggu |
| `apps.paused` | Paused | Dijeda |
| `apps.ready` | Your booking page is live | Halaman tempahan anda sudah aktif |
| `apps.loading` | Loading your apps… | Memuatkan aplikasi anda… |
| `apps.error` | Could not load your apps. | Tidak dapat memuatkan aplikasi anda. |
| `apps.retry` | Try again | Cuba lagi |
| `apps.none` | Every available app is set up. | Semua aplikasi yang ada sudah disediakan. |

- [ ] **Step 1: Write the failing tests.**

`app/src/routes/views/__tests__/AppsView.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AppsView from '../AppsView';
import { I18nProvider } from '@/i18n/I18nProvider';
import { AppsProvider } from '@/lib/apps/useApps';
import { fakeAppsApi } from '@/lib/apps/__tests__/fixtures';

function mount(api = fakeAppsApi()) {
  const onOpen = vi.fn();
  render(<I18nProvider><AppsProvider api={api}>
    <AppsView app={null} bookingId={null} section={null} onOpen={onOpen} onConnectCalendar={vi.fn()} />
  </AppsProvider></I18nProvider>);
  return { api, onOpen, user: userEvent.setup() };
}

describe('AppsView', () => {
  it('offers Bookings to set up when nothing is installed', async () => {
    const { onOpen, user } = mount();
    await user.click(await screen.findByRole('button', { name: /Set up/ }));
    expect(onOpen).toHaveBeenCalledWith({ app: 'bookings' });
    expect(screen.queryByRole('heading', { name: 'Your apps' })).toBeNull();
  });

  it('lists an installed app with its waiting requests, and does not offer it again', async () => {
    const api = fakeAppsApi({
      list: vi.fn(async () => ({ apps: [{ key: 'bookings' as const, state: 'active' as const, publicUrl: 'https://s.test/b/x', pending: 2 }], available: ['bookings' as const] })),
    });
    const { onOpen, user } = mount(api);
    await user.click(await screen.findByRole('button', { name: /Bookings.*2 waiting/ }));
    expect(onOpen).toHaveBeenCalledWith({ app: 'bookings' });
    expect(screen.queryByRole('button', { name: /Set up/ })).toBeNull();
    expect(screen.getByText('Every available app is set up.')).toBeInTheDocument();
  });

  it('says so when the apps cannot be loaded, and retries', async () => {
    const api = fakeAppsApi({ list: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ apps: [], available: ['bookings'] }) });
    const { user } = mount(api);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });
});
```

  In `app/src/components/__tests__/workspace-modes.test.tsx`:
  - Add `appsVersion?: number` to `mount`'s `options` type.
  - Pass `appsVersion={options.appsVersion}` to `SignedInProvider`.
  - Add `import { fakeAppsApi } from '@/lib/apps/__tests__/fixtures';`.
  - Append inside `describe('workspace navigation', …)`:

```tsx
  it('adds Apps after Activity, and to the phone bar before More, when apps are on', async () => {
    const repo = Object.assign(new LocalRepository(), { apps: fakeAppsApi() });
    await mount(<Dashboard />, repo, '/app', { appsVersion: 1 });
    const work = (await sidebarQueries()).getByRole('group', { name: 'Work' });
    expect(within(work).getAllByRole('button').map(button => button.textContent?.replace(/\d+$/, ''))).toEqual(['Activity', 'Apps']);
    const mobile = document.querySelector('.dashboard-bottom-nav')!;
    expect([...mobile.querySelectorAll(':scope > button')].slice(0, 4).map(button => button.textContent))
      .toEqual(['Home', 'Activity2', 'Chat', 'Apps']);
  });
  it.each([undefined, 2])('keeps Apps hidden without supported discovery: %s', async appsVersion => {
    const apps = fakeAppsApi();
    const repo = Object.assign(new LocalRepository(), { apps });
    await mount(<Dashboard />, repo, '/app', { appsVersion });
    const work = (await sidebarQueries()).getByRole('group', { name: 'Work' });
    expect(within(work).queryByRole('button', { name: 'Apps' })).toBeNull();
    expect(apps.list).not.toHaveBeenCalled();
  });
  it('keeps Apps out of the anonymous demo', async () => {
    const apps = fakeAppsApi();
    const repo = Object.assign(new LocalRepository(), { apps });
    await mount(<Dashboard />, repo, '/app', { signedIn: false, appsVersion: 1 });
    const work = (await sidebarQueries()).getByRole('group', { name: 'Work' });
    expect(within(work).queryByRole('button', { name: 'Apps' })).toBeNull();
    expect(apps.list).not.toHaveBeenCalled();
  });
  it('falls back to Home when a link asks for apps that are not on', async () => {
    const apps = fakeAppsApi();
    await mount(<Dashboard />, Object.assign(new LocalRepository(), { apps }), '/app?view=apps&app=bookings', {});
    const sidebar = await sidebarQueries();
    expect(sidebar.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(apps.list).not.toHaveBeenCalled();
  });
  it('opens the Apps list from view=apps', async () => {
    const repo = Object.assign(new LocalRepository(), { apps: fakeAppsApi() });
    await mount(<Dashboard />, repo, '/app?view=apps', { appsVersion: 1 });
    expect(await screen.findByRole('heading', { name: 'Apps', level: 1 })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them and confirm they fail.**

```bash
pnpm exec vitest run src/routes/views/__tests__/AppsView.test.tsx src/components/__tests__/workspace-modes.test.tsx
```

Expected: FAIL. `AppsView` does not exist, and there is no Apps nav item.

- [ ] **Step 3: Create `app/src/routes/views/AppsView.tsx`.**

```tsx
import { CalendarCheck } from '@phosphor-icons/react';
import { Button, Card, LoadingState } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { useApps } from '@/lib/apps/useApps';
import type { AppKey } from '@/lib/apps/types';

/* The owner's apps: what is installed, and what can be added. Only apps the
   Worker says exist are offered (`available`). */

const ICONS: Record<AppKey, typeof CalendarCheck> = { bookings: CalendarCheck };

export default function AppsView({ onOpen }: {
  app: string | null;
  bookingId: string | null;
  section: string | null;
  onOpen: (params: Record<string, string>) => void;
  onConnectCalendar: () => void;
}) {
  const t = useT();
  const apps = useApps();
  const installed = apps.list?.apps ?? [];
  const addable = (apps.list?.available ?? []).filter((key) => !installed.some((app) => app.key === key));

  return <section className="apps-view" aria-labelledby="apps-title">
    <header className="apps-heading">
      <h1 id="apps-title">{t('apps.title')}</h1>
      <p>{t('apps.intro')}</p>
    </header>
    {apps.error && !apps.list && <Card role="alert" className="apps-state">
      <p>{t('apps.error')}</p>
      <Button variant="outline" onClick={() => void apps.refresh()}>{t('apps.retry')}</Button>
    </Card>}
    {!apps.error && !apps.list && <LoadingState title={t('apps.loading')} />}
    {apps.list && <>
      {installed.length > 0 && <section className="apps-section" aria-labelledby="apps-installed">
        <h2 id="apps-installed">{t('apps.installed')}</h2>
        <div className="apps-grid">
          {installed.map((app) => {
            const AppIcon = ICONS[app.key];
            return <button key={app.key} type="button" className={`apps-tile apps-tile-${app.key}`} onClick={() => onOpen({ app: app.key })}>
              <span className="apps-tile-icon"><AppIcon size={24} weight="duotone" aria-hidden="true" /></span>
              <span className="apps-tile-copy">
                <strong>{t(`apps.${app.key}.name`)}</strong>
                <small>{app.pending > 0 ? t('apps.pending', { n: app.pending }) : t(app.state === 'paused' ? 'apps.paused' : 'apps.ready')}</small>
              </span>
            </button>;
          })}
        </div>
      </section>}
      <section className="apps-section" aria-labelledby="apps-add">
        <h2 id="apps-add">{t('apps.add.title')}</h2>
        {addable.length === 0 ? <p className="apps-none">{t('apps.none')}</p> : <div className="apps-grid">
          {addable.map((key) => {
            const AppIcon = ICONS[key];
            return <Card key={key} className="apps-offer">
              <span className="apps-tile-icon"><AppIcon size={24} weight="duotone" aria-hidden="true" /></span>
              <div>
                <h3>{t(`apps.${key}.name`)}</h3>
                <p>{t(`apps.${key}.detail`)}</p>
              </div>
              <Button onClick={() => onOpen({ app: key })} aria-label={`${t('apps.setup')} ${t(`apps.${key}.name`)}`}>{t('apps.setup')}</Button>
            </Card>;
          })}
        </div>}
      </section>
    </>}
  </section>;
}
```

- [ ] **Step 4: Wire the Dashboard.** In `app/src/routes/Dashboard.tsx`:

  a. Imports:
  - add `useAppsEnabled` to the `@/lib/repo/gate` import;
  - add `import { AppsProvider } from '@/lib/apps/useApps';`;
  - add `import AppsView from './views/AppsView';`.

  b. Extend `View` with `| 'apps'`.

  c. In `NAV`, insert
  `{ id: 'apps', labelKey: 'nav.apps', icon: 'apps', section: 'work' },`
  directly after the `work` entry.

  d. Replace the two lines that compute `goalsEnabled`'s filter and
  `availableNav` with:

```ts
  const goalsEnabled = signedIn && !!repository.goals;
  const appsEnabled = useAppsEnabled() && !!repository.apps;
  const availableNav = NAV.filter((item) => (item.id !== 'goals' || goalsEnabled) && (item.id !== 'apps' || appsEnabled));
```

  The `routines` splice stays as it is: it inserts after the first three
  items. With apps on, that is after Apps; with apps off, after Skills,
  exactly as today.

  e. Add a helper beside `go`:

```ts
  function openApps(params: Record<string, string> = {}) {
    setSearchParams({ view: 'apps', ...params });
    if (!window.matchMedia('(min-width: 1024px)').matches) window.scrollTo({ top: 0, behavior: 'instant' });
  }
```

  f. Wrap the whole returned `<Shell …>…</Shell>` in
  `<AppsProvider api={appsEnabled ? repository.apps ?? null : null}>` …
  `</AppsProvider>`.

  g. In the content column, after the `view === 'business'` block, add:

```tsx
          {view === 'apps' && appsEnabled && repository.apps && <AppsView
            app={searchParams.get('app')}
            bookingId={searchParams.get('booking')}
            section={searchParams.get('section')}
            onOpen={openApps}
            onConnectCalendar={() => go('business', 'connections')}
          />}
```

- [ ] **Step 5: Add the icon.** In `app/src/components/Icon.tsx`, add
  `SquaresFour` to the `@phosphor-icons/react` import, and add
  `apps: SquaresFour,` to `CHROME` after `routines`.

- [ ] **Step 6: Add the strings** from the table above to `pages.ts`, in both
  languages.

- [ ] **Step 7: Run the tests.**

```bash
pnpm exec vitest run src/routes/views/__tests__/AppsView.test.tsx src/components/__tests__/workspace-modes.test.tsx
```

Expected: all pass, the existing navigation tests included.
- With apps off, the nav still has 7 items and the phone bar still reads
  Home · Activity · Chat · Skills.
- If `workspace-modes` flakes, re-run it alone.

- [ ] **Step 8: Typecheck and commit.**

```bash
pnpm typecheck
git add src/routes/views/AppsView.tsx src/routes/views/__tests__/AppsView.test.tsx src/routes/Dashboard.tsx src/components/Icon.tsx src/i18n/pages.ts src/components/__tests__/workspace-modes.test.tsx
git commit -m "feat(app): Apps in the workspace navigation, for pilot owners only"
```

---

## Task 5: Bookings settings, for setup and later edits

**Files:**
- Create: `app/src/routes/views/apps/BookingsSettings.tsx`
- Modify: `app/src/i18n/pages.ts` with the keys below.
- Test: `app/src/routes/views/apps/__tests__/BookingsSettings.test.tsx`

**Interfaces:**
- **Consumes:**
  - `AppsError` and the types (Task 2).
  - `useBusiness()` from `@/hooks/useBusiness`, whose `business.name` gives
    the default link name.
- **Produces:**
  - `BookingsSettings({ api, config, onSaved, onReload })`.
    - `config` has no installation: the component is setup mode.
    - Otherwise it edits the saved settings.
    - `onSaved(next: BookingsConfig)` fires after a successful save.
    - `onReload()` asks the parent to fetch the config again.
  - `slugFrom(name)`, which is exported so it can be tested.
- **Why the form looks as it does (spec, "Settings" tab):**
  - Setup starts with one service.
  - "Add another service" appears only once the page is installed, with
    the note that services do not share places.
  - Minimum notice and horizon sit under a collapsed **Advanced settings**.
  - Setup requires the availability acknowledgement.
  - Save always sends the config version. A stale version, `CONFIG_CHANGED`,
    shows a Reload.
- **Hours:** one opening range per weekday is edited. Any further range on
  the same day, which the API allows, is kept exactly as saved rather than
  silently dropped.
- **The parent remounts this component whenever the config changes.** Task 8
  does it with `key={config.version ?? 'new'}`, so the draft always starts
  from the saved values.

**Strings** (`en` / `bm`), added after the `apps.*` keys:

| Key | English | Malay |
|---|---|---|
| `bookings.setup.title` | Set up your booking page | Sediakan halaman tempahan anda |
| `bookings.setup.lead` | Start with one service. You can add more once your page is live. | Mulakan dengan satu perkhidmatan. Anda boleh tambah lagi selepas halaman anda aktif. |
| `bookings.setup.acknowledge` | I understand: availability comes from the hours I set here. Other calendar events do not block these times. | Saya faham: waktu yang tersedia datang daripada waktu yang saya tetapkan di sini. Acara kalendar lain tidak menyekat waktu ini. |
| `bookings.setup.publish` | Publish booking page | Terbitkan halaman tempahan |
| `bookings.settings.title` | Settings | Tetapan |
| `bookings.settings.service` | Service | Perkhidmatan |
| `bookings.settings.serviceN` | Service {n} | Perkhidmatan {n} |
| `bookings.settings.name` | Name | Nama |
| `bookings.settings.duration` | Length of each booking | Tempoh setiap tempahan |
| `bookings.settings.minutes` | {n} min | {n} min |
| `bookings.settings.capacity` | Places per time | Tempat bagi setiap waktu |
| `bookings.settings.price` | Price (optional) | Harga (pilihan) |
| `bookings.settings.price.placeholder` | e.g. RM45 | cth. RM45 |
| `bookings.settings.hours` | Weekly hours | Waktu mingguan |
| `bookings.settings.opens` | {day} opens | {day} buka |
| `bookings.settings.closes` | {day} closes | {day} tutup |
| `bookings.settings.active` | Taking bookings for this service | Menerima tempahan untuk perkhidmatan ini |
| `bookings.settings.remove` | Remove | Buang |
| `bookings.settings.addService` | Add another service | Tambah perkhidmatan lain |
| `bookings.settings.independent` | Add a service only if its people, rooms and equipment are separate. Services never share places. | Tambah perkhidmatan hanya jika orang, bilik dan peralatannya berasingan. Perkhidmatan tidak berkongsi tempat. |
| `bookings.settings.slug` | Link name | Nama pautan |
| `bookings.settings.advanced` | Advanced settings | Tetapan lanjutan |
| `bookings.settings.notice` | Minimum notice | Notis minimum |
| `bookings.settings.notice.0` | None | Tiada |
| `bookings.settings.notice.30` | 30 minutes | 30 minit |
| `bookings.settings.notice.60` | 1 hour | 1 jam |
| `bookings.settings.notice.120` | 2 hours | 2 jam |
| `bookings.settings.notice.240` | 4 hours | 4 jam |
| `bookings.settings.notice.720` | 12 hours | 12 jam |
| `bookings.settings.notice.1440` | 1 day | 1 hari |
| `bookings.settings.notice.2880` | 2 days | 2 hari |
| `bookings.settings.notice.10080` | 1 week | 1 minggu |
| `bookings.settings.notice.custom` | {n} minutes | {n} minit |
| `bookings.settings.horizon` | How far ahead customers can book (days) | Berapa jauh ke hadapan pelanggan boleh menempah (hari) |
| `bookings.settings.save` | Save settings | Simpan tetapan |
| `bookings.settings.reload` | Reload | Muat semula |
| `bookings.settings.error.slug` | Use 3–40 lowercase letters, numbers or dashes, starting and ending with a letter or number. | Gunakan 3–40 huruf kecil, nombor atau sengkang, bermula dan berakhir dengan huruf atau nombor. |
| `bookings.settings.error.slugTaken` | That link name is taken. Try another. | Nama pautan itu sudah digunakan. Cuba yang lain. |
| `bookings.settings.error.horizon` | Choose between 1 and 90 days. | Pilih antara 1 hingga 90 hari. |
| `bookings.settings.error.acknowledge` | Please confirm you understand how availability works. | Sila sahkan anda faham cara waktu tersedia berfungsi. |
| `bookings.settings.error.noService` | Keep at least one service taking bookings. | Kekalkan sekurang-kurangnya satu perkhidmatan yang menerima tempahan. |
| `bookings.settings.error.name` | Give the service a name (up to 80 characters). | Beri nama perkhidmatan (hingga 80 aksara). |
| `bookings.settings.error.capacity.range` | Choose 1 to 50 places. | Pilih 1 hingga 50 tempat. |
| `bookings.settings.error.capacity.reserved` | Bookings already hold more places than this. Choose a higher number. | Tempahan sedia ada sudah memegang lebih banyak tempat. Pilih nombor yang lebih tinggi. |
| `bookings.settings.error.noHours` | Open at least one day. | Buka sekurang-kurangnya satu hari. |
| `bookings.settings.error.closes` | Closing time must be after opening time. | Waktu tutup mesti selepas waktu buka. |
| `bookings.settings.error.changed` | These settings were changed somewhere else. Reload to see the latest, then make your change again. | Tetapan ini telah diubah di tempat lain. Muat semula untuk melihat yang terkini, kemudian buat perubahan anda sekali lagi. |
| `bookings.settings.error.uncertain` | We could not confirm the save. Reload to check what was saved. | Kami tidak dapat mengesahkan simpanan. Muat semula untuk menyemak apa yang disimpan. |
| `bookings.settings.error.invalid` | Some settings were not accepted. Check them and try again. | Sesetengah tetapan tidak diterima. Semak dan cuba lagi. |
| `bookings.settings.error.generic` | Could not save. Try again. | Tidak dapat menyimpan. Cuba lagi. |

- [ ] **Step 1: Write the failing test** at
  `app/src/routes/views/apps/__tests__/BookingsSettings.test.tsx`.

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BookingsSettings, { slugFrom } from '../BookingsSettings';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { AppsError } from '@/lib/apps/api';
import { configFixture, fakeAppsApi, SERVICE_ID } from '@/lib/apps/__tests__/fixtures';
import type { BookingsConfig } from '@/lib/apps/types';

const NEW: BookingsConfig = { installation: null, version: null, settings: null, services: [] };

async function mount(config: BookingsConfig, api = fakeAppsApi()) {
  const repo = new LocalRepository();
  await repo.setBizType('restaurant');
  await repo.setBizProfile({ name: 'Kedai Kita', loc: 'Shah Alam' });
  const onSaved = vi.fn();
  const onReload = vi.fn();
  render(<RepositoryProvider repository={repo}><I18nProvider>
    <BookingsSettings api={api} config={config} onSaved={onSaved} onReload={onReload} />
  </I18nProvider></RepositoryProvider>);
  return { api, onSaved, onReload, user: userEvent.setup() };
}

describe('slugFrom', () => {
  it('makes a link name from a business name, or nothing when it cannot', () => {
    expect(slugFrom('Kedai Kita')).toBe('kedai-kita');
    expect(slugFrom('Café Ümmi & Co.')).toBe('cafe-ummi-co');
    expect(slugFrom('!!')).toBe('');
    expect(slugFrom('App')).toBe('');
  });
});

describe('BookingsSettings', () => {
  it('publishes a first service with weekday hours and the business link name', async () => {
    const { api, onSaved, user } = await mount(NEW);
    await user.type(await screen.findByLabelText('Name'), 'Cupping class');
    await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
    await user.click(screen.getByRole('button', { name: 'Publish booking page' }));
    expect(api.saveBookingsConfig).toHaveBeenCalledWith({
      version: null, slug: 'kedai-kita', accepting: true, minNoticeMinutes: 120, horizonDays: 30,
      acknowledgeAvailabilityLimits: true,
      services: [{ id: null, name: 'Cupping class', durationMinutes: 60, capacity: 1, priceLabel: null, active: true,
        hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: '09:00', closes: '17:00' })) }],
    });
    expect(onSaved).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Add another service' })).toBeNull();
  });

  it('will not publish until availability is acknowledged', async () => {
    const { api, user } = await mount(NEW);
    await user.type(await screen.findByLabelText('Name'), 'Cupping class');
    await user.click(screen.getByRole('button', { name: 'Publish booking page' }));
    expect(screen.getByText('Please confirm you understand how availability works.')).toBeInTheDocument();
    expect(api.saveBookingsConfig).not.toHaveBeenCalled();
  });

  it('points at a closing time before the opening time', async () => {
    const { api, user } = await mount(configFixture());
    fireEvent.change(screen.getByLabelText('Tuesday closes'), { target: { value: '09:00' } });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByText('Closing time must be after opening time.')).toBeInTheDocument();
    expect(api.saveBookingsConfig).not.toHaveBeenCalled();
  });

  it('asks for a reload when the settings changed elsewhere', async () => {
    const api = fakeAppsApi({ saveBookingsConfig: vi.fn().mockRejectedValue(new AppsError('CONFIG_CHANGED', 409)) });
    const { onReload, user } = await mount(configFixture(), api);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(api.saveBookingsConfig).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }));
    expect(await screen.findByText(/changed somewhere else/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalled();
  });

  it('explains a link name that is taken and places below what is booked', async () => {
    const taken = fakeAppsApi({ saveBookingsConfig: vi.fn().mockRejectedValue(new AppsError('SLUG_TAKEN', 409)) });
    const first = await mount(configFixture(), taken);
    await first.user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('That link name is taken. Try another.')).toBeInTheDocument();
  });

  it('marks the service whose places are below what is already booked', async () => {
    const api = fakeAppsApi({ saveBookingsConfig: vi.fn().mockRejectedValue(new AppsError('CAPACITY_BELOW_RESERVED', 409, false, SERVICE_ID)) });
    const { user } = await mount(configFixture(), api);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText(/already hold more places/)).toBeInTheDocument();
  });

  it('keeps a second opening range on the same day as it was saved', async () => {
    const config = configFixture({ services: [{ ...configFixture().services[0], hours: [
      { weekday: 1, opens: '09:00', closes: '12:00' }, { weekday: 1, opens: '14:00', closes: '17:00' },
    ] }] });
    const { api, user } = await mount(config);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(api.saveBookingsConfig.mock.calls[0][0].services[0].hours).toEqual([
      { weekday: 1, opens: '09:00', closes: '12:00' }, { weekday: 1, opens: '14:00', closes: '17:00' },
    ]);
  });

  it('keeps advanced settings folded and shows the link it will publish', async () => {
    await mount(configFixture());
    expect(screen.getByText('Advanced settings').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('https://sites.test/b/seido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add another service' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

```bash
pnpm exec vitest run src/routes/views/apps/__tests__/BookingsSettings.test.tsx
```

Expected: FAIL with `Cannot find module '../BookingsSettings'`.

- [ ] **Step 3: Create `app/src/routes/views/apps/BookingsSettings.tsx`.**

```tsx
import { useMemo, useState, type FormEvent } from 'react';
import { Button, Input } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useBusiness } from '@/hooks/useBusiness';
import { AppsError } from '@/lib/apps/api';
import type { AppsApi, BookingService, BookingsConfig, BookingsConfigInput, WeeklyHours } from '@/lib/apps/types';

/* Monday first, as a Malaysian week reads; 0 is Sunday in the data. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
const DURATIONS = Array.from({ length: 32 }, (_, i) => (i + 1) * 15);
const NOTICE = [0, 30, 60, 120, 240, 720, 1440, 2880, 10080];
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED = new Set(['api', 'admin', 'www', 'app', 'b']);

interface DayDraft { open: boolean; opens: string; closes: string }
interface ServiceDraft {
  key: string;
  id: string | null;
  name: string;
  durationMinutes: number;
  capacity: number;
  priceLabel: string;
  active: boolean;
  days: Record<number, DayDraft>;
  /** Further ranges on a day, kept exactly as saved: the editor shows one per day. */
  extra: WeeklyHours[];
}

let draftKeys = 0;

/** A link name from a business name, or '' when none fits the rules. */
export function slugFrom(name: string): string {
  const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return SLUG.test(slug) && !RESERVED.has(slug) ? slug : '';
}

function newService(): ServiceDraft {
  return {
    key: `new-${++draftKeys}`, id: null, name: '', durationMinutes: 60, capacity: 1, priceLabel: '', active: true,
    days: Object.fromEntries(WEEK.map((day) => [day, { open: day >= 1 && day <= 5, opens: '09:00', closes: '17:00' }])),
    extra: [],
  };
}

function toDraft(service: BookingService): ServiceDraft {
  const days: Record<number, DayDraft> = Object.fromEntries(WEEK.map((day) => [day, { open: false, opens: '09:00', closes: '17:00' }]));
  const extra: WeeklyHours[] = [];
  for (const range of [...service.hours].sort((a, b) => a.opens.localeCompare(b.opens))) {
    if (days[range.weekday].open) extra.push(range);
    else days[range.weekday] = { open: true, opens: range.opens, closes: range.closes };
  }
  return {
    key: service.id, id: service.id, name: service.name, durationMinutes: service.durationMinutes,
    capacity: service.capacity, priceLabel: service.priceLabel ?? '', active: service.active, days, extra,
  };
}

export default function BookingsSettings({ api, config, onSaved, onReload }: {
  api: AppsApi;
  config: BookingsConfig;
  onSaved: (next: BookingsConfig) => void;
  onReload: () => void;
}) {
  const { t, lang } = useI18n();
  const { business } = useBusiness();
  const installed = config.installation !== null;
  const [slugInput, setSlugInput] = useState<string | null>(config.installation?.slug ?? null);
  const slug = slugInput ?? slugFrom(business.name);
  const [services, setServices] = useState<ServiceDraft[]>(() => (config.services.length ? config.services.map(toDraft) : [newService()]));
  const [minNotice, setMinNotice] = useState(config.settings?.minNoticeMinutes ?? 120);
  const [horizon, setHorizon] = useState(config.settings?.horizonDays ?? 30);
  const [acknowledged, setAcknowledged] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<{ key: string; reload: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const dayName = useMemo(() => {
    const format = new Intl.DateTimeFormat(lang === 'bm' ? 'ms-MY' : 'en-MY', { weekday: 'long', timeZone: 'UTC' });
    // 4 October 2026 was a Sunday, so day d is 4 + d October.
    return (day: number) => format.format(new Date(Date.UTC(2026, 9, 4 + day)));
  }, [lang]);
  const origin = config.installation ? new URL(config.installation.publicUrl).origin : null;
  const notices = [...new Set([...NOTICE, minNotice])].sort((a, b) => a - b);

  function update(key: string, change: Partial<ServiceDraft>) {
    setServices((list) => list.map((service) => (service.key === key ? { ...service, ...change } : service)));
  }
  function updateDay(key: string, day: number, change: Partial<DayDraft>) {
    setServices((list) => list.map((service) => (service.key === key
      ? { ...service, days: { ...service.days, [day]: { ...service.days[day], ...change } } } : service)));
  }

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    if (!SLUG.test(slug) || RESERVED.has(slug)) found.slug = 'bookings.settings.error.slug';
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 90) found.horizon = 'bookings.settings.error.horizon';
    if (!installed && !acknowledged) found.acknowledge = 'bookings.settings.error.acknowledge';
    if (!services.some((service) => service.active)) found.services = 'bookings.settings.error.noService';
    for (const service of services) {
      const name = service.name.trim();
      if (!name || name.length > 80) found[`${service.key}.name`] = 'bookings.settings.error.name';
      if (!Number.isInteger(service.capacity) || service.capacity < 1 || service.capacity > 50) {
        found[`${service.key}.capacity`] = 'bookings.settings.error.capacity.range';
      }
      const open = WEEK.filter((day) => service.days[day].open);
      if (service.active && open.length === 0) found[`${service.key}.hours`] = 'bookings.settings.error.noHours';
      for (const day of open) {
        if (service.days[day].closes <= service.days[day].opens) found[`${service.key}.day.${day}`] = 'bookings.settings.error.closes';
      }
    }
    return found;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    const input: BookingsConfigInput = {
      version: config.version,
      slug,
      accepting: config.settings?.accepting ?? true,
      minNoticeMinutes: minNotice,
      horizonDays: horizon,
      acknowledgeAvailabilityLimits: installed || acknowledged,
      services: services.map((service) => ({
        id: service.id,
        name: service.name.trim(),
        durationMinutes: service.durationMinutes,
        capacity: service.capacity,
        priceLabel: service.priceLabel.trim() || null,
        active: service.active,
        hours: [
          ...WEEK.filter((day) => service.days[day].open)
            .map((day) => ({ weekday: day, opens: service.days[day].opens, closes: service.days[day].closes })),
          ...service.extra,
        ],
      })),
    };
    setSaving(true);
    try {
      onSaved(await api.saveBookingsConfig(input));
    } catch (error) {
      const code = error instanceof AppsError ? error.code : '';
      if (code === 'SLUG_TAKEN') setErrors({ slug: 'bookings.settings.error.slugTaken' });
      else if (code === 'ACK_REQUIRED') setErrors({ acknowledge: 'bookings.settings.error.acknowledge' });
      else if (code === 'CAPACITY_BELOW_RESERVED') {
        const service = services.find((draft) => draft.id === (error as AppsError).serviceId);
        if (service) setErrors({ [`${service.key}.capacity`]: 'bookings.settings.error.capacity.reserved' });
        else setProblem({ key: 'bookings.settings.error.capacity.reserved', reload: false });
      } else if (code === 'CONFIG_CHANGED' || code === 'UNKNOWN_SERVICE') setProblem({ key: 'bookings.settings.error.changed', reload: true });
      else if (error instanceof AppsError && error.uncertain) setProblem({ key: 'bookings.settings.error.uncertain', reload: true });
      else if (error instanceof AppsError && error.status === 400) setProblem({ key: 'bookings.settings.error.invalid', reload: false });
      else setProblem({ key: 'bookings.settings.error.generic', reload: false });
    } finally {
      setSaving(false);
    }
  }

  const error = (key: string) => (errors[key] ? <p className="field-error" role="alert">{t(errors[key])}</p> : null);
  const noticeLabel = (minutes: number) => (NOTICE.includes(minutes)
    ? t(`bookings.settings.notice.${minutes}`) : t('bookings.settings.notice.custom', { n: minutes }));

  return <form className="bookings-settings" onSubmit={(event) => void save(event)} noValidate>
    <h2>{t(installed ? 'bookings.settings.title' : 'bookings.setup.title')}</h2>
    {!installed && <p className="bookings-lead">{t('bookings.setup.lead')}</p>}
    {services.map((service, index) => <fieldset key={service.key} className="bookings-service card">
      <legend>{services.length > 1 ? t('bookings.settings.serviceN', { n: index + 1 }) : t('bookings.settings.service')}</legend>
      <label>{t('bookings.settings.name')}
        <Input value={service.name} maxLength={80} aria-invalid={Boolean(errors[`${service.key}.name`])}
          onChange={(event) => update(service.key, { name: event.target.value })} />
      </label>
      {error(`${service.key}.name`)}
      <label>{t('bookings.settings.duration')}
        <select className="input" value={service.durationMinutes} onChange={(event) => update(service.key, { durationMinutes: Number(event.target.value) })}>
          {DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{t('bookings.settings.minutes', { n: minutes })}</option>)}
        </select>
      </label>
      <label>{t('bookings.settings.capacity')}
        <Input type="number" min={1} max={50} value={service.capacity} aria-invalid={Boolean(errors[`${service.key}.capacity`])}
          onChange={(event) => update(service.key, { capacity: Number(event.target.value) })} />
      </label>
      {error(`${service.key}.capacity`)}
      <label>{t('bookings.settings.price')}
        <Input value={service.priceLabel} maxLength={40} placeholder={t('bookings.settings.price.placeholder')}
          onChange={(event) => update(service.key, { priceLabel: event.target.value })} />
      </label>
      <div className="bookings-hours" role="group" aria-label={t('bookings.settings.hours')}>
        <span className="bookings-hours-title">{t('bookings.settings.hours')}</span>
        {WEEK.map((day) => <div key={day} className="bookings-day">
          <label className="bookings-check bookings-day-open">
            <input type="checkbox" checked={service.days[day].open} onChange={(event) => updateDay(service.key, day, { open: event.target.checked })} />
            {dayName(day)}
          </label>
          {service.days[day].open && <>
            <input className="input" type="time" step={900} aria-label={t('bookings.settings.opens', { day: dayName(day) })}
              value={service.days[day].opens} onChange={(event) => updateDay(service.key, day, { opens: event.target.value })} />
            <input className="input" type="time" step={900} aria-label={t('bookings.settings.closes', { day: dayName(day) })}
              value={service.days[day].closes} onChange={(event) => updateDay(service.key, day, { closes: event.target.value })} />
          </>}
          {error(`${service.key}.day.${day}`)}
        </div>)}
        {error(`${service.key}.hours`)}
      </div>
      {service.id !== null && <label className="bookings-check">
        <input type="checkbox" checked={service.active} onChange={(event) => update(service.key, { active: event.target.checked })} />
        {t('bookings.settings.active')}
      </label>}
      {service.id === null && services.length > 1 && <Button type="button" variant="ghost"
        onClick={() => setServices((list) => list.filter((draft) => draft.key !== service.key))}>{t('bookings.settings.remove')}</Button>}
    </fieldset>)}
    {error('services')}
    {installed && <div className="bookings-more">
      <Button type="button" variant="outline" onClick={() => setServices((list) => [...list, newService()])}>{t('bookings.settings.addService')}</Button>
      <p>{t('bookings.settings.independent')}</p>
    </div>}
    <label>{t('bookings.settings.slug')}
      <Input value={slug} maxLength={40} aria-invalid={Boolean(errors.slug)} onChange={(event) => setSlugInput(event.target.value.toLowerCase())} />
    </label>
    <p className="bookings-link-preview">{origin ? `${origin}/b/${slug}` : `…/b/${slug}`}</p>
    {error('slug')}
    <details className="bookings-advanced">
      <summary>{t('bookings.settings.advanced')}</summary>
      <label>{t('bookings.settings.notice')}
        <select className="input" value={minNotice} onChange={(event) => setMinNotice(Number(event.target.value))}>
          {notices.map((minutes) => <option key={minutes} value={minutes}>{noticeLabel(minutes)}</option>)}
        </select>
      </label>
      <label>{t('bookings.settings.horizon')}
        <Input type="number" min={1} max={90} value={horizon} aria-invalid={Boolean(errors.horizon)} onChange={(event) => setHorizon(Number(event.target.value))} />
      </label>
      {error('horizon')}
    </details>
    {!installed && <label className="bookings-check bookings-ack">
      <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
      {t('bookings.setup.acknowledge')}
    </label>}
    {error('acknowledge')}
    {problem && <div className="bookings-problem" role="alert">
      <p>{t(problem.key)}</p>
      {problem.reload && <Button type="button" variant="outline" onClick={onReload}>{t('bookings.settings.reload')}</Button>}
    </div>}
    <Button type="submit" disabled={saving}>{t(installed ? 'bookings.settings.save' : 'bookings.setup.publish')}</Button>
  </form>;
}
```

- [ ] **Step 4: Add the strings** from the table to `pages.ts`, in both
  languages.

- [ ] **Step 5: Run the test.**

```bash
pnpm exec vitest run src/routes/views/apps/__tests__/BookingsSettings.test.tsx
```

Expected: all pass.
- If `useBusiness()` returns a placeholder name before the repository loads,
  the default link name updates as soon as the real name arrives. Only an
  edit fixes `slugInput`.
- `findByLabelText` in the setup test waits for that.

- [ ] **Step 6: Typecheck and commit.**

```bash
pnpm typecheck
git add src/routes/views/apps/BookingsSettings.tsx src/routes/views/apps/__tests__/BookingsSettings.test.tsx src/i18n/pages.ts
git commit -m "feat(app): Bookings settings: set up a first service, then edit safely"
```

---

## Task 6: The Booking page tab

**Files:**
- Create: `app/src/routes/views/apps/BookingPage.tsx`
- Modify: `app/src/i18n/pages.ts`
- Test: `app/src/routes/views/apps/__tests__/BookingPage.test.tsx`

**Interfaces:**
- **Consumes:** `configToInput` (Task 3) and `AppsError` (Task 2).
- **Produces:** `BookingPage({ api, config, onChange, onReload })`.
  - `config.installation` is never null here.
  - `onChange(next)` receives the saved config after the **Taking bookings**
    switch.
- **Ruling: no embedded preview.** The spec asks for "a preview of the
  customer page". The sites deploy sends `frame-ancestors 'none'`, so an
  `<iframe>` of the real page would be blank. The tab instead shows the
  services customers choose from, plus an **Open page** link to the real
  thing.

**Strings:**

| Key | English | Malay |
|---|---|---|
| `bookings.page.title` | Your booking page | Halaman tempahan anda |
| `bookings.page.taking` | Taking booking requests. Customers can pick a time and send a request. | Menerima permintaan tempahan. Pelanggan boleh memilih waktu dan menghantar permintaan. |
| `bookings.page.paused` | Paused. Customers see that you are not taking bookings right now. | Dijeda. Pelanggan melihat bahawa anda tidak menerima tempahan buat masa ini. |
| `bookings.page.copy` | Copy link | Salin pautan |
| `bookings.page.copied` | Copied | Disalin |
| `bookings.page.copyFailed` | Could not copy. Select the link and copy it yourself. | Tidak dapat menyalin. Pilih pautan dan salin sendiri. |
| `bookings.page.share` | Share | Kongsi |
| `bookings.page.open` | Open page | Buka halaman |
| `bookings.page.accepting` | Taking bookings | Menerima tempahan |
| `bookings.page.installationPaused` | Bookings is paused for this business. | Tempahan dijeda untuk perniagaan ini. |
| `bookings.page.preview` | What customers choose from | Pilihan pelanggan |
| `bookings.page.preview.detail` | Your page lists these services. Open the page to see it as a customer does. | Halaman anda menyenaraikan perkhidmatan ini. Buka halaman untuk melihatnya seperti pelanggan. |

- [ ] **Step 1: Write the failing test** at
  `app/src/routes/views/apps/__tests__/BookingPage.test.tsx`.

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BookingPage from '../BookingPage';
import { I18nProvider } from '@/i18n/I18nProvider';
import { AppsError } from '@/lib/apps/api';
import { configFixture, fakeAppsApi } from '@/lib/apps/__tests__/fixtures';

function mount(api = fakeAppsApi(), config = configFixture()) {
  const onChange = vi.fn();
  const onReload = vi.fn();
  const user = userEvent.setup();
  render(<I18nProvider><BookingPage api={api} config={config} onChange={onChange} onReload={onReload} /></I18nProvider>);
  return { api, onChange, onReload, user };
}
afterEach(() => { Reflect.deleteProperty(navigator, 'share'); });

describe('BookingPage', () => {
  it('shows the live link, copies it, and opens it in a new tab', async () => {
    const { user } = mount();
    expect(screen.getByText(/Taking booking requests/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe('https://sites.test/b/seido');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    const open = screen.getByRole('link', { name: 'Open page' });
    expect(open).toHaveAttribute('href', 'https://sites.test/b/seido');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Cupping class')).toBeInTheDocument();
  });

  it('offers Share only where the device can share', async () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });

  it('pauses with the saved version, and hands back the saved config', async () => {
    const paused = configFixture({ settings: { ...configFixture().settings!, accepting: false } });
    const api = fakeAppsApi({ saveBookingsConfig: vi.fn(async () => paused) });
    const { onChange, user } = mount(api);
    await user.click(screen.getByRole('checkbox', { name: 'Taking bookings' }));
    expect(api.saveBookingsConfig).toHaveBeenCalledWith(expect.objectContaining({ version: 3, accepting: false, slug: 'seido' }));
    expect(onChange).toHaveBeenCalledWith(paused);
  });

  it('asks for a reload when the switch meets a newer version', async () => {
    const api = fakeAppsApi({ saveBookingsConfig: vi.fn().mockRejectedValue(new AppsError('CONFIG_CHANGED', 409)) });
    const { onReload, user } = mount(api);
    await user.click(screen.getByRole('checkbox', { name: 'Taking bookings' }));
    expect(await screen.findByText(/changed somewhere else/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

```bash
pnpm exec vitest run src/routes/views/apps/__tests__/BookingPage.test.tsx
```

Expected: FAIL with `Cannot find module '../BookingPage'`.

- [ ] **Step 3: Create `app/src/routes/views/apps/BookingPage.tsx`.**

```tsx
import { useState } from 'react';
import { ArrowSquareOut, Copy, ShareNetwork } from '@phosphor-icons/react';
import { Button, Card } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { AppsError } from '@/lib/apps/api';
import { configToInput } from '@/lib/apps/bookings';
import type { AppsApi, BookingsConfig } from '@/lib/apps/types';

/* The public link and the one switch that matters day to day. The customer
   page cannot be framed (its CSP says frame-ancestors 'none'), so the
   preview is the list customers choose from, plus a link to the real page. */

export default function BookingPage({ api, config, onChange, onReload }: {
  api: AppsApi;
  config: BookingsConfig;
  onChange: (next: BookingsConfig) => void;
  onReload: () => void;
}) {
  const { t } = useI18n();
  const installation = config.installation!;
  const accepting = config.settings?.accepting ?? false;
  const taking = installation.state === 'active' && accepting;
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ key: string; reload: boolean } | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy() {
    try {
      await navigator.clipboard.writeText(installation.publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setProblem({ key: 'bookings.page.copyFailed', reload: false });
    }
  }

  async function toggle(next: boolean) {
    setSaving(true);
    setProblem(null);
    try {
      onChange(await api.saveBookingsConfig({ ...configToInput(config), accepting: next }));
    } catch (error) {
      if (error instanceof AppsError && error.code === 'CONFIG_CHANGED') setProblem({ key: 'bookings.settings.error.changed', reload: true });
      else if (error instanceof AppsError && error.uncertain) setProblem({ key: 'bookings.settings.error.uncertain', reload: true });
      else setProblem({ key: 'bookings.settings.error.generic', reload: false });
    } finally {
      setSaving(false);
    }
  }

  return <div className="booking-page">
    <Card className="booking-page-link">
      <h2>{t('bookings.page.title')}</h2>
      <p className="booking-page-url"><a href={installation.publicUrl} target="_blank" rel="noopener noreferrer">{installation.publicUrl}</a></p>
      <p className={taking ? 'booking-page-live' : 'booking-page-paused'}>{t(taking ? 'bookings.page.taking' : 'bookings.page.paused')}</p>
      <div className="booking-page-actions">
        <Button variant="outline" onClick={() => void copy()}><Copy size={17} aria-hidden="true" />{t(copied ? 'bookings.page.copied' : 'bookings.page.copy')}</Button>
        {canShare && <Button variant="outline" onClick={() => void navigator.share({ title: t('apps.bookings.name'), url: installation.publicUrl }).catch(() => undefined)}>
          <ShareNetwork size={17} aria-hidden="true" />{t('bookings.page.share')}
        </Button>}
        <a className="btn btn-outline" href={installation.publicUrl} target="_blank" rel="noopener noreferrer">
          <ArrowSquareOut size={17} aria-hidden="true" />{t('bookings.page.open')}
        </a>
      </div>
      <label className="bookings-check">
        <input type="checkbox" checked={accepting} disabled={saving} onChange={(event) => void toggle(event.target.checked)} />
        {t('bookings.page.accepting')}
      </label>
      {installation.state === 'paused' && <p>{t('bookings.page.installationPaused')}</p>}
      {problem && <div className="bookings-problem" role="alert">
        <p>{t(problem.key)}</p>
        {problem.reload && <Button variant="outline" onClick={onReload}>{t('bookings.settings.reload')}</Button>}
      </div>}
    </Card>
    <Card className="booking-page-preview" aria-labelledby="booking-preview-title">
      <h3 id="booking-preview-title">{t('bookings.page.preview')}</h3>
      <p>{t('bookings.page.preview.detail')}</p>
      <ul>
        {config.services.filter((service) => service.active).map((service) => <li key={service.id}>
          <strong>{service.name}</strong>
          <span>{t('bookings.settings.minutes', { n: service.durationMinutes })}{service.priceLabel ? ` · ${service.priceLabel}` : ''}</span>
        </li>)}
      </ul>
    </Card>
  </div>;
}
```

- [ ] **Step 4: Add the strings, then run the test.**

```bash
pnpm exec vitest run src/routes/views/apps/__tests__/BookingPage.test.tsx
```

Expected: all pass. `userEvent.setup()` installs a clipboard stub, which is
why the test reads the link back with `navigator.clipboard.readText()`.

- [ ] **Step 5: Typecheck and commit.**

```bash
pnpm typecheck
git add src/routes/views/apps/BookingPage.tsx src/routes/views/apps/__tests__/BookingPage.test.tsx src/i18n/pages.ts
git commit -m "feat(app): the booking page tab: the link, sharing it, and taking bookings on or off"
```

---

## Task 7: The Bookings tab: requests, decisions, Calendar state

**Files:**
- Create: `app/src/routes/views/apps/BookingCard.tsx`
- Create: `app/src/routes/views/apps/BookingsList.tsx`
- Modify: `app/src/i18n/pages.ts`
- Test: `app/src/routes/views/apps/__tests__/BookingsList.test.tsx`

**Interfaces:**
- **Consumes:**
  - From Task 3:
    - `loadWindow`, `loadPendingBookings`, `addDays`, `WINDOW_DAYS` and
      `groupByDay`;
    - `statusTag`, `calendarTag`, `calendarReasonKey`, `whatsappKey`,
      `actionErrorKey` and `bookingWhen`;
    - `useApps()`.
  - `malaysiaDay` from `@/lib/daily-brief`.
- **Produces:**
  - `BookingCard({ booking, busy, message, now, onAct, onConnectCalendar })`,
    where `onAct` receives
    `BookingAction = 'confirm' | 'decline' | 'cancel' | 'retry'`.
  - `BookingsList({ api, bookingId, onConnectCalendar, now? })`.
- **Behaviour (spec, the "Bookings" tab row, and Review focus 1–3 and 5):**
  - **Filters:**
    - **Needs you** covers pending requests that can still be confirmed,
      across 91 days.
    - **Today** is today's bookings.
    - **Upcoming** covers 90 days ahead, in three 31-day windows with
      Earlier/Later, grouped by date.
    - **Go to date** opens any day, past days included.
  - **Default filter:** Needs you when requests are waiting, otherwise
    Today. The default is fixed once the waiting count is known, so a
    confirm that empties Needs you does not jump the view away from the card
    just confirmed.
  - **After a decision:** the card is replaced by the server's answer, which
    shows the WhatsApp link and Calendar state, and `apps.refresh()` runs.
  - **A refused or lost answer:** the card shows the reason and re-reads the
    booking, so it shows the booking as it now stands.
  - **Cancel** asks first, through `window.confirm`.
  - **A deep-linked booking** (`bookingId`) is fetched on its own and pinned
    above the list under **From your notification**, whatever the filter.
  - **While any shown booking's Calendar is syncing,** the list reloads
    quietly every 10 seconds. It also reloads when the app returns to the
    foreground.

**Strings:**

| Key | English | Malay |
|---|---|---|
| `bookings.filters` | Show bookings | Tunjuk tempahan |
| `bookings.filter.needs` | Needs you | Perlu anda |
| `bookings.filter.today` | Today | Hari ini |
| `bookings.filter.upcoming` | Upcoming | Akan datang |
| `bookings.date.pick` | Go to date | Pergi ke tarikh |
| `bookings.focused` | From your notification | Daripada notifikasi anda |
| `bookings.loading` | Loading bookings… | Memuatkan tempahan… |
| `bookings.error.load` | Could not load bookings. | Tidak dapat memuatkan tempahan. |
| `bookings.empty.needs` | No requests are waiting for you. | Tiada permintaan menunggu anda. |
| `bookings.empty.today` | No bookings today. | Tiada tempahan hari ini. |
| `bookings.empty.upcoming` | No bookings in these dates. | Tiada tempahan dalam tarikh ini. |
| `bookings.empty.date` | No bookings on this date. | Tiada tempahan pada tarikh ini. |
| `bookings.window.earlier` | Earlier | Sebelumnya |
| `bookings.window.later` | Later | Seterusnya |
| `bookings.window.range` | {from} to {to} | {from} hingga {to} |
| `bookings.status.needsYou` | Needs you | Perlu anda |
| `bookings.status.confirmed` | Confirmed | Disahkan |
| `bookings.status.declined` | Declined | Ditolak |
| `bookings.status.cancelled` | Cancelled | Dibatalkan |
| `bookings.status.expired` | Expired | Tamat tempoh |
| `bookings.party` | Party of {n} | {n} orang |
| `bookings.reference` | Ref {reference} | Rujukan {reference} |
| `bookings.confirm` | Confirm | Sahkan |
| `bookings.decline` | Decline | Tolak |
| `bookings.cancel` | Cancel booking | Batalkan tempahan |
| `bookings.cancel.confirm` | Cancel {name}'s booking? Their place is released, and you can send them a message. | Batalkan tempahan {name}? Tempat mereka akan dilepaskan, dan anda boleh menghantar mesej kepada mereka. |
| `bookings.whatsapp.confirm` | Send confirmation on WhatsApp | Hantar pengesahan melalui WhatsApp |
| `bookings.whatsapp.decline` | Send decline on WhatsApp | Hantar penolakan melalui WhatsApp |
| `bookings.whatsapp.cancel` | Send cancellation on WhatsApp | Hantar pembatalan melalui WhatsApp |
| `bookings.calendar.syncing` | Syncing | Sedang diselaraskan |
| `bookings.calendar.removing` | Removing from Google Calendar | Sedang dibuang dari Google Calendar |
| `bookings.calendar.added` | Added to Google Calendar | Ditambah ke Google Calendar |
| `bookings.calendar.removed` | Removed from Google Calendar | Dibuang dari Google Calendar |
| `bookings.calendar.notConnected` | Calendar not connected | Kalendar tidak disambungkan |
| `bookings.calendar.attention` | Needs attention | Perlu perhatian |
| `bookings.calendar.connect` | Connect Google Calendar | Sambung Google Calendar |
| `bookings.calendar.retry` | Retry | Cuba semula |
| `bookings.calendar.sameAccount` | the same Google account | akaun Google yang sama |
| `bookings.calendar.reason.reconnect` | Reconnect {account} in Connections, then retry. | Sambung semula {account} di Sambungan, kemudian cuba semula. |
| `bookings.calendar.reason.disconnected` | Google Calendar was disconnected. Reconnect {account}, then retry. | Google Calendar telah diputuskan. Sambung semula {account}, kemudian cuba semula. |
| `bookings.calendar.reason.removed_in_google` | This event was deleted in Google Calendar, so Jentera did not add it again. | Acara ini telah dipadam dalam Google Calendar, jadi Jentera tidak menambahnya semula. |
| `bookings.calendar.reason.unconfirmed` | Jentera could not confirm this with Google Calendar. Retry to check again. | Jentera tidak dapat mengesahkan ini dengan Google Calendar. Cuba semula untuk menyemak. |
| `bookings.calendar.reason.provider` | Google Calendar could not complete this after several tries. Retry to try again. | Google Calendar tidak dapat menyelesaikan ini selepas beberapa percubaan. Cuba semula. |
| `bookings.error.alreadyDecided` | Already decided on another device. This is the booking as it stands. | Sudah diputuskan pada peranti lain. Inilah tempahan seperti sekarang. |
| `bookings.error.expired` | This time has passed, so the request can no longer be confirmed. | Waktu ini telah berlalu, jadi permintaan tidak lagi boleh disahkan. |
| `bookings.error.notRetryable` | This booking has nothing to sync. | Tempahan ini tiada apa-apa untuk diselaraskan. |
| `bookings.error.calendarDisconnected` | The Google account for this booking is disconnected. Reconnect it, then retry. | Akaun Google untuk tempahan ini telah diputuskan. Sambung semula, kemudian cuba semula. |
| `bookings.error.notFound` | This booking could not be found. | Tempahan ini tidak dapat ditemui. |
| `bookings.error.uncertain` | We did not hear back. This is the booking as it stands now. | Kami tidak menerima jawapan. Inilah tempahan seperti sekarang. |
| `bookings.error.generic` | Something went wrong. Try again. | Sesuatu tidak kena. Cuba lagi. |

- [ ] **Step 1: Write the failing test** at
  `app/src/routes/views/apps/__tests__/BookingsList.test.tsx`.

```tsx
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BookingsList from '../BookingsList';
import { I18nProvider } from '@/i18n/I18nProvider';
import { AppsProvider } from '@/lib/apps/useApps';
import { AppsError } from '@/lib/apps/api';
import { BOOKING_ID, bookingFixture, fakeAppsApi } from '@/lib/apps/__tests__/fixtures';
import type { Booking, BookingsQuery } from '@/lib/apps/types';

const NOW = new Date('2026-10-05T00:00:00Z');   // Monday 08:00 in Malaysia
const WA = 'https://wa.me/60123456789?text=Hi';
const calendar = (status: Booking['calendar']['status'], over: Partial<Booking['calendar']> = {}) =>
  ({ status, error: null, reason: null, canRetry: false, account: null, ...over });
const installed = (pending: number) => vi.fn(async () => ({
  apps: [{ key: 'bookings' as const, state: 'active' as const, publicUrl: 'https://s.test/b/x', pending }], available: ['bookings' as const],
}));
/** Pending requests on `status: 'pending'` queries, `window` on everything else. */
const serve = (pending: Booking[], window: Booking[] = []) =>
  vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' ? pending : window, nextCursor: null }));

function mount(api: ReturnType<typeof fakeAppsApi>, bookingId: string | null = null) {
  const onConnectCalendar = vi.fn();
  const user = userEvent.setup();
  render(<I18nProvider><AppsProvider api={api}>
    <BookingsList api={api} bookingId={bookingId} onConnectCalendar={onConnectCalendar} now={() => NOW} />
  </AppsProvider></I18nProvider>);
  return { onConnectCalendar, user };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('BookingsList', () => {
  it('opens on Needs you, and a confirm shows the WhatsApp link and Syncing at once', async () => {
    const confirmed = bookingFixture({ status: 'confirmed', whatsappUrl: WA, calendar: calendar('pending') });
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn(async () => ({ booking: confirmed, whatsappUrl: WA, calendarQueued: true })),
    });
    const { user } = mount(api);
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    expect(within(card).getByText('Needs you')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Confirm' }));
    expect(api.decide).toHaveBeenCalledWith(BOOKING_ID, 'confirm');
    const after = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(after).getByRole('link', { name: /Send confirmation on WhatsApp/ })).toHaveAttribute('href', WA));
    expect(within(after).getByText('Syncing')).toBeInTheDocument();
    expect(within(after).queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('shows the booking as it stands when another device decided first', async () => {
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn().mockRejectedValue(new AppsError('ALREADY_DECIDED', 409)),
      booking: vi.fn(async () => bookingFixture({ status: 'declined', whatsappUrl: WA })),
    });
    const { user } = mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(card).getByText('Declined')).toBeInTheDocument());
    expect(within(card).getByRole('alert')).toHaveTextContent('Already decided on another device');
    expect(within(card).getByRole('link', { name: /Send decline on WhatsApp/ })).toBeInTheDocument();
  });

  it('recovers from a lost answer by reading the booking again', async () => {
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn().mockRejectedValue(new AppsError('NETWORK', 0, true)),
      booking: vi.fn(async () => bookingFixture({ status: 'confirmed', whatsappUrl: WA, calendar: calendar('created') })),
    });
    const { user } = mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(card).getByText('Added to Google Calendar')).toBeInTheDocument());
    expect(within(card).getByRole('alert')).toHaveTextContent('We did not hear back');
    expect(within(card).queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('says when the time has passed', async () => {
    const api = fakeAppsApi({
      list: installed(1), bookings: serve([bookingFixture()]),
      decide: vi.fn().mockRejectedValue(new AppsError('EXPIRED', 409)),
      booking: vi.fn(async () => bookingFixture({ expired: true })),
    });
    const { user } = mount(api);
    await user.click(within(await screen.findByRole('article', { name: 'Aisyah' })).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/This time has passed/)).toBeInTheDocument();
  });

  it('asks before cancelling, and shows cleanup still running afterwards', async () => {
    const confirmed = bookingFixture({ status: 'confirmed', whatsappUrl: WA, calendar: calendar('created') });
    const cancelled = bookingFixture({ status: 'cancelled', whatsappUrl: WA, calendar: calendar('pending') });
    const api = fakeAppsApi({
      list: installed(0), bookings: serve([], [confirmed]),
      cancel: vi.fn(async () => ({ booking: cancelled, whatsappUrl: WA, calendarQueued: true })),
    });
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { user } = mount(api);
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    await user.click(within(card).getByRole('button', { name: 'Cancel booking' }));
    expect(api.cancel).not.toHaveBeenCalled();
    await user.click(within(card).getByRole('button', { name: 'Cancel booking' }));
    expect(ask).toHaveBeenCalledTimes(2);
    const after = await screen.findByRole('article', { name: 'Aisyah' });
    await waitFor(() => expect(within(after).getByText('Cancelled')).toBeInTheDocument());
    expect(within(after).getByText('Removing from Google Calendar')).toBeInTheDocument();
    expect(within(after).queryByText('Removed from Google Calendar')).toBeNull();
    expect(within(after).getByRole('link', { name: /Send cancellation on WhatsApp/ })).toBeInTheDocument();
  });

  it('explains a Calendar failure, retries it, and offers Connect when nothing is connected', async () => {
    const failed = bookingFixture({ status: 'confirmed', calendar: calendar('failed', { reason: 'reconnect', canRetry: true, account: 'owner@example.com' }) });
    const waiting = bookingFixture({ id: '11111111-1111-4111-8111-00000000000e', customerName: 'Aina', status: 'confirmed', calendar: calendar('not_connected', { canRetry: true }) });
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], [failed, waiting]) });
    const { onConnectCalendar, user } = mount(api);
    const card = await screen.findByRole('article', { name: 'Aisyah' });
    expect(within(card).getByText('Reconnect owner@example.com in Connections, then retry.')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Retry' }));
    expect(api.retryCalendar).toHaveBeenCalledWith(BOOKING_ID);
    await user.click(within(screen.getByRole('article', { name: 'Aina' })).getByRole('button', { name: 'Connect Google Calendar' }));
    expect(onConnectCalendar).toHaveBeenCalled();
  });

  it('pins the booking a notification opened, whatever the filter', async () => {
    const far = bookingFixture({ startsAt: '2026-12-04T02:00:00.000Z' });
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], []), booking: vi.fn(async () => far) });
    mount(api, BOOKING_ID);
    const pinned = await screen.findByRole('region', { name: 'From your notification' });
    expect(within(pinned).getByRole('article', { name: 'Aisyah' })).toBeInTheDocument();
    expect(api.booking).toHaveBeenCalledWith(BOOKING_ID);
  });

  it('pages Upcoming in 31-day windows from today', async () => {
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], []) });
    const { user } = mount(api);
    await user.click(await screen.findByRole('button', { name: 'Upcoming' }));
    await waitFor(() => expect(api.bookings).toHaveBeenCalledWith({ from: '2026-10-05', days: 31 }));
    await user.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(api.bookings).toHaveBeenCalledWith({ from: '2026-11-05', days: 31 }));
  });

  it('polls quietly while Calendar is syncing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const syncing = bookingFixture({ status: 'confirmed', calendar: calendar('pending') });
    const api = fakeAppsApi({ list: installed(0), bookings: serve([], [syncing]) });
    mount(api);
    await screen.findByRole('article', { name: 'Aisyah' });
    const before = api.bookings.mock.calls.filter(([q]) => q.status !== 'pending').length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await waitFor(() => expect(api.bookings.mock.calls.filter(([q]) => q.status !== 'pending').length).toBeGreaterThan(before));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

```bash
pnpm exec vitest run src/routes/views/apps/__tests__/BookingsList.test.tsx
```

Expected: FAIL with `Cannot find module '../BookingsList'`.

- [ ] **Step 3: Create `app/src/routes/views/apps/BookingCard.tsx`.**

```tsx
import { ArrowsClockwise, WhatsappLogo } from '@phosphor-icons/react';
import { Button, Tag } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { bookingWhen, calendarReasonKey, calendarTag, statusTag, whatsappKey } from '@/lib/apps/bookings';
import type { Booking } from '@/lib/apps/types';

export type BookingAction = 'confirm' | 'decline' | 'cancel' | 'retry';

/* One booking as the owner acts on it. The WhatsApp link is an ordinary link
   the owner taps, so no pop-up blocker is involved, and it never claims the
   message was sent. */
export default function BookingCard({ booking, busy, message, now, onAct, onConnectCalendar }: {
  booking: Booking;
  busy: boolean;
  message: string | null;
  now: Date;
  onAct: (action: BookingAction) => void;
  onConnectCalendar: () => void;
}) {
  const { t, lang } = useI18n();
  const status = statusTag(booking);
  const calendar = calendarTag(booking);
  const whatsapp = whatsappKey(booking);
  const future = Date.parse(booking.startsAt) > now.getTime();
  const titleId = `booking-${booking.id}`;
  return <article className="booking-card card" aria-labelledby={titleId}>
    <header className="booking-card-header">
      <h3 id={titleId}>{booking.customerName}</h3>
      <Tag tone={status.tone}>{t(status.key)}</Tag>
    </header>
    <p className="booking-card-when">
      {bookingWhen(booking.startsAt, lang)} · {booking.serviceName} · {t('bookings.party', { n: booking.partySize })}
    </p>
    {booking.note && <p className="booking-card-note">{booking.note}</p>}
    <p className="booking-card-meta">{t('bookings.reference', { reference: booking.reference })}</p>
    {calendar && <div className="booking-card-calendar">
      <Tag tone={calendar.tone}>{t(calendar.key)}</Tag>
      {booking.calendar.status === 'failed' && <span>
        {t(calendarReasonKey(booking.calendar.reason), { account: booking.calendar.account ?? t('bookings.calendar.sameAccount') })}
      </span>}
      {booking.calendar.status === 'not_connected' && booking.status === 'confirmed' && <Button variant="ghost" onClick={onConnectCalendar}>
        {t('bookings.calendar.connect')}
      </Button>}
      {booking.calendar.canRetry && <Button variant="ghost" disabled={busy} onClick={() => onAct('retry')}>
        <ArrowsClockwise size={16} aria-hidden="true" />{t('bookings.calendar.retry')}
      </Button>}
    </div>}
    {message && <p className="booking-card-message" role="alert">{message}</p>}
    <div className="booking-card-actions">
      {booking.status === 'pending' && !booking.expired && <>
        <Button variant="outline" disabled={busy} onClick={() => onAct('decline')}>{t('bookings.decline')}</Button>
        <Button disabled={busy} onClick={() => onAct('confirm')}>{t('bookings.confirm')}</Button>
      </>}
      {booking.status === 'confirmed' && future && <Button variant="ghost" disabled={busy} onClick={() => onAct('cancel')}>
        {t('bookings.cancel')}
      </Button>}
      {whatsapp && booking.whatsappUrl && <a className="btn btn-outline booking-card-whatsapp" href={booking.whatsappUrl} target="_blank" rel="noopener noreferrer">
        <WhatsappLogo size={17} aria-hidden="true" />{t(whatsapp)}
      </a>}
    </div>
  </article>;
}
```

- [ ] **Step 4: Create `app/src/routes/views/apps/BookingsList.tsx`.**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, LoadingState } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useApps } from '@/lib/apps/useApps';
import { actionErrorKey, addDays, groupByDay, loadPendingBookings, loadWindow, WINDOW_DAYS } from '@/lib/apps/bookings';
import { malaysiaDay } from '@/lib/daily-brief';
import type { AppsApi, Booking } from '@/lib/apps/types';
import BookingCard, { type BookingAction } from './BookingCard';

type Filter = 'needs' | 'today' | 'upcoming' | 'date';
const POLL_MS = 10_000;
/** Upcoming reaches 90 days ahead in three windows. */
const UPCOMING_OFFSETS = [0, 31, 62];

export default function BookingsList({ api, bookingId, onConnectCalendar, now = () => new Date() }: {
  api: AppsApi;
  bookingId: string | null;
  onConnectCalendar: () => void;
  now?: () => Date;
}) {
  const { t, lang } = useI18n();
  const apps = useApps();
  const clock = useRef(now);
  clock.current = now;
  const [chosen, setChosen] = useState<Filter | null>(null);
  const filter: Filter = chosen ?? 'today';
  const [offset, setOffset] = useState(0);
  const [date, setDate] = useState(() => malaysiaDay(now()));
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [focused, setFocused] = useState<Booking | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const generation = useRef(0);

  /* Needs you when requests wait, otherwise Today — decided once, so
     confirming the last request does not pull the view away from it. */
  useEffect(() => {
    if (chosen === null && apps.pending !== null) setChosen(apps.pending.length > 0 ? 'needs' : 'today');
  }, [chosen, apps.pending]);

  const load = useCallback(async (quiet = false) => {
    const mine = ++generation.current;
    if (!quiet) {
      setRows(null);
      setFailed(false);
    }
    try {
      const today = malaysiaDay(clock.current());
      const next = filter === 'needs' ? await loadPendingBookings(api, clock.current())
        : filter === 'today' ? await loadWindow(api, { from: today, days: 1 })
          : filter === 'upcoming' ? await loadWindow(api, { from: addDays(today, offset), days: WINDOW_DAYS })
            : await loadWindow(api, { from: date, days: 1 });
      if (mine === generation.current) setRows(next);
    } catch {
      if (mine === generation.current && !quiet) setFailed(true);
    }
  }, [api, filter, offset, date]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!bookingId) {
      setFocused(null);
      return;
    }
    let live = true;
    api.booking(bookingId).then(
      (booking) => { if (live) setFocused(booking); },
      () => { if (live) setMessages((current) => ({ ...current, [bookingId]: 'bookings.error.notFound' })); },
    );
    return () => { live = false; };
  }, [api, bookingId]);

  const syncing = [...(rows ?? []), ...(focused ? [focused] : [])].some((booking) => booking.calendar.status === 'pending');
  useEffect(() => {
    if (!syncing) return;
    const timer = window.setInterval(() => {
      void load(true);
      if (focused) void api.booking(focused.id).then(setFocused, () => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [syncing, load, api, focused]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  function replace(next: Booking) {
    setRows((list) => list?.map((booking) => (booking.id === next.id ? next : booking)) ?? list);
    setFocused((booking) => (booking?.id === next.id ? next : booking));
  }

  async function act(booking: Booking, action: BookingAction) {
    if (action === 'cancel' && !window.confirm(t('bookings.cancel.confirm', { name: booking.customerName }))) return;
    setBusy(booking.id);
    setMessages((current) => {
      const next = { ...current };
      delete next[booking.id];
      return next;
    });
    try {
      const result = action === 'confirm' || action === 'decline' ? await api.decide(booking.id, action)
        : action === 'cancel' ? await api.cancel(booking.id) : await api.retryCalendar(booking.id);
      replace(result.booking);
    } catch (error) {
      setMessages((current) => ({ ...current, [booking.id]: actionErrorKey(error) }));
      /* Someone else decided, or the answer was lost: show the booking as the server has it now. */
      try {
        replace(await api.booking(booking.id));
      } catch {
        /* The message stands. */
      }
    } finally {
      setBusy(null);
      void apps.refresh();
    }
  }

  const locale = lang === 'bm' ? 'ms-MY' : 'en-MY';
  const dayTitle = (day: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${day}T00:00:00Z`));
  const card = (booking: Booking) => <BookingCard key={booking.id} booking={booking} busy={busy === booking.id}
    message={messages[booking.id] ? t(messages[booking.id]) : null} now={clock.current()}
    onAct={(action) => void act(booking, action)} onConnectCalendar={onConnectCalendar} />;
  const shown = (rows ?? []).filter((booking) => booking.id !== focused?.id);
  const today = malaysiaDay(clock.current());
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
    {!focused && bookingId && messages[bookingId] && <p role="alert">{t(messages[bookingId])}</p>}
    {failed && <Card role="alert" className="bookings-state">
      <p>{t('bookings.error.load')}</p>
      <Button variant="outline" onClick={() => void load()}>{t('apps.retry')}</Button>
    </Card>}
    {!failed && rows === null && <LoadingState title={t('bookings.loading')} />}
    {rows !== null && shown.length === 0 && <p className="bookings-empty">{t(`bookings.empty.${filter}`)}</p>}
    {rows !== null && shown.length > 0 && (filter === 'upcoming'
      ? groupByDay(shown).map(([day, list]) => <section key={day} className="bookings-day-group" aria-label={dayTitle(day)}>
        <h3>{dayTitle(day)}</h3>{list.map(card)}
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

  Messages are stored as keys and translated when rendered, so a language
  switch also changes them.

- [ ] **Step 5: Add the strings, then run the test.**

```bash
pnpm exec vitest run src/routes/views/apps/__tests__/BookingsList.test.tsx
```

Expected: all pass. Repeat the file twice.
- The polling test uses fake timers with `shouldAdvanceTime`.
- If it fails only when run inside the full suite, re-run the file alone
  before changing anything.
- The pinned-booking test finds the section by its accessible name, through
  `aria-labelledby`. That is why the section carries it.

- [ ] **Step 6: Typecheck and commit.**

```bash
pnpm typecheck
git add src/routes/views/apps/BookingCard.tsx src/routes/views/apps/BookingsList.tsx src/routes/views/apps/__tests__/BookingsList.test.tsx src/i18n/pages.ts
git commit -m "feat(app): the Bookings tab: decide, cancel, WhatsApp and honest Calendar state"
```

---

## Task 8: The Bookings app, and opening it from a link

**Files:**
- Create: `app/src/routes/views/apps/BookingsApp.tsx`
- Modify: `app/src/routes/views/AppsView.tsx`: add the
  `app === 'bookings'` branch.
- Modify: `app/src/styles/dashboard.css`: append the Apps and Bookings
  block below.
- Modify: `app/src/i18n/pages.ts`
- Test: `app/src/routes/views/apps/__tests__/BookingsApp.test.tsx`
- Test: `app/src/components/__tests__/workspace-modes.test.tsx`: add the
  deep-link test.

**Interfaces:**
- **Consumes:**
  - `BookingsSettings` (Task 5), `BookingPage` (Task 6) and `BookingsList`
    (Task 7).
  - `useApps()` (Task 3).
  - `Tabs` from `@/components/Tabs`, which gives tabs the id
    `${idPrefix}-tab-${id}` and points `aria-controls` at
    `${idPrefix}-panel-${id}`.
- **Produces:**
  - `BookingsApp({ bookingId, section, onSection, onBack, onConnectCalendar })`.
  - `onSection(section: 'bookings' | 'page' | 'settings', bookingId?: string)`.
- **Behaviour:**
  - **Before setup,** only the Settings form shows (setup mode), with no
    tabs.
  - **A first successful save** refreshes the shared apps state and moves to
    the **Booking page** tab: the share screen is the success state.
  - **After setup,** the tabs are Bookings, Booking page and Settings, with
    Bookings the default.
  - **Settings remounts per config version,** so a Reload or a save starts
    from what the server holds.
  - **URLs:**

    | Screen | URL |
    |---|---|
    | the Apps list | `view=apps` |
    | Bookings | `view=apps&app=bookings` |
    | one tab | `…&section=page` or `…&section=settings` |
    | a deep-linked booking | `…&booking=<id>` |

**Strings:**

| Key | English | Malay |
|---|---|---|
| `bookings.title` | Bookings | Tempahan |
| `bookings.back` | All apps | Semua aplikasi |
| `bookings.tabs` | Bookings sections | Bahagian tempahan |
| `bookings.tab.bookings` | Bookings | Tempahan |
| `bookings.tab.page` | Booking page | Halaman tempahan |
| `bookings.tab.settings` | Settings | Tetapan |
| `bookings.config.loading` | Loading Bookings… | Memuatkan Tempahan… |
| `bookings.config.error` | Could not load Bookings. | Tidak dapat memuatkan Tempahan. |

- [ ] **Step 1: Write the failing tests.**

`app/src/routes/views/apps/__tests__/BookingsApp.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BookingsApp from '../BookingsApp';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { AppsProvider } from '@/lib/apps/useApps';
import { configFixture, fakeAppsApi } from '@/lib/apps/__tests__/fixtures';

async function mount(api = fakeAppsApi(), section: string | null = null) {
  const repo = new LocalRepository();
  await repo.setBizType('restaurant');
  await repo.setBizProfile({ name: 'Kedai Kita', loc: 'Shah Alam' });
  const onSection = vi.fn();
  const onBack = vi.fn();
  render(<RepositoryProvider repository={repo}><I18nProvider><AppsProvider api={api}>
    <BookingsApp bookingId={null} section={section} onSection={onSection} onBack={onBack} onConnectCalendar={vi.fn()} />
  </AppsProvider></I18nProvider></RepositoryProvider>);
  return { api, onSection, onBack, user: userEvent.setup() };
}

describe('BookingsApp', () => {
  it('shows only the setup form before Bookings is installed, then moves to the booking page', async () => {
    const api = fakeAppsApi({ bookingsConfig: vi.fn(async () => ({ installation: null, version: null, settings: null, services: [] })) });
    const { onSection, user } = await mount(api);
    expect(await screen.findByRole('heading', { name: 'Set up your booking page' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    await user.type(screen.getByLabelText('Name'), 'Cupping class');
    await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
    await user.click(screen.getByRole('button', { name: 'Publish booking page' }));
    await waitFor(() => expect(onSection).toHaveBeenCalledWith('page'));
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('opens on the Bookings tab once installed, and switches tabs through the URL', async () => {
    const { onSection, user } = await mount();
    expect(await screen.findByRole('tab', { name: 'Bookings', selected: true })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Booking page' }));
    expect(onSection).toHaveBeenCalledWith('page');
  });

  it('shows the booking page tab from the URL', async () => {
    await mount(fakeAppsApi(), 'page');
    expect(await screen.findByRole('heading', { name: 'Your booking page' })).toBeInTheDocument();
  });

  it('says so when Bookings cannot be loaded, and retries', async () => {
    const api = fakeAppsApi({ bookingsConfig: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(configFixture()) });
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('tab', { name: 'Bookings' })).toBeInTheDocument();
  });
});
```

  In `workspace-modes.test.tsx`:
  - Add `bookingFixture` and `BOOKING_ID` to the fixtures import.
  - Append inside `describe('workspace navigation', …)`:

```tsx
  it('opens a booking straight from its notification link', async () => {
    const apps = fakeAppsApi({
      list: vi.fn(async () => ({ apps: [{ key: 'bookings' as const, state: 'active' as const, publicUrl: 'https://s.test/b/x', pending: 0 }], available: ['bookings' as const] })),
      booking: vi.fn(async () => bookingFixture({ startsAt: '2026-12-04T02:00:00.000Z' })),
    });
    const repo = Object.assign(new LocalRepository(), { apps });
    await mount(<Dashboard />, repo, `/app?view=apps&app=bookings&booking=${BOOKING_ID}`, { appsVersion: 1 });
    const pinned = await screen.findByRole('region', { name: 'From your notification' });
    expect(within(pinned).getByRole('article', { name: 'Aisyah' })).toBeInTheDocument();
    expect(apps.booking).toHaveBeenCalledWith(BOOKING_ID);
  });
```

- [ ] **Step 2: Run them and confirm they fail.**

```bash
pnpm exec vitest run src/routes/views/apps/__tests__/BookingsApp.test.tsx src/components/__tests__/workspace-modes.test.tsx
```

Expected: FAIL.
- `BookingsApp` does not exist.
- The deep link shows the Apps list instead of the booking.

- [ ] **Step 3: Create `app/src/routes/views/apps/BookingsApp.tsx`.**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { Button, Card, LoadingState } from '@/components/ui';
import { Tabs } from '@/components/Tabs';
import { useT } from '@/i18n/I18nProvider';
import { useApps } from '@/lib/apps/useApps';
import type { BookingsConfig } from '@/lib/apps/types';
import BookingsList from './BookingsList';
import BookingPage from './BookingPage';
import BookingsSettings from './BookingsSettings';

export type BookingsSection = 'bookings' | 'page' | 'settings';

export default function BookingsApp({ bookingId, section, onSection, onBack, onConnectCalendar }: {
  bookingId: string | null;
  section: string | null;
  onSection: (section: BookingsSection, bookingId?: string) => void;
  onBack: () => void;
  onConnectCalendar: () => void;
}) {
  const t = useT();
  const apps = useApps();
  const api = apps.api!;
  const [config, setConfig] = useState<BookingsConfig | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setConfig(await api.bookingsConfig());
    } catch {
      setFailed(true);
    }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const installed = config?.installation != null;
  const active: BookingsSection = !installed ? 'settings' : section === 'page' || section === 'settings' ? section : 'bookings';

  function saved(next: BookingsConfig) {
    const first = !installed;
    setConfig(next);
    void apps.refresh();
    if (first) onSection('page');
  }

  return <section className="bookings-app" aria-labelledby="bookings-title">
    <header className="bookings-app-heading">
      <h1 id="bookings-title">{t('bookings.title')}</h1>
      <Button variant="ghost" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />{t('bookings.back')}</Button>
    </header>
    {failed && <Card role="alert" className="bookings-state">
      <p>{t('bookings.config.error')}</p>
      <Button variant="outline" onClick={() => void load()}>{t('apps.retry')}</Button>
    </Card>}
    {!failed && !config && <LoadingState title={t('bookings.config.loading')} />}
    {config && <>
      {installed && <Tabs<BookingsSection>
        tabs={[
          { id: 'bookings', label: t('bookings.tab.bookings') },
          { id: 'page', label: t('bookings.tab.page') },
          { id: 'settings', label: t('bookings.tab.settings') },
        ]}
        active={active}
        onSelect={(id) => onSection(id)}
        label={t('bookings.tabs')}
        idPrefix="bookings"
      />}
      <div role={installed ? 'tabpanel' : undefined} id={installed ? `bookings-panel-${active}` : undefined}
        aria-labelledby={installed ? `bookings-tab-${active}` : undefined} className="bookings-panel">
        {active === 'bookings' && <BookingsList api={api} bookingId={bookingId} onConnectCalendar={onConnectCalendar} />}
        {active === 'page' && <BookingPage api={api} config={config} onChange={saved} onReload={() => void load()} />}
        {active === 'settings' && <BookingsSettings key={config.version ?? 'new'} api={api} config={config} onSaved={saved} onReload={() => void load()} />}
      </div>
    </>}
  </section>;
}
```

- [ ] **Step 4: Open it from `AppsView`.** In
  `app/src/routes/views/AppsView.tsx`:
  - Destructure `app, bookingId, section, onOpen, onConnectCalendar`.
  - Add `import BookingsApp from './apps/BookingsApp';`.
  - At the top of the component body, after `const apps = useApps();`, add:

```tsx
  if (app === 'bookings' && apps.api) {
    return <BookingsApp
      bookingId={bookingId}
      section={section}
      onSection={(next, booking) => onOpen({ app: 'bookings', ...(next === 'bookings' ? {} : { section: next }), ...(booking ? { booking } : {}) })}
      onBack={() => onOpen({})}
      onConnectCalendar={onConnectCalendar}
    />;
  }
```

  Keep every hook call above this early return. `useT()` and `useApps()`
  both come first, and the derived values below are not hooks.

- [ ] **Step 5: Style the screens.** Append to `app/src/styles/dashboard.css`.
  Every token comes from the file's existing set:

```css
/* ── Apps and Bookings ─────────────────────────────────────────────── */
.apps-view, .bookings-app { display: grid; gap: 20px; }
.apps-heading h1, .bookings-app-heading h1 { font-size: 24px; font-weight: 650; }
.apps-heading p, .bookings-lead, .bookings-more p, .booking-page-preview p, .apps-none, .bookings-empty { color: var(--text-secondary); }
.apps-section { display: grid; gap: 12px; }
.apps-section h2 { font-size: 15px; font-weight: 600; }
.apps-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 12px; }
.apps-tile { display: flex; align-items: center; gap: 13px; min-height: 84px; padding: 16px; border: 1px solid var(--rail); border-radius: 18px; background: var(--bg-card); text-align: left; }
.apps-tile:hover { background: var(--bg-card-hover); }
.apps-tile-copy { display: grid; gap: 2px; }
.apps-tile-copy small { color: var(--text-secondary); }
.apps-tile-icon { display: grid; flex: 0 0 42px; width: 42px; height: 42px; place-items: center; border-radius: 14px; background: rgb(244 114 182 / 0.14); color: rgb(244 114 182); }
.apps-offer { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px; padding: 16px; }
.apps-offer h3 { font-weight: 600; }
.apps-offer p { color: var(--text-secondary); font-size: 13px; }
.apps-state, .bookings-state { display: grid; gap: 10px; padding: 16px; }
.bookings-app-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.bookings-panel, .bookings-list { display: grid; gap: 14px; }
.bookings-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.bookings-date { display: flex; align-items: center; gap: 8px; margin-left: auto; font-size: 13px; color: var(--text-secondary); }
.bookings-cards, .bookings-day-group, .bookings-focused { display: grid; gap: 10px; }
.bookings-day-group h3, .bookings-focused h2 { font-size: 14px; font-weight: 600; color: var(--text-secondary); }
.bookings-window { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--text-secondary); }
.booking-card { display: grid; gap: 8px; padding: 16px; }
.booking-card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.booking-card-header h3 { font-weight: 600; }
.booking-card-when, .booking-card-meta { color: var(--text-secondary); font-size: 13px; }
.booking-card-note { font-size: 13px; }
.booking-card-calendar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; }
.booking-card-message, .field-error { color: var(--color-red-400); font-size: 13px; }
.booking-card-actions, .booking-page-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.booking-card-whatsapp, .booking-page-actions .btn { display: inline-flex; align-items: center; gap: 6px; }
.bookings-settings { display: grid; gap: 16px; }
.bookings-settings label { display: grid; gap: 6px; font-size: 13px; }
.bookings-settings .bookings-check, .booking-page .bookings-check { display: flex; align-items: center; gap: 8px; }
.bookings-service { display: grid; gap: 12px; padding: 16px; }
.bookings-hours { display: grid; gap: 8px; }
.bookings-hours-title { font-size: 13px; font-weight: 600; }
.bookings-day { display: grid; grid-template-columns: minmax(110px, 1fr) auto auto; align-items: center; gap: 8px; }
.bookings-advanced summary { cursor: pointer; font-weight: 600; }
.bookings-link-preview { font-family: var(--font-mono); font-size: 13px; color: var(--text-secondary); overflow-wrap: anywhere; }
.bookings-problem { display: grid; gap: 8px; padding: 12px; border-radius: 12px; background: rgb(249 156 0 / 0.1); }
.booking-page { display: grid; gap: 16px; }
.booking-page-link, .booking-page-preview { display: grid; gap: 12px; padding: 18px; }
.booking-page-url { font-family: var(--font-mono); overflow-wrap: anywhere; }
.booking-page-live { color: var(--accent-green); }
.booking-page-paused { color: var(--color-amber-400); }
.booking-page-preview ul { display: grid; gap: 6px; }
.booking-page-preview li { display: flex; justify-content: space-between; gap: 8px; }
@media (max-width: 640px) {
  .bookings-day { grid-template-columns: 1fr 1fr; }
  .bookings-day-open { grid-column: 1 / -1; }
  .bookings-date { margin-left: 0; }
  .apps-offer { grid-template-columns: auto 1fr; }
  .apps-offer .btn { grid-column: 1 / -1; }
}
```

  None of these rules set `font-size`, `line-height` or padding on a
  `.btn`, so the workspace type bridge in `styles/dashboard-type.css` is not
  fought (see `CLAUDE.md`).

- [ ] **Step 6: Add the strings, then run the tests.**

```bash
pnpm exec vitest run src/routes/views/apps/__tests__ src/routes/views/__tests__/AppsView.test.tsx src/components/__tests__/workspace-modes.test.tsx
```

Expected: all pass.

- [ ] **Step 7: Typecheck and commit.**

```bash
pnpm typecheck
git add src/routes/views/apps/BookingsApp.tsx src/routes/views/apps/__tests__/BookingsApp.test.tsx src/routes/views/AppsView.tsx src/styles/dashboard.css src/i18n/pages.ts src/components/__tests__/workspace-modes.test.tsx
git commit -m "feat(app): the Bookings app: setup, then tabs, and a notification opens its booking"
```

---

## Task 9: Notifications lead to their booking

**Files:**
- Modify: `app/src/lib/notifications.ts`:
  - add the `booking_requested` kind and the `url` field;
  - add `KINDS`;
  - add `workspaceParams`.
- Modify: `app/src/routes/views/NotificationsView.tsx`:
  - the `onOpenUrl` prop;
  - `open()`;
  - `Glyph`.
- Modify: `app/src/routes/Dashboard.tsx`: pass `onOpenUrl`.
- Test: `app/src/lib/__tests__/notifications.test.ts`. Create it, or add to
  it if it already exists.
- Test: `app/src/routes/views/__tests__/NotificationsView.test.tsx`

**Interfaces:**
- **Produces:**
  - `AppNotification.url: string | null`, always present after parsing.
  - `workspaceParams(url)` returns `Record<string, string> | null`: the
    query of a same-origin `/app` URL, or null.
  - `NotificationsView` takes `onOpenUrl?: (url: string) => void`.
- **Rules:**
  - A notification with a `url` opens that URL.
  - A notification without one behaves exactly as before: a review, a task
    or a routine.
  - A list from an older Worker, with no `url` field, still parses, with
    `url: null`.
  - A `url` outside `/app` is refused, just as an unknown kind is today.
- **Coordination:** `main` has a pending change to this file that adds a
  `KINDS` const and `work_finished`. Keep the same shape (a `KINDS` array
  used by the validator) so the release merge is one line.

- [ ] **Step 1: Write the failing tests.**

`app/src/lib/__tests__/notifications.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNotifications, workspaceParams } from '../notifications';

const ID = '11111111-1111-4111-8111-111111111111';
const item = (over: Record<string, unknown> = {}) => ({
  id: ID, kind: 'booking_requested', title: 'New booking request', body: 'Aisyah · Tue 6 Oct', runId: null, routineId: null,
  occurrenceId: null, url: `/app?view=apps&app=bookings&booking=${ID}`, readAt: null, createdAt: '2026-10-05T00:00:00.000Z', ...over,
});
function serve(notifications: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, notifications, unread: 1, nextCursor: null }))));
}
afterEach(() => vi.unstubAllGlobals());

describe('notifications', () => {
  it('accepts a booking request with its workspace link', async () => {
    serve([item()]);
    const page = await fetchNotifications();
    expect(page.notifications[0]).toMatchObject({ kind: 'booking_requested', url: `/app?view=apps&app=bookings&booking=${ID}` });
  });

  it('reads a list from an older server with no url as having none', async () => {
    const legacy = item({ kind: 'reminder_due' });
    delete (legacy as Record<string, unknown>).url;
    serve([legacy]);
    expect((await fetchNotifications()).notifications[0].url).toBeNull();
  });

  it('refuses a link out of the workspace', async () => {
    serve([item({ url: 'https://evil.test/app' })]);
    await expect(fetchNotifications()).rejects.toThrow();
  });

  it('turns a workspace link into search params, and nothing else', () => {
    expect(workspaceParams(`/app?view=apps&app=bookings&booking=${ID}`)).toEqual({ view: 'apps', app: 'bookings', booking: ID });
    expect(workspaceParams('/app')).toEqual({});
    expect(workspaceParams('https://evil.test/app?view=apps')).toBeNull();
    expect(workspaceParams('/elsewhere?view=apps')).toBeNull();
  });
});
```

  In `app/src/routes/views/__tests__/NotificationsView.test.tsx`:
  - Add `url: null,` to the existing inline notification literal, after
    `occurrenceId: null,`.
  - Change the imports to
    `import { render, screen, waitFor } from '@testing-library/react';` and
    add `import userEvent from '@testing-library/user-event';`.
  - Append inside the `describe`:

```tsx
  it('opens a booking request at its workspace link', async () => {
    const url = '/app?view=apps&app=bookings&booking=33333333-3333-4333-8333-333333333333';
    const onOpenUrl = vi.fn();
    const onOpenTask = vi.fn();
    const onOpenRoutine = vi.fn();
    const onOpenReview = vi.fn();
    const state = {
      items: [{
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'booking_requested' as const,
        title: 'New booking request',
        body: 'Aisyah · Tue 6 Oct, 10:00 am · Cupping class (2)',
        runId: null,
        routineId: null,
        occurrenceId: null,
        url,
        readAt: null,
        createdAt: '2026-10-05T00:00:00.000Z',
      }],
      unread: 1, nextCursor: null, loading: false, loadingMore: false, error: null,
      refresh: vi.fn(async () => {}), markRead: vi.fn(async () => {}), markAll: vi.fn(async () => {}), loadMore: vi.fn(async () => {}),
    };
    render(<RepositoryProvider repository={new LocalRepository()}><I18nProvider><NotificationsView state={state}
      onOpenTask={onOpenTask} onOpenRoutine={onOpenRoutine} onOpenReview={onOpenReview} onOpenUrl={onOpenUrl} /></I18nProvider></RepositoryProvider>);
    await userEvent.setup().click((await screen.findByText('New booking request')).closest('button')!);
    await waitFor(() => expect(onOpenUrl).toHaveBeenCalledWith(url));
    expect(state.markRead).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(onOpenTask).not.toHaveBeenCalled();
    expect(onOpenRoutine).not.toHaveBeenCalled();
    expect(onOpenReview).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them and confirm they fail.**

```bash
pnpm exec vitest run src/lib/__tests__/notifications.test.ts src/routes/views/__tests__/NotificationsView.test.tsx
```

Expected: FAIL.
- `booking_requested` is not an allowed kind.
- `workspaceParams` is not exported.

- [ ] **Step 3: Update `app/src/lib/notifications.ts`.**
  - Add `| 'booking_requested'` to `NotificationKind`.
  - Add
    `/** Where the notification leads inside the workspace, when the Worker stored one. */ url: string | null;`
    to `AppNotification`, after `occurrenceId`.
  - Replace the inline kind array and the start of `notification()` with:

```ts
/* One unknown kind rejects the whole list (`fetchNotifications`), so a new
   kind ships here before the Worker writes it. */
const KINDS: readonly NotificationKind[] = [
  'reminder_due', 'routine_completed', 'routine_failed', 'routine_skipped', 'routine_needs_approval',
  'work_needs_you', 'approval_requested', 'booking_requested',
];
const WORKSPACE_URL = /^\/app([/?#]|$)/;

function notification(value: unknown): value is AppNotification {
  if (!object(value)) return false;
  return isRunId(value.id) && typeof value.kind === 'string' &&
    (KINDS as readonly string[]).includes(value.kind) &&
    (value.url === undefined || value.url === null ||
      (typeof value.url === 'string' && value.url.length <= 300 && WORKSPACE_URL.test(value.url) && !value.url.includes('\\'))) &&
```

  Keep the rest of the validator unchanged, from `typeof value.title` on.

  - In `fetchNotifications`, return the list with `url` normalised:

```ts
  return {
    notifications: (data.notifications as AppNotification[]).map((item) => ({ ...item, url: typeof item.url === 'string' ? item.url : null })),
    unread: data.unread as number,
    nextCursor: data.nextCursor as string | null,
  };
```

  - Append:

```ts
/** The search params of a same-origin workspace link (`/app?…`), or null. */
export function workspaceParams(url: string): Record<string, string> | null {
  const origin = typeof window === 'undefined' ? 'https://app.invalid' : window.location.origin;
  let target: URL;
  try {
    target = new URL(url, origin);
  } catch {
    return null;
  }
  if (target.origin !== origin || target.pathname !== '/app') return null;
  return Object.fromEntries(target.searchParams);
}
```

- [ ] **Step 4: Update `NotificationsView.tsx`.**
  - Add `CalendarCheck` to the Phosphor import.
  - In `Glyph`, before the final `: … ? Bell : Check` ternary, add
    `: item.kind === 'booking_requested' ? CalendarCheck`.
  - Add `onOpenUrl?: (url: string) => void;` to the props type, and
    destructure it.
  - Make `open()`'s first branch
    `if (item.url && onOpenUrl) onOpenUrl(item.url);`, then
    `else if (item.runId && onOpenReview …` as before.
  - Give the body preview class to a notification with a `url` too:
    `className={item.runId || item.routineId || item.url ? 'notification-body-preview' : undefined}`.

- [ ] **Step 5: Wire the Dashboard.**
  - In `Dashboard.tsx`, add `import { workspaceParams } from '@/lib/notifications';`.
  - Pass this to `NotificationsView`:

```tsx
            onOpenUrl={(url) => {
              const params = workspaceParams(url);
              if (params) setSearchParams(params);
            }}
```

- [ ] **Step 6: Run the tests.**

```bash
pnpm exec vitest run src/lib/__tests__/notifications.test.ts src/routes/views/__tests__/NotificationsView.test.tsx src/pwa/__tests__/sw-push.test.ts
```

Expected: all pass. The push click (`sw.ts`) already opens `data.url`, which
the Worker sets to the same link, so it needs no change.

- [ ] **Step 7: Typecheck and commit.**

```bash
pnpm typecheck
git add src/lib/notifications.ts src/lib/__tests__/notifications.test.ts src/routes/views/NotificationsView.tsx src/routes/views/__tests__/NotificationsView.test.tsx src/routes/Dashboard.tsx
git commit -m "feat(app): a booking request notification opens that booking"
```

---

## Task 10: Home option B, the Alerts bell, and Needs you in the daily brief

**Files:**
- Create: `app/src/components/AlertsBell.tsx`
- Create: `app/src/components/BookingsNeedsYou.tsx`
- Modify: `app/src/routes/views/HomeView.tsx`:
  - the `onOpenApp` prop;
  - the tile row;
  - the `bookings` prop passed to `DailyBrief`.
- Modify: `app/src/components/DailyBrief.tsx`: the optional `bookings` prop,
  rendered above the brief's loading, error and body branches.
- Modify: `app/src/routes/Dashboard.tsx`:
  - `onOpenApp` for `HomeView`;
  - `<AlertsBell>` in `accountAccessory`.
- Modify: `app/src/styles/dashboard.css`
- Modify: `app/src/i18n/pages.ts`
- Test: `app/src/routes/views/__tests__/HomeView.apps.test.tsx`
- Test: `app/src/components/__tests__/workspace-modes.test.tsx`: add the
  bell tests.

**Interfaces:**
- **Consumes:**
  - `useHomeApps()` and `useApps()` (Task 3).
  - `bookingWhen` and `actionErrorKey` (Task 3).
  - `openApps` (Dashboard, Task 4).
- **Produces:**
  - `HomeView` takes `onOpenApp?: (app: string) => void`.
  - `DailyBrief` takes
    `bookings?: { items: Booking[]; onConfirm: (id: string) => Promise<Booking>; onOpenAll: () => void } | null`.
  - `AlertsBell({ unread, onOpen })`.
- **Behaviour (spec, "Home, option B"; D2):**
  - **Option B applies only with apps on and at least one app installed.**
    Otherwise Home is exactly as today.
  - **The tile row:**
    - one tile per installed app, the first three at most;
    - then **Add app**, which opens `view=apps`, or **All apps** when there
      are more than three;
    - Bookings is pink and carries a red count when requests wait.
  - **The Alerts tile goes; the bell appears** in the top bar with the
    unread count. It shows only in option B, so Alerts never has two
    entrances.
  - **Needs you in the daily brief:**
    - shows up to three waiting requests, as
      "Aisyah · Tue 6 Oct, 10:00 am · Cupping class";
    - each has **Confirm**, which is replaced by the WhatsApp link once
      confirmed;
    - "See all requests (n)" opens Bookings;
    - it renders whatever state the brief itself is in, error included.
    `dailyBrief()` is not touched and stays deterministic.

**Strings:**

| Key | English | Malay |
|---|---|---|
| `home.apps` | Your apps | Aplikasi anda |
| `home.apps.add` | Add app | Tambah aplikasi |
| `home.apps.add.detail` | More tools for your business | Lebih banyak alat untuk perniagaan anda |
| `home.apps.all` | All apps | Semua aplikasi |
| `home.apps.all.detail` | See every app | Lihat semua aplikasi |
| `home.bell` | Alerts | Makluman |
| `home.bell.unread` | Alerts, {n} unread | Makluman, {n} belum dibaca |
| `brief.bookings.title` | Needs you | Perlu anda |
| `brief.bookings.confirm` | Confirm {name} | Sahkan {name} |
| `brief.bookings.all` | See all requests ({n}) | Lihat semua permintaan ({n}) |

- [ ] **Step 1: Write the failing tests.**

`app/src/routes/views/__tests__/HomeView.apps.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import HomeView from '../HomeView';
import { ToastProvider } from '@/components/Toast';
import { ActivityProvider } from '@/hooks/useActivity';
import { useBusiness } from '@/hooks/useBusiness';
import { useConnections } from '@/hooks/useConnections';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import { AppsProvider } from '@/lib/apps/useApps';
import { bookingFixture, fakeAppsApi } from '@/lib/apps/__tests__/fixtures';
import type { AppsApi, BookingsQuery } from '@/lib/apps/types';

const WA = 'https://wa.me/60123456789?text=Hi';
const installed = (pending: number) => vi.fn(async () => ({
  apps: [{ key: 'bookings' as const, state: 'active' as const, publicUrl: 'https://s.test/b/x', pending }], available: ['bookings' as const],
}));

function Harness({ onNavigate, onOpenApp }: { onNavigate: (...args: unknown[]) => void; onOpenApp: (app: string) => void }) {
  const b = useBusiness();
  const connections = useConnections();
  return <HomeView b={b} connections={connections} goalsEnabled={false} onNavigate={onNavigate} onOpenApp={onOpenApp} />;
}

async function mount(api: AppsApi | null, options: { activityFails?: boolean } = {}) {
  const repo = new LocalRepository();
  await repo.setBizType('restaurant');
  await repo.setBizProfile({ name: 'Kedai Kita', loc: 'Shah Alam' });
  repo.activity = options.activityFails
    ? async () => { throw new Error('activity down'); }
    : async () => ({ counters: { handled: 0, needsYou: 0, minutesSaved: 0, thisWeek: 0, connections: 0 }, work: [] });
  const onNavigate = vi.fn();
  const onOpenApp = vi.fn();
  render(<MemoryRouter><SignedInProvider value account="home-apps-test"><RepositoryProvider repository={repo}>
    <I18nProvider><ToastProvider><ActivityProvider><AppsProvider api={api}>
      <Harness onNavigate={onNavigate} onOpenApp={onOpenApp} />
    </AppsProvider></ActivityProvider></ToastProvider></I18nProvider>
  </RepositoryProvider></SignedInProvider></MemoryRouter>);
  return { onNavigate, onOpenApp, user: userEvent.setup() };
}

describe('Home with apps', () => {
  it('keeps today\'s four tiles when apps are off', async () => {
    await mount(null);
    await waitFor(() => expect(document.querySelectorAll('.home-action')).toHaveLength(4));
    expect(document.querySelector('.home-action-alerts')).not.toBeNull();
  });

  it('keeps today\'s four tiles when apps are on but nothing is installed', async () => {
    const api = fakeAppsApi();
    await mount(api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(document.querySelectorAll('.home-action')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /Add app/ })).toBeNull();
  });

  it('shows installed apps with their count, and Add app, in place of the four tiles', async () => {
    const { onNavigate, onOpenApp, user } = await mount(fakeAppsApi({ list: installed(2) }));
    await user.click(await screen.findByRole('button', { name: /Bookings.*2 waiting/ }));
    expect(onOpenApp).toHaveBeenCalledWith('bookings');
    expect(document.querySelector('.home-action-alerts')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Add app/ }));
    expect(onNavigate).toHaveBeenCalledWith('apps');
  });

  it('lists waiting requests in the daily brief and confirms one there', async () => {
    const pending = bookingFixture({ startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const api = fakeAppsApi({
      list: installed(1),
      bookings: vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' ? [pending] : [], nextCursor: null })),
      decide: vi.fn(async () => ({ booking: { ...pending, status: 'confirmed' as const, whatsappUrl: WA }, whatsappUrl: WA, calendarQueued: false })),
    });
    const { user } = await mount(api);
    await user.click(await screen.findByRole('button', { name: 'Confirm Aisyah' }));
    expect(api.decide).toHaveBeenCalledWith(pending.id, 'confirm');
    expect(await screen.findByRole('link', { name: /Send confirmation on WhatsApp/ })).toHaveAttribute('href', WA);
  });

  it('keeps the waiting requests when the rest of the brief fails to load', async () => {
    const pending = bookingFixture({ startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const api = fakeAppsApi({
      list: installed(1),
      bookings: vi.fn(async (query: BookingsQuery) => ({ bookings: query.status === 'pending' ? [pending] : [], nextCursor: null })),
    });
    await mount(api, { activityFails: true });
    expect(await screen.findByRole('button', { name: 'Confirm Aisyah' })).toBeInTheDocument();
  });
});
```

  In `workspace-modes.test.tsx`, append inside `describe('workspace navigation', …)`:

```tsx
  it('puts an Alerts bell in the top bar only once an app is installed', async () => {
    const withApp = fakeAppsApi({
      list: vi.fn(async () => ({ apps: [{ key: 'bookings' as const, state: 'active' as const, publicUrl: 'https://s.test/b/x', pending: 0 }], available: ['bookings' as const] })),
    });
    await mount(<Dashboard />, Object.assign(new LocalRepository(), { apps: withApp }), '/app', { appsVersion: 1 });
    expect(await screen.findByRole('button', { name: 'Alerts' })).toBeInTheDocument();
  });
  it('shows no bell while nothing is installed', async () => {
    const empty = fakeAppsApi();
    await mount(<Dashboard />, Object.assign(new LocalRepository(), { apps: empty }), '/app', { appsVersion: 1 });
    await waitFor(() => expect(empty.list).toHaveBeenCalled());
    // The Home tile is named "Alerts" plus its detail, so only the bell matches exactly.
    expect(screen.queryByRole('button', { name: 'Alerts' })).toBeNull();
  });
```

- [ ] **Step 2: Run them and confirm they fail.**

```bash
pnpm exec vitest run src/routes/views/__tests__/HomeView.apps.test.tsx src/components/__tests__/workspace-modes.test.tsx
```

Expected: FAIL. There is no app tile and no bell yet.

- [ ] **Step 3: Create `app/src/components/AlertsBell.tsx`.**

```tsx
import { Bell } from '@phosphor-icons/react';
import { useT } from '@/i18n/I18nProvider';
import { useHomeApps } from '@/lib/apps/useApps';

/** Alerts' entrance once Home shows apps in its place (option B). Absent
    otherwise, so there are never two ways in. */
export function AlertsBell({ unread, onOpen }: { unread: number; onOpen: () => void }) {
  const t = useT();
  if (!useHomeApps()) return null;
  return <button type="button" className="workspace-bell" onClick={onOpen}
    aria-label={unread > 0 ? t('home.bell.unread', { n: unread }) : t('home.bell')}>
    <Bell size={19} weight="duotone" aria-hidden="true" />
    {unread > 0 && <span className="workspace-bell-count" aria-hidden="true">{unread}</span>}
  </button>;
}
```

- [ ] **Step 4: Create `app/src/components/BookingsNeedsYou.tsx`.**

```tsx
import { useState } from 'react';
import { ArrowRight, WhatsappLogo } from '@phosphor-icons/react';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { actionErrorKey, bookingWhen } from '@/lib/apps/bookings';
import type { Booking } from '@/lib/apps/types';

const SHOWN = 3;

/** Booking requests waiting on the owner, inside the daily brief. */
export function BookingsNeedsYou({ items, onConfirm, onOpenAll }: {
  items: Booking[];
  onConfirm: (id: string) => Promise<Booking>;
  onOpenAll: () => void;
}) {
  const { t, lang } = useI18n();
  /* A confirmed request leaves the pending list on the next refresh; keep it
     here for this visit so its WhatsApp link stays one tap away. */
  const [done, setDone] = useState<Booking[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; key: string } | null>(null);
  const shown = [...done, ...items.filter((item) => !done.some((booking) => booking.id === item.id))].slice(0, SHOWN);
  if (shown.length === 0) return null;

  async function confirm(id: string) {
    setBusy(id);
    setProblem(null);
    try {
      const booking = await onConfirm(id);
      setDone((list) => [booking, ...list.filter((item) => item.id !== id)]);
    } catch (error) {
      setProblem({ id, key: actionErrorKey(error) });
    } finally {
      setBusy(null);
    }
  }

  return <section className="brief-bookings" aria-labelledby="brief-bookings-title">
    <h3 id="brief-bookings-title">{t('brief.bookings.title')}</h3>
    <ul>
      {shown.map((booking) => <li key={booking.id}>
        <span className="brief-booking-line">{booking.customerName} · {bookingWhen(booking.startsAt, lang)} · {booking.serviceName}</span>
        {booking.status === 'pending'
          ? <Button variant="outline" disabled={busy === booking.id} onClick={() => void confirm(booking.id)}
            aria-label={t('brief.bookings.confirm', { name: booking.customerName })}>{t('bookings.confirm')}</Button>
          : booking.whatsappUrl && <a className="btn btn-outline" href={booking.whatsappUrl} target="_blank" rel="noopener noreferrer">
            <WhatsappLogo size={16} aria-hidden="true" />{t('bookings.whatsapp.confirm')}
          </a>}
        {problem?.id === booking.id && <p role="alert" className="field-error">{t(problem.key)}</p>}
      </li>)}
    </ul>
    <button type="button" className="brief-all" onClick={onOpenAll}>
      {t('brief.bookings.all', { n: items.length })}<ArrowRight size={16} aria-hidden="true" />
    </button>
  </section>;
}
```

- [ ] **Step 5: Render it from `DailyBrief`.** In
  `app/src/components/DailyBrief.tsx`:
  - Import `BookingsNeedsYou` and `type Booking` from `@/lib/apps/types`.
  - Add
    `bookings?: { items: Booking[]; onConfirm: (id: string) => Promise<Booking>; onOpenAll: () => void } | null;`
    to the props, and destructure it.
  - Directly after the closing `</header>`, before the
    `{activity.mode === 'error' ? …` branch, add:

```tsx
      {bookings && <BookingsNeedsYou items={bookings.items} onConfirm={bookings.onConfirm} onOpenAll={bookings.onOpenAll} />}
```

- [ ] **Step 6: Option B in `HomeView`.** In
  `app/src/routes/views/HomeView.tsx`:
  - Add `CalendarCheck` and `Plus` to the `@phosphor-icons/react` import.
  - Add `import { useApps, useHomeApps } from '@/lib/apps/useApps';`.
  - Add `onOpenApp` to the destructured props and to the props type as
    `onOpenApp?: (app: string) => void;`.
  - After `const activity = useActivity();`, add
    `const apps = useApps(); const homeApps = useHomeApps();`.
  - Replace the `<section className="home-actions" …>…</section>` block
    with:

```tsx
      {homeApps ? (
        <section className="home-actions home-actions-apps" aria-label={t('home.apps')}>
          {homeApps.slice(0, 3).map((app) => (
            <button key={app.key} type="button" className={`home-action home-action-${app.key}`} onClick={() => onOpenApp?.(app.key)}>
              <span className="home-action-icon">
                <CalendarCheck size={22} weight="duotone" aria-hidden="true" />
                {app.pending > 0 && <span className="home-action-count" aria-hidden="true">{app.pending}</span>}
              </span>
              <span><strong>{t(`apps.${app.key}.name`)}</strong>
                <small>{app.pending > 0 ? t('apps.pending', { n: app.pending }) : t(app.state === 'paused' ? 'apps.paused' : 'apps.ready')}</small></span>
            </button>
          ))}
          {homeApps.length > 3 ? (
            <button type="button" className="home-action home-action-more" onClick={() => onNavigate('apps')}>
              <span className="home-action-icon"><SquaresFour size={22} weight="duotone" aria-hidden="true" /></span>
              <span><strong>{t('home.apps.all')}</strong><small>{t('home.apps.all.detail')}</small></span>
            </button>
          ) : (
            <button type="button" className="home-action home-action-add" onClick={() => onNavigate('apps')}>
              <span className="home-action-icon"><Plus size={22} weight="bold" aria-hidden="true" /></span>
              <span><strong>{t('home.apps.add')}</strong><small>{t('home.apps.add.detail')}</small></span>
            </button>
          )}
        </section>
      ) : (
        /* the existing four-tile <section className="home-actions"> … </section>, unchanged */
      )}
```

    Put the existing block, unchanged, in the `else` branch. Do not retype
    it.

  - Change the `DailyBrief` line to pass the bookings:

```tsx
      {!demo && <DailyBrief activity={activity} snapshot={snap} now={now} onNavigate={onNavigate}
        bookings={homeApps && apps.api && apps.pending ? {
          items: apps.pending,
          onConfirm: async (id) => {
            const result = await apps.api!.decide(id, 'confirm');
            void apps.refresh();
            return result.booking;
          },
          onOpenAll: () => onOpenApp?.('bookings'),
        } : null} />}
```

- [ ] **Step 7: Wire the Dashboard.** In `Dashboard.tsx`:
  - Add `import { AlertsBell } from '@/components/AlertsBell';`.
  - Pass `onOpenApp={(app) => openApps({ app })}` to `HomeView`.
  - Inside `accountAccessory`'s `<div className="workspace-header-accessories">`,
    directly before
    `<div className="computer-status-header-slot" …/>`, add
    `<AlertsBell unread={notifications.unread} onOpen={() => go('notifications')} />`.

- [ ] **Step 8: Style option B.** Append to `app/src/styles/dashboard.css`:

```css
/* ── Home option B: apps in the tile row ───────────────────────────── */
.home-actions.home-actions-apps { grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); }
.home-action-bookings { background: linear-gradient(145deg, rgb(244 114 182 / 0.11), transparent 64%), var(--bg-card); }
.home-action-bookings .home-action-icon { position: relative; background: rgb(244 114 182 / 0.14); color: rgb(244 114 182); }
.home-action-add { border-style: dashed; background: var(--bg-card); }
.home-action-count, .workspace-bell-count {
  position: absolute; top: -6px; right: -6px; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px;
  background: var(--color-red-400); color: #fff; font-size: 11px; font-weight: 700; line-height: 20px; text-align: center;
}
.workspace-bell {
  position: relative; display: grid; width: 40px; height: 40px; place-items: center; border: 1px solid var(--rail);
  border-radius: 12px; background: var(--bg-card); color: var(--text);
}
.workspace-bell:hover { background: var(--bg-card-hover); }
@media (max-width: 640px) {
  .home-actions.home-actions-apps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

  `.home-actions.home-actions-apps` outranks the plain `.home-actions` rules
  in the existing media queries, so option B keeps its own columns there.
  The four-tile layout is untouched.

- [ ] **Step 9: Add the strings, then run the tests.**

```bash
pnpm exec vitest run src/routes/views/__tests__/HomeView.apps.test.tsx src/routes/views/__tests__/HomeView.test.tsx src/components/__tests__/workspace-modes.test.tsx
```

Expected: all pass, including the existing `HomeView` tests.

- [ ] **Step 10: Typecheck and commit.**

```bash
pnpm typecheck
git add src/components/AlertsBell.tsx src/components/BookingsNeedsYou.tsx src/components/DailyBrief.tsx src/routes/views/HomeView.tsx src/routes/views/__tests__/HomeView.apps.test.tsx src/routes/Dashboard.tsx src/styles/dashboard.css src/i18n/pages.ts src/components/__tests__/workspace-modes.test.tsx
git commit -m "feat(app): Home shows the business's apps, with Alerts in the top bar and requests in the brief"
```

---

## Task 11: Language parity, and the documentation

**Files:**
- Create: `app/src/i18n/__tests__/pages-parity.test.ts`
- Modify: `CLAUDE.md`:
  - add a `### Business apps (Bookings)` section directly after
    `### Routines`;
  - change the `docs/architecture.md` pointer at the top from "the five
    deployables" to "the six deployables".
- Modify: `docs/architecture.md`, section 2: retitle it and add a row for
  the sites deploy.
- Modify: `docs/todo.md`:
  - add rows under "Shipped, never exercised on production";
  - add rows under "Owner-side";
  - add rows under "Deferred product decisions".
- Modify: `docs/plans/2026-09-23-apps-wired-to-automation.md`: the status
  line.
- Modify: `docs/plans/2026-09-23-apps-shell-and-bookings-v1.md`: the plan 4
  status line, added in Task 12.

**Interfaces:** documentation only, plus one test. `PAGE_MESSAGES` from
`app/src/i18n/pages.ts` has `en` and `bm` maps.

- [ ] **Step 1: Write the parity test** at
  `app/src/i18n/__tests__/pages-parity.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { PAGE_MESSAGES } from '../pages';

/* A missing key never fails at runtime: t() falls back to English, then to
   the raw key. This test is what keeps the Malay workspace complete. */
describe('page strings', () => {
  it('has every key in both English and Malay', () => {
    expect(Object.keys(PAGE_MESSAGES.bm).sort()).toEqual(Object.keys(PAGE_MESSAGES.en).sort());
  });

  it('has no empty string in either language', () => {
    for (const lang of ['en', 'bm'] as const) {
      for (const [key, value] of Object.entries(PAGE_MESSAGES[lang])) expect(value.trim(), `${lang}:${key}`).not.toBe('');
    }
  });

  it('keeps the same placeholders in both languages', () => {
    const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [key, value] of Object.entries(PAGE_MESSAGES.en)) {
      expect(slots(PAGE_MESSAGES.bm[key] ?? ''), key).toEqual(slots(value));
    }
  });
});
```

- [ ] **Step 2: Run it.**

```bash
cd app && pnpm exec vitest run src/i18n/__tests__/pages-parity.test.ts
```

Expected: PASS, since Tasks 4–10 added every key in both languages. If a
placeholder check fails on an existing, pre-plan key, check whether the
Malay wording really drops that value:
- If it does, fix the Malay string.
- If the difference is deliberate, report it rather than weakening the
  test.

- [ ] **Step 3: Add the `CLAUDE.md` section.** Insert it directly after the
  `### Routines` section and before `### Looking at production`, keeping the
  file's voice:

```markdown
### Business apps (Bookings)

Bookings is the first of the apps in
`docs/plans/2026-09-23-apps-wired-to-automation.md`: a public page where a
customer asks for a time, and one tap for the owner to confirm, decline or
cancel, with a prepared WhatsApp message and the event kept in Google
Calendar. The spec is `docs/plans/2026-09-23-apps-shell-and-bookings-v1.md`;
plans 1–4 beside it end with "As built" notes that carry what the release
must do.

It is a pilot. `APPS_ENABLED` and `APPS_BUSINESS_IDS` (exact UUIDs, at most
20, empty means nobody) sit in both `[vars]` and `[env.sites.vars]` of
`worker/wrangler.toml`, and `scripts/check-apps-flags.mjs` fails a deploy
when the two drift. Off the list, every owner and public path answers 404,
and `/api/me` sends `features.apps` to owners only, so staff never see it.

The public pages are a second deploy of `worker/`, `jentera-sites`
(`pnpm deploy:sites`), on its own origin: it never reads or sets a cookie,
holds no credential secret (only `TURNSTILE_SECRET`), and answers 404
outside `/b/…`. Its entry is `src/sites/index.ts`, typed against `SitesEnv`,
and `test/sites-bundle.test.ts` fails if its import graph ever reaches
connections, connectors or the Calendar executor. Two brakes run before the
database: `SITES_BURST` (60/min per address) on every page and
`BOOKING_BURST` (10/min) on a request. Turnstile there uses action `booking`
and the sites host, through `verifyTurnstile`'s expectation argument; the
sign-in doors keep `signin`. A link name a business used before stays with it
(`app_slug`) and redirects with 307.

A request is created under the installation lock (installation → service →
booking, the order every writer shares), capped at 200 per business per
Malaysian day, and made idempotent by a submission key; it notifies every
owner with `booking_requested`, whose `url` is
`/app?view=apps&app=bookings&booking=<id>`. **The app must know a kind
before the Worker writes it** — see Web push above.

Google Calendar sync is durable: the decision commits a
`booking_calendar_job`, `processBookingCalendarJob`
(`src/apps/bookings/calendar-sync.ts`) claims it with a lease, calls Google
outside any transaction within 8 s, and records the result only if the lease
and revision still hold. The first attempt runs from `ctx.waitUntil` after
the owner's tap; the minute cron's `sweepBookingCalendar` retries (8 tries,
up to an hour apart) and recovers orphaned attempts. A booking remembers its
Google account and never touches another one; a failure carries a
machine-readable `calendar.reason` and `canRetry` for the app to word.

In the app, `useAppsEnabled() && repository.apps` gates everything
(`LocalRepository` has no `apps`, so the demo never shows it); `AppsProvider`
in `Dashboard` holds the installed apps and waiting requests for Home, the
bell, the daily brief and `view=apps`. Home switches to option B — apps in
the tile row, Alerts as a bell — only once an app is installed.
`app/src/i18n/__tests__/pages-parity.test.ts` keeps English and Malay in
step.
```

  Also change the line near the top that reads "the five deployables" to
  "the six deployables".

- [ ] **Step 4: Update `docs/architecture.md`.**
  - Retitle `## 2. The five deployables` as `## 2. The six deployables`.
  - Add a row to its table after **Control plane**:

```markdown
| **Public pages** | `worker/` (`src/sites/index.ts`, `[env.sites]`) | Cloudflare Worker `jentera-sites`, its own origin (`jentera-sites.qhkmdev90.workers.dev` during the pilot); no cookies, no credential secrets | `pnpm deploy:sites`, which checks the apps flags first |
```

  - Search the file for other "five deployables" mentions, for example in
    section 1 or section 20, and make them "six".

- [ ] **Step 5: Add rows to `docs/todo.md`.** Keep each section's table
  shape.
  - **"Shipped, never exercised on production"** (these are built, not
    shipped: say "built on branch `bookings-v1`, not merged"):

```markdown
| Bookings v1 end to end | Plans 1–4 built on branch `bookings-v1` (not merged, nothing applied). Release order and checks are in each plan's "As built" | On Kitakod: apply 065–068 (`pnpm db:migrate:apps-bookings`), merge, deploy the app first, then `aisar-api`, then `pnpm deploy:sites`, set `TURNSTILE_SECRET` on sites, add Kitakod's id to both flag lists and flip `APPS_ENABLED`; set up a service, book from a phone, confirm from the notification, see the event in Google Calendar, cancel, see it removed |
| Calendar deleted-id behaviour | The spec's "Calendar deleted-id verification" was never run live; the code treats a 409 plus a `cancelled` read-back as deleted either way | In a disposable test calendar: insert with a deterministic id, delete, insert again, fetch; record status codes and event status (no customer data) |
```

  - **"Owner-side":**

```markdown
| Turnstile on the booking page | The sites deploy checks Turnstile only once `TURNSTILE_SECRET` is set there, and the widget must list the sites hostname | Add `jentera-sites.qhkmdev90.workers.dev` to the widget, then `wrangler secret put TURNSTILE_SECRET --env sites`; do both before `APPS_ENABLED` is true |
```

  - **"Deferred product decisions":**

```markdown
| Customer data retention (PDPA) | Bookings keeps customers' names, phone numbers and notes with no retention period or deletion route (spec, Out of scope) | A retention period and a way to act on a customer's deletion request are decided and built **before the pilot widens beyond the first businesses** |
| Bookings, later projects | Out of scope for v1: automatic WhatsApp, payments or deposits, customer reminders, customer cancel/reschedule, shared staff or resource scheduling, availability from existing Calendar events, staff access, Activity rows, a custom domain, businesses outside Malaysia, and editing the page by chat (plan 5) | Each is its own plan when chosen |
| Bookings on its own Hyperdrive config | The sites deploy shares `aisar-api`'s Hyperdrive pool; a public flood is braked before the database but still shares the origin connections | Decide before widening the pilot: a separate config with caching off and a low connection cap |
```

- [ ] **Step 6: Update the direction doc's status.** In
  `docs/plans/2026-09-23-apps-wired-to-automation.md`, replace the line 3
  status with:

```markdown
Status: direction agreed in a product brainstorm on 23 September 2026. Project 1 (Bookings v1) is built on branch `bookings-v1` as plans 1–4, not yet released; see `2026-09-23-apps-shell-and-bookings-v1.md`.
```

- [ ] **Step 7: Commit.**

```bash
cd ~/.agent-worktree/workspaces/aisar-site-b726b8/bookings-v1
git add app/src/i18n/__tests__/pages-parity.test.ts CLAUDE.md docs/architecture.md docs/todo.md docs/plans/2026-09-23-apps-wired-to-automation.md
git commit -m "docs: Bookings v1 in CLAUDE.md, architecture and the follow-up list; keep strings in parity"
```

---

## Task 12: Full verification

- [ ] **Step 1: Run the app suite, typecheck and build.**

```bash
cd ~/.agent-worktree/workspaces/aisar-site-b726b8/bookings-v1/app
pnpm typecheck && pnpm test 2>&1 | tail -8 && pnpm build 2>&1 | tail -5
```

Expected: everything passes, and the build prerenders the public pages.
Re-run a file that flakes alone before blaming the change, especially
`workspace-modes` and the routine gates.

- [ ] **Step 2: Run the Worker suite.** Task 1 touched the Worker.

```bash
cd ../worker
echo "clock drift: $(( $(docker run --rm alpine date -u +%s) - $(date -u +%s) ))s"
pnpm typecheck && pnpm test 2>&1 | tail -6
```

Expected: the drift is within a few seconds, and everything passes. If the
drift is large, stop and report it rather than running the suite.

- [ ] **Step 3: Record progress.** In
  `docs/plans/2026-09-23-apps-shell-and-bookings-v1.md`, add this directly
  under the `Plan 3 …` status line, with the last implementation commit:

```
Plan 4 (owner screens) built on branch bookings-v1: <last commit>. Plans 1–4 complete; release per the "As built" notes of plans 2–4.
```

  Commit it by named path, with subject `docs: plan 4 of Bookings v1 built`.
