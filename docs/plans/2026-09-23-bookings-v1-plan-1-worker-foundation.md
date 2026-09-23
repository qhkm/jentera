# Bookings v1, plan 1: worker foundation

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the database, the pilot flag and the owner-facing API for the
Bookings app, so an owner can install Bookings, configure it, list requests,
and confirm, decline or cancel them. This plan has no public page, no
Calendar executor and no UI.

**Architecture:**
- **One migration** adds every Bookings table under forced RLS, the Calendar
  job table the later executor will use, and a generic `url` target on
  notifications.
- **Pure modules** hold everything that can be tested without a database:
  Malaysian time, phone numbers, open times, WhatsApp text.
- **Two store modules** do the database work (`config.ts`, `bookings.ts`).
- **One route file**, `routes/apps.ts`, is chained into `index.ts` like
  `handleGoals`.

**Tech stack:** Cloudflare Workers (TypeScript), postgres.js through
Hyperdrive, Neon Postgres with forced RLS, Vitest with a throwaway Docker
Postgres (`worker/test/harness.ts`).

**Spec:** [`docs/plans/2026-09-23-apps-shell-and-bookings-v1.md`](2026-09-23-apps-shell-and-bookings-v1.md),
approved at `70c453b`. Read it first. This plan implements its data model,
flag, owner routes, deciding and cancelling.

**The four plans, built in order:**

| Plan | Covers |
|---|---|
| **1 (this one)** | Worker foundation |
| 2 | Public pages: the sites deploy, request creation, Turnstile and flag-drift checks |
| 3 | Durable Calendar sync: the connector's delete helper, the job processor, `waitUntil`, the cron, the retry route |
| 4 | The app (`app/`) |

Nothing deploys until all four are done.

## Global constraints

Copied from the spec. Every task must respect them.

- `resolveTenant` is the only source of a business id. No route reads one from
  a body, query string or header.
- **RLS:**
  - Every new table has `enable` and `force row level security`.
  - Each has a tenant policy with both `using` and `with check` on
    `nullif(current_setting('app.business_id', true), '')::uuid`.
  - Grants to `aisar_app` are only what the routes need.
- **Tests:** arrange as `owner` (`asOwner`) and assert as `aisar_app`
  (`asApp`, `asTenant`, or through the routes, which use `withTenant`).
- **The flag:** `APPS_ENABLED === 'true'`, and `APPS_BUSINESS_IDS` must
  contain the business id exactly. It holds valid UUIDs only, at most 20,
  with no wildcard.
- **Flag off:** every Apps route answers **404**. `/api/me` advertises
  `features.apps = { apiVersion: 1 }` only when the flag is on **and**
  `can(identity, 'apps.manage')`.
- **Permissions:** `apps.manage` and `bookings.decide` are both owner-only.
- **Field limits:**

| Field | Rule |
|---|---|
| Slug | `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`. Reserved: `api`, `admin`, `www`, `app`, `b`. |
| Duration | 15 to 480 minutes, in steps of 15 |
| Capacity | 1 to 50 |
| Price label | At most 40 characters |
| Service name | 1 to 80 characters |
| `min_notice_minutes` | 0 to 10080, default 120 |
| `horizon_days` | 1 to 90, default 30 |
| Customer phone | Stored as `^60[0-9]{8,11}$` |

- **Time zone:** `Asia/Kuala_Lumpur` everywhere. Malaysia has used UTC+8 with
  no daylight saving since 1982, so a fixed offset is exact.
- **Languages:** WhatsApp text in English (`en`) and Malay (`bm`), following
  `business.lang`. Opening WhatsApp is never reported as "sent".
- **Owner JSON responses:** `Cache-Control: private, no-store`. Writes
  (`PUT`, `POST`) require the request `Origin` to equal the allowed origin, as
  `routes/goals.ts` does.
- **Commits:** stage named paths only, never `git add -A` or `git add .`.
  Other sessions share this checkout.
- **Before claiming a task done:** in `worker/`, run `pnpm typecheck`, which
  checks twice (`src`, then `src` plus `test`). Tests need Docker running.

## Review focus

Five inputs the spec implies but a task could easily miss. Each has a test in
its owning task.

1. **A booking just after Malaysian midnight** (for example 00:30 on 27 Sep in
   Malaysia, which is 16:30 UTC on 26 Sep). It must be listed on the
   Malaysian date, not the UTC one. Tested in Tasks 3 and 8.
2. **An owner typing the link name with capitals or spaces**
   (`" Kedai-Aisyah "`). It is normalised to `kedai-aisyah`, not refused.
   Tested in Task 7.
3. **Hours that close at midnight or run overnight** (`closes: "24:00"`, or
   `22:00` to `02:00`). They are refused with a clear message rather than
   stored and then mis-sliced. Tested in Tasks 3 and 7.
4. **A save that would leave no active service,** or removes a service that
   has bookings. The first is refused. The second deactivates the service and
   keeps its bookings reachable. Tested in Task 7.
5. **A business whose language is Malay.** Confirming produces Malay WhatsApp
   text, not English. Tested in Tasks 5 and 8.

---

## File structure

**Created:**

| File | Holds |
|---|---|
| `worker/migrations/067_apps_bookings.sql` | Every table, both functions, the notification changes |
| `worker/scripts/apply-apps-bookings.mjs` | The production apply script, which verifies before committing |
| `worker/src/apps/gating.ts` | `appsEnabledFor` |
| `worker/src/apps/bookings/time.ts` | Malaysian wall-clock helpers |
| `worker/src/apps/bookings/phone.ts` | `normalizeMyPhone` |
| `worker/src/apps/bookings/slots.ts` | `peakReserved`, `placesLeft`, `openSlots`, `lastBookableDate` |
| `worker/src/apps/bookings/messages.ts` | `bookingMessage`, `whatsappUrl`, `whenText` |
| `worker/src/apps/bookings/config.ts` | Parse, read and save the config; `ConfigError` |
| `worker/src/apps/bookings/bookings.ts` | List, get, decide, cancel, `bookingJson`, `queueCalendarJob` |
| `worker/src/routes/apps.ts` | `handleApps` |

**Test files created:**
- `apps-migration.test.ts`
- `apps-gating.test.ts`
- `apps-time-phone.test.ts`
- `apps-slots.test.ts`
- `apps-messages.test.ts`
- `notifications-url.test.ts`
- `apps-config-route.test.ts`
- `apps-bookings-route.test.ts`

**Modified:**

| File | Change |
|---|---|
| `worker/package.json` | Adds `db:migrate:apps-bookings` |
| `worker/src/env.ts` | Adds `APPS_ENABLED`, `APPS_BUSINESS_IDS`, `SITES_ORIGIN` |
| `worker/wrangler.toml` | Adds the same three to `[vars]`. `APPS_ENABLED` stays `"false"` until release. |
| `worker/src/permissions.ts` | Adds two rows |
| `worker/src/routes/session.ts` | Adds `features.apps` to `/api/me` |
| `worker/src/notifications/store.ts` | Adds the `booking_requested` kind and the persisted `url` |
| `worker/src/index.ts` | Chains `handleApps` |

---

## Task 0: Workspace

- [ ] **Step 1: Create an isolated worktree.** The shared checkout has other
  sessions' work in it. Per the global instructions, use `wt`:

```bash
cd ~/ios/aisar-site && wt new bookings-v1 && cd .worktrees/bookings-v1/worker && pnpm install
```

`wt new` changes into the worktree. If it prints a different path, use that.

- [ ] **Step 2: Confirm the baseline is green before changing anything.**
  Docker must be running.

```bash
docker info >/dev/null && pnpm typecheck && pnpm test -- --run test/goals-route.test.ts
```

Expected: typecheck passes, and the goals route tests pass.

---

## Task 1: Migration 067 and its apply script

**Files:**
- Create: `worker/migrations/067_apps_bookings.sql`
- Create: `worker/scripts/apply-apps-bookings.mjs`
- Modify: `worker/package.json` (the scripts block)
- Test: `worker/test/apps-migration.test.ts`

**Interfaces:**
- **Tables:**
  - `app_installation(business_id, app_key, state, public_slug, config_version, created_at, updated_at)`
  - `booking_settings(business_id, accepting, availability_acknowledged_at, min_notice_minutes, horizon_days, updated_at)`
  - `booking_service(business_id, id, name, duration_minutes, capacity, price_label, active, sort)`
  - `booking_hours(business_id, service_id, weekday, opens, closes)`
  - `booking(...)`, with the spec's columns plus `calendar_connection_id`
  - `booking_calendar_job(business_id, booking_id, desired, revision, completed_revision, attempts, next_attempt_at, lease_token, lease_expires_at, last_error, updated_at)`
- **Functions:**
  - `bookings_by_slug(p_slug text) → table(business_id uuid)`
  - `booking_calendar_due(p_now timestamptz, p_limit integer) → table(business_id uuid, booking_id uuid)`
- **Notification:** a new `url text` column, and the `booking_requested` kind.
- **Deviation from the spec:** the config version is an integer column,
  `config_version`, not derived from `updated_at`. A JavaScript `Date` drops
  Postgres's microseconds, so comparing timestamps would report false
  conflicts.

- [ ] **Step 1: Check the next free migration number.**

```bash
ls ~/ios/aisar-site/.worktrees/bookings-v1/worker/migrations | tail -3
```

Expected: the last file is `066_specialist_role_avatars.sql`. If a newer
number exists, use the next free one everywhere this plan says `067`.

