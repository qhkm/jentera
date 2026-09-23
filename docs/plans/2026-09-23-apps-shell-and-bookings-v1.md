# Apps shell and Bookings v1

Status: spec, 23 September 2026. **Not yet approved for build.** It becomes a
build plan once the owner has reviewed it. This is project 1 of
[apps wired to automation](2026-09-23-apps-wired-to-automation.md); read that
document for the why, the catalogue and the rules against bloat.

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
   - On confirm, the booking is added to the owner's Google Calendar if one is
     connected.
   - Either way, the owner gets a prefilled WhatsApp message to send the
     customer with one more tap.
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
- editing the page by chat, and any agent tool for bookings (reading or
  writing)
- staff access to bookings (owner only)
- rows in Activity for bookings
- a custom domain, and a subdomain per business
- any app other than Bookings
- businesses outside Malaysia

## Defaults taken, for the owner to review

The direction doc left these open. This spec picks a default for each so the
build is not blocked. Change any of them before approving.

| # | Decision | Default in this spec |
|---|---|---|
| D1 | Where public pages are served | A second deploy of `worker/`, named `jentera-sites`, at `jentera-sites.qhkmdev90.workers.dev`, until the public domain is chosen. `workers.dev` is on the Public Suffix List, so it is a separate site from the workspace and from `aisar-api`. |
| D2 | When Home switches to option B | When the business has at least one app installed. With the flag on but no app yet, Home keeps today's four tiles, and the Apps entry is where Bookings is set up. |
| D3 | Who can decide and configure | The owner only (`apps.manage`, `bookings.decide`). |
| D4 | Holding a slot | A pending request holds its places until declined. Nothing expires automatically. A pending request whose start time has passed shows as "Expired" and cannot be confirmed. |
| D5 | How slots are made | Every service has its own weekly hours and capacity. Start times step by the service's duration from opening time. Services do not share capacity with each other. |
| D6 | Calendar | On confirm, create the event if a Google Calendar connection exists. If that fails, the booking stays confirmed and the failure is shown. There is no retry button in v1. |
| D7 | Search engines | Public pages carry `noindex` during the pilot. |
| D8 | Time zone and phone numbers | `Asia/Kuala_Lumpur` everywhere, and Malaysian phone numbers only. This matches the five places that already hard-code the zone. |

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
  service_id      uuid not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  party_size      integer not null check (party_size between 1 and 50),
  customer_name   text not null check (char_length(customer_name) between 1 and 80),
  customer_phone  text not null check (customer_phone ~ '^60[0-9]{8,11}$'),
  note            text check (char_length(note) <= 500),
  status          text not null default 'pending' check (status in ('pending', 'confirmed', 'declined')),
  decided_at      timestamptz,
  decided_by      uuid,
  calendar_status text not null default 'none' check (calendar_status in ('none', 'created', 'failed', 'not_connected')),
  calendar_event_id text,
  calendar_error  text check (char_length(calendar_error) <= 300),
  created_at      timestamptz not null default now(),
  check (ends_at > starts_at),
  primary key (business_id, id),
  unique (business_id, reference),
  foreign key (business_id, service_id) references booking_service (business_id, id)
);
create index booking_slot on booking (business_id, service_id, starts_at) where status in ('pending', 'confirmed');
```

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
  where a.public_slug = p_slug and a.app_key = 'bookings' and a.state = 'active' limit 1
$$;
```

**Notification kind.**
- Redefine `notification_kind_check` with every kind from `040_reminders.sql:32-36`
  plus `booking_requested`.
- Add `booking_requested` to the TypeScript union in
  `worker/src/notifications/store.ts:4-13`.

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
- It prints `{ ok: true, migration: '067_apps_bookings', verified }`.

Register it as `"db:migrate:apps-bookings"` in `worker/package.json`.

## Worker: owner routes

New file `worker/src/routes/apps.ts`, exporting
`handleApps(request, env, url, cors)`. It returns `null` for paths it does not
own, and is chained in `index.ts` like `handleGoals` (`index.ts:219-220`).

Every route:
1. calls `resolveTenant`
2. calls `hasBusiness` (401 or 403 as the existing routes do)
3. checks `appsEnabledFor` (404 when false)
4. checks `can(identity, …)` (403)

Everything runs inside `withTenant`.

Add `'apps.manage': ['owner']` and `'bookings.decide': ['owner']` to
`PERMISSIONS` (`worker/src/permissions.ts:15-48`).

