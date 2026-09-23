# Apps shell and Bookings v1

Status: **approved for build, 23 September 2026.** The owner accepted D1–D8
and decided D9. Implementation has not started. This is project 1 of
[apps wired to automation](2026-09-23-apps-wired-to-automation.md); read that
document for the why, the catalogue and the rules against bloat.

Plan 1 (worker foundation) built on branch bookings-v1: f7b8d00.
Plan 2 (public pages) built on branch bookings-v1: addd6c5.
Plan 3 (durable Calendar sync) built on branch bookings-v1: 7a05379. Before release: run the deleted-id experiment in "Calendar deleted-id verification" against a disposable test calendar.

Written to be built by an agent that has not seen the conversation behind it.
Everything in this repo's `CLAUDE.md` applies, in particular:

- `resolveTenant` is the only source of a business id.
- RLS is forced on every tenant table.
- Assert as `aisar_app`, arrange as `owner`.
- `pnpm typecheck` in `worker/` runs twice.
- Stage named paths only; never `git add -A`.
- Deploy order is migration, then Worker, then app.

## What this delivers

For businesses on a pilot list, and nobody else:

1. **A public booking page.** A customer of the business opens a link, picks
   a service and a time, leaves a name and phone number, and gets "request
   received".
2. **The request reaches the owner** as a push notification, a red count on
   the Bookings tile, and an item in the daily brief.
3. **The owner confirms or declines** in one tap.
   - On confirm, a durable job adds the booking to the owner's Google Calendar
     if one is connected. Sync progress and recoverable failures are visible.
   - Either way, the owner gets a prefilled WhatsApp message to send the
     customer with one more tap.
   - Owners can cancel a future confirmed booking, release its places, and
     send a cancellation message. Automatic Calendar removal is included in v1
     by owner decision (D9), with durable retry and reconciliation.
4. **Home changes to option B** once the business has an app.
   - The four Home tiles become the business's apps.
   - Alerts moves to a bell in the top bar.
   - An **Apps** entry joins the bottom bar and the sidebar.

The kill criterion comes from the direction doc. If 3 pilot businesses have
not taken one real customer booking within 2 weeks of going live, stop before
the WhatsApp port.

## Out of scope

Each of these is a later project:

- sending WhatsApp automatically (this version uses a `wa.me` link the owner
  taps)
- payments or deposits
- reminders to customers
- the customer cancelling or rescheduling
- shared staff/resource scheduling, nightly rentals, and checking existing
  Google Calendar events for availability
- editing the page by chat, and any agent tool for bookings (reading or
  writing). Scheduled as **plan 5**, after the owner screens (plan 4):
  chat proposes a change to the same structured settings the owner screen
  edits (services, hours, capacity, notice, pause, link name), shown as a
  diff the owner approves through the existing approval gate, and saved
  through the same versioned config write. A few safe presentation fields
  (a welcome line, a logo, an accent from a fixed palette) may join it as
  structured, escaped settings. The prompt never generates the page's HTML,
  CSS or script: that would be the general builder this direction rejects,
  and it would break the escaping, CSP and no-cookie guarantees.