- [ ] **Step 2: Write the failing migration test** at
  `worker/test/apps-migration.test.ts`.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { asApp, asOwner, asTenant, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded)
      values (${A}, 'Alpha', 'services', true), (${B}, 'Beta', 'salon', true)`;
    await sql`insert into app_installation (business_id, app_key, public_slug)
      values (${A}, 'bookings', 'alpha-studio'), (${B}, 'bookings', 'beta-salon')`;
  });
});

describe('apps and bookings schema', () => {
  it('scopes installations to the tenant and refuses writes for another business', async () => {
    const rows = await asTenant(A, (tx) => tx<{ public_slug: string }[]>`
      select public_slug from app_installation`);
    expect(rows.map((r) => r.public_slug)).toEqual(['alpha-studio']);
    await expect(asTenant(A, (tx) => tx`
      insert into booking_settings (business_id, availability_acknowledged_at)
      values (${B}, now())`)).rejects.toThrow(/row-level security/);
  });

  it('resolves a public slug to a business id and nothing else', async () => {
    const [found] = await asApp((sql) => sql<{ business_id: string }[]>`
      select * from public.bookings_by_slug('alpha-studio')`);
    expect(found).toEqual({ business_id: A });
    const missing = await asApp((sql) => sql`select * from public.bookings_by_slug('nobody')`);
    expect(missing).toHaveLength(0);
    await asOwner((sql) => sql`update app_installation set state = 'paused' where business_id = ${A}`);
    const paused = await asApp((sql) => sql`select * from public.bookings_by_slug('alpha-studio')`);
    expect(paused).toHaveLength(1);
  });

  it('refuses slugs outside the pattern, and duplicates across businesses', async () => {
    await expect(asOwner((sql) => sql`
      update app_installation set public_slug = 'Bad Slug' where business_id = ${A}`)).rejects.toThrow();
    await expect(asOwner((sql) => sql`
      update app_installation set public_slug = 'beta-salon' where business_id = ${A}`)).rejects.toThrow(/app_installation_slug/);
  });

  it('accepts booking_requested notifications with an internal url only', async () => {
    const [user] = await asOwner((sql) => sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('o@example.com', true) returning id`);
    await asOwner((sql) => sql`
      insert into notification (business_id, recipient_user_id, kind, title, body, source_key, url)
      values (${A}, ${user.id}, 'booking_requested', 'New booking', 'Aisyah, Sat 3 pm', 'booking:1',
              '/app?view=apps&app=bookings&booking=1')`);
    await expect(asOwner((sql) => sql`
      insert into notification (business_id, recipient_user_id, kind, title, body, source_key, url)
      values (${A}, ${user.id}, 'booking_requested', 't', 'b', 'booking:2', 'https://evil.example')`))
      .rejects.toThrow(/notification_url_check/);
  });

  it('lists due calendar jobs by id only, skipping leased and completed ones', async () => {
    const service = await asOwner(async (sql) => {
      const [s] = await sql<{ id: string }[]>`
        insert into booking_service (business_id, name, duration_minutes, capacity)
        values (${A}, 'Cupping class', 60, 4) returning id`;
      return s.id;
    });
    const booking = await asOwner(async (sql) => {
      const [b] = await sql<{ id: string }[]>`
        insert into booking (business_id, reference, submission_key, submission_hash, service_id,
          service_name, starts_at, ends_at, party_size, customer_name, customer_phone, status)
        values (${A}, 'K7Q2MP', gen_random_uuid(), 'h', ${service}, 'Cupping class',
          now() + interval '1 day', now() + interval '1 day 1 hour', 2, 'Aisyah', '60123456789', 'confirmed')
        returning id`;
      await sql`insert into booking_calendar_job (business_id, booking_id, desired) values (${A}, ${b.id}, 'present')`;
      return b.id;
    });
    const due = await asApp((sql) => sql`select * from public.booking_calendar_due(now(), 50)`);
    expect(due).toEqual([{ business_id: A, booking_id: booking }]);
    await asOwner((sql) => sql`update booking_calendar_job set lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '1 minute' where booking_id = ${booking}`);
    expect(await asApp((sql) => sql`select * from public.booking_calendar_due(now(), 50)`)).toHaveLength(0);
    await asOwner((sql) => sql`update booking_calendar_job set lease_token = null, lease_expires_at = null,
      completed_revision = revision where booking_id = ${booking}`);
    expect(await asApp((sql) => sql`select * from public.booking_calendar_due(now(), 50)`)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails.**

```bash
pnpm test -- --run test/apps-migration.test.ts
```

Expected: FAIL with `relation "app_installation" does not exist`.

- [ ] **Step 4: Write the migration** at
  `worker/migrations/067_apps_bookings.sql`.

```sql
-- Apps (migration 067). The first app is Bookings: a public page where a
-- business's customers request a time, and the owner's list behind it.
-- Every table is tenant-scoped under forced RLS. The public page finds a
-- business only through bookings_by_slug, a security definer that returns an
-- id and nothing else; everything after that runs inside withTenant.
-- Spec: docs/plans/2026-09-23-apps-shell-and-bookings-v1.md

create table if not exists app_installation (
  business_id    uuid not null references business(id) on delete cascade,
  app_key        text not null check (app_key in ('bookings')),
  state          text not null default 'active' check (state in ('active', 'paused')),
  public_slug    text not null check (public_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  -- An integer, not updated_at: a JS Date drops Postgres microseconds, so a
  -- timestamp version would report false conflicts.
  config_version integer not null default 1 check (config_version >= 1),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (business_id, app_key)
);
create unique index if not exists app_installation_slug on app_installation (public_slug);
alter table app_installation enable row level security;
alter table app_installation force row level security;
drop policy if exists app_installation_tenant on app_installation;
create policy app_installation_tenant on app_installation
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update on app_installation to aisar_app;

create table if not exists booking_settings (
  business_id                  uuid primary key references business(id) on delete cascade,
  accepting                    boolean not null default true,
  availability_acknowledged_at timestamptz not null,
  min_notice_minutes           integer not null default 120 check (min_notice_minutes between 0 and 10080),
  horizon_days                 integer not null default 30 check (horizon_days between 1 and 90),
  updated_at                   timestamptz not null default now()
);
alter table booking_settings enable row level security;
alter table booking_settings force row level security;
drop policy if exists booking_settings_tenant on booking_settings;
create policy booking_settings_tenant on booking_settings
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update on booking_settings to aisar_app;

create table if not exists booking_service (
  business_id      uuid not null references business(id) on delete cascade,
  id               uuid not null default gen_random_uuid(),
  name             text not null check (char_length(name) between 1 and 80),
  duration_minutes integer not null check (duration_minutes between 15 and 480 and duration_minutes % 15 = 0),
  capacity         integer not null default 1 check (capacity between 1 and 50),
  price_label      text check (char_length(price_label) <= 40),
  active           boolean not null default true,
  sort             integer not null default 0,
  primary key (business_id, id)
);
alter table booking_service enable row level security;
alter table booking_service force row level security;
drop policy if exists booking_service_tenant on booking_service;
create policy booking_service_tenant on booking_service
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update, delete on booking_service to aisar_app;

create table if not exists booking_hours (
  business_id uuid not null,
  service_id  uuid not null,
  weekday     smallint not null check (weekday between 0 and 6),  -- 0 = Sunday
  opens       time not null,
  closes      time not null,
  check (closes > opens),
  primary key (business_id, service_id, weekday, opens),
  foreign key (business_id, service_id) references booking_service (business_id, id) on delete cascade
);
alter table booking_hours enable row level security;
alter table booking_hours force row level security;
drop policy if exists booking_hours_tenant on booking_hours;
create policy booking_hours_tenant on booking_hours
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update, delete on booking_hours to aisar_app;

create table if not exists booking (
  business_id            uuid not null,
  id                     uuid not null default gen_random_uuid(),
  reference              text not null check (reference ~ '^[A-HJ-NP-Z2-9]{6}$'),
  submission_key         uuid not null,
  submission_hash        text not null check (char_length(submission_hash) between 1 and 128),
  service_id             uuid not null,
  service_name           text not null check (char_length(service_name) between 1 and 80),
  starts_at              timestamptz not null,
  ends_at                timestamptz not null,
  party_size             integer not null check (party_size between 1 and 50),
  customer_name          text not null check (char_length(customer_name) between 1 and 80),
  customer_phone         text not null check (customer_phone ~ '^60[0-9]{8,11}$'),
  note                   text check (char_length(note) <= 500),
  status                 text not null default 'pending'
                         check (status in ('pending', 'confirmed', 'declined', 'cancelled')),
  decided_at             timestamptz,
  decided_by             uuid references app_user(id) on delete set null,
  cancelled_at           timestamptz,
  cancelled_by           uuid references app_user(id) on delete set null,
  calendar_status        text not null default 'none'
                         check (calendar_status in ('none', 'pending', 'created', 'failed', 'not_connected', 'removed')),
  -- connection.id is a single-column key; a composite tenant key is not
  -- available. The value is only ever set from findConnection under RLS.
  calendar_connection_id uuid references connection(id) on delete set null,
  calendar_event_id      text check (char_length(calendar_event_id) <= 1024),
  calendar_error         text check (char_length(calendar_error) <= 300),
  created_at             timestamptz not null default now(),
  check (ends_at > starts_at),
  primary key (business_id, id),
  unique (business_id, reference),
  unique (business_id, submission_key),
  foreign key (business_id, service_id) references booking_service (business_id, id)
);
create index if not exists booking_slot on booking (business_id, service_id, starts_at)
  where status in ('pending', 'confirmed');
create index if not exists booking_window on booking (business_id, starts_at);
create index if not exists booking_created on booking (business_id, created_at);
alter table booking enable row level security;
alter table booking force row level security;
drop policy if exists booking_tenant on booking;
create policy booking_tenant on booking
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update on booking to aisar_app;

-- One row per booking: the Calendar state the booking wants. The executor
-- (plan 3) claims a row with a lease, acts outside the transaction, and
-- completes only when its lease and revision still match.
create table if not exists booking_calendar_job (
  business_id        uuid not null,
  booking_id         uuid not null,
  desired            text not null check (desired in ('present', 'absent')),
  revision           integer not null default 1 check (revision >= 1),
  completed_revision integer,
  attempts           integer not null default 0 check (attempts >= 0),
  next_attempt_at    timestamptz not null default now(),
  lease_token        uuid,
  lease_expires_at   timestamptz,
  last_error         text check (char_length(last_error) <= 300),
  updated_at         timestamptz not null default now(),
  primary key (business_id, booking_id),
  foreign key (business_id, booking_id) references booking (business_id, id) on delete cascade
);
create index if not exists booking_calendar_job_due on booking_calendar_job (next_attempt_at, booking_id)
  where completed_revision is distinct from revision;
alter table booking_calendar_job enable row level security;
alter table booking_calendar_job force row level security;
drop policy if exists booking_calendar_job_tenant on booking_calendar_job;
create policy booking_calendar_job_tenant on booking_calendar_job
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update on booking_calendar_job to aisar_app;

-- The public page has no tenant. Like invitation_by_token (035), this returns
-- an id and nothing else; paused installations resolve so the page can say
-- "not taking bookings". The pilot flag is checked in the Worker.
create or replace function public.bookings_by_slug(p_slug text)
returns table (business_id uuid)
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select a.business_id from public.app_installation a
   where a.public_slug = p_slug and a.app_key = 'bookings'
   limit 1
$$;
revoke all on function public.bookings_by_slug(text) from public;
grant execute on function public.bookings_by_slug(text) to aisar_app;

-- The cron has no tenant either. Ids only, like push_outbox_due (031).
create or replace function public.booking_calendar_due(p_now timestamptz, p_limit integer default 50)
returns table (business_id uuid, booking_id uuid)
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select j.business_id, j.booking_id from public.booking_calendar_job j
   where j.completed_revision is distinct from j.revision
     and j.next_attempt_at <= p_now
     and j.attempts < 8
     and (j.lease_expires_at is null or j.lease_expires_at <= p_now)
   order by j.next_attempt_at, j.booking_id
   limit greatest(1, least(p_limit, 200))
$$;
revoke all on function public.booking_calendar_due(timestamptz, integer) from public;
grant execute on function public.booking_calendar_due(timestamptz, integer) to aisar_app;

-- Where a notification leads, stored so the in-app inbox and the push open
-- the same place. Generic, so later apps do not each add a foreign key here.
-- Internal workspace paths only.
alter table notification add column if not exists url text;
alter table notification drop constraint if exists notification_url_check;
alter table notification add constraint notification_url_check check (
  url is null or (char_length(url) <= 300 and url ~ '^/app([/?#]|$)'));

alter table notification drop constraint if exists notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'routine_completed', 'routine_failed', 'routine_skipped', 'routine_needs_approval',
  'work_needs_you', 'approval_requested', 'reminder_due', 'booking_requested'
));
```

- [ ] **Step 5: Run the test and confirm it passes.**

```bash
pnpm test -- --run test/apps-migration.test.ts
```

Expected: 5 passed. The harness applies every migration in `migrations/` at
startup.

- [ ] **Step 6: Write the production apply script** at
  `worker/scripts/apply-apps-bookings.mjs`. It follows `apply-goals.mjs`
  exactly for the host allowlist.

```js
#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
const target = new URL(connection);
const allowedHosts = new Set([
  'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech',
  'ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech',
]);
if ((target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') ||
    !allowedHosts.has(target.hostname) || target.pathname !== '/neondb' ||
    target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}

const TABLES = {
  app_installation: 'select,insert,update',
  booking_settings: 'select,insert,update',
  booking_service: 'select,insert,update,delete',
  booking_hours: 'select,insert,update,delete',
  booking: 'select,insert,update',
  booking_calendar_job: 'select,insert,update',
};

const migration = await readFile(new URL('../migrations/067_apps_bookings.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const checks = {};
    for (const [table, privileges] of Object.entries(TABLES)) {
      const [row] = await tx`
        select
          (select relrowsecurity and relforcerowsecurity from pg_class
            where oid = ${'public.' + table}::regclass) as forced_rls,
          (select count(*) = 1 from pg_policies
            where schemaname = 'public' and tablename = ${table}
              and policyname = ${table + '_tenant'}
              and qual is not null and with_check is not null) as tenant_policy,
          has_table_privilege('aisar_app', ${'public.' + table}, ${privileges}) as app_grants`;
      for (const key of ['forced_rls', 'tenant_policy', 'app_grants']) {
        if (!row[key]) throw new Error(`apps migration verification failed: ${table}.${key}`);
      }
      checks[table] = row;
    }
    const [fn] = await tx`
      select
        has_function_privilege('aisar_app', 'public.bookings_by_slug(text)', 'execute') as slug_fn,
        has_function_privilege('aisar_app', 'public.booking_calendar_due(timestamptz, integer)', 'execute') as due_fn,
        (select count(*) = 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'notification' and column_name = 'url') as notification_url,
        (select pg_get_constraintdef(oid) like '%booking_requested%' from pg_constraint
          where conrelid = 'public.notification'::regclass and conname = 'notification_kind_check') as booking_kind`;
    for (const key of ['slug_fn', 'due_fn', 'notification_url', 'booking_kind']) {
      if (!fn[key]) throw new Error(`apps migration verification failed: ${key}`);
    }
    return { ...checks, ...fn };
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '067_apps_bookings', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
```

- [ ] **Step 7: Register the script.** In `worker/package.json`, add this line
  beside the other `db:migrate:*` entries:

```json
"db:migrate:apps-bookings": "node scripts/apply-apps-bookings.mjs",
```

- [ ] **Step 8: Typecheck and commit.**

```bash
pnpm typecheck
git add migrations/067_apps_bookings.sql scripts/apply-apps-bookings.mjs package.json test/apps-migration.test.ts
git commit -m "feat(worker): schema for the Bookings app under forced RLS"
```

---

## Task 2: Pilot flag, permissions and `/api/me` discovery

**Files:**
- Create: `worker/src/apps/gating.ts`
- Modify: `worker/src/env.ts` (after `DESKTOP_VIEW_BUSINESS_IDS`, line 77)
- Modify: `worker/wrangler.toml` (`[vars]`, after `AISAR_ROUTINES_BUSINESS_IDS`, line 196)
- Modify: `worker/src/permissions.ts` (the `PERMISSIONS` object)
- Modify: `worker/src/routes/session.ts:622-625` (the `features` object)
- Test: `worker/test/apps-gating.test.ts`

**Interfaces:**
- Produces `appsEnabledFor(env: Env, businessId: string): boolean`.
- Produces the permissions `'apps.manage'` and `'bookings.decide'`.
- Produces `env.SITES_ORIGIN?: string`, which later tasks use for public links.

- [ ] **Step 1: Write the failing test** at `worker/test/apps-gating.test.ts`.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { appsEnabledFor } from '../src/apps/gating';
import { handleSession } from '../src/routes/session';
import { asOwner, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:5173' };

describe('appsEnabledFor', () => {
  it('needs the switch and an exact id, with no wildcard', () => {
    expect(appsEnabledFor(testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: A }), A)).toBe(true);
    expect(appsEnabledFor(testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: ` ${A.toUpperCase()} ,${B}` }), A)).toBe(true);
    expect(appsEnabledFor(testEnv({ APPS_ENABLED: 'false', APPS_BUSINESS_IDS: A }), A)).toBe(false);
    expect(appsEnabledFor(testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: '' }), A)).toBe(false);
    expect(appsEnabledFor(testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: '*' }), A)).toBe(false);
    expect(appsEnabledFor(testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: B }), A)).toBe(false);
    expect(appsEnabledFor(testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: `${A},not-a-uuid` }), A)).toBe(false);
  });
});