| Method and path | Permission | Does |
|---|---|---|
| `GET /api/apps` | `apps.manage` | Installed apps `[{ key: 'bookings', state, publicUrl, pending }]`, where `pending` counts pending bookings not yet started. Also `available: ['bookings']`. **Only list apps that exist.** |
| `GET /api/apps/bookings/config` | `apps.manage` | The installation (or `null`), settings, services and hours |
| `PUT /api/apps/bookings/config` | `apps.manage` | Installs on first call and replaces settings, services and hours in one transaction. Validates every field against the checks above. Slug taken: `409 SLUG_TAKEN`. Reserved slugs: `api`, `admin`, `www`, `app`, `b`. |
| `GET /api/apps/bookings/bookings?from=YYYY-MM-DD&days=N` | `bookings.decide` | Bookings from `from`, Malaysian time, for up to 31 days, with service name. Pending first within each day. |
| `POST /api/apps/bookings/bookings/:id/decide` | `bookings.decide` | Body `{ decision: 'confirm' \| 'decline' }`. See [Deciding](#deciding). |

`PUT` already passed the CORS and request-guard lists for push. Confirm that
`test/cors.test.ts` still passes with the new routes, since it scans both
lists.

### Deciding

1. **Change the status.** In `withTenant`, run
   `update booking set status = $decision, decided_at = now(), decided_by = $user where business_id … and id = $id and status = 'pending' and starts_at > now() returning *`.
   - No row returned: answer **409** with `ALREADY_DECIDED` or `EXPIRED`, from
     a read of the row.
   - This conditional update is what makes a double tap safe.
2. **On confirm, add the calendar event.** In a **second** `withTenant`, after
   the first has committed:
   - `findConnection(tx, GOOGLE_CALENDAR_CONNECTOR)`
     (`worker/src/connections.ts:183`). If there is none, set
     `calendar_status = 'not_connected'`.
   - Otherwise:
     - get the secret with `useCredential(env, tx, connection.id)` (`:156`)
     - call `createGoogleCalendarEvent(env, secret, { requestId: booking.id, summary, start, end, timeZone: 'Asia/Kuala_Lumpur', description })`
       (`worker/src/connectors/google-calendar.ts:304`)
     - summary: `"<service> · <customer name> (<party size>)"`
     - description: the phone number, the note and the reference
   - `requestId` is the booking id, and the connector derives the event id
     from it, so a retry never creates a second event.
   - Record `created` with the event id, or `failed` with a short message.
     Mark the connection with `markConnectionHealthy`, `markConnectionExpired`
     or `markConnectionProblem`, as `routes/repo.ts:634-672` does.
   - Give the call **8 seconds**. A timeout is `failed`.
   - This is the first path that creates an event without an agent proposal.
     That is deliberate: the owner's tap *is* the decision, so no approval row
     is needed.
3. **Answer** `{ booking, whatsappUrl }`.
   - `whatsappUrl` is `https://wa.me/<customer_phone>?text=<encoded>`, from a
     template in the business's `lang` (`en` or `bm`).
   - Confirm example: "Hi Aisyah, your cupping class for 2 on Sat 27 Sep at
     3:00 pm is confirmed. Ref K7Q2MP. See you at SEIDO Coffee."
   - Decline example: "Hi Aisyah, sorry, we can't take your cupping class
     booking on Sat 27 Sep at 3:00 pm. Please choose another time: <public
     link>."
   - Put the templates in `worker/src/apps/bookings/messages.ts`, both
     languages, with tests.

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
  right now", not a 404.

**Open times.** A pure function, `worker/src/apps/bookings/slots.ts`, takes
the service, its hours, the settings, the existing bookings and `now`, and
returns the open times. Test it on its own.
- Times start at `opens` and step by `duration_minutes`, while
  `start + duration <= closes`, on each day in the horizon.
- Drop any start earlier than `now + min_notice`.
- For each start, subtract the `party_size` of the service's `pending` and
  `confirmed` bookings at that start from `capacity`.

**Creating a request, in one `withTenant` transaction.**
1. Lock the service: `select … from booking_service where … and active for update`.
   This lines up concurrent requests for the same service.
2. Recompute places left at `starts_at`. `starts_at` must be a start the
   slot function produces, so a made-up time is refused.
3. Too few places: 303 back to the times page with "That time was just taken."
4. Otherwise insert the booking. Generate `reference` from 6 characters with
   no 0/O or 1/I, and retry on the unique index.
5. Call `createNotification` for each of `ownersOf(tx, businessId)` with:
   - `kind: 'booking_requested'`
   - `sourceKey: 'booking:' + id`
   - `url: '/app?view=apps&app=bookings'`

   It already queues the push through the outbox.

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
- **Daily cap:** at most 200 requests per business per day, counted from
  `booking.created_at`. Over it, re-render the form with a polite
  "try again later".

**Response headers on every page.**
- `Content-Security-Policy: default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `X-Robots-Tag: noindex` (D7)
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
  `bookings(from, days)` and `decide(id, decision)`.
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
  - Keep `dailyBrief()` deterministic, as its comment requires.

**Apps view.**
- `view=apps` (`app/src/routes/views/AppsView.tsx`) shows:
  - installed apps as tiles
  - an **Add app** section listing only what `available` returns: Bookings,
    with one line on what it does and a **Set up** button
- `view=apps&app=bookings` (`app/src/routes/views/apps/BookingsApp.tsx`) has
  four tabs:

| Tab | Shows |
|---|---|
| **Today** | Today's bookings, pending first. Each card shows name, time, service, party size, note, and a status tag (Needs you, Confirmed, Declined, Expired). Pending cards have **Decline** and **Confirm**. After a decision, the card shows **Send on WhatsApp**, a normal link to `whatsappUrl` opened by the owner's tap, because a pop-up opened after an `await` gets blocked. It also shows a calendar tag: Added to Google Calendar, Calendar not connected (linking to Business → Connections), or Couldn't add to calendar. |
| **Upcoming** | The next 30 days, grouped by day |
| **Page** | The public link, **Copy**, **Share** (`navigator.share` where available), **Open**, and the **Taking bookings** switch (`accepting`) |
| **Settings** | The slug (editable, showing the resulting link), services (name, duration in 15-minute steps, places per time, optional price label, active), weekly hours per service (per weekday: closed, or opens and closes), minimum notice and how far ahead. Save calls `saveBookingsConfig`. Before any config exists, this tab is the setup form. |

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
  services, hours or bookings through any route, and not as `aisar_app`
  directly.
- **`bookings_by_slug`:** returns an id only for an active `bookings`
  installation. It returns nothing for a paused one or an unknown slug.
- **Flag:** with the business outside `APPS_BUSINESS_IDS`, every owner route
  and every sites route answers 404.
- **Permissions:** a staff member gets 403 on every owner route.
  `permissions.test.ts` still passes.
- **`slots.ts`:** hours stepping, minimum notice, horizon, and capacity
  reduced by pending and confirmed bookings but not by declined ones.
- **The last place:** two concurrent requests for it on separate
  connections, via `Promise.all`. Exactly one booking is created and the other
  is told the time was taken.
- **Made-up times:** a `starts_at` not produced by `slots.ts` is refused.
- **Deciding:**
  - confirm, then confirm again: the second answers 409 `ALREADY_DECIDED`
  - confirming a pending booking whose start has passed answers 409 `EXPIRED`
  - decline frees the place
- **Calendar**, with `fetchFake` for Google:
  - connected and succeeding: `created`, with the event id
  - Google returning an error: `failed`, and the booking is still confirmed
  - no connection: `not_connected`
  - the `requestId` sent is the booking id
- **`phone.ts`:** `012-345 6789`, `+60 12 345 6789`, `60123456789`, and the
  rejects.
- **`messages.ts`:** English and Malay, confirm and decline, with the
  customer's name and the note escaped as needed. A `wa.me` URL is URL
  encoding, not HTML.
- **Notifications:** a request creates one `booking_requested` notification
  per owner, and a repeated `sourceKey` creates none.
- **Sites:**
  - a business name of `<script>alert(1)</script>` renders escaped
  - every response carries the CSP and `noindex` headers and no `Set-Cookie`
  - `/api/anything` answers 404 on the sites deploy
  - `accepting = false` shows the not-taking-bookings page
  - Turnstile `missing` re-renders the form when the secret is set
  - a Turnstile token for the `signin` action is rejected on the booking form
  - the sign-in doors still verify as before
- **`cors.test.ts`** passes.

**App** (`cd app && pnpm test`, `pnpm typecheck`, `pnpm build`). Follow
`GoalsView.test.tsx`.

- **Bottom bar:** apps on means Home · Activity · Chat · Apps · More, with
  Skills in the More sheet. Apps off leaves it unchanged.
- **Home:** apps on with an installed app shows option B. Apps on with none
  installed, and apps off, both show today's four tiles.
- **Bell:** shows the unread count, and appears only in option B.
- **Bookings:** Confirm shows the WhatsApp link and the calendar tag. A 409
  shows "Already decided" or "This time has passed". Settings validates
  duration steps and closes after opens.
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
   transfer-field check.
4. **Sites.** Deploy with `wrangler deploy --env sites`. Then:
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
      WhatsApp link opens with the message.
   5. Decline a second request, and its place frees.
   6. Remove Kitakod from `APPS_BUSINESS_IDS`. Home returns to today's tiles
      and the public link answers 404. Put it back.
7. **Then add the pilots' business ids, one at a time.**

## Documentation to update in the same change

- **`docs/architecture.md`:** the deployables list gains the sites deploy
  of `worker/`.
- **`CLAUDE.md`:**
  - a short paragraph on the sites deploy: its own origin, no cookies, no
    credential secrets
  - the Turnstile action and hostname option
  - the apps flag
- **`docs/todo.md`:** rows for the pilot, and for the deferred items listed in
  [Out of scope](#out-of-scope).
- **The direction doc:** project 1's status.