- staff access to bookings (owner only)
- rows in Activity for bookings
- a custom domain, and a subdomain per business
- any app other than Bookings
- businesses outside Malaysia
- a retention period for customers' names and phone numbers, and handling a
  customer's request to delete them (PDPA). v1 shows the notice described
  under [Public pages](#public-pages-the-sites-deploy). Retention and
  deletion are a `docs/todo.md` row that must be settled before the pilot
  widens beyond the first businesses.

## Defaults taken, for the owner to review

The direction doc left these open. The owner approved D1–D8 on 23 September
2026, and decided D9: keep automatic Calendar removal in v1.

| # | Decision | Default in this spec |
|---|---|---|
| D1 | Where public pages are served | A second deploy of `worker/`, named `jentera-sites`, at `jentera-sites.qhkmdev90.workers.dev`, until the public domain is chosen. `workers.dev` is on the Public Suffix List, so it is a separate site from the workspace and from `aisar-api`. |
| D2 | When Home switches to option B | When the business has at least one app installed. With the flag on but no app yet, Home keeps today's four tiles, and the Apps entry is where Bookings is set up. |
| D3 | Who can decide and configure | The owner only (`apps.manage`, `bookings.decide`). |
| D4 | Holding a slot | A pending request holds its places until declined. Nothing expires automatically. A pending request whose start time has passed shows as "Expired" and cannot be confirmed. |
| D5 | How slots are made | Every service has its own weekly hours and capacity. Start times step by duration from opening time; existing overlapping reservations consume capacity even after settings change. Services do not share capacity. Pilot eligibility below is mandatory. |
| D6 | Calendar | Confirmation and a Calendar job commit together. After commit, the placed request schedules the first attempt via `ctx.waitUntil`; the minute cron retries and reconciles durable jobs. Both use the same lease/revision rules. Failures never undo confirmation. Owners can retry after fixing a connection. Cancellation queues automatic removal, as selected in D9. |
| D7 | Search engines | Public pages carry `noindex` during the pilot. |
| D8 | Time zone and phone numbers | `Asia/Kuala_Lumpur` everywhere, and Malaysian phone numbers only. This matches the five places that already hard-code the zone. |
| D9 | Calendar removal on cancellation | **Owner selected: retain automatic removal in v1.** Include durable cleanup, create/delete race handling and the provider verification below. |

### D9: automatic Calendar removal retained

Owner decision, 23 September 2026: retain automatic Calendar removal. Cancellation
releases capacity immediately, preserves the audit trail, provides the WhatsApp
cancellation message and durably queues removal of any event that exists or may
have been created. The UI shows cleanup progress and failures separately from
the booking's cancelled status.

The `absent` jobs, idempotent deletion, lease/revision checks, reconciliation and
cancellation-race tests below are required v1 scope. Verify deleted-id behavior
in an isolated test calendar before release; do not assume a 409 means a live
event exists.

### Pilot eligibility and availability limits

Start with a single bookable service, or services whose people, rooms and
equipment are independent. Multiple services that compete for the same person
or resource are not eligible for this version. Verify this with each pilot
before enabling its id; do not assume the businesses suggested in the direction
doc all fit. Kitakod is the internal end-to-end test first.

Google Calendar is an output, not an availability source. Setup explains:
"Availability comes from the hours you set here. Other calendar events do not
block these times." Require the owner to acknowledge this before publishing.
Do not claim conflict checking against Google Calendar or across services.

Pending requests hold capacity until declined or their reserved interval ends.
An expired pending request cannot be confirmed; its historical status remains
pending and the UI derives "Expired". An ongoing expired request still reserves
its interval until its end, avoiding accidental overlap after a settings edit.

## Flag

Follow `DESKTOP_VIEW_BUSINESS_IDS` (`worker/src/runtime/desktop.ts:11-15`),
**not** routines. Routines treats an empty list as "every business", which is
wrong for a pilot.

- `worker/wrangler.toml` gets `APPS_ENABLED = "true"` and
  `APPS_BUSINESS_IDS = "<uuid>,<uuid>"`. The first id is Kitakod,
  `4e8c…50b5`, the id already used for desktop view.
  - Both are typed in `worker/src/env.ts`.
  - Both vars are repeated under `[env.sites]` (see
    [Public pages](#public-pages-the-sites-deploy)).
- **New `worker/src/apps/gating.ts`** exports
  `appsEnabledFor(env, businessId): boolean`.
  - It needs `APPS_ENABLED === 'true'` and an exact, case-insensitive match
    against a list of valid UUIDs.
  - At most 20 ids, and no wildcard.
- **`/api/me`** (`worker/src/routes/session.ts:612-630`) adds
  `features.apps = { apiVersion: 1 }` only when `appsEnabledFor` is true
  **and** `can(identity, 'apps.manage')`.
  - Staff therefore never receive the feature (D3), and the app never needs to
    read a role. The team panel follows the same pattern with a
    server-provided `canManage`.
- **App:** `MeResponse.features` (`app/src/lib/repo/remote.ts:75-78`) gains
  `apps?: { apiVersion: 1 }`. Add an `AppsContext` and `useAppsEnabled()`
  beside routines in `app/src/lib/repo/gate.tsx` (lines 51, 91 and 190-191).
- **The flag gates everything.** Every owner route and every public route
  answers **404** for a business outside the flag, so removing an id hides the
  feature and the public page at once.
- **The two deploys must agree.** `APPS_ENABLED` and `APPS_BUSINESS_IDS` exist
  in two places: the top-level vars (`aisar-api`) and `[env.sites]`. If they
  drift, the pilot is half on: the public page is live while owner routes
  404, or the reverse.
  - Add `worker/scripts/check-apps-flags.mjs`. It parses `wrangler.toml` and
    exits 1 when the two sets differ, comparing ids as a normalised set
    (lowercased, sorted, no duplicates).
  - Run it from `predeploy`, beside `check-transfer-fields.mjs`.
  - Add `"deploy:sites": "node scripts/check-apps-flags.mjs && wrangler deploy --env sites"`
    to `worker/package.json`, because a bare `wrangler deploy --env sites`
    skips `predeploy`.
  - Give it a test for matching and differing lists.

## Data model

One migration, `worker/migrations/067_apps_bookings.sql`. **Take the next free
number when you write it**, since other sessions add migrations.

Before applying it to production, check whether 065 and 066 have been applied
there: `docs/todo.md` said on 22 Sep that 065 had not. Apply in order.

Copy the conventions of `048_goals.sql` and `049_goal_checkpoints.sql`:

- `(business_id, id)` primary keys, and composite foreign keys
- length and `in (…)` checks
- `enable` **and** `force row level security`
- a policy with **both** `using` and `with check` on
  `nullif(current_setting('app.business_id', true), '')::uuid`, as in `065`
- grants to `aisar_app` limited to what the routes need

```sql
create table app_installation (
  business_id uuid not null references business(id) on delete cascade,
  app_key     text not null check (app_key in ('bookings')),
  state       text not null default 'active' check (state in ('active', 'paused')),
  public_slug text not null check (public_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (business_id, app_key)
);
create unique index app_installation_slug on app_installation (public_slug);

create table booking_settings (
  business_id        uuid primary key references business(id) on delete cascade,
  accepting          boolean not null default true,
  availability_acknowledged_at timestamptz not null,
  min_notice_minutes integer not null default 120 check (min_notice_minutes between 0 and 10080),
  horizon_days       integer not null default 30  check (horizon_days between 1 and 90),
  updated_at         timestamptz not null default now()
);

create table booking_service (
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

create table booking_hours (
  business_id uuid not null,
  service_id  uuid not null,
  weekday     smallint not null check (weekday between 0 and 6),  -- 0 = Sunday
  opens       time not null,
  closes      time not null,
  check (closes > opens),
  primary key (business_id, service_id, weekday, opens),
  foreign key (business_id, service_id) references booking_service (business_id, id) on delete cascade
);

create table booking (
  business_id     uuid not null,
  id              uuid not null default gen_random_uuid(),
  reference       text not null,   -- 6 characters, shown to the customer
  submission_key  uuid not null,
  submission_hash text not null,   -- digest of the normalized request payload
  service_id      uuid not null,
  service_name    text not null check (char_length(service_name) between 1 and 80),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  party_size      integer not null check (party_size between 1 and 50),
  customer_name   text not null check (char_length(customer_name) between 1 and 80),
  customer_phone  text not null check (customer_phone ~ '^60[0-9]{8,11}$'),
  note            text check (char_length(note) <= 500),
  status          text not null default 'pending' check (status in ('pending', 'confirmed', 'declined', 'cancelled')),
  decided_at      timestamptz,
  decided_by      uuid,
  cancelled_at    timestamptz,
  cancelled_by    uuid,
  calendar_status text not null default 'none' check (calendar_status in ('none', 'pending', 'created', 'failed', 'not_connected', 'removed')),
  calendar_connection_id uuid,    -- connection chosen for this booking's event
  calendar_event_id text,
  calendar_error  text check (char_length(calendar_error) <= 300),
  created_at      timestamptz not null default now(),
  check (ends_at > starts_at),
  primary key (business_id, id),
  unique (business_id, reference),
  unique (business_id, submission_key),
  foreign key (business_id, service_id) references booking_service (business_id, id)
);
create index booking_slot on booking (business_id, service_id, starts_at) where status in ('pending', 'confirmed');
```

Snapshot `service_name`, `starts_at` and `ends_at` when creating the request.
Later service edits must not rewrite what the customer requested. Use a
tenant-composite foreign key for `calendar_connection_id` where supported by
the existing connection schema; a disconnected/replaced connection must not
silently redirect cleanup to a different calendar.

**Calendar jobs.** Add a tenant-scoped `booking_calendar_job` table in this
migration, one row per `(business_id, booking_id)` with a composite booking FK.
It records desired state (`present` or `absent`), revision, attempts,
`next_attempt_at`, lease token/expiry, completion and a sanitized last error.
Enforce the same forced RLS and tenant policy as the other new tables. Add a
narrow security-definer due scan returning ids only, following the push outbox
pattern. Both the API Worker's post-commit request attempt and its cron use the
same job processor and claim rules; the sites deploy has no Calendar executor
or credential secrets.

**Deleting.** `booking_service` needs `delete` for the settings editor. Only
delete a service that has no bookings; otherwise set `active = false`. Nothing
else needs `delete`.

**Resolving the public slug.** A security-definer function, following
`invitation_by_token` (`035_invitation.sql:41-55`): stable, security definer,
a pinned `search_path`, `revoke all … from public` and
`grant execute … to aisar_app`.

```sql
create or replace function public.bookings_by_slug(p_slug text)
returns table (business_id uuid) language sql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
  select a.business_id from public.app_installation a
  where a.public_slug = p_slug and a.app_key = 'bookings' limit 1
$$;
```

**Notification kind.**
- Redefine `notification_kind_check` with every kind from `040_reminders.sql:32-36`
  plus `booking_requested`.
- Add `booking_requested` to the TypeScript union in
  `worker/src/notifications/store.ts:4-13`.
- Add a nullable generic `url` column to `notification`. Persist the existing
  input through `createNotification`, select it in list queries, and expose it
  in notification JSON and app types. Existing rows can remain null and use
  their current task/routine navigation fallback. Future apps use the same
  column rather than adding one foreign key per app.
- Store server-generated internal workspace paths only, such as
  `/app?view=apps&app=bookings&booking=<id>`; validate origin/path before using
  the target for either push or in-app navigation. Reject external URLs,
  protocol-relative URLs and non-navigation schemes. A URL is a navigation
  hint, never authorization: the destination still enforces tenant, permission
  and feature checks. Booking records are retained, and stale/unavailable
  targets get the normal safe fallback.
- The current `url` input only reaches the push outbox; it is not stored in
  the in-app notification. Both destinations must now use the persisted target.

**Production apply script.** Migrations reach production through one script
per migration, not by hand. Add `worker/scripts/apply-apps-bookings.mjs`,
copied from `apply-goals.mjs`:

- It keeps the same allowlist of reviewed Neon owner hosts.
- It runs the migration in one transaction and then verifies, before
  committing:
  - every table exists
  - `relrowsecurity` and `relforcerowsecurity` are both set on each
  - each tenant policy exists
  - `aisar_app` holds exactly the grants the routes need
  - `bookings_by_slug` exists and `aisar_app` can execute it
  - `notification_kind_check` admits `booking_requested`
  - the Calendar jobs table, due-scan grants, and generic notification URL column exist
- It prints `{ ok: true, migration: '067_apps_bookings', verified }`.

Register it as `"db:migrate:apps-bookings"` in `worker/package.json`.

## Worker: owner routes

New file `worker/src/routes/apps.ts`, exporting
`handleApps(request, env, url, cors, ctx)`, receiving the request's execution
context from `index.ts`. It returns `null` for paths it does not
own, and is chained in `index.ts` like `handleGoals` (`index.ts:219-220`).

Every route:
1. calls `resolveTenant`
2. calls `hasBusiness` (401 or 403 as the existing routes do)
3. checks `appsEnabledFor` (404 when false)
4. checks `can(identity, …)` (403)

Tenant database operations run inside `withTenant`. Calendar network calls
run outside database transactions, in the job processor described below.

Add `'apps.manage': ['owner']` and `'bookings.decide': ['owner']` to
`PERMISSIONS` (`worker/src/permissions.ts:15-48`).

| Method and path | Permission | Does |
|---|---|---|
| `GET /api/apps` | `apps.manage` | Installed apps `[{ key: 'bookings', state, publicUrl, pending }]`, where `pending` counts pending bookings not yet started. Also `available: ['bookings']`. **Only list apps that exist.** |
| `GET /api/apps/bookings/config` | `apps.manage` | The installation (or `null`), settings, services and hours |
| `PUT /api/apps/bookings/config` | `apps.manage` | Installs on first call; updates settings and services by stable id and replaces hours in one transaction under the locking rules below. Requires the version returned by config reads; stale edits return `409 CONFIG_CHANGED`. Slug taken: `409 SLUG_TAKEN`. Reserved slugs: `api`, `admin`, `www`, `app`, `b`. |
| `GET /api/apps/bookings/bookings?from=YYYY-MM-DD&days=N&status=pending` | `bookings.decide` | Optional status filter; date window of 1–31 Malaysian days. Cursor-paginated, with service snapshot, Calendar state and `whatsappUrl` for decided bookings. Pending first within each day. Following pages preserves filters. |
| `GET /api/apps/bookings/bookings/:id` | `bookings.decide` | One booking, including Calendar state and the current WhatsApp action. Supports notification links and recovery after a lost response. Missing or other-tenant id: 404. |
| `POST /api/apps/bookings/bookings/:id/decide` | `bookings.decide` | Body `{ decision: 'confirm' \| 'decline' }`. See [Deciding](#deciding). |
| `POST /api/apps/bookings/bookings/:id/cancel` | `bookings.decide` | Cancels a future confirmed booking and durably queues Calendar cleanup. |
| `POST /api/apps/bookings/bookings/:id/calendar/retry` | `bookings.decide` | Requeues failed sync (or initial sync after connecting Calendar). Derives present/absent from booking state and deduplicates an already queued/in-flight job. |

`PUT` already passed the CORS and request-guard lists for push. Confirm that
`test/cors.test.ts` still passes with the new routes, since it scans both
lists.

### Settings and locking

Use the installation row as the per-business lock for the pilot. Config saves,
new requests, decisions and cancellations lock it first, then affected services
in id order, then bookings/jobs. Initial installation uses the unique key to
resolve concurrent creation. Return a version derived from `updated_at`, and
update it on every config change; compare it under the lock before a save.
The Booking page switch must use this version too, so it cannot overwrite newer
hours. Initial setup must include `acknowledgeAvailabilityLimits: true`; the
server records the acknowledgment time and rejects publishing without it.

Reject overlapping weekly-hours ranges, duplicate service ids and attempts to
modify another business's services. Allow split hours in the data contract but
keep the initial editor to one opening range per weekday. Preserve stable service
ids. Omitted services with bookings are deactivated, not deleted.

Existing reservations keep their service name and time snapshots. New hours or
duration affect only new slots. Reject a capacity reduction below the peak
reserved places in any future part of pending/confirmed booking intervals,
including an ongoing booking. Changing hours or deactivating a service does not
cancel its existing bookings; show this consequence before saving.

### Deciding and cancelling

1. In one `withTenant`, acquire the locks above and conditionally change a
   future pending booking. Map `confirm` to `confirmed` and `decline` to
   `declined`; record `decided_at` and `decided_by`.
   - Missing or other-tenant id: **404**. Same decision already applied: **200**
     with the existing result and no repeated side effects. A conflicting
     decision: **409 ALREADY_DECIDED**. A still-pending booking whose start has
     passed: **409 EXPIRED**.
   - On confirm, select the Calendar connection and store its id. If absent,
     set `not_connected`. Otherwise set `pending` and upsert the `present`
     Calendar job **in this same transaction**. Decline queues no Calendar job.
2. Cancellation uses the same locking and conditional-update pattern:
   `confirmed → cancelled`, only before the start, recording `cancelled_at`
   and `cancelled_by`. Repeating cancellation returns the existing result.
   Other states give **409 ALREADY_DECIDED**, or **EXPIRED** for a confirmed
   booking already started. Release capacity immediately. If an event may have
   been created, change the job's desired state to `absent`, increment its
   revision, and set Calendar state to `pending` atomically. Do not clear a
   live executor lease. Never erase the original confirmation audit fields.
3. **After commit**, schedule the first attempt with
   `ctx.waitUntil(processBookingCalendarJob(env, businessId, booking.id))` when
   work is queued. This applies to confirm, explicit retry, and cancellation.
   Do not start before commit or reuse a closed transaction.
   The processor catches/logs sanitized errors and preserves the durable retry
   state; it does not change the successful HTTP response.
4. **Answer immediately** `{ booking, whatsappUrl }`; do not await provider I/O.
   - `whatsappUrl` is `https://wa.me/<customer_phone>?text=<encoded>`, from a
     template in the business's `lang` (`en` or `bm`).
   - Confirm example: "Hi Aisyah, your cupping class for 2 on Sat 27 Sep at
     3:00 pm is confirmed. Ref K7Q2MP. See you at SEIDO Coffee."
   - Decline example: "Hi Aisyah, sorry, we can't take your cupping class
     booking on Sat 27 Sep at 3:00 pm. Please choose another time: <public
     link>."
   - Add a cancellation template explaining the cancellation and linking to
     the public page. Use the snapshotted service name and reserved time.
   - Put the templates in `worker/src/apps/bookings/messages.ts`, both
     languages, with tests. Generate the appropriate URL on every owner list,
     detail and decision response, including after reload or a repeat request.
     Opening WhatsApp does not mean the customer was notified; never show "Sent"
     without delivery evidence.

### Durable Calendar sync

The first attempt runs via `ctx.waitUntil` in the placed HTTP invocation after
the decide/cancel transaction commits, including cancellation cleanup.
Explicit retry uses the same path. The API Worker's minute cron scans due job
ids and processes a bounded batch for retries and reconciliation. `waitUntil`
is a latency improvement, not the durability mechanism: if it never starts or
is interrupted, the committed job remains recoverable.

`CLAUDE.md` records HTTP placement near Neon but cron in IAD, with measured
tenant transactions of 1.1–2.3 seconds there. Do not make a healthy confirmation
wait for the next cron tick. Avoid promising an exact completion time; measure
the first attempt during pilot verification.

Both entry points call the same processor, claim the same job lease, and enforce
the same revision/state checks. A request attempt racing cron must not produce
two active owners of the job, bypass backoff or revive completed work. Follow
the existing outbox's tenant scoping, backoff and lease recovery pattern.
Use up to eight attempts with capped exponential backoff; after exhaustion show
`failed` and allow the owner to retry. Disabled pilots do not execute jobs; retain
them for resumption when re-enabled. Pausing public bookings does not stop sync
for existing reservations.

- Claim a job and read its booking, revision and credential in a short tenant
  transaction, respecting the common lock order. Only one valid lease may
  execute per booking at a time. Retry is only valid for confirmed/cancelled
  bookings; pending/declined bookings cannot create Calendar work.
- Outside the transaction, call `createGoogleCalendarEvent` using the booking id
  as `requestId`, the snapshot name, party size, start/end and Malaysian time
  zone. Include phone, note and reference in the event description. Abort
  network calls with an 8-second budget, including token refresh; a bare
  `Promise.race` without cancellation is insufficient.
- For `absent`, remove the deterministic event id, even when a timed-out create
  never stored its result. Add an idempotent delete helper to the connector;
  already absent is success. Do not create a new event for a cancelled booking.
- A duplicate-id 409 is not proof of a live event. Inspect the fetched event's
  status: `cancelled` is a deletion marker, never a successful `created` result.
  With desired state `absent`, reconcile it as absent; with `present`, report
  an explicit removed-event conflict for owner attention. Do not silently
  resurrect it or generate a replacement id. This check also covers an owner
  deleting an event manually during a create retry.
- Save completion only when lease token and revision still match. If a cancel
  arrived during creation, leave removal due and reconcile to `absent` before
  reporting Calendar cleanup complete. A crashed/expired lease is recoverable;
  an uncertain provider result needs reconciliation, not an assumption that
  no event exists. Test create/cancel races and delayed provider responses.
- Record `created`, `removed`, or a sanitized failure. Mark connection health
  using the existing helpers. A missing/revoked original connection during
  cleanup needs owner attention; never delete through a replacement account.
- When a booking was confirmed with no connection, an explicit retry after
  connecting selects and pins that connection before queueing creation. A
  cancellation with no possible Calendar event needs no cleanup job.
- Sync retries never change booking status or resend customer notifications.
  The owner's confirm/cancel tap authorizes this specific Calendar operation;
  no additional agent approval row is needed.

### Calendar deleted-id verification

Checked against Google's documentation on 23 September 2026:

- [Calendar API errors](https://developers.google.com/workspace/calendar/api/guides/errors)
  documents duplicate-id 409 responses and a deleted-resource 410 response for
  deleting an already-deleted event. It does not promise that every attempt to
  reinsert a deleted id always returns 409.
- [Event resource status](https://developers.google.com/workspace/calendar/api/v3/reference/events)
  documents `cancelled` as deleted, including retrieval by `events.get`; deletion
  markers can later disappear. A returned resource is therefore not sufficient
  evidence of a live event.
- The existing `createGoogleCalendarEvent` fetches the id after a 409 and returns
  `view(body)` without rejecting `status: 'cancelled'`. The booking processor
  must not translate that result into `calendar_status = 'created'`.

**Not yet verified by a live API experiment.** Before relying on automatic
removal, use an explicitly designated disposable test calendar: insert an event
with a deterministic id, delete it, attempt insertion with the same id, then
fetch it. Record response status, API error reason and event status without
credentials/customer data. Also exercise cancellation racing an in-flight
create. Do not run this experiment against customer bookings. Keep tests for
409 followed by a cancelled resource regardless of whether the single live
experiment happens to reproduce that response sequence.

## Public pages: the sites deploy

**Why a second deploy of the same code, rather than a new app or routes on
`aisar-api`:**
- It needs the same database, tenancy helpers, Turnstile and rate limits.
- It must not share an origin with `aisar-api`, where the owner's session
  cookie lives.
- A Wrangler environment gives both with one codebase.

**Configuration.**
- Add `[env.sites]` to `worker/wrangler.toml`:
  - `name = "jentera-sites"`
  - `main = "src/sites/index.ts"`
  - the Hyperdrive binding, repeated, because environment bindings are not
    inherited
  - `APPS_ENABLED`, `APPS_BUSINESS_IDS`, `TURNSTILE_SITE_KEY`
    (public) and `SITES_ORIGIN`
  - a new rate-limit binding, `BOOKING_BURST`, at 10 per 60 s
- It gets **no** `CREDENTIAL_KEY`, `VAULT`, Resend, Stripe or runtime
  secrets. The only secret it needs is `TURNSTILE_SECRET`. If this deploy is
  ever compromised, it cannot decrypt a credential.
- **It never reads or sets a cookie.** Its fetch handler serves only the
  routes below and answers 404 for everything else, including `/api/*`.

**Routes.** All HTML is rendered on the server with no framework and works
without JavaScript, apart from the Turnstile widget.

| Path | Shows |
|---|---|
| `GET /b/:slug` | The business name and the list of active services, in the business's language, with a toggle between English and Malay |
| `GET /b/:slug?service=:id&date=YYYY-MM-DD` | Seven days from the date, and the open times for the chosen day with the places left at each |
| `GET /b/:slug/request?service=:id&start=<ISO>` | The form: name, phone, party size (1 up to the places left), an optional note, and Turnstile |
| `POST /b/:slug/request` | Validates and creates the request, then **303** to `/b/:slug/done?ref=K7Q2MP` |
| `GET /b/:slug/done?ref=` | "Request received. \<Business\> will confirm on WhatsApp." with the reference |

**What each request does.**
- Resolve the slug with `bookings_by_slug` inside `withUser`, then check
  `appsEnabledFor`. Everything else runs in `withTenant(business_id)`, as
  `team.ts:99-108` does.
- `accepting = false` or `state = 'paused'` renders "Not taking bookings
  right now", not a 404, for new booking pages/submissions. An already committed
  submission can still recover its receipt while paused. The done page remains
  a generic receipt and never exposes customer details or decision state from
  the short reference. A disabled pilot always answers 404, including receipts.
- Carry the chosen `en`/`bm` language through all form fields, links and
  redirects. Public pages never expose the owner-only booking detail endpoint.

**Open times.** A pure function, `worker/src/apps/bookings/slots.ts`, takes
the service, its hours, the settings, the existing bookings and `now`, and
returns the open times. Test it on its own.
- Times start at `opens` and step by `duration_minutes`, while
  `start + duration <= closes`, on each day in the horizon.
- Drop any start earlier than `now + min_notice`.
- For a candidate interval `[start, end)`, find the same service's pending and
  confirmed bookings satisfying `existing.start < end && existing.end > start`.
  Compute the peak concurrent reserved places over that interval using their
  start/end boundaries, then subtract that peak from capacity. Treat ends as
  exclusive, so adjacent bookings do not overlap. Do not simply sum all
  overlapping rows: two successive old bookings may each overlap a longer new
  slot without overlapping each other. Declined/cancelled rows consume nothing.
- Read bookings by interval overlap, not only by their start falling inside the
  queried dates. Return each start once. Enforce the configured horizon even
  when a caller supplies a date or start beyond it.

**Submission retries.** Render a cryptographically random UUID as a hidden
`submission_key` in the form; preserve it on validation errors. Store a digest
of the normalized service, start, name, phone, party size and note, excluding
Turnstile tokens. The key is scoped to the business and retained with the booking.
An identical replay returns the original receipt, with no extra booking,
notification or daily-cap usage; a changed payload with the same key gives
**409 SUBMISSION_CHANGED** and asks the customer to start a fresh request.

After input validation and the burst limit, check for a committed identical
submission before verifying a new Turnstile token, since the original token may
already have been consumed. A matching key and digest only recover a generic
receipt, never private data. New submissions need the normal Turnstile check
outside the database transaction. Recheck the key under the transaction lock
below to handle concurrent submits. This protects replay of the same form; a
fresh form is a new request, not implicitly deduplicated by phone number.

**Creating a request, in one `withTenant` transaction.**
1. Lock the installation first, then the service, following the common lock
   order. Recheck the submission key and return its original receipt on an
   identical replay. Re-read installation state, accepting, service active state,
   hours and settings under the lock. A stale open form must not bypass a pause
   or settings change.
2. Under the installation lock, count all bookings created on the current
   Malaysian calendar day, across every service and status. Refuse a new request
   at 200. Keeping count and insert under this shared lock enforces the cap
   even when requests target different services simultaneously.
3. Recompute places left at `starts_at`. `starts_at` must be a start the
   slot function produces, so a made-up time is refused.
4. Too few places: 303 back to the times page with "That time was just taken."
5. Otherwise insert the booking with its submission key/hash and service/time
   snapshots. Generate `reference` from 6 characters with no 0/O or 1/I. Use
   bounded retries with `ON CONFLICT (business_id, reference) DO NOTHING` or a
   savepoint; catching a unique violation alone leaves a transaction aborted.
6. Call `createNotification` for each of `ownersOf(tx, businessId)` with:
   - `kind: 'booking_requested'`
   - `sourceKey: 'booking:' + id`
   - `url: '/app?view=apps&app=bookings&booking=' + id` (persisted in the notification)

   It already queues the push through the outbox. These writes commit with the
   booking. In-app navigation uses the persisted URL and the owner detail route
   to open the exact booking, even outside the current date filter. Disabled
   features and unavailable bookings have a clear fallback message.

**Privacy notice (PDPA).** The request form shows one short line above the
submit button, in the page's language:

- English: "Your name and phone number go to \<Business\> to handle this
  booking."
- Malay: "Nama dan nombor telefon anda dihantar kepada \<Business\> untuk
  menguruskan tempahan ini."
- Both link to `https://jentera.ai/privacy`.

Render the business name escaped, like every other business-provided string.
Collect nothing beyond the form's fields, and do not log customer names,
phone numbers or notes. Retention and deletion are out of scope for v1 (see
[Out of scope](#out-of-scope)).

**Validation.**
- **Phone:** strip everything but digits and a leading `+`. `01…` becomes
  `601…`, and `+60…` becomes `60…`. The result must match `^60[0-9]{8,11}$`.
  Put this in `worker/src/apps/bookings/phone.ts`, with tests.
- **Name:** trimmed, 1–80 characters.
- **Note:** at most 500 characters.
- **Party size:** from 1 up to the places left.

**Abuse limits.**
- **Turnstile.** `verifyTurnstile` (`worker/src/turnstile.ts:47`) hard-codes
  the `signin` action and checks the hostname against `ALLOWED_ORIGINS`.
  - Give it an optional `{ action, hostname }` argument, defaulting to today's
    values so the sign-in doors do not change.
  - The sites deploy passes `{ action: 'booking', hostname: <SITES_ORIGIN host> }`.
  - Missing or rejected: re-render the form with an error.
  - `'unavailable'` admits the request, as the sign-in doors do.
- **Burst limit:** `BOOKING_BURST.limit({ key: 'book:' + clientIp })`.
- **Daily cap:** at most 200 new requests per business per Malaysian calendar
  day, enforced atomically as above. Declining/cancelling does not refund this
  abuse budget. Over it, re-render the form with a polite "try again later".

**Response headers on every page.**
- `Content-Security-Policy: default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `X-Robots-Tag: noindex` (D7)
- `Cache-Control: no-store` (availability, receipts and error forms)
- **No `Set-Cookie`.**

**Escaping.** Every string that came from a business or a customer is escaped
when rendered. That covers the business name, service names and price labels.
Put the helpers in `worker/src/sites/render.ts`.

**Turnstile's allowed hostnames.** The owner adds the sites hostname to the
existing Turnstile widget in the Cloudflare dashboard **before**
`TURNSTILE_SECRET` is set on the sites deploy. Until then, leave the secret
unset, so the check is skipped rather than refusing everyone. This is the same
key-before-secret order the sign-in doors used.

## App (`app/`)

The workspace talks to `aisar-api` only. It links to the sites origin for the
public page, and never calls it.

**Repository.**
- `app/src/lib/repo/types.ts:485` gains an optional `apps?: AppsApi`, remote
  only, like `routines` (`:487`).
- `AppsApi` has `list()`, `bookingsConfig()`, `saveBookingsConfig(input)`,
  `bookings({ from, days, status?, cursor? })`, `booking(id)`,
  `decide(id, decision)`, `cancel(id)` and `retryCalendar(id)`.
- It is implemented in `RemoteRepository` on the existing `call<T>`
  (`remote.ts:106`). `LocalRepository` leaves it out, so the anonymous demo
  and local-only runs never show apps.
- Types live in `app/src/lib/apps/types.ts`.

**Navigation.** When `useAppsEnabled()` is true:
- Insert `{ id: 'apps', labelKey: 'nav.apps', icon: 'apps', section: 'work' }`
  into `NAV` right after `work` (`Dashboard.tsx:59-86`).
- Add `apps: SquaresFour` to the `CHROME` icon map
  (`app/src/components/Icon.tsx:82-101`; these are Phosphor icons, and
  `HomeView` already imports `SquaresFour`). The Bookings tile uses Phosphor's
  `CalendarCheck`.
- On phones, the bottom bar then reads Home · Activity · Chat · Apps · More,
  because `PRIMARY_SLOTS = 3` (`BottomNav.tsx:16`). Skills moves into More
  with nothing else changed.
- The desktop sidebar shows Apps in the work section.

**Home, option B.** Only when apps are enabled **and** `list()` returns at
least one installed app (D2). Otherwise Home does not change.
- **The tile row.** `.home-actions` (`HomeView.tsx:156-176`) renders one tile
  per installed app, followed by an **Add app** tile that opens `view=apps`.
  - Use the same tile markup and styles (`dashboard.css:227-305`).
  - Bookings gets its own colour pair, following
    `.home-action-activity` (pink: `rgb(244 114 182)`). An Add app tile uses a
    dashed border.
  - Bookings shows a red count when `pending > 0`.
  - With more than three apps, show the first three and then **All apps**.
    With only Bookings available, the row has two tiles.
- **The bell.** An Alerts bell button goes into the top bar's
  `accountAccessory` (`Dashboard.tsx:221-227`), beside `ComputerStatus`. It
  carries `notifications.unread` (`Dashboard.tsx:114`) and opens
  `view=notifications`. It only appears in the option B layout, so today's
  Home has no two ways to reach Alerts.
- **The daily brief.** `DailyBrief` (`app/src/components/DailyBrief.tsx:18`)
  takes an optional `pendingBookings` list.
  - When it is not empty, the brief shows a "Needs you" list above its normal
    priority, with up to three items.
  - Each item reads "Aisyah · Sat 3:00 pm · Cupping class" and has a
    **Confirm** button that calls `decide`, then shows the WhatsApp link.
  - Load pending future bookings across the full configured horizon, not only
    today; link to Needs you for the rest. Keep booking data independent of
    the normal brief's loading/error state.
  - Keep `dailyBrief()` deterministic, as its comment requires.

**Apps view.**
- `view=apps` (`app/src/routes/views/AppsView.tsx`) shows:
  - installed apps as tiles
  - an **Add app** section listing only what `available` returns: Bookings,
    with one line on what it does and a **Set up** button
- `view=apps&app=bookings` (`app/src/routes/views/apps/BookingsApp.tsx`) has
  three tabs:

| Tab | Shows |
|---|---|
| **Bookings** | Filters **Needs you · Today · Upcoming**, defaulting to Needs you when requests await a decision, otherwise Today. Cards show name, time, service snapshot, party size, note and status (Needs you, Confirmed, Declined, Cancelled, Expired). Future pending cards offer Decline and Confirm; future confirmed cards have a secondary Cancel action with a confirmation step. |
| **Booking page** | The public link, a preview of the customer page, **Copy**, **Share** (`navigator.share` where available), **Open**, and the **Taking bookings** switch. Explain whether the page is taking requests or paused. |
| **Settings** | Start with one service: name, duration in 15-minute steps, places per time, optional price label, and weekly hours. Offer additional services after setup, with the independent-resource limitation explained. Put minimum notice and horizon under **Advanced settings**. Show the editable slug with its resulting link. Save uses the config version and handles stale-edit conflicts. |

- Needs you covers pending future requests through the full horizon. Upcoming
  groups bookings by date and supports up to 90 days in windows of at most 31
  days, loading all cursor pages needed for each window. Existing bookings stay
  reachable through date navigation even if the owner later shortens the horizon.
  Include a date picker for history and notification destinations.
- Show **Send confirmation on WhatsApp**, **Send decline on WhatsApp**, or
  **Send cancellation on WhatsApp** on decided cards after reload as well as
  immediately after the action. These are normal links opened by the owner's
  tap, avoiding pop-up blocking after an `await`. They do not claim delivery.
- Calendar tags are **Syncing**, **Added to Google Calendar**, **Removed from
  Google Calendar**, **Calendar not connected**, or **Needs attention**. Offer
  Connect or Retry when appropriate. Cancellation can be complete while Calendar
  cleanup is still pending; show both facts accurately.
- After decisions, cancellation or config saves, refresh shared app counts,
  lists and the daily brief. Refresh on return to the foreground; poll booking
  state while sync is pending so a reload is not required to see completion.
- Mobile setup shows one short form first; the public-link/share screen is the
  success state. Use explicit empty, loading and error states for each tab.

**Strings.** Every string goes in `app/src/i18n/pages.ts` in both English and
Malay.

**Design system.** Use `<Button>` from `@/components/ui`, never a bare
`.btn`. Do not put `text-*` or `py-*` on a `.btn` or `.input`. Keep
`prefers-reduced-motion` handling and accessibility labels. See the controls
notes in `CLAUDE.md`.

**Demo mode.** None of this appears in the anonymous demo: `useActivity`
answers `demo` there, and `LocalRepository` has no `apps`. Signed-in owners
never see playbook figures.

## Tests

**Worker** (`cd worker && pnpm test`, then `pnpm typecheck`). Use the
`harness.ts` split: arrange as owner, assert as `aisar_app`. Route tests call
`handleApps` directly, as `goals-route.test.ts:33-47` does.

- **RLS:** a second business cannot read or change the first's installation,
  services, hours, bookings or Calendar jobs through any route, and not as
  `aisar_app` directly. Following another tenant's booking URL never grants
  access; the owner detail route returns 404.
- **`bookings_by_slug`:** resolves active and paused Bookings installations;
  unknown slugs return nothing. A paused installation renders the unavailable
  page, while a disabled pilot always returns 404.
- **Flag:** with the business outside `APPS_BUSINESS_IDS`, every owner route
  and every sites route answers 404.
- **Permissions:** a staff member gets 403 on every owner route.
  `permissions.test.ts` still passes.
- **`slots.ts`:** hours stepping, minimum notice, horizon, deduplicated starts,
  and peak concurrent capacity reduced by pending/confirmed but not
  declined/cancelled bookings. Cover adjacent intervals, partial overlap,
  bookings starting before the query window, and a longer candidate overlapping
  two successive old bookings without double-counting their places.
- **Settings:** reject overlapping hours and capacity below future reserved
  peak. Preserve old booking snapshots after changing name, opening time or
  duration. A 10–11am booking still blocks a new 10:30–11:30am slot at capacity
  one. Reject stale config versions, including from the Taking bookings switch.
  Race config changes/pause against submission under the common lock.
- **The last place:** two concurrent requests for it on separate
  connections, via `Promise.all`. Exactly one booking is created and the other
  is told the time was taken.
- **Submission recovery:** concurrent identical submission keys create one
  booking and one notification per owner, returning the same receipt. A replay
  after a lost response works with a consumed Turnstile token, at the daily cap,
  and while paused. Same key with a changed normalized payload returns 409.
  New keys still require verification; no reference/key lookup exposes PII.
- **Daily cap:** with 199 requests today, submit concurrently to two different
  services; only one new request commits. Cover the Malaysian midnight boundary
  and replay/decline/cancellation not changing the consumed request count.
- **Made-up times:** a `starts_at` not produced by `slots.ts` is refused.
- **Deciding:**
  - confirm, then confirm again: same result, one Calendar job
  - confirm versus decline concurrently: one transition wins, the other is
    409 `ALREADY_DECIDED`; a missing/other-tenant id gives 404
  - confirming a pending booking whose start has passed answers 409 `EXPIRED`
  - decline frees the place
- **Cancelling:** a future confirmed booking becomes cancelled, releases
  capacity, preserves the confirmation audit, and queues removal atomically.
  Repeated cancellation is idempotent; started bookings cannot be cancelled.
- **Calendar**, with `fetchFake` for Google:
  - connected and succeeding: `created`, with the event id
  - the durable job commits before `ctx.waitUntil` processing can call Google;
    confirmation returns `pending` without awaiting the network
  - the request schedules a first attempt without waiting for cron; explicit
    retry and cancellation do likewise
  - request attempt versus cron: one valid lease, identical revision checks;
    repeat requests do not bypass backoff or duplicate work
  - interrupted/unstarted `waitUntil`: the minute cron recovers the durable job
  - crash after confirmation commit: cron eventually creates the event
  - Google returning a retryable error or timing out: backoff; exhaustion yields
    `failed`, and the booking stays confirmed
  - crash after provider success but before database completion: retry recovers
    the same event, never a second event
  - no connection: `not_connected`
  - the `requestId` sent is the booking id
  - retry after connecting/recovering Calendar works and is deduplicated
  - cancel during creation, delayed create responses, worker restart and expired
    leases all reconcile to event absence; stale executors cannot mark a newer
    job complete
  - deleting an absent event succeeds; losing the original connection gives
    attention rather than using another account; feature-off jobs wait
  - create, delete, then insert returns 409 and GET returns
    `status: 'cancelled'`: never record `created`, never resurrect or change the
    id; stale revision completion cannot overwrite the cancellation
  - a retry encounters a manually deleted event through
    409 + cancelled GET, or a missing/deleted-resource response; it must not
    report a live event without evidence
  - cancellation before a create is claimed prevents creation; an in-flight or
    uncertain create is reconciled to absence before the UI reports "Removed"
- **`phone.ts`:** `012-345 6789`, `+60 12 345 6789`, `60123456789`, and the
  rejects.
- **`messages.ts`:** English and Malay, confirm, decline and cancellation, with the
  customer's name and the note escaped as needed. A `wa.me` URL is URL
  encoding, not HTML.
- **Notifications:** a request creates one `booking_requested` notification
  per owner, and a repeated `sourceKey` creates none. List JSON carries
  the generic `url`; both push and in-app navigation identify that booking.
  Null targets preserve legacy task/routine behavior. Invalid/external targets
  cannot navigate out of the workspace.
- **Sites:**
  - a business name of `<script>alert(1)</script>` renders escaped
  - every response carries CSP, `noindex`, `no-store` and no `Set-Cookie`
  - `/api/anything` answers 404 on the sites deploy
  - `accepting = false` shows the not-taking-bookings page
  - paused state does too, including an old form posted after pausing
  - Turnstile `missing` re-renders the form when the secret is set
  - a Turnstile token for the `signin` action is rejected on the booking form
  - the sign-in doors still verify as before
  - the request form shows the privacy notice in both languages, with the
    business name escaped and the link to `/privacy`
  - no log line carries a customer name, phone number or note
- **`check-apps-flags.mjs`:** passes when the two lists match as sets. It
  fails when an id is in one list only, or when `APPS_ENABLED` differs.
- **`cors.test.ts`** passes.

**App** (`cd app && pnpm test`, `pnpm typecheck`, `pnpm build`). Follow
`GoalsView.test.tsx`.

- **Bottom bar:** apps on means Home · Activity · Chat · Apps · More, with
  Skills in the More sheet. Apps off leaves it unchanged.
- **Home:** apps on with an installed app shows option B. Apps on with none
  installed, and apps off, both show today's four tiles.
- **Bell:** shows the unread count, and appears only in option B.
- **Bookings:** three tabs and Needs you/Today/Upcoming filters work on phone
  and desktop. Confirm immediately shows the WhatsApp link and Syncing; later
  refresh shows the final Calendar state. Links survive page reload and a lost
  decision response. A 409 shows "Already decided" or "This time has passed".
- **Cancellation/retry:** cancellation confirmation releases the booking in the
  UI, retains its history and shows cleanup progress plus the new WhatsApp link.
  Show "Removed" only after reconciliation confirms absence. Retry does not
  reconfirm or duplicate notifications.
- **Settings:** duration steps, hours overlap and stale-version errors are
  actionable; advanced settings are collapsed initially. The setup limitation
  acknowledgment is required before publishing.
- **Dates and notifications:** a request on day 60 is visible, counted and
  reachable from both push and in-app notifications. Full list pagination and
  shortening the horizon do not hide existing bookings. A disabled feature has
  a safe fallback. Daily brief booking actions survive an unrelated brief error.
- **Shared state:** decisions refresh Home counts, Needs you and daily brief;
  foreground refresh picks up work decided from another device.
- **Language parity:** every new key exists in both English and Malay.
- **Existing tests:** the service-worker, SEO and demo-mode tests still
  pass.

`app/` vitest can flake under full-suite load. If `workspace-modes` or gate
routines fail, re-run the file on its own before blaming the change.

## Release

Nothing here touches the runner, Hermes or sprites, so there is no
`ship-runtime.sh` and no `RUNTIME_RELEASE` bump.

1. **Check the tree.** Run `git status` in the shared checkout and know whose
   uncommitted work is present. Commit your own work by named path.
2. **Migrations.** Apply in order on production.
   - First check whether 065 and 066 are there, with
     `./worker/scripts/stats.sh sql "select to_regclass('public.bot_preference')"`.
     That connection is read-only, so it can check but not apply.
   - Apply any missing earlier migration with its own script, then this one:
     `cd worker && AISAR_NEON_OWNER_URL="$(neonctl connection-string --project-id red-haze-10375483 --role-name neondb_owner --pooled)" pnpm db:migrate:apps-bookings`.
     `docs/team-plan.md:203` shows the same pattern.
3. **`aisar-api`.** Deploy the Worker: `pnpm deploy` in `worker/` runs the
   transfer-field check. Verify both the post-commit `ctx.waitUntil` attempt and
   recovery through its existing cron; the sites deploy must not run that sweep.
4. **Sites.** Deploy with `pnpm deploy:sites` in `worker/`, which checks that
   the two flag lists agree before deploying. Then:
   - check that `curl -sI https://jentera-sites.qhkmdev90.workers.dev/b/<slug>`
     returns the headers above
   - set `TURNSTILE_SECRET` on the sites environment only after the owner has
     added the hostname to the widget
5. **App.** Deploy with `./deploy.sh "…"`. It publishes the working tree, so
   check `git status` first.
6. **Try it live on Kitakod:**
   1. Set up a service and hours.
   2. Open the public link on a phone and request a booking.
   3. The push arrives, the tile shows 1, and the brief lists it.
   4. Confirm. The event appears in the owner's Google Calendar, and the
      WhatsApp link opens with the message. Refresh and verify the link remains.
   5. Decline a second request, and its place frees.
   6. Cancel the confirmed future booking; its place frees. Verify automatic
      Calendar removal, suppression of queued creates, create/cancel races,
      and the deleted-id API experiment above.
      Verify sync failure/retry in a controlled test before customer bookings.
   7. Pause taking bookings with a form already open; submitting that form
      must fail politely. Unpause and verify a new request succeeds.
   8. Remove Kitakod from `APPS_BUSINESS_IDS` in **both deployments**. Home returns to today's tiles
      and the public link answers 404. Put it back.
7. **Then add the pilots' business ids, one at a time, in both deployments.**
   Check each business meets the availability limits above and understands
   that Calendar is not checked for conflicts. Record the pilot start date and
   first real customer booking against the kill criterion.

## Documentation to update in the same change

- **`docs/architecture.md`:** the deployables list gains the sites deploy
  of `worker/`.
- **`CLAUDE.md`:**
  - a short paragraph on the sites deploy: its own origin, no cookies, no
    credential secrets
  - the Turnstile action and hostname option
  - the apps flag
- **`docs/todo.md`:** rows for the pilot, and for the deferred items listed in
  [Out of scope](#out-of-scope). This includes customer-data retention and
  deletion, due before the pilot widens.
- **The direction doc:** project 1's status.