describe('/api/me advertises apps to owners only', () => {
  let owner = '';
  let staff = '';
  beforeEach(async () => {
    await truncateAll();
    const ids = await asOwner(async (sql) => {
      await sql`insert into business (id, name, playbook_key, onboarded) values (${A}, 'Alpha', 'services', true)`;
      await sql`update business set plan = 'team' where id = ${A}`;
      const [o] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('owner@example.com', true) returning id`;
      const [s] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('staff@example.com', true) returning id`;
      await sql`insert into membership (user_id, business_id, role) values (${o.id}, ${A}, 'owner'), (${s.id}, ${A}, 'staff')`;
      return { o: o.id, s: s.id };
    });
    owner = await signIn(ids.o);
    staff = await signIn(ids.s);
  });

  async function features(cookie: string, env = testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: A })) {
    const { request, url } = req('GET', '/api/me', { cookie });
    const res = await handleSession(request, env, url, CORS);
    return ((await res!.json()) as { features?: Record<string, unknown> }).features ?? {};
  }

  it('includes apps for the owner of an allowed business', async () => {
    expect((await features(owner)).apps).toEqual({ apiVersion: 1 });
  });
  it('omits apps for staff, and when the flag is off', async () => {
    expect((await features(staff)).apps).toBeUndefined();
    expect((await features(owner, testEnv({ APPS_ENABLED: 'false', APPS_BUSINESS_IDS: A }))).apps).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

```bash
pnpm test -- --run test/apps-gating.test.ts
```

Expected: FAIL with `Cannot find module '../src/apps/gating'`.

- [ ] **Step 3: Add the env fields.** In `worker/src/env.ts`, directly after
  `DESKTOP_VIEW_BUSINESS_IDS?: string;`, add:

```ts
  /* Apps pilot (docs/plans/2026-09-23-apps-shell-and-bookings-v1.md).
     Exact business ids only, like desktop view: an empty list is nobody. */
  APPS_ENABLED?: string;
  APPS_BUSINESS_IDS?: string;
  /* The public origin of the sites deploy, e.g.
     https://jentera-sites.qhkmdev90.workers.dev — used to build booking links. */
  SITES_ORIGIN?: string;
```

- [ ] **Step 4: Create `worker/src/apps/gating.ts`.**

```ts
import type { Env } from '../env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_APPS_PILOTS = 20;

/** The apps pilot list. Like desktop view and unlike routines: an empty list
    means nobody, there is no wildcard, and one malformed id turns the whole
    list off rather than guessing. */
export function appsEnabledFor(env: Env, businessId: string): boolean {
  if (env.APPS_ENABLED !== 'true' || !UUID.test(businessId)) return false;
  const ids = (env.APPS_BUSINESS_IDS ?? '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean);
  return ids.length > 0 && ids.length <= MAX_APPS_PILOTS && ids.every((id) => UUID.test(id)) &&
    ids.includes(businessId.toLowerCase());
}
```

- [ ] **Step 5: Add the permissions.** In `worker/src/permissions.ts`, add these
  rows to `PERMISSIONS`, after `'agent.memory'`:

```ts
  /** Install, configure and pause business apps, and see their public links. */
  'apps.manage': ['owner'],
  /** Confirm, decline and cancel booking requests from customers. */
  'bookings.decide': ['owner'],
```

- [ ] **Step 6: Advertise it on `/api/me`.**
  - In `worker/src/routes/session.ts`, add these imports at the top:
    `import { appsEnabledFor } from '../apps/gating';` and, if it is not
    already imported, `import { can } from '../permissions';`.
  - Then extend the `features` object (lines 622-625):

```ts
    const features = {
      ...(businessId && routinesEnabledFor(env, businessId) ? { routines: { apiVersion: 1 } } : {}),
      ...(plan === 'team' ? { team: { apiVersion: 1 } } : {}),
      /* Owners only: staff never learn the feature exists, so the app needs
         no role check of its own (spec D3). */
      ...(businessId && appsEnabledFor(env, businessId) && can(identity, 'apps.manage')
        ? { apps: { apiVersion: 1 } } : {}),
    };
```

- [ ] **Step 7: Add the vars.** In `worker/wrangler.toml` `[vars]`, after
  `AISAR_ROUTINES_BUSINESS_IDS`:

```toml
# Apps pilot. Stays "false" until the release step in the spec flips it.
APPS_ENABLED = "false"
APPS_BUSINESS_IDS = "4e8c2593-2af2-494f-b157-fec0295a50b5"
SITES_ORIGIN = "https://jentera-sites.qhkmdev90.workers.dev"
```

- [ ] **Step 8: Run the tests.**

```bash
pnpm test -- --run test/apps-gating.test.ts test/routines.test.ts test/permissions.test.ts
```

Expected: all pass. `routines.test.ts` proves `/api/me` still advertises
routines, and `permissions.test.ts` still passes.

- [ ] **Step 9: Typecheck and commit.**

```bash
pnpm typecheck
git add src/apps/gating.ts src/env.ts wrangler.toml src/permissions.ts src/routes/session.ts test/apps-gating.test.ts
git commit -m "feat(worker): apps pilot flag, owner permissions and /api/me discovery"
```

---

## Task 3: Malaysian time and phone numbers

**Files:**
- Create: `worker/src/apps/bookings/time.ts`
- Create: `worker/src/apps/bookings/phone.ts`
- Test: `worker/test/apps-time-phone.test.ts`

**Interfaces:**
- **From `time.ts`:**
  - `MY_TIME_ZONE`
  - `isDate(v): boolean`
  - `isClock(v): boolean`, for `HH:MM` from 00:00 to 23:59
  - `clockMinutes(v): number`
  - `myDate(instant): string`
  - `myInstant(date, minutes?): Date`
  - `addDays(date, n): string`
  - `weekday(date): number`
  - `myIso(instant): string`
  - `myParts(instant): { weekday, day, month, hour, minute }`
- **From `phone.ts`:** `normalizeMyPhone(input: string): string | null`

- [ ] **Step 1: Write the failing test** at `worker/test/apps-time-phone.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { normalizeMyPhone } from '../src/apps/bookings/phone';
import { addDays, clockMinutes, isClock, isDate, myDate, myInstant, myIso, myParts, weekday } from '../src/apps/bookings/time';

describe('Malaysian time', () => {
  it('reads the Malaysian date across UTC midnight', () => {
    expect(myDate(new Date('2026-09-26T16:30:00Z'))).toBe('2026-09-27');
    expect(myDate(new Date('2026-09-26T15:59:00Z'))).toBe('2026-09-26');
  });
  it('builds instants from a Malaysian date and minutes', () => {
    expect(myInstant('2026-09-27').toISOString()).toBe('2026-09-26T16:00:00.000Z');
    expect(myInstant('2026-09-27', 15 * 60).toISOString()).toBe('2026-09-27T07:00:00.000Z');
    expect(myIso(new Date('2026-09-27T07:00:00Z'))).toBe('2026-09-27T15:00:00+08:00');
  });
  it('walks dates and weekdays', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(weekday('2026-09-27')).toBe(0); // a Sunday
    expect(myParts(new Date('2026-09-27T07:05:00Z'))).toEqual({ weekday: 0, day: 27, month: 8, hour: 15, minute: 5 });
  });
  it('validates dates and clock times strictly', () => {
    expect(isDate('2026-02-29')).toBe(false);
    expect(isDate('2028-02-29')).toBe(true);
    expect(isClock('09:30')).toBe(true);
    expect(isClock('24:00')).toBe(false);
    expect(isClock('9:30')).toBe(false);
    expect(clockMinutes('15:45')).toBe(945);
    expect(clockMinutes('15:45:00')).toBe(945);
  });
});

describe('normalizeMyPhone', () => {
  it.each([
    ['012-345 6789', '60123456789'],
    ['+60 12 345 6789', '60123456789'],
    ['60123456789', '60123456789'],
    ['011-2345 6789', '601123456789'],
    ['(03) 2345-6789', '60323456789'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeMyPhone(input)).toBe(expected);
  });
  it.each(['', '12345', '+65 9123 4567', '0123-abc-456', '0060123456789', '012345'])('refuses %s', (input) => {
    expect(normalizeMyPhone(input)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

```bash
pnpm test -- --run test/apps-time-phone.test.ts
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Create `worker/src/apps/bookings/time.ts`.**

```ts
/* Malaysian wall-clock time for Bookings.

   Malaysia has kept UTC+8 with no daylight saving since 1982, so a fixed
   offset is exact, and it keeps this arithmetic independent of Intl data,
   which varies by runtime. Every date a person sees or types is a Malaysian
   date; every instant stored is a timestamptz. */

export const MY_TIME_ZONE = 'Asia/Kuala_Lumpur';
const OFFSET_MS = 8 * 60 * 60_000;
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** 'HH:MM' from 00:00 to 23:59. Midnight as a closing time is not supported. */
export function isClock(value: string): boolean {
  return CLOCK.test(value);
}

/** Minutes after midnight for 'HH:MM' or Postgres 'HH:MM:SS'. */
export function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/** The Malaysian calendar date of an instant, as YYYY-MM-DD. */
export function myDate(instant: Date): string {
  return new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant a Malaysian date begins, plus `minutes`. */
export function myInstant(date: string, minutes = 0): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - OFFSET_MS + minutes * 60_000);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday, matching booking_hours.weekday. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** RFC 3339 with the Malaysian offset: 2026-09-27T15:00:00+08:00. */
export function myIso(instant: Date): string {
  return `${new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 19)}+08:00`;
}

export function myParts(instant: Date): { weekday: number; day: number; month: number; hour: number; minute: number } {
  const local = new Date(instant.getTime() + OFFSET_MS);
  return {
    weekday: local.getUTCDay(),
    day: local.getUTCDate(),
    month: local.getUTCMonth(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}
```

- [ ] **Step 4: Create `worker/src/apps/bookings/phone.ts`.**

```ts
/* Malaysian phone numbers only (spec D8). Stored as digits with the country
   code, 60…, which is also the form wa.me expects. Anything that is not a
   Malaysian number is refused rather than guessed at. */

const ALLOWED = /^\+?[0-9\s().-]+$/;
const STORED = /^60[0-9]{8,11}$/;

export function normalizeMyPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || !ALLOWED.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  const normalized = trimmed.startsWith('+') || digits.startsWith('60')
    ? digits
    : digits.startsWith('0') ? `6${digits}` : '';
  return STORED.test(normalized) ? normalized : null;
}
```

- [ ] **Step 5: Run the test and confirm it passes.**

```bash
pnpm test -- --run test/apps-time-phone.test.ts
```

Expected: all pass. `'0060123456789'` becomes `'60060123456789'`, 14 digits,
which is refused.

- [ ] **Step 6: Typecheck and commit.**

```bash
pnpm typecheck
git add src/apps/bookings/time.ts src/apps/bookings/phone.ts test/apps-time-phone.test.ts
git commit -m "feat(worker): Malaysian time and phone helpers for bookings"
```

---

## Task 4: Open times and capacity

**Files:**
- Create: `worker/src/apps/bookings/slots.ts`
- Test: `worker/test/apps-slots.test.ts`

**Interfaces:**
- Consumes `addDays`, `clockMinutes`, `myDate`, `myInstant` and `weekday` from
  Task 3.
- **Produces types:**
  - `SlotService { durationMinutes: number; capacity: number }`
  - `SlotHours { weekday: number; opens: string; closes: string }`
  - `SlotSettings { minNoticeMinutes: number; horizonDays: number }`
  - `Reservation { startsAt: Date; endsAt: Date; partySize: number }`
  - `OpenSlot { startsAt: Date; endsAt: Date; remaining: number }`
- **Produces functions:**
  - `peakReserved(reservations, start, end?): number`. With no `end`, it looks
    forever.
  - `placesLeft(capacity, reservations, start, end): number`
  - `lastBookableDate(now, horizonDays): string`
  - `openSlots({ service, hours, settings, reservations, now, from, days }): OpenSlot[]`
- **The horizon rule:** `lastBookableDate` is today's Malaysian date plus
  `horizonDays`. Today is day 0.

- [ ] **Step 1: Write the failing test** at `worker/test/apps-slots.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { lastBookableDate, openSlots, peakReserved, placesLeft, type Reservation } from '../src/apps/bookings/slots';

const at = (iso: string) => new Date(iso);
const r = (start: string, end: string, partySize: number): Reservation =>
  ({ startsAt: at(start), endsAt: at(end), partySize });

describe('peakReserved and placesLeft', () => {
  it('treats ends as exclusive, so back-to-back bookings do not overlap', () => {
    const held = [r('2026-09-27T02:00:00Z', '2026-09-27T03:00:00Z', 1)];
    expect(placesLeft(1, held, at('2026-09-27T03:00:00Z'), at('2026-09-27T04:00:00Z'))).toBe(1);
  });
  it('counts partial overlap: a 10–11 booking blocks a 10:30–11:30 slot at capacity 1', () => {
    const held = [r('2026-09-27T02:00:00Z', '2026-09-27T03:00:00Z', 1)];
    expect(placesLeft(1, held, at('2026-09-27T02:30:00Z'), at('2026-09-27T03:30:00Z'))).toBe(0);
  });
  it('does not double-count two successive bookings under one longer slot', () => {
    const held = [
      r('2026-09-27T02:00:00Z', '2026-09-27T03:00:00Z', 2),
      r('2026-09-27T03:00:00Z', '2026-09-27T04:00:00Z', 2),
    ];
    expect(peakReserved(held, at('2026-09-27T02:00:00Z'), at('2026-09-27T04:00:00Z'))).toBe(2);
    expect(placesLeft(3, held, at('2026-09-27T02:00:00Z'), at('2026-09-27T04:00:00Z'))).toBe(1);
  });
  it('adds up truly concurrent bookings, including one that started earlier', () => {
    const held = [
      r('2026-09-27T01:00:00Z', '2026-09-27T03:00:00Z', 1),
      r('2026-09-27T02:00:00Z', '2026-09-27T03:00:00Z', 2),
    ];
    expect(peakReserved(held, at('2026-09-27T02:00:00Z'), at('2026-09-27T03:00:00Z'))).toBe(3);
  });
  it('looks forever when no end is given', () => {
    const held = [r('2030-01-01T00:00:00Z', '2030-01-01T01:00:00Z', 4)];
    expect(peakReserved(held, at('2026-09-27T00:00:00Z'))).toBe(4);
  });
});

describe('openSlots', () => {
  const service = { durationMinutes: 60, capacity: 2 };
  const settings = { minNoticeMinutes: 120, horizonDays: 30 };
  // Sunday 27 Sep 2026, 10:00–13:00 Malaysian time.
  const hours = [{ weekday: 0, opens: '10:00', closes: '13:00' }];
  const now = at('2026-09-26T00:00:00Z'); // Sat 08:00 in Malaysia

  it('steps by duration from opening and stops when a slot would pass closing', () => {
    const slots = openSlots({ service, hours, settings, reservations: [], now, from: '2026-09-27', days: 1 });
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-09-27T02:00:00.000Z', '2026-09-27T03:00:00.000Z', '2026-09-27T04:00:00.000Z',
    ]);
    expect(slots.every((s) => s.remaining === 2)).toBe(true);
  });
  it('drops starts inside the minimum notice', () => {
    const late = at('2026-09-27T01:30:00Z'); // 09:30 Malaysia; notice ends 11:30
    const slots = openSlots({ service, hours, settings, reservations: [], now: late, from: '2026-09-27', days: 1 });
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual(['2026-09-27T04:00:00.000Z']);
  });
  it('hides full slots and shows what is left of partly held ones', () => {
    const reservations = [r('2026-09-27T02:00:00Z', '2026-09-27T03:00:00Z', 2), r('2026-09-27T03:00:00Z', '2026-09-27T04:00:00Z', 1)];
    const slots = openSlots({ service, hours, settings, reservations, now, from: '2026-09-27', days: 1 });
    expect(slots.map((s) => [s.startsAt.toISOString(), s.remaining])).toEqual([
      ['2026-09-27T03:00:00.000Z', 1], ['2026-09-27T04:00:00.000Z', 2],
    ]);
  });
  it('never offers a date past the horizon, whatever the caller asks for', () => {
    expect(lastBookableDate(now, 1)).toBe('2026-09-27');
    const beyond = openSlots({ service, hours, settings: { ...settings, horizonDays: 1 }, reservations: [], now, from: '2026-10-04', days: 7 });
    expect(beyond).toEqual([]);
  });
  it('returns each start once even if ranges repeat', () => {
    const doubled = [...hours, { weekday: 0, opens: '10:00', closes: '11:00' }];
    const slots = openSlots({ service, hours: doubled, settings, reservations: [], now, from: '2026-09-27', days: 1 });
    expect(new Set(slots.map((s) => s.startsAt.getTime())).size).toBe(slots.length);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

```bash
pnpm test -- --run test/apps-slots.test.ts
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Create `worker/src/apps/bookings/slots.ts`.**

```ts
import { addDays, clockMinutes, myDate, myInstant, weekday } from './time';

export interface SlotService { durationMinutes: number; capacity: number }
export interface SlotHours { weekday: number; opens: string; closes: string }
export interface SlotSettings { minNoticeMinutes: number; horizonDays: number }
export interface Reservation { startsAt: Date; endsAt: Date; partySize: number }
export interface OpenSlot { startsAt: Date; endsAt: Date; remaining: number }

const FOREVER = new Date(8.64e15);

/** The most places held at any instant of [start, end).

    Ends are exclusive, so a booking ending at 11:00 and one starting at
    11:00 never overlap. Summing every overlapping row would be wrong: two
    successive bookings can each overlap a longer slot without ever
    overlapping each other, so this sweeps the boundaries instead. */
export function peakReserved(reservations: Reservation[], start: Date, end: Date = FOREVER): number {
  const s = start.getTime();
  const e = end.getTime();
  const edges: Array<[number, number]> = [];
  for (const held of reservations) {
    const hs = held.startsAt.getTime();
    const he = held.endsAt.getTime();
    if (hs < e && he > s) edges.push([Math.max(hs, s), held.partySize], [Math.min(he, e), -held.partySize]);
  }
  // At one instant, releases come before new holds: that is the exclusive end.
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let peak = 0;
  for (const [, delta] of edges) {
    current += delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

export function placesLeft(capacity: number, reservations: Reservation[], start: Date, end: Date): number {
  return Math.max(0, capacity - peakReserved(reservations, start, end));
}

/** The last Malaysian date a customer may book; today counts as day 0. */
export function lastBookableDate(now: Date, horizonDays: number): string {
  return addDays(myDate(now), horizonDays);
}

/** Open start times for one service, in order, each once.

    `reservations` must be the service's pending and confirmed bookings that
    can overlap the dates asked for; declined and cancelled rows hold
    nothing. Slots start at opening time and step by the duration while
    the slot still ends by closing time. */
export function openSlots(input: {
  service: SlotService;
  hours: SlotHours[];
  settings: SlotSettings;
  reservations: Reservation[];
  now: Date;
  from: string;
  days: number;
}): OpenSlot[] {
  const { service, hours, settings, reservations, now } = input;
  const earliest = now.getTime() + settings.minNoticeMinutes * 60_000;
  const last = lastBookableDate(now, settings.horizonDays);
  const found = new Map<number, OpenSlot>();
  for (let offset = 0; offset < input.days; offset += 1) {
    const date = addDays(input.from, offset);
    if (date > last) break;
    const day = weekday(date);
    for (const range of hours) {
      if (range.weekday !== day) continue;
      const closes = clockMinutes(range.closes);
      for (let minute = clockMinutes(range.opens); minute + service.durationMinutes <= closes; minute += service.durationMinutes) {
        const startsAt = myInstant(date, minute);
        const key = startsAt.getTime();
        if (key < earliest || found.has(key)) continue;
        const endsAt = new Date(key + service.durationMinutes * 60_000);
        const remaining = placesLeft(service.capacity, reservations, startsAt, endsAt);
        if (remaining > 0) found.set(key, { startsAt, endsAt, remaining });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
```

- [ ] **Step 4: Run the test and confirm it passes.**

```bash
pnpm test -- --run test/apps-slots.test.ts
```

Expected: all pass.

- [ ] **Step 5: Typecheck and commit.**

```bash
pnpm typecheck
git add src/apps/bookings/slots.ts test/apps-slots.test.ts
git commit -m "feat(worker): open booking times with interval-overlap capacity"
```

---

## Task 5: WhatsApp messages

**Files:**
- Create: `worker/src/apps/bookings/messages.ts`
- Test: `worker/test/apps-messages.test.ts`

**Interfaces:**
- Consumes `myParts` from Task 3.
- Produces `type Lang = 'en' | 'bm'` and
  `type MessageKind = 'confirm' | 'decline' | 'cancel'`.
- Produces
  `interface MessageInput { kind; lang; customerName; serviceName; partySize; startsAt; reference; businessName; publicUrl }`.
- Produces `whenText(startsAt, lang): string`,
  `bookingMessage(input): string` and
  `whatsappUrl(phone, text): string`.

- [ ] **Step 1: Write the failing test** at `worker/test/apps-messages.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { bookingMessage, whatsappUrl, whenText, type MessageInput } from '../src/apps/bookings/messages';

const base: MessageInput = {
  kind: 'confirm', lang: 'en', customerName: 'Aisyah', serviceName: 'cupping class', partySize: 2,
  startsAt: new Date('2026-09-26T07:00:00Z'), // Sat 26 Sep, 3:00 pm Malaysia
  reference: 'K7Q2MP', businessName: 'SEIDO Coffee', publicUrl: 'https://sites.test/b/seido',
};

describe('booking messages', () => {
  it('formats the Malaysian time in each language', () => {
    expect(whenText(base.startsAt, 'en')).toBe('Sat 26 Sep at 3:00 pm');
    expect(whenText(base.startsAt, 'bm')).toBe('Sabtu 26 Sep, 3.00 petang');
    expect(whenText(new Date('2026-09-26T02:30:00Z'), 'bm')).toBe('Sabtu 26 Sep, 10.30 pagi');
    expect(whenText(new Date('2026-09-26T04:00:00Z'), 'en')).toBe('Sat 26 Sep at 12:00 pm');
  });
  it('writes the confirmation, decline and cancellation in English', () => {
    expect(bookingMessage(base)).toBe(
      'Hi Aisyah, your cupping class for 2 people on Sat 26 Sep at 3:00 pm is confirmed. Ref K7Q2MP. See you at SEIDO Coffee.');
    expect(bookingMessage({ ...base, kind: 'decline' })).toBe(
      "Hi Aisyah, sorry, we can't take your cupping class booking on Sat 26 Sep at 3:00 pm. Please choose another time: https://sites.test/b/seido");
    expect(bookingMessage({ ...base, kind: 'cancel', partySize: 1 })).toContain('(ref K7Q2MP) has been cancelled');
  });
  it('writes them in Malay', () => {
    expect(bookingMessage({ ...base, lang: 'bm' })).toBe(
      'Hai Aisyah, tempahan cupping class anda untuk 2 orang pada Sabtu 26 Sep, 3.00 petang telah disahkan. Rujukan K7Q2MP. Jumpa di SEIDO Coffee.');
    expect(bookingMessage({ ...base, lang: 'bm', kind: 'cancel' })).toContain('telah dibatalkan');
  });
  it('URL-encodes the text for wa.me, never HTML-escapes it', () => {
    const url = whatsappUrl('60123456789', 'Hi <Aisyah> & co?');
    expect(url).toBe('https://wa.me/60123456789?text=Hi%20%3CAisyah%3E%20%26%20co%3F');
    expect(decodeURIComponent(url.split('text=')[1])).toBe('Hi <Aisyah> & co?');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

```bash
pnpm test -- --run test/apps-messages.test.ts
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Create `worker/src/apps/bookings/messages.ts`.**

```ts
import { myParts } from './time';

/* What the owner sends the customer on WhatsApp, prefilled into a wa.me link
   that the owner taps. Opening that link is not delivery: nothing here or in
   the UI may claim a message was sent. Text only; wa.me takes it URL-encoded. */

export type Lang = 'en' | 'bm';
export type MessageKind = 'confirm' | 'decline' | 'cancel';

export interface MessageInput {
  kind: MessageKind;
  lang: Lang;
  customerName: string;
  serviceName: string;
  partySize: number;
  startsAt: Date;
  reference: string;
  businessName: string;
  publicUrl: string;
}

const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BM_DAYS = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
const BM_MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];

export function whenText(startsAt: Date, lang: Lang): string {
  const p = myParts(startsAt);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const minutes = String(p.minute).padStart(2, '0');
  if (lang === 'bm') {
    const period = p.hour < 12 ? 'pagi' : p.hour < 14 ? 'tengah hari' : p.hour < 19 ? 'petang' : 'malam';
    return `${BM_DAYS[p.weekday]} ${p.day} ${BM_MONTHS[p.month]}, ${hour12}.${minutes} ${period}`;
  }
  return `${EN_DAYS[p.weekday]} ${p.day} ${EN_MONTHS[p.month]} at ${hour12}:${minutes} ${p.hour < 12 ? 'am' : 'pm'}`;
}

export function bookingMessage(m: MessageInput): string {
  const when = whenText(m.startsAt, m.lang);
  if (m.lang === 'bm') {
    if (m.kind === 'confirm') {
      return `Hai ${m.customerName}, tempahan ${m.serviceName} anda untuk ${m.partySize} orang pada ${when} telah disahkan. Rujukan ${m.reference}. Jumpa di ${m.businessName}.`;
    }
    if (m.kind === 'decline') {
      return `Hai ${m.customerName}, maaf, kami tidak dapat menerima tempahan ${m.serviceName} anda pada ${when}. Sila pilih masa lain: ${m.publicUrl}`;
    }
    return `Hai ${m.customerName}, maaf, tempahan ${m.serviceName} anda pada ${when} (rujukan ${m.reference}) telah dibatalkan. Anda boleh membuat tempahan lain di sini: ${m.publicUrl}`;
  }
  const people = m.partySize === 1 ? '1 person' : `${m.partySize} people`;
  if (m.kind === 'confirm') {
    return `Hi ${m.customerName}, your ${m.serviceName} for ${people} on ${when} is confirmed. Ref ${m.reference}. See you at ${m.businessName}.`;
  }
  if (m.kind === 'decline') {
    return `Hi ${m.customerName}, sorry, we can't take your ${m.serviceName} booking on ${when}. Please choose another time: ${m.publicUrl}`;
  }
  return `Hi ${m.customerName}, sorry, your ${m.serviceName} booking on ${when} (ref ${m.reference}) has been cancelled. You can book another time here: ${m.publicUrl}`;
}

export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
```

- [ ] **Step 4: Run the test and confirm it passes.**

```bash
pnpm test -- --run test/apps-messages.test.ts
```

Expected: all pass.

- [ ] **Step 5: Typecheck and commit.**

```bash
pnpm typecheck
git add src/apps/bookings/messages.ts test/apps-messages.test.ts
git commit -m "feat(worker): English and Malay WhatsApp text for booking decisions"
```

---

## Task 6: Persisted notification targets

**Files:**
- Modify: `worker/src/notifications/store.ts`. That means the kind union
  (lines 4-13), `NotificationRow`, `NotificationJson`, `COLUMNS`,
  `notificationJson` and `createNotification`.
- Test: `worker/test/notifications-url.test.ts`

**Interfaces:**
- Produces `workspaceTarget(url: string | undefined): string | null`.
- `NotificationJson` gains `url: string | null`, and `NotificationRow` gains
  `url: string | null`.
- `NotificationKind` gains `'booking_requested'`.

- [ ] **Step 1: Check the existing callers' URLs.** Every one must already be
  a workspace path.

```bash
/usr/bin/grep -rn "url:" src/notifications src/routines | /usr/bin/grep -v store.ts
```

Expected: only `` `/app?view=work&review=${…}` `` in `src/notifications/work.ts`.
That matches `^/app([/?#]|$)`.

- [ ] **Step 2: Write the failing test** at `worker/test/notifications-url.test.ts`.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createNotification, listNotifications, notificationJson, workspaceTarget } from '../src/notifications/store';
import { asOwner, asTenant, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
let user = '';

beforeEach(async () => {
  await truncateAll();
  user = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded) values (${A}, 'Alpha', 'services', true)`;
    const [u] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('o@example.com', true) returning id`;
    return u.id;
  });
});

describe('notification targets', () => {
  it('accepts workspace paths and nothing else', () => {
    expect(workspaceTarget('/app?view=apps&app=bookings&booking=1')).toBe('/app?view=apps&app=bookings&booking=1');
    expect(workspaceTarget('/app')).toBe('/app');
    for (const bad of ['https://evil.example/app', '//evil.example', '/apple', '/api/x', 'javascript:alert(1)', '/app\\evil', undefined]) {
      expect(workspaceTarget(bad)).toBeNull();
    }
  });

  it('stores the target, lists it, and pushes to the same place', async () => {
    await asTenant(A, (tx) => createNotification(tx, A, {
      recipientUserId: user, kind: 'booking_requested', title: 'New booking request',
      body: 'Aisyah · Sat 3:00 pm', sourceKey: 'booking:b1', url: '/app?view=apps&app=bookings&booking=b1',
    }));
    const page = await asTenant(A, (tx) => listNotifications(tx, user, 10, null));
    expect(notificationJson(page.rows[0]).url).toBe('/app?view=apps&app=bookings&booking=b1');
    const [push] = await asOwner((sql) => sql<{ url: string }[]>`select url from push_outbox`);
    expect(push.url).toBe('/app?view=apps&app=bookings&booking=b1');
  });

  it('drops an unsafe target, falls back to the inbox for the push, and keeps legacy rows null', async () => {
    await asTenant(A, (tx) => createNotification(tx, A, {
      recipientUserId: user, kind: 'booking_requested', title: 't', body: 'b', sourceKey: 'booking:b2', url: 'https://evil.example',
    }));
    const page = await asTenant(A, (tx) => listNotifications(tx, user, 10, null));
    expect(notificationJson(page.rows[0]).url).toBeNull();
    const [push] = await asOwner((sql) => sql<{ url: string }[]>`select url from push_outbox`);
    expect(push.url).toBe('/app?view=notifications');
  });
});
```

- [ ] **Step 3: Run it and confirm it fails.**

```bash
pnpm test -- --run test/notifications-url.test.ts
```

Expected: FAIL with `workspaceTarget is not a function`, or a type error on
`'booking_requested'`.

- [ ] **Step 4: Edit `worker/src/notifications/store.ts`.**

  a. Add a member to the kind union, after `| 'approval_requested'`:

```ts
  /* A customer asked for a booking on a Bookings page (migration 067). */
  | 'booking_requested';
```

The `;` moves from the previous line to this one.

  b. Add `url: string | null;` to both `NotificationRow` and `NotificationJson`.

  c. Replace the `COLUMNS` constant:

```ts
const COLUMNS = 'id, kind, title, body, run_id, routine_id, occurrence_id, url, read_at, created_at';
```

  d. In `notificationJson`, add `url: row.url,` after `occurrenceId`.

  e. Add this function above `createNotification`:

```ts
/** Where a notification may lead: a workspace path and nothing else. The
    target is a navigation hint, never authorization; the destination
    checks tenant, permission and feature again. */
export function workspaceTarget(url: string | undefined): string | null {
  if (!url || url.length > 300 || url.includes('\\')) return null;
  return /^\/app([/?#]|$)/.test(url) ? url : null;
}
```

  f. In `createNotification`, add
  `const target = workspaceTarget(input.url);` as the first line. Add `url` to
  the insert column list and `${target}` to its values, after
  `${input.occurrenceId ?? null}`. In the push, use
  `url: target ?? '/app?view=notifications',`.

- [ ] **Step 5: Run the tests.**

```bash
pnpm test -- --run test/notifications-url.test.ts test/notifications-work.test.ts test/routines.test.ts
```

Expected: all pass. The work and routine notifications behave as before.

- [ ] **Step 6: Typecheck and commit.**

```bash
pnpm typecheck
git add src/notifications/store.ts test/notifications-url.test.ts
git commit -m "feat(worker): store where a notification leads, for inbox and push alike"
```

---

## Task 7: Config: parse, read and save; `GET /api/apps`; the route shell

**Files:**
- Create: `worker/src/apps/bookings/config.ts`
- Create: `worker/src/routes/apps.ts`
- Modify: `worker/src/index.ts`. Import `handleApps` next to `handleGoals`
  (line 52), and chain it right after the goals block (lines 219-220).
- Test: `worker/test/apps-config-route.test.ts`

**Interfaces:**
- **Consumes:**
  - `appsEnabledFor` (Task 2)
  - `peakReserved` and `Reservation` (Task 4)
  - `clockMinutes` and `isClock` (Task 3)
- **Produces from `config.ts`:**
  - Types: `HoursInput`, `ServiceInput`, `ConfigInput`, `ServiceView` and
    `ConfigView`.
  - `ConfigView` is
    `{ installation: { slug; state; publicUrl } | null; version: number | null; settings: { accepting; minNoticeMinutes; horizonDays; availabilityAcknowledgedAt } | null; services: ServiceView[] }`.
  - `class ConfigError { code: ConfigErrorCode; serviceId: string | null }`,
    where `ConfigErrorCode` is `'CONFIG_CHANGED' | 'SLUG_TAKEN' | 'ACK_REQUIRED' | 'UNKNOWN_SERVICE' | 'CAPACITY_BELOW_RESERVED'`.
  - Functions: `normalizeSlug`, `parseConfigInput`,
    `readConfig(tx, businessId, sitesOrigin)`,
    `saveConfig(tx, businessId, input, now)` and
    `publicBookingUrl(sitesOrigin, slug)`.
- **Produces from `routes/apps.ts`:**
  `handleApps(request, env, url, cors): Promise<Response | null>`, and the
  internal helpers `json`, `originAllowed` and `forbidden`, which Task 8
  reuses in the same file.
- **Saving is all or nothing.** `saveConfig` throws `ConfigError` for refusals,
  so the whole transaction rolls back. The route maps `ACK_REQUIRED` to 400 and
  every other code to 409.

- [ ] **Step 1: Write the failing test** at
  `worker/test/apps-config-route.test.ts`.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { handleApps } from '../src/routes/apps';
import { asOwner, jsonOf, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:5173' };
const ENV = testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: `${A},${B}`, SITES_ORIGIN: 'https://sites.test' });
let ownerA = '';
let ownerB = '';
let staffA = '';

beforeEach(async () => {
  await truncateAll();
  const ids = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded)
      values (${A}, 'Alpha', 'services', true), (${B}, 'Beta', 'salon', true)`;
    await sql`update business set plan = 'team' where id = ${A}`;
    const users = await sql<{ id: string; email: string }[]>`
      insert into app_user (email, email_verified)
      values ('a@example.com', true), ('b@example.com', true), ('s@example.com', true) returning id, email`;
    const byEmail = Object.fromEntries(users.map((u) => [u.email, u.id]));
    await sql`insert into membership (user_id, business_id, role) values
      (${byEmail['a@example.com']}, ${A}, 'owner'), (${byEmail['b@example.com']}, ${B}, 'owner'),
      (${byEmail['s@example.com']}, ${A}, 'staff')`;
    return byEmail;
  });
  ownerA = await signIn(ids['a@example.com']);
  ownerB = await signIn(ids['b@example.com']);
  staffA = await signIn(ids['s@example.com']);
});

async function call(method: string, path: string, cookie: string, body?: unknown, env = ENV) {
  const shaped = req(method, path, { cookie, body });
  const headers = new Headers(shaped.request.headers);
  headers.set('Origin', CORS['Access-Control-Allow-Origin']);
  const res = await handleApps(new Request(shaped.request, { headers }), env, shaped.url, CORS);
  if (!res) throw new Error('apps route did not handle the request');
  return res;
}

const service = (over: Record<string, unknown> = {}) => ({
  id: null, name: 'Cupping class', durationMinutes: 60, capacity: 4, priceLabel: 'RM45', active: true,
  hours: [{ weekday: 6, opens: '10:00', closes: '13:00' }], ...over,
});
const config = (over: Record<string, unknown> = {}) => ({
  version: null, slug: 'kedai-aisyah', accepting: true, minNoticeMinutes: 120, horizonDays: 30,
  acknowledgeAvailabilityLimits: true, services: [service()], ...over,
});
type Saved = { config: { version: number; installation: { slug: string; publicUrl: string }; services: Array<{ id: string; active: boolean; hours: unknown[] }> } };

describe('apps route: access', () => {
  it('answers 404 for a business outside the pilot, and when the switch is off', async () => {
    const onlyB = testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: B, SITES_ORIGIN: 'https://sites.test' });
    expect((await call('GET', '/api/apps', ownerA, undefined, onlyB)).status).toBe(404);
    const off = testEnv({ APPS_ENABLED: 'false', APPS_BUSINESS_IDS: A });
    expect((await call('GET', '/api/apps', ownerA, undefined, off)).status).toBe(404);
  });
  it('is owner only, private and uncached', async () => {
    expect((await call('GET', '/api/apps', staffA)).status).toBe(403);
    expect((await call('PUT', '/api/apps/bookings/config', staffA, config())).status).toBe(403);
    const res = await call('GET', '/api/apps', ownerA);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ ok: true, apps: [], available: ['bookings'] });
  });
});

describe('apps route: config', () => {
  it('installs on the first save only with the availability acknowledgement', async () => {
    const refused = await call('PUT', '/api/apps/bookings/config', ownerA, config({ acknowledgeAvailabilityLimits: false }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: 'ACK_REQUIRED' });
    const saved = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config()));
    expect(saved.config.version).toBe(1);
    expect(saved.config.installation).toMatchObject({ slug: 'kedai-aisyah', publicUrl: 'https://sites.test/b/kedai-aisyah' });
    const listed = await jsonOf<{ apps: unknown[] }>(await call('GET', '/api/apps', ownerA));
    expect(listed.apps).toEqual([{ key: 'bookings', state: 'active', publicUrl: 'https://sites.test/b/kedai-aisyah', pending: 0 }]);
  });

  it('versions every save and refuses a stale one', async () => {
    const first = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config()));
    const again = await call('PUT', '/api/apps/bookings/config', ownerA, config());
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'CONFIG_CHANGED' });
    const svc = first.config.services[0];
    const second = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ version: 1, services: [service({ id: svc.id, name: 'Cupping' })] })));
    expect(second.config.version).toBe(2);
    expect((await call('PUT', '/api/apps/bookings/config', ownerA, config({ version: 1, services: [service({ id: svc.id })] }))).status).toBe(409);
  });

  it('normalises the link name, and refuses taken or reserved ones', async () => {
    const saved = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config({ slug: '  Kedai-Aisyah ' })));
    expect(saved.config.installation.slug).toBe('kedai-aisyah');
    const taken = await call('PUT', '/api/apps/bookings/config', ownerB, config());
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: 'SLUG_TAKEN' });
    expect((await call('PUT', '/api/apps/bookings/config', ownerB, config({ slug: 'api' }))).status).toBe(400);
    expect(await asOwner((sql) => sql`select 1 from app_installation where business_id = ${B}`)).toHaveLength(0);
  });

  it('refuses midnight closing, overnight and overlapping hours, bad durations, and no active service', async () => {
    const bad = [
      config({ services: [service({ hours: [{ weekday: 1, opens: '18:00', closes: '24:00' }] })] }),
      config({ services: [service({ hours: [{ weekday: 1, opens: '22:00', closes: '02:00' }] })] }),
      config({ services: [service({ hours: [{ weekday: 1, opens: '09:00', closes: '12:00' }, { weekday: 1, opens: '11:00', closes: '14:00' }] })] }),
      config({ services: [service({ durationMinutes: 20 })] }),
      config({ services: [service({ active: false })] }),
      config({ services: [] }),
    ];
    for (const body of bad) expect((await call('PUT', '/api/apps/bookings/config', ownerA, body)).status).toBe(400);
  });

  it('deactivates a removed service that has bookings and deletes an unused one', async () => {
    const first = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ services: [service(), service({ name: 'Private tasting' })] })));
    const [used, unused] = first.config.services;
    await asOwner((sql) => sql`insert into booking (business_id, reference, submission_key, submission_hash, service_id,
      service_name, starts_at, ends_at, party_size, customer_name, customer_phone)
      values (${A}, 'K7Q2MP', gen_random_uuid(), 'h', ${used.id}, 'Cupping class',
        now() + interval '2 days', now() + interval '2 days 1 hour', 1, 'Aisyah', '60123456789')`);
    const replacement = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ version: 1, services: [service({ name: 'Espresso basics' })] })));
    const ids = replacement.config.services.map((s) => [s.id, s.active]);
    expect(ids).toContainEqual([used.id, false]);
    expect(ids.find(([id]) => id === unused.id)).toBeUndefined();
  });

  it('refuses to cut capacity below places already held, and rolls back the whole save', async () => {
    const first = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config()));
    const svc = first.config.services[0];
    await asOwner((sql) => sql`insert into booking (business_id, reference, submission_key, submission_hash, service_id,
      service_name, starts_at, ends_at, party_size, customer_name, customer_phone)
      values (${A}, 'K7Q2MP', gen_random_uuid(), 'h', ${svc.id}, 'Cupping class',
        now() + interval '2 days', now() + interval '2 days 1 hour', 3, 'Aisyah', '60123456789')`);
    const res = await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ version: 1, slug: 'renamed', services: [service({ id: svc.id, capacity: 2 })] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'CAPACITY_BELOW_RESERVED', serviceId: svc.id });
    const [row] = await asOwner((sql) => sql<{ public_slug: string; config_version: number }[]>`
      select public_slug, config_version from app_installation where business_id = ${A}`);
    expect(row).toEqual({ public_slug: 'kedai-aisyah', config_version: 1 });
  });

  it('refuses a service id that belongs to another business', async () => {
    const other = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerB, config({ slug: 'beta-salon' })));
    const res = await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ services: [service({ id: other.config.services[0].id })] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'UNKNOWN_SERVICE' });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

```bash
pnpm test -- --run test/apps-config-route.test.ts
```

Expected: FAIL with `Cannot find module '../src/routes/apps'`.

- [ ] **Step 3: Create `worker/src/apps/bookings/config.ts`.**

```ts
import type postgres from 'postgres';
import { peakReserved } from './slots';
import { clockMinutes, isClock } from './time';

/* An owner's Bookings configuration: the installation (link and version),
   the settings, the services and their weekly hours. Saving is all or
   nothing: a refusal throws ConfigError so the whole transaction rolls back. */

export const RESERVED_SLUGS: ReadonlySet<string> = new Set(['api', 'admin', 'www', 'app', 'b']);
export const MAX_SERVICES = 20;
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = '23505';

export interface HoursInput { weekday: number; opens: string; closes: string }
export interface ServiceInput {
  id: string | null;
  name: string;
  durationMinutes: number;
  capacity: number;
  priceLabel: string | null;
  active: boolean;
  hours: HoursInput[];
}
export interface ConfigInput {
  version: number | null;
  slug: string;
  accepting: boolean;
  minNoticeMinutes: number;
  horizonDays: number;
  acknowledgeAvailabilityLimits: boolean;
  services: ServiceInput[];
}
export interface ServiceView extends Omit<ServiceInput, 'id'> { id: string }
export interface ConfigView {
  installation: { slug: string; state: 'active' | 'paused'; publicUrl: string } | null;
  version: number | null;
  settings: { accepting: boolean; minNoticeMinutes: number; horizonDays: number; availabilityAcknowledgedAt: string } | null;
  services: ServiceView[];
}

export type ConfigErrorCode = 'CONFIG_CHANGED' | 'SLUG_TAKEN' | 'ACK_REQUIRED' | 'UNKNOWN_SERVICE' | 'CAPACITY_BELOW_RESERVED';
export class ConfigError extends Error {
  constructor(readonly code: ConfigErrorCode, readonly serviceId: string | null = null) {
    super(code);
  }
}

type Parsed<T> = { ok: true; value: T } | { ok: false; err: string };
const fail = (err: string): { ok: false; err: string } => ({ ok: false, err });

function int(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length >= 1 && clean.length <= max ? clean : null;
}

export function publicBookingUrl(sitesOrigin: string, slug: string): string {
  return `${sitesOrigin.replace(/\/+$/, '')}/b/${slug}`;
}

export function normalizeSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  return SLUG.test(slug) && !RESERVED_SLUGS.has(slug) ? slug : null;
}

function parseHours(value: unknown): Parsed<HoursInput[]> {
  if (!Array.isArray(value) || value.length > 28) return fail('hours must be a list of at most 28 ranges');
  const hours: HoursInput[] = [];
  for (const raw of value) {
    const range = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const weekday = int(range.weekday, 0, 6);
    const opens = typeof range.opens === 'string' ? range.opens : '';
    const closes = typeof range.closes === 'string' ? range.closes : '';
    if (weekday === null || !isClock(opens) || !isClock(closes)) {
      return fail('each range needs a weekday 0-6 and HH:MM times from 00:00 to 23:59');
    }
    if (clockMinutes(closes) <= clockMinutes(opens)) {
      return fail('closing time must be after opening time on the same day; overnight hours are not supported');
    }
    hours.push({ weekday, opens, closes });
  }
  hours.sort((a, b) => a.weekday - b.weekday || clockMinutes(a.opens) - clockMinutes(b.opens));
  for (let i = 1; i < hours.length; i += 1) {
    if (hours[i].weekday === hours[i - 1].weekday && clockMinutes(hours[i].opens) < clockMinutes(hours[i - 1].closes)) {
      return fail('opening hours on the same day overlap');
    }
  }
  return { ok: true, value: hours };
}

function parseService(value: unknown): Parsed<ServiceInput> {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const id = raw.id === undefined || raw.id === null ? null
    : typeof raw.id === 'string' && UUID.test(raw.id) ? raw.id.toLowerCase() : undefined;
  if (id === undefined) return fail('service id is not valid');
  const name = text(raw.name, 80);
  if (!name) return fail('service name must be 1 to 80 characters');
  const durationMinutes = int(raw.durationMinutes, 15, 480);
  if (durationMinutes === null || durationMinutes % 15 !== 0) return fail('duration must be 15 to 480 minutes in 15-minute steps');
  const capacity = int(raw.capacity, 1, 50);
  if (capacity === null) return fail('places per time must be 1 to 50');
  const priceRaw = typeof raw.priceLabel === 'string' ? raw.priceLabel.trim() : raw.priceLabel;
  const priceLabel = priceRaw === undefined || priceRaw === null || priceRaw === '' ? null : text(priceRaw, 40);
  if (priceLabel === null && priceRaw !== undefined && priceRaw !== null && priceRaw !== '') {
    return fail('price label must be at most 40 characters');
  }
  const active = raw.active === undefined ? true : raw.active;
  if (typeof active !== 'boolean') return fail('active must be true or false');
  const hours = parseHours(raw.hours ?? []);
  if (!hours.ok) return hours;
  return { ok: true, value: { id, name, durationMinutes, capacity, priceLabel, active, hours: hours.value } };
}

export function parseConfigInput(body: unknown): Parsed<ConfigInput> {
  if (!body || typeof body !== 'object') return fail('a JSON object is required');
  const raw = body as Record<string, unknown>;
  const version = raw.version === null || raw.version === undefined ? null : int(raw.version, 1, 2_147_483_647);
  if (version === null && raw.version !== null && raw.version !== undefined) return fail('version is not valid');
  const slug = normalizeSlug(raw.slug);
  if (!slug) return fail('link name must be 3 to 40 lowercase letters, numbers or dashes, and not a reserved word');
  if (typeof raw.accepting !== 'boolean') return fail('accepting must be true or false');
  const minNoticeMinutes = int(raw.minNoticeMinutes, 0, 10080);
  if (minNoticeMinutes === null) return fail('minimum notice must be 0 to 10080 minutes');
  const horizonDays = int(raw.horizonDays, 1, 90);
  if (horizonDays === null) return fail('booking horizon must be 1 to 90 days');
  if (!Array.isArray(raw.services) || raw.services.length < 1 || raw.services.length > MAX_SERVICES) {
    return fail(`add between 1 and ${MAX_SERVICES} services`);
  }
  const services: ServiceInput[] = [];
  for (const value of raw.services) {
    const parsed = parseService(value);
    if (!parsed.ok) return parsed;
    services.push(parsed.value);
  }
  const ids = services.map((s) => s.id).filter((id): id is string => id !== null);
  if (new Set(ids).size !== ids.length) return fail('a service appears twice');
  if (!services.some((s) => s.active)) return fail('at least one service must be active');
  return {
    ok: true,
    value: {
      version, slug, accepting: raw.accepting, minNoticeMinutes, horizonDays,
      acknowledgeAvailabilityLimits: raw.acknowledgeAvailabilityLimits === true, services,
    },
  };
}

export async function readConfig(tx: postgres.TransactionSql, businessId: string, sitesOrigin: string): Promise<ConfigView> {
  const [installation] = await tx<{ public_slug: string; state: 'active' | 'paused'; config_version: number }[]>`
    select public_slug, state, config_version from app_installation
     where business_id = ${businessId} and app_key = 'bookings'`;
  if (!installation) return { installation: null, version: null, settings: null, services: [] };
  const [settings] = await tx<{ accepting: boolean; min_notice_minutes: number; horizon_days: number; availability_acknowledged_at: Date }[]>`
    select accepting, min_notice_minutes, horizon_days, availability_acknowledged_at
      from booking_settings where business_id = ${businessId}`;
  const services = await tx<{ id: string; name: string; duration_minutes: number; capacity: number; price_label: string | null; active: boolean }[]>`
    select id, name, duration_minutes, capacity, price_label, active from booking_service
     where business_id = ${businessId} order by sort, name, id`;
  const hours = await tx<{ service_id: string; weekday: number; opens: string; closes: string }[]>`
    select service_id, weekday, to_char(opens, 'HH24:MI') as opens, to_char(closes, 'HH24:MI') as closes
      from booking_hours where business_id = ${businessId} order by weekday, opens`;
  return {
    installation: {
      slug: installation.public_slug,
      state: installation.state,
      publicUrl: publicBookingUrl(sitesOrigin, installation.public_slug),
    },
    version: installation.config_version,
    settings: settings ? {
      accepting: settings.accepting,
      minNoticeMinutes: settings.min_notice_minutes,
      horizonDays: settings.horizon_days,
      availabilityAcknowledgedAt: settings.availability_acknowledged_at.toISOString(),
    } : null,
    services: services.map((s) => ({
      id: s.id, name: s.name, durationMinutes: s.duration_minutes, capacity: s.capacity,
      priceLabel: s.price_label, active: s.active,
      hours: hours.filter((h) => h.service_id === s.id).map(({ weekday, opens, closes }) => ({ weekday, opens, closes })),
    })),
  };
}

async function claimSlug<T>(tx: postgres.TransactionSql, write: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  try {
    return (await tx.savepoint((sp) => write(sp))) as T;
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw new ConfigError('SLUG_TAKEN');
    throw error;
  }
}

/** Save everything or nothing. Locks in the common order: the installation,
    then services in id order. */
export async function saveConfig(tx: postgres.TransactionSql, businessId: string, input: ConfigInput, now: Date): Promise<void> {
  const [existing] = await tx<{ public_slug: string; config_version: number }[]>`
    select public_slug, config_version from app_installation
     where business_id = ${businessId} and app_key = 'bookings' for update`;
  if (!existing) {
    if (input.version !== null) throw new ConfigError('CONFIG_CHANGED');
    if (!input.acknowledgeAvailabilityLimits) throw new ConfigError('ACK_REQUIRED');
    const inserted = await claimSlug(tx, (sp) => sp<{ business_id: string }[]>`
      insert into app_installation (business_id, app_key, public_slug)
      values (${businessId}, 'bookings', ${input.slug})
      on conflict (business_id, app_key) do nothing returning business_id`);
    // Lost a race with a concurrent first save: the client must reload.
    if (inserted.length === 0) throw new ConfigError('CONFIG_CHANGED');
    await tx`insert into booking_settings
      (business_id, accepting, availability_acknowledged_at, min_notice_minutes, horizon_days, updated_at)
      values (${businessId}, ${input.accepting}, ${now}, ${input.minNoticeMinutes}, ${input.horizonDays}, ${now})`;
  } else {
    if (input.version !== existing.config_version) throw new ConfigError('CONFIG_CHANGED');
    if (input.slug !== existing.public_slug) {
      await claimSlug(tx, (sp) => sp`update app_installation set public_slug = ${input.slug}
        where business_id = ${businessId} and app_key = 'bookings'`);
    }
    const updated = await tx`update booking_settings
      set accepting = ${input.accepting}, min_notice_minutes = ${input.minNoticeMinutes},
          horizon_days = ${input.horizonDays}, updated_at = ${now}
      where business_id = ${businessId} returning business_id`;
    if (updated.length === 0) {
      if (!input.acknowledgeAvailabilityLimits) throw new ConfigError('ACK_REQUIRED');
      await tx`insert into booking_settings
        (business_id, accepting, availability_acknowledged_at, min_notice_minutes, horizon_days, updated_at)
        values (${businessId}, ${input.accepting}, ${now}, ${input.minNoticeMinutes}, ${input.horizonDays}, ${now})`;
    }
    await tx`update app_installation set config_version = config_version + 1, updated_at = ${now}
      where business_id = ${businessId} and app_key = 'bookings'`;
  }
  await saveServices(tx, businessId, input.services, now);
}

async function saveServices(tx: postgres.TransactionSql, businessId: string, services: ServiceInput[], now: Date): Promise<void> {
  const existing = await tx<{ id: string; capacity: number }[]>`
    select id, capacity from booking_service where business_id = ${businessId} order by id for update`;
  const known = new Map(existing.map((s) => [s.id, s]));
  for (const service of services) {
    if (service.id && !known.has(service.id)) throw new ConfigError('UNKNOWN_SERVICE', service.id);
  }
  for (const service of services) {
    const before = service.id ? known.get(service.id) : undefined;
    if (!before || service.capacity >= before.capacity) continue;
    const held = await tx<{ starts_at: Date; ends_at: Date; party_size: number }[]>`
      select starts_at, ends_at, party_size from booking
       where business_id = ${businessId} and service_id = ${before.id}
         and status in ('pending', 'confirmed') and ends_at > ${now}`;
    const peak = peakReserved(held.map((h) => ({ startsAt: h.starts_at, endsAt: h.ends_at, partySize: h.party_size })), now);
    if (peak > service.capacity) throw new ConfigError('CAPACITY_BELOW_RESERVED', before.id);
  }
  const kept = new Set<string>();
  for (const [sort, service] of services.entries()) {
    let id = service.id;
    if (id) {
      await tx`update booking_service
        set name = ${service.name}, duration_minutes = ${service.durationMinutes}, capacity = ${service.capacity},
            price_label = ${service.priceLabel}, active = ${service.active}, sort = ${sort}
        where business_id = ${businessId} and id = ${id}`;
    } else {
      const [created] = await tx<{ id: string }[]>`
        insert into booking_service (business_id, name, duration_minutes, capacity, price_label, active, sort)
        values (${businessId}, ${service.name}, ${service.durationMinutes}, ${service.capacity},
                ${service.priceLabel}, ${service.active}, ${sort})
        returning id`;
      id = created.id;
    }
    kept.add(id);
    await tx`delete from booking_hours where business_id = ${businessId} and service_id = ${id}`;
    for (const range of service.hours) {
      await tx`insert into booking_hours (business_id, service_id, weekday, opens, closes)
        values (${businessId}, ${id}, ${range.weekday}, ${range.opens}, ${range.closes})`;
    }
  }
  for (const old of existing) {
    if (kept.has(old.id)) continue;
    const [used] = await tx`select 1 from booking where business_id = ${businessId} and service_id = ${old.id} limit 1`;
    if (used) {
      // Its bookings stay reachable; only new requests stop.
      await tx`update booking_service set active = false where business_id = ${businessId} and id = ${old.id}`;
    } else {
      await tx`delete from booking_service where business_id = ${businessId} and id = ${old.id}`;
    }
  }
}
```

- [ ] **Step 4: Create `worker/src/routes/apps.ts`.** Task 8 extends this file
  with the bookings routes.

```ts
import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { can } from '../permissions';
import { appsEnabledFor } from '../apps/gating';
import { ConfigError, parseConfigInput, publicBookingUrl, readConfig, saveConfig } from '../apps/bookings/config';

/* Business apps, owner side. Spec: docs/plans/2026-09-23-apps-shell-and-bookings-v1.md.
   Every path answers 404 unless the business is on the apps pilot list, so
   removing an id hides the feature at once. */

export function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...headers },
  });
}

export function originAllowed(request: Request, cors: Record<string, string>): boolean {
  const origin = request.headers.get('Origin');
  return Boolean(origin) && origin === cors['Access-Control-Allow-Origin'];
}

export function forbidden(cors: Record<string, string>) {
  return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
}

export function notFound(cors: Record<string, string>) {
  return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
}

export async function handleApps(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname !== '/api/apps' && !url.pathname.startsWith('/api/apps/')) return null;
  const identity = await resolveTenant(env, request);
  if (!identity) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);
  if (!hasBusiness(identity)) return json({ ok: false, err: 'no business', code: 'NO_BUSINESS' }, { status: 404 }, cors);
  if (!appsEnabledFor(env, identity.businessId)) return notFound(cors);
  if (request.method !== 'GET' && !originAllowed(request, cors)) {
    return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
  }
  const businessId = identity.businessId;
  const sitesOrigin = env.SITES_ORIGIN ?? '';
  const now = new Date();

  if (url.pathname === '/api/apps' && request.method === 'GET') {
    if (!can(identity, 'apps.manage')) return forbidden(cors);
    const apps = await withTenant(env, businessId, async (tx) => {
      const [installed] = await tx<{ public_slug: string; state: 'active' | 'paused' }[]>`
        select public_slug, state from app_installation where business_id = ${businessId} and app_key = 'bookings'`;
      if (!installed) return [];
      const [{ pending }] = await tx<{ pending: number }[]>`
        select count(*)::int as pending from booking
         where business_id = ${businessId} and status = 'pending' and starts_at > ${now}`;
      return [{ key: 'bookings', state: installed.state, publicUrl: publicBookingUrl(sitesOrigin, installed.public_slug), pending }];
    });
    return json({ ok: true, apps, available: ['bookings'] }, {}, cors);
  }

  if (url.pathname === '/api/apps/bookings/config') {
    if (!can(identity, 'apps.manage')) return forbidden(cors);
    if (request.method === 'GET') {
      const config = await withTenant(env, businessId, (tx) => readConfig(tx, businessId, sitesOrigin));
      return json({ ok: true, config }, {}, cors);
    }
    if (request.method === 'PUT') {
      const parsed = parseConfigInput(await request.json().catch(() => null));
      if (!parsed.ok) return json({ ok: false, err: parsed.err }, { status: 400 }, cors);
      try {
        const config = await withTenant(env, businessId, async (tx) => {
          await saveConfig(tx, businessId, parsed.value, now);
          return readConfig(tx, businessId, sitesOrigin);
        });
        return json({ ok: true, config }, {}, cors);
      } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        return json({ ok: false, code: error.code, serviceId: error.serviceId },
          { status: error.code === 'ACK_REQUIRED' ? 400 : 409 }, cors);
      }
    }
  }

  return notFound(cors);
}
```

- [ ] **Step 5: Chain it in `worker/src/index.ts`.**
  - Add `import { handleApps } from './routes/apps';` after the `handleGoals`
    import (line 52).
  - Directly after `if (goals) return goals;` (line 220), add:

```ts
    const apps = await handleApps(request, env, url, headers);
    if (apps) return apps;
```

- [ ] **Step 6: Run the tests.**

```bash
pnpm test -- --run test/apps-config-route.test.ts test/cors.test.ts
```

Expected: all pass. `cors.test.ts` passes because `GET`, `PUT` and `POST`
are already in both method lists. If it fails, it names the list to extend.

- [ ] **Step 7: Typecheck and commit.**

```bash
pnpm typecheck
git add src/apps/bookings/config.ts src/routes/apps.ts src/index.ts test/apps-config-route.test.ts
git commit -m "feat(worker): owners install and configure Bookings, versioned and all-or-nothing"
```

---

## Task 8: Listing, deciding and cancelling bookings

**Files:**
- Create: `worker/src/apps/bookings/bookings.ts`
- Modify: `worker/src/routes/apps.ts`. Add the `/api/apps/bookings/bookings`
  block before the final `return notFound(cors);`.
- Test: `worker/test/apps-bookings-route.test.ts`

**Interfaces:**
- **Consumes:**
  - `bookingMessage`, `whatsappUrl` and `Lang` (Task 5)
  - `addDays`, `isDate`, `myDate` and `myInstant` (Task 3)
  - `publicBookingUrl` (Task 7)
  - `findConnection(tx, connector)` from `src/connections.ts`
  - `GOOGLE_CALENDAR_CONNECTOR` from `src/connectors/google-calendar.ts`
- **Produces from `bookings.ts`, the types:**
  - `BookingStatus` and `CalendarStatus`
  - `BookingRow`, the database row type
  - `BookingContext { businessName; lang; publicUrl; now }`
  - `BookingJson`
  - `BookingCursor { d: string; p: 0 | 1; s: string; id: string }`
  - `DecideResult`, which is
    `{ ok: true; row: BookingRow; changed: boolean; calendarQueued: boolean } | { ok: false; code: 'NOT_FOUND' | 'ALREADY_DECIDED' | 'EXPIRED' }`
- **Produces from `bookings.ts`, the functions:**
  - `bookingJson(row, ctx)`
  - `encodeCursor` and `decodeCursor`
  - `listBookings(tx, businessId, { from, days, status, cursor, limit?, now })`,
    which returns `{ rows, nextCursor }`
  - `getBooking(tx, businessId, id)`
  - `decideBooking(tx, businessId, id, decision, userId, now)`
  - `cancelBooking(tx, businessId, id, userId, now)`
  - `queueCalendarJob(tx, businessId, bookingId, desired, now)`
- **Plan 3 builds on this.** Its processor reads the job rows written here.
  It will also add `ctx.waitUntil` to the decide and cancel responses.

- [ ] **Step 1: Write the failing test** at
  `worker/test/apps-bookings-route.test.ts`.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { handleApps } from '../src/routes/apps';
import { asOwner, jsonOf, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:5173' };
const ENV = testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: `${A},${B}`, SITES_ORIGIN: 'https://sites.test' });
let ownerA = '';
let ownerB = '';
let serviceA = '';

type Json = { ok: boolean; code?: string; booking: { id: string; status: string; expired: boolean; calendar: { status: string }; whatsappUrl: string | null }; whatsappUrl: string | null };

beforeEach(async () => {
  await truncateAll();
  const ids = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded)
      values (${A}, 'SEIDO Coffee', 'services', true), (${B}, 'Beta', 'salon', true)`;
    const users = await sql<{ id: string; email: string }[]>`insert into app_user (email, email_verified)
      values ('a@example.com', true), ('b@example.com', true) returning id, email`;
    const byEmail = Object.fromEntries(users.map((u) => [u.email, u.id]));
    await sql`insert into membership (user_id, business_id, role) values
      (${byEmail['a@example.com']}, ${A}, 'owner'), (${byEmail['b@example.com']}, ${B}, 'owner')`;
    await sql`insert into app_installation (business_id, app_key, public_slug) values (${A}, 'bookings', 'seido')`;
    await sql`insert into booking_settings (business_id, availability_acknowledged_at) values (${A}, now())`;
    const [s] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
      values (${A}, 'cupping class', 60, 4) returning id`;
    return { ...byEmail, service: s.id };
  });
  ownerA = await signIn(ids['a@example.com']);
  ownerB = await signIn(ids['b@example.com']);
  serviceA = ids.service;
});

async function call(method: string, path: string, cookie: string, body?: unknown) {
  const shaped = req(method, path, { cookie, body });
  const headers = new Headers(shaped.request.headers);
  headers.set('Origin', CORS['Access-Control-Allow-Origin']);
  const res = await handleApps(new Request(shaped.request, { headers }), ENV, shaped.url, CORS);
  if (!res) throw new Error('apps route did not handle the request');
  return res;
}

async function booking(startsAt: string, over: { status?: string; party?: number; ref?: string; minutes?: number } = {}) {
  const [row] = await asOwner((sql) => sql<{ id: string }[]>`
    insert into booking (business_id, reference, submission_key, submission_hash, service_id, service_name,
      starts_at, ends_at, party_size, customer_name, customer_phone, status)
    values (${A}, ${over.ref ?? 'K7Q2MP'}, gen_random_uuid(), 'h', ${serviceA}, 'cupping class',
      ${startsAt}::timestamptz, ${startsAt}::timestamptz + make_interval(mins => ${over.minutes ?? 60}),
      ${over.party ?? 2}, 'Aisyah', '60123456789', ${over.status ?? 'pending'})
    returning id`);
  return row.id;
}
const inDays = (days: number, hourUtc = 7) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
};

describe('listing bookings', () => {
  it('groups by Malaysian date, pending first, and pages with a cursor', async () => {
    // 00:30 on 27 Sep in Malaysia is 16:30 UTC on 26 Sep.
    await asOwner((sql) => sql`insert into booking (business_id, reference, submission_key, submission_hash, service_id,
      service_name, starts_at, ends_at, party_size, customer_name, customer_phone, status)
      values
      (${A}, 'AAAAAA', gen_random_uuid(), 'h', ${serviceA}, 'cupping class', '2026-09-26T16:30:00Z', '2026-09-26T17:30:00Z', 1, 'Late', '60123456789', 'confirmed'),
      (${A}, 'BBBBBB', gen_random_uuid(), 'h', ${serviceA}, 'cupping class', '2026-09-27T05:00:00Z', '2026-09-27T06:00:00Z', 1, 'Pending', '60123456789', 'pending'),
      (${A}, 'CCCCCC', gen_random_uuid(), 'h', ${serviceA}, 'cupping class', '2026-09-26T08:00:00Z', '2026-09-26T09:00:00Z', 1, 'Earlier', '60123456789', 'confirmed')`);
    const day = await jsonOf<{ bookings: Array<{ customerName: string }> }>(
      await call('GET', '/api/apps/bookings/bookings?from=2026-09-27&days=1', ownerA));
    expect(day.bookings.map((b) => b.customerName)).toEqual(['Pending', 'Late']);
    const first = await jsonOf<{ bookings: Array<{ customerName: string }>; nextCursor: string | null }>(
      await call('GET', '/api/apps/bookings/bookings?from=2026-09-26&days=2&limit=2', ownerA));
    expect(first.bookings.map((b) => b.customerName)).toEqual(['Earlier', 'Pending']);
    const rest = await jsonOf<{ bookings: Array<{ customerName: string }>; nextCursor: string | null }>(
      await call('GET', `/api/apps/bookings/bookings?from=2026-09-26&days=2&limit=2&cursor=${first.nextCursor}`, ownerA));
    expect(rest.bookings.map((b) => b.customerName)).toEqual(['Late']);
    expect(rest.nextCursor).toBeNull();
  });

  it('refuses a bad window and hides another business', async () => {
    expect((await call('GET', '/api/apps/bookings/bookings?from=2026-02-30', ownerA)).status).toBe(400);
    expect((await call('GET', '/api/apps/bookings/bookings?from=2026-09-27&days=32', ownerA)).status).toBe(400);
    const id = await booking(inDays(2));
    expect((await call('GET', `/api/apps/bookings/bookings/${id}`, ownerA)).status).toBe(200);
    expect((await call('GET', `/api/apps/bookings/bookings/${id}`, ownerB)).status).toBe(404);
  });
});

describe('deciding', () => {
  it('confirms, queues a Calendar job when Google is connected, and repeats safely', async () => {
    await asOwner((sql) => sql`insert into connection (business_id, connector, method, status) values (${A}, 'google', 'oauth', 'connected')`);
    const id = await booking(inDays(2));
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    expect(res.status).toBe(200);
    const body = await jsonOf<Json>(res);
    expect(body.booking).toMatchObject({ status: 'confirmed', calendar: { status: 'pending' } });
    expect(decodeURIComponent(body.whatsappUrl!)).toContain('is confirmed. Ref K7Q2MP. See you at SEIDO Coffee.');
    const again = await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    expect(again.status).toBe(200);
    const jobs = await asOwner((sql) => sql<{ desired: string; revision: number }[]>`select desired, revision from booking_calendar_job`);
    expect(jobs).toEqual([{ desired: 'present', revision: 1 }]);
  });

  it('marks Calendar not connected when there is no Google connection', async () => {
    const id = await booking(inDays(2));
    const body = await jsonOf<Json>(await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' }));
    expect(body.booking.calendar.status).toBe('not_connected');
    expect(await asOwner((sql) => sql`select 1 from booking_calendar_job`)).toHaveLength(0);
  });

  it('refuses a conflicting decision, an expired request, and another business', async () => {
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'decline' });
    const conflict = await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'ALREADY_DECIDED' });
    const past = await booking(new Date(Date.now() - 3_600_000).toISOString(), { ref: 'PPPPPP' });
    const expired = await call('POST', `/api/apps/bookings/bookings/${past}/decide`, ownerA, { decision: 'confirm' });
    expect(expired.status).toBe(409);
    expect(await expired.json()).toMatchObject({ code: 'EXPIRED' });
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerB, { decision: 'confirm' })).status).toBe(404);
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'maybe' })).status).toBe(400);
  });

  it('lets exactly one of two concurrent decisions win', async () => {
    const id = await booking(inDays(2));
    const [a, b] = await Promise.all([
      call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' }),
      call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'decline' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('writes the WhatsApp text in Malay for a Malay business', async () => {
    await asOwner((sql) => sql`update business set lang = 'bm' where id = ${A}`);
    const id = await booking(inDays(2));
    const body = await jsonOf<Json>(await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' }));
    expect(decodeURIComponent(body.whatsappUrl!)).toContain('telah disahkan');
  });
});

describe('cancelling', () => {
  it('releases the place, keeps the confirmation, and queues removal when an event may exist', async () => {
    await asOwner((sql) => sql`insert into connection (business_id, connector, method, status) values (${A}, 'google', 'oauth', 'connected')`);
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/cancel`, ownerA);
    expect(res.status).toBe(200);
    const body = await jsonOf<Json>(res);
    expect(body.booking).toMatchObject({ status: 'cancelled', calendar: { status: 'pending' } });
    expect(decodeURIComponent(body.whatsappUrl!)).toContain('has been cancelled');
    const [row] = await asOwner((sql) => sql<{ decided_at: Date | null; cancelled_at: Date | null }[]>`
      select decided_at, cancelled_at from booking where id = ${id}`);
    expect(row.decided_at).not.toBeNull();
    expect(row.cancelled_at).not.toBeNull();
    expect(await asOwner((sql) => sql`select desired, revision from booking_calendar_job`)).toEqual([{ desired: 'absent', revision: 2 }]);
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/cancel`, ownerA)).status).toBe(200);
    expect(await asOwner((sql) => sql`select revision from booking_calendar_job`)).toEqual([{ revision: 2 }]);
  });

  it('needs no Calendar cleanup when none was ever connected, and refuses pending or started bookings', async () => {
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    await call('POST', `/api/apps/bookings/bookings/${id}/cancel`, ownerA);
    expect(await asOwner((sql) => sql`select 1 from booking_calendar_job`)).toHaveLength(0);
    const pending = await booking(inDays(3), { ref: 'QQQQQQ' });
    expect((await call('POST', `/api/apps/bookings/bookings/${pending}/cancel`, ownerA)).status).toBe(409);
    const started = await booking(new Date(Date.now() - 600_000).toISOString(), { ref: 'RRRRRR', status: 'confirmed' });
    const res = await call('POST', `/api/apps/bookings/bookings/${started}/cancel`, ownerA);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'EXPIRED' });
  });

  it('counts only future pending requests on the apps list', async () => {
    await booking(inDays(2));
    await booking(new Date(Date.now() - 3_600_000).toISOString(), { ref: 'LDLDLD' });
    const listed = await jsonOf<{ apps: Array<{ pending: number }> }>(await call('GET', '/api/apps', ownerA));
    expect(listed.apps[0].pending).toBe(1);
  });
});
```

Every fixture reference matches the `reference` check,
`^[A-HJ-NP-Z2-9]{6}$`: no `0`, `O`, `1` or `I`.

- [ ] **Step 2: Run it and confirm it fails.**

```bash
pnpm test -- --run test/apps-bookings-route.test.ts
```

Expected: FAIL. The bookings paths answer 404, because the route has no
bookings block yet.

- [ ] **Step 3: Create `worker/src/apps/bookings/bookings.ts`.**

```ts
import type postgres from 'postgres';
import { findConnection } from '../../connections';
import { GOOGLE_CALENDAR_CONNECTOR } from '../../connectors/google-calendar';
import { bookingMessage, whatsappUrl, type Lang, type MessageKind } from './messages';
import { addDays, myInstant } from './time';

/* The owner's side of booking requests. Decisions and cancellations lock in
   the common order (the installation, then the service, then the booking)
   and change state with a conditional update, so a double tap or two devices
   deciding at once leave exactly one outcome. */

export type BookingStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled';
export type CalendarStatus = 'none' | 'pending' | 'created' | 'failed' | 'not_connected' | 'removed';

export interface BookingRow {
  id: string;
  reference: string;
  service_id: string;
  service_name: string;
  starts_at: Date;
  ends_at: Date;
  party_size: number;
  customer_name: string;
  customer_phone: string;
  note: string | null;
  status: BookingStatus;
  decided_at: Date | null;
  cancelled_at: Date | null;
  calendar_status: CalendarStatus;
  calendar_error: string | null;
  created_at: Date;
}

export interface BookingContext { businessName: string; lang: Lang; publicUrl: string; now: Date }

export interface BookingJson {
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
  calendar: { status: CalendarStatus; error: string | null };
  /** A prefilled message for the owner to send; never proof it was sent. */
  whatsappUrl: string | null;
  createdAt: string;
}

export interface BookingCursor { d: string; p: 0 | 1; s: string; id: string }

export type DecideResult =
  | { ok: true; row: BookingRow; changed: boolean; calendarQueued: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_DECIDED' | 'EXPIRED' };

// A plain string[]: postgres.js's identifier helper, tx(COLUMNS), does not accept a readonly tuple.
const COLUMNS: string[] = [
  'id', 'reference', 'service_id', 'service_name', 'starts_at', 'ends_at', 'party_size', 'customer_name',
  'customer_phone', 'note', 'status', 'decided_at', 'cancelled_at', 'calendar_status', 'calendar_error', 'created_at',
];

function messageKind(status: BookingStatus): MessageKind | null {
  return status === 'confirmed' ? 'confirm' : status === 'declined' ? 'decline' : status === 'cancelled' ? 'cancel' : null;
}

export function bookingJson(row: BookingRow, ctx: BookingContext): BookingJson {
  const kind = messageKind(row.status);
  return {
    id: row.id,
    reference: row.reference,
    serviceId: row.service_id,
    serviceName: row.service_name,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    partySize: row.party_size,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    note: row.note,
    status: row.status,
    expired: row.status === 'pending' && row.starts_at.getTime() <= ctx.now.getTime(),
    decidedAt: row.decided_at?.toISOString() ?? null,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    calendar: { status: row.calendar_status, error: row.calendar_error },
    whatsappUrl: kind ? whatsappUrl(row.customer_phone, bookingMessage({
      kind, lang: ctx.lang, customerName: row.customer_name, serviceName: row.service_name,
      partySize: row.party_size, startsAt: row.starts_at, reference: row.reference,
      businessName: ctx.businessName, publicUrl: ctx.publicUrl,
    })) : null,
    createdAt: row.created_at.toISOString(),
  };
}

export function encodeCursor(cursor: BookingCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(value: string): BookingCursor | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const raw = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))) as Record<string, unknown>;
    const ok = typeof raw.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.d) && (raw.p === 0 || raw.p === 1) &&
      typeof raw.s === 'string' && !Number.isNaN(Date.parse(raw.s)) &&
      typeof raw.id === 'string' && /^[0-9a-f-]{36}$/i.test(raw.id);
    return ok ? { d: raw.d as string, p: raw.p as 0 | 1, s: raw.s as string, id: raw.id as string } : null;
  } catch {
    return null;
  }
}

/** Bookings overlapping a window of Malaysian days, ordered by Malaysian
    date, pending first within a day, then start time. */
export async function listBookings(
  tx: postgres.TransactionSql,
  businessId: string,
  query: { from: string; days: number; status: 'pending' | null; cursor: BookingCursor | null; limit?: number; now: Date },
): Promise<{ rows: BookingRow[]; nextCursor: string | null }> {
  const limit = query.limit ?? 50;
  const windowStart = myInstant(query.from);
  const windowEnd = myInstant(addDays(query.from, query.days));
  const day = tx`(starts_at at time zone 'Asia/Kuala_Lumpur')::date`;
  const rows = await tx<Array<BookingRow & { day: string }>>`
    select ${tx(COLUMNS)}, ${day}::text as day from booking
     where business_id = ${businessId} and starts_at < ${windowEnd} and ends_at > ${windowStart}
       ${query.status === 'pending' ? tx`and status = 'pending' and starts_at > ${query.now}` : tx``}
       ${query.cursor ? tx`and (${day}, (status <> 'pending')::int, starts_at, id)
         > (${query.cursor.d}::date, ${query.cursor.p}::int, ${query.cursor.s}::timestamptz, ${query.cursor.id}::uuid)` : tx``}
     order by ${day}, (status <> 'pending')::int, starts_at, id
     limit ${limit + 1}`;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map(({ day: _day, ...row }) => row),
    nextCursor: rows.length > limit && last
      ? encodeCursor({ d: last.day, p: last.status === 'pending' ? 0 : 1, s: last.starts_at.toISOString(), id: last.id })
      : null,
  };
}

export async function getBooking(tx: postgres.TransactionSql, businessId: string, id: string): Promise<BookingRow | null> {
  const [row] = await tx<BookingRow[]>`select ${tx(COLUMNS)} from booking where business_id = ${businessId} and id = ${id}`;
  return row ?? null;
}

/** Lock the installation, the booking's service, then the booking. */
async function lockForChange(tx: postgres.TransactionSql, businessId: string, id: string): Promise<BookingRow | null> {
  const [installed] = await tx`select 1 from app_installation
    where business_id = ${businessId} and app_key = 'bookings' for update`;
  if (!installed) return null;
  const [target] = await tx<{ service_id: string }[]>`select service_id from booking
    where business_id = ${businessId} and id = ${id}`;
  if (!target) return null;
  await tx`select 1 from booking_service where business_id = ${businessId} and id = ${target.service_id} for update`;
  const [row] = await tx<BookingRow[]>`select ${tx(COLUMNS)} from booking
    where business_id = ${businessId} and id = ${id} for update`;
  return row ?? null;
}

/** Record the Calendar state a booking should reach. A new revision tells a
    running executor its work is stale; a live lease is left alone. */
export async function queueCalendarJob(
  tx: postgres.TransactionSql,
  businessId: string,
  bookingId: string,
  desired: 'present' | 'absent',
  now: Date,
): Promise<void> {
  await tx`insert into booking_calendar_job (business_id, booking_id, desired, revision, attempts, next_attempt_at, updated_at)
    values (${businessId}, ${bookingId}, ${desired}, 1, 0, ${now}, ${now})
    on conflict (business_id, booking_id) do update
      set desired = excluded.desired, revision = booking_calendar_job.revision + 1, attempts = 0,
          next_attempt_at = excluded.next_attempt_at, last_error = null, updated_at = excluded.updated_at`;
}

export async function decideBooking(
  tx: postgres.TransactionSql,
  businessId: string,
  id: string,
  decision: 'confirm' | 'decline',
  userId: string,
  now: Date,
): Promise<DecideResult> {
  const row = await lockForChange(tx, businessId, id);
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  const target: BookingStatus = decision === 'confirm' ? 'confirmed' : 'declined';
  if (row.status === target) return { ok: true, row, changed: false, calendarQueued: false };
  if (row.status !== 'pending') return { ok: false, code: 'ALREADY_DECIDED' };
  if (row.starts_at.getTime() <= now.getTime()) return { ok: false, code: 'EXPIRED' };
  let calendarStatus: CalendarStatus = 'none';
  let connectionId: string | null = null;
  if (target === 'confirmed') {
    const connection = await findConnection(tx, GOOGLE_CALENDAR_CONNECTOR);
    connectionId = connection?.id ?? null;
    calendarStatus = connection ? 'pending' : 'not_connected';
  }
  const [updated] = await tx<BookingRow[]>`update booking
    set status = ${target}, decided_at = ${now}, decided_by = ${userId},
        calendar_status = ${calendarStatus}, calendar_connection_id = ${connectionId}
    where business_id = ${businessId} and id = ${id} and status = 'pending'
    returning ${tx(COLUMNS)}`;
  if (connectionId) await queueCalendarJob(tx, businessId, id, 'present', now);
  return { ok: true, row: updated, changed: true, calendarQueued: connectionId !== null };
}

export async function cancelBooking(
  tx: postgres.TransactionSql,
  businessId: string,
  id: string,
  userId: string,
  now: Date,
): Promise<DecideResult> {
  const row = await lockForChange(tx, businessId, id);
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (row.status === 'cancelled') return { ok: true, row, changed: false, calendarQueued: false };
  if (row.status !== 'confirmed') return { ok: false, code: 'ALREADY_DECIDED' };
  if (row.starts_at.getTime() <= now.getTime()) return { ok: false, code: 'EXPIRED' };
  const [job] = await tx`select 1 from booking_calendar_job where business_id = ${businessId} and booking_id = ${id}`;
  // An event may exist if one was ever queued or recorded; only then clean up.
  const eventMayExist = Boolean(job) || row.calendar_status === 'created';
  const [updated] = await tx<BookingRow[]>`update booking
    set status = 'cancelled', cancelled_at = ${now}, cancelled_by = ${userId},
        calendar_status = ${eventMayExist ? 'pending' : row.calendar_status}
    where business_id = ${businessId} and id = ${id} and status = 'confirmed'
    returning ${tx(COLUMNS)}`;
  if (eventMayExist) await queueCalendarJob(tx, businessId, id, 'absent', now);
  return { ok: true, row: updated, changed: true, calendarQueued: eventMayExist };
}
```

- [ ] **Step 4: Add the bookings routes to `worker/src/routes/apps.ts`.**
  - Add these imports:

```ts
import type postgres from 'postgres';
import { bookingJson, cancelBooking, decideBooking, decodeCursor, getBooking, listBookings, type BookingContext } from '../apps/bookings/bookings';
import { isDate, myDate } from '../apps/bookings/time';
import type { Lang } from '../apps/bookings/messages';
```

  - Insert this block before the final `return notFound(cors);`:

```ts
  if (url.pathname === '/api/apps/bookings/bookings' || url.pathname.startsWith('/api/apps/bookings/bookings/')) {
    if (!can(identity, 'bookings.decide')) return forbidden(cors);
    const context = async (tx: postgres.TransactionSql): Promise<BookingContext | null> => {
      const [business] = await tx<{ name: string; lang: Lang }[]>`select name, lang from business where id = ${businessId}`;
      const [installed] = await tx<{ public_slug: string }[]>`select public_slug from app_installation
        where business_id = ${businessId} and app_key = 'bookings'`;
      if (!business || !installed) return null;
      return { businessName: business.name, lang: business.lang, publicUrl: publicBookingUrl(sitesOrigin, installed.public_slug), now };
    };

    if (url.pathname === '/api/apps/bookings/bookings' && request.method === 'GET') {
      const from = url.searchParams.get('from') ?? myDate(now);
      const days = Number(url.searchParams.get('days') ?? '7');
      const limit = Number(url.searchParams.get('limit') ?? '50');
      const status = url.searchParams.get('status');
      const rawCursor = url.searchParams.get('cursor');
      const cursor = rawCursor ? decodeCursor(rawCursor) : null;
      if (!isDate(from) || !Number.isInteger(days) || days < 1 || days > 31 || !Number.isInteger(limit) || limit < 1 ||
          limit > 100 || (status !== null && status !== 'pending') || (rawCursor && !cursor)) {
        return json({ ok: false, err: 'invalid bookings window' }, { status: 400 }, cors);
      }
      const result = await withTenant(env, businessId, async (tx) => {
        const ctx = await context(tx);
        if (!ctx) return null;
        const page = await listBookings(tx, businessId, { from, days, status: status === 'pending' ? 'pending' : null, cursor, limit, now });
        return { bookings: page.rows.map((row) => bookingJson(row, ctx)), nextCursor: page.nextCursor };
      });
      if (!result) return notFound(cors);
      return json({ ok: true, ...result }, {}, cors);
    }

    const match = url.pathname.match(/^\/api\/apps\/bookings\/bookings\/([0-9a-f-]{36})(?:\/(decide|cancel))?$/i);
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
          : await cancelBooking(tx, businessId, id, identity.userId, now);
        return result.ok ? { ok: true as const, booking: bookingJson(result.row, ctx) } : result;
      });
      if (!outcome.ok) {
        return outcome.code === 'NOT_FOUND' ? notFound(cors)
          : json({ ok: false, code: outcome.code }, { status: 409 }, cors);
      }
      return json({ ok: true, booking: outcome.booking, whatsappUrl: outcome.booking.whatsappUrl }, {}, cors);
    }
  }
```

- [ ] **Step 5: Run the tests.**

```bash
pnpm test -- --run test/apps-bookings-route.test.ts test/apps-config-route.test.ts
```

Expected: all pass.
- **If the concurrency test fails with a deadlock:** check that both paths lock
  the installation first (`lockForChange`).
- **If the cursor test fails:** compare the `day` expression in the `where` and
  `order by` clauses. They must be identical.

- [ ] **Step 6: Typecheck and commit.**

```bash
pnpm typecheck
git add src/apps/bookings/bookings.ts src/routes/apps.ts test/apps-bookings-route.test.ts
git commit -m "feat(worker): owners list, confirm, decline and cancel booking requests"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the whole worker suite and both typecheck passes.**

```bash
cd ~/ios/aisar-site/.worktrees/bookings-v1/worker && pnpm typecheck && pnpm test
```

Expected: everything passes.
- **If an unrelated test fails,** re-run that file alone before suspecting this
  change.
- **If a failure is real, fix it in the task that caused it,** and commit the
  fix by named path.

- [ ] **Step 2: Confirm nothing is live.**

```bash
/usr/bin/grep -n '^APPS_ENABLED' wrangler.toml
```

Expected: `APPS_ENABLED = "false"`. This plan deploys nothing. The switch
flips only in the spec's release step, after plans 2–4.

- [ ] **Step 3: Record progress in the spec.** Add one line under the status
  line of `docs/plans/2026-09-23-apps-shell-and-bookings-v1.md`:
  `Plan 1 (worker foundation) built on branch bookings-v1: <last commit>.`
  Then commit it by named path.
