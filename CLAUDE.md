# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` carries the same house rules in shorter form. `PRODUCT_VISION.md`, `DISCUSSION_SUMMARY.md` and `TECHNICAL_ARCHITECTURE.md` carry product direction — read those before changing what the product *does*, not just how it's built.

[`docs/architecture.md`](docs/architecture.md) is the system as built: the six deployables, the tenancy invariants, the path a message takes, the fleet, and where the design has slack. This file stays the authority on any conflict — it is maintained edit by edit — but that one is where to start on a system you have not seen before.

For current positioning and customer-facing UX, follow
[`docs/marketing/product-thesis-and-homepage.md`](docs/marketing/product-thesis-and-homepage.md).
Jentera automates everyday business work; “AI staff” is the explanation, not a
workforce-management interface. This direction supersedes earlier worker-roster
framing. Publish only supported capabilities and verified outcome counts.

## React rebuild (`app/`)

```bash
cd app && pnpm install
pnpm dev        # :5173
pnpm build      # tsc -b && vite build
pnpm typecheck
```

Deploy with `./deploy.sh "msg"` — builds `app/` and publishes to the **`aisar-jentera`** project, live at `jentera.ai`. That project serves two hostnames, `jentera.ai` and `jentera.aisar.ai`, from the same deployment; `deploy.sh` verifies the first. Preview instead with `AISAR_PAGES_PROJECT=aisar-next ./deploy.sh "msg"`. The script verifies the served CSS and JS are real assets, not the SPA fallback HTML, and fails loudly if they are not.

`app/README.md` has the detail. The parts worth knowing here:

- The installed app updates on a prompt (`registerType: 'prompt'`), never
  mid-reply. A browser only looks for a new service worker on navigation
  and at most daily on its own, so `pwa/update-checks.ts` asks on every
  return to the foreground and hourly while open; a release then shows its
  prompt within minutes rather than at the next launch. The 4-hour cache
  header the zone puts on `/sw.js` is not a factor: browsers bypass the
  HTTP cache for a service worker's main script on update checks.
- **The Reload on that prompt is ours, not the plugin's**
  (`pwa/apply-update.ts`). `updateServiceWorker(true)` does less than its
  name and its argument suggest: vite-plugin-pwa ignores `reloadPage` and
  only posts SKIP_WAITING, reloading from a separate listener that fires
  on `controlling` and *only when it saw a controller at registration
  time*. So a page that was not under a worker when it registered — the
  session that first installs one, or any load after a hard refresh —
  swapped workers and then sat on the old bundle with the notice still on
  screen. Measured both sides on a real build-to-build swap on 23
  September: controlled at register time reloaded, uncontrolled did not.
  `applyUpdate` reloads when the new worker takes control, and after
  `TAKEOVER_GRACE_MS` regardless — which also covers the other dead end,
  where nothing is waiting because another tab already took the update and
  SKIP_WAITING lands nowhere.
- **The worker is registered from `AppRoutes`, for every route.**
  `<ServiceWorkerRegistration />` sat in `routes/Landing.tsx` until 23
  September, which `/` stopped rendering when LandingV3 took over
  (`App.tsx`): no public page registered a worker, so an owner arriving
  through `/signin` reached the app on a page no worker controlled — the
  one state in which the reload above refuses. `src/__tests__/service-worker-registration.test.tsx`
  walks every public path and fails if one registers nothing.
- The steps under a reply are read, not quoted. The runner keeps only the
  program of a command (`git`, never `git push …`), nothing for code, and
  the action word for a process; the runtime's and the host's own names are
  dropped too (`commandProgram` in `runner/src/server.mjs`). The app
  (`lib/task-presentation.ts`) turns each step into a kind of work with a
  safe subject — the program, a search, a site's host — folds consecutive
  steps of one kind into one line with a count, and shows every step only
  at the advanced level. That trail stands inline — a card above a finished
  answer, the live list under a running one — rather than behind the
  disclosure it sat in until 22 September, which nobody opened. Only its
  tail shows (`INLINE_STEPS`, `stepTail`); earlier lines wait behind a
  button so a long run cannot push the answer off a phone screen. It says
  what was done and to what, never what came back: tool *results* are
  stripped before they leave the sprite, so a line reading "52 accounts"
  would be invented. Narration is never shown verbatim: older traces
  carried passwords and internal paths. Until 13 September every terminal
  step read "[Command arguments hidden]" and a task showed the same line
  eight times.
- **Watching the agent work is a second desktop mode, not the page preview.**
  The desktop viewer was built as a takeover: `desktopControlValid` wants a
  durable owner pause and a live control lease, so seeing the screen meant
  stopping the agent. An *observe* session injects nothing, so it needs
  neither, and runs while the agent works. The two are kept apart by the
  ticket `purpose`, which the HMAC covers, plus a separate route
  (`/api/browser/observe`) and subprotocol (`jentera-observe.`) that each
  refuse the other's. `-viewonly` in x11vnc is the single enforcement point —
  RFB is two-way for its whole life, so a gateway that dropped client bytes
  would never deliver a frame. Because nothing is injected, observe skips the
  native key release and therefore cannot latch `cleanupBlocked`. The page
  preview stays as the fallback and starts first, so opening the panel never
  waits on a capability only the pilot has.
  `docs/plans/2026-09-23-desktop-observe.md` is the contract; it is behind
  `DESKTOP_VIEW_BUSINESS_IDS` and not enabled for customers.
- `app/src/lib/data/` is hand-maintained TypeScript. Add a playbook with `scripts/add-playbook.mjs`, which edits `playbooks.ts` directly — don't hand-merge.
- Controls share `--control-h` / `--control-pad-y`. A `text-*` or `py-*` utility on a `.btn`/`.input` overrides the component and breaks the shared height — this caused three separate visual bugs. Let components own their type and padding.
- **The workspace type bridge in `styles/dashboard-type.css` outweighs your
  component rule.** Its `:is()` lists include `.btn`, and `:is()` takes the
  specificity of its *most* specific argument and applies it to all of them —
  one compound entry lifts the body rule to (0,3,1) and the small rule to
  (0,3,0). So `.some-view .btn { font-size: … }` at (0,2,0) loses, silently:
  on 23 September the Skills refresh button's `font-size: 0` lost exactly
  this way while `width` and `padding` from the same block applied, leaving a
  14px label in a 44px box that pushed the page wider than the phone. Change
  a property the bridge does not set — hide the label element rather than
  shrink its text. Lowering the bridge with `:where()` was tried and measured
  the same day and is not safe: 4 of 92 probed selectors moved, including
  `.btn` line-height across the whole workspace. The file's header comment
  carries the numbers.
- **A `.btn` with no variant class has no visible surface of its own.**
  `.btn` supplies shape, type and padding; `.btn-primary`/`-outline`/`-ghost`/
  `-reco` supply fill, border and colour. A bare `.btn` was transparent in
  both until 23 September, so it rendered as plain text — seventeen call
  sites had drifted into it. There is now a fallback that renders it as
  `.btn-outline` in both themes, but prefer `<Button>` from
  `@/components/ui`: it defaults to primary and cannot produce a bare
  control. Anchors still need the classes written out, since `Button`
  renders a `button`.
- The old static engine wrote work-done indices as **strings**; the app reads either format and writes strings, so existing users' approvals survive the cutover.
- **Playbook figures are for the anonymous demo only.** Every playbook carries plausible counters, work items and customer conversations; they are the same for every business of a type and move for nobody. Shown to a signed-in owner they are lies, and they were shipped as lies three times: a "4 connections" badge for an account with one, a dashboard that read 82% handled, and an inbox naming customers who do not exist. `useActivity` answers `real` / `pending` / `demo` — branch on `demo` before borrowing anything, and treat `pending` as the real layout with nothing in it. A boolean is what caused this: "not real yet" and "show the demo" are different answers.
- **Server data on the Bookings path goes through one query cache**
  (`app/src/lib/query/`, TanStack Query v5; spec
  `docs/superpowers/specs/2026-09-25-query-cache-bookings-path-design.md`).
  Every key starts `['biz', businessId, …]` and is built only in
  `lib/query/keys.ts`, so one business's data can never draw under another.
  Every decision on this path, the Home brief's included, goes through
  `useBookingAction`, and a failed or unanswered one through `rereadBooking`
  (both `lib/apps/queries.ts`): the mutation never retries and puts the
  server's answer into every cached copy of the booking (`writeBooking`); a
  lost answer is re-read, never resent, with the card busy until the re-read
  lands and the lists read again only after it. A decision made around them
  leaves the Bookings screens showing a stale Confirm. Requests use
  `networkMode: 'always'`, so a tap made offline fails at once instead of
  being sent on reconnect. The cache lives in memory for the page, with
  nothing persisted to the device, and `RepositoryGate` makes it for
  signed-in pages only: the demo gets none. Tests mount through
  `renderWithQuery` (`src/test-support/query.tsx`). `returnToApp(client)` is
  "the owner came back after 30 s": it invalidates every query first, so it
  forces everything stale and cannot catch a `staleTime` regression;
  `focusApp()` shows the page alone, for a return inside the window. The
  cache listens for `visibilitychange` on `window`, and the non-bubbling
  `new Event('visibilitychange')` older tests dispatch on `document` never
  reaches it. Activity, Routines, Goals, Connections and shared chats still
  fetch by hand until phase 2.

## Native shell (`mobile/`)

The iOS and Android apps are one Capacitor project with app id
`ai.jentera.app`. `mobile/capacitor.config.ts` points at `../app/dist`, and
`pnpm sync` in `mobile/` always rebuilds the web app before copying it into the
native projects. There is deliberately no production `server.url`: loading the
live site inside a privileged WebView would create both review and XSS risk.

The bundled origins are `capacitor://app.jentera.ai` on iOS and
`https://app.jentera.ai` on Android. `app/src/lib/native/` is the only platform
boundary; keep PWA installation, web push and service-worker updates inert
natively. Until native bearer auth lands, native-only feature calls fail loudly
instead of falling back to the cross-site session cookie, which the WebView
cannot use safely.

```bash
cd mobile
pnpm install
pnpm sync
pnpm typecheck
pnpm exec cap doctor
```

The generated `ios/` and `android/` projects are source and stay committed.
Their copied web assets, generated Capacitor JSON and local build state remain
ignored. Full device builds require Xcode and the Android SDK; neither is
implied by a successful `cap sync`.

## localStorage keys

The full persisted surface. Changing or adding one affects the flow gates, so call it out in the commit.

| Key | Meaning |
|---|---|
| `aisar-onboarded-v1` | `'1'` = onboarding done; `/app` redirects without it |
| `aisar-setup-done-v1` | `'1'` = setup done; drives command-centre stage |
| `aisar-biz-type` | Playbook key |
| `aisar-biz-name`, `aisar-biz-loc` | User overrides on playbook defaults |
| `aisar-channels` | JSON array from onboarding step 4 |
| `aisar-conns` | JSON array of connected connectors (seeded from playbook) |
| `aisar-country`, `aisar-lang` | `'MY'` etc. / `'en'` \| `'bm'` |
| `aisar-approvals` | JSON queue of pending agent actions |
| `aisar-work-done:{bizType}` | Per-playbook completed work, **string indices** |
| `aisar-learn:{key}` | Self-improving demo — counts of user picks |
| `aisar-join-token` | An invitation token waiting for its person to sign in; while present, `/onboard` sends them to `/join` |

## Adding a playbook

```bash
node scripts/add-playbook.mjs --file spec.json
```

Only `key` (lowercase/underscore, not `generic`) and `keywords` (3–8 terms, BM + EN) are required. The script injects the new entry into `app/src/lib/data/playbooks.ts` ahead of `generic`, typechecks, and asserts every keyword infers back to the new key.

## Backend (`worker/`)

A Cloudflare Worker serving the `Repository` interface, deployed at
`https://aisar-api.qhkmdev90.workers.dev`. State lives in **Neon Postgres**
(ap-southeast-1) reached through Hyperdrive — not D1; that was the earlier
design. The app still runs fully without it, on `LocalRepository`; setting
`VITE_API_URL` routes through the Worker instead.

Two invariants hold the tenancy model up, and both are load-bearing:

- **`resolveTenant` is the only source of a business id.** No route may read
  one from a request body. That was the hole this replaced.
- **RLS is forced on every tenant table**, scoped by a transaction-local
  `app.business_id` that only `withTenant` sets. The predicates in route SQL
  are deliberate belt-and-braces, not the actual boundary.

**Hyperdrive query caching is disabled on the `aisar-db` config, and must
stay disabled.** It is on by default and caches plain SELECTs for ~60s.
`verifySession`, `resolveTenant` and the password lookup all run outside a
transaction, so all three were cacheable — meaning a logout would not take
effect until the entry expired, and a revoked session kept authenticating.
It surfaced as a freshly verified account still being told it was
unverified; the database said one thing and the Worker read another.
Hyperdrive is here for connection pooling, which is unaffected.

There are three ways in — magic link, password, and Google — and all three
converge on the same session cookie, so nothing downstream distinguishes
them. `email_verified` is what keeps them safe together: a password alone
never proves ownership of an address, only consuming a link or Google
asserting it does. Signing up on an address that already exists never
overwrites its password and never says so, and Google claiming an
*unverified* account clears whatever password it held — otherwise someone
could register against a stranger's address and wait for them to arrive.

Auth is a magic link: the token is stored SHA-256 hashed, single-use via a
conditional UPDATE, and exchanged for an HttpOnly/Secure/SameSite=Lax session
cookie. Because the cookie travels cross-origin, `ALLOWED_ORIGINS` must list
each origin exactly — a wildcard is rejected by the browser outright. Two
lists must name every method a route handles, and neither is visible to a
route's own tests: `Access-Control-Allow-Methods` in `index.ts`, which the
browser's preflight enforces before anything but GET or POST leaves it (the
fetch throws), and the allowlist in `request-guard.ts`, which answers 405
before dispatch. `PUT` was in neither for the push subscription route until
the evening of 12 September, so the notifications switch read "not
available" on every device while curl against the route and the route's
tests both passed; `test/cors.test.ts` now scans the routes against both.

Every new account sends one plain-text notice to `SIGNUP_NOTICE_TO` (a
var in `wrangler.toml`; unset means nobody is told): the address, which
door, whether the address is verified yet, the time in Malaysia and the
running account count. All three doors are upserts, so `Session.created`
is read off the same statement (`xmax = 0`) rather than guessed from a
lookup before it, and a return visit never sends. The routes hand the send
to `ctx.waitUntil` behind the response (`signup-notice.ts`), so Resend
being slow or down cannot delay or fail a sign-in.

Cloudflare Turnstile stands in front of the link request, the password
signup and the password login (`turnstile.ts` on both sides). The page
renders a widget only when the build carries `VITE_TURNSTILE_SITE_KEY`
(`app/.env.production`) and sends its token as `turnstileToken`; the
worker checks it against `TURNSTILE_SECRET` only when that secret is set,
refusing a missing or rejected token with 400 and code `TURNSTILE`, and
admitting the request when Cloudflare's checker itself cannot be reached,
because the rate limits below still hold. Order matters when turning it
on: ship the app with the site key first, then set the secret — the other
way round every door refuses until the app catches up. Google sign-in is
not behind it: Google already stands in front of that door.
`test/turnstile.test.ts` and the sign-in page tests cover both halves with
a fake checker.

`/api/auth/request` is rate limited three ways: an edge burst binding
(5/60s per IP), and Postgres counters of 50/24h per IP and 10/24h per
address. IP limits answer 429; the per-address one answers 204, because
its counter includes requests made by anyone for that address and a 429
would leak third-party activity. `MAX_OUTSTANDING` in `auth.ts` is a
separate, stricter short-range brake on concurrent live links.

**Still missing, and known:** connector execution is stubbed in
`src/connectors.ts` for everything outside `worker/src/connectors/`,
pending OAuth registrations. Three are real as of 23 September —
Telegram, Google Calendar and Bukku; this line said Telegram alone until
the other two shipped past it. `app/src/lib/live-connectors.ts` is the
authority the app reads, and its test reads that directory rather than
restating it, so the Connections tab offers a working button only where
something is behind it. Adding one is three steps in order: the execute
body in the Worker, a connect flow, then the name in `LIVE_CONNECTORS` —
a name without the other two puts back the lie that turned a tag green
for a connector that did nothing.

Webhook verification is done — this line used to say it was not.
`verifyWebhook` compares a stored per-connection secret in constant
time. Stored rather than derived from `CREDENTIAL_KEY`, because
deriving it would break every live webhook on a key rotation.

Web push lives in `src/push/`. `crypto.ts` is RFC 8291 payload encryption
and RFC 8292 VAPID on Web Crypto, and `test/push-crypto.test.ts` holds it
to the RFC's worked example byte for byte — a change that still "works"
against one browser but drifts from the spec fails there first.
Subscriptions are tenant rows under RLS (`push_subscription`, migration
030) keyed by the browser's endpoint, which is unique across tenants: the
same browser keeps its endpoint whoever signs in, so a second account's
insert collides with a row RLS hides and the route answers 409, and the
app takes a fresh endpoint. `pushToUser(env, businessId, userId, payload)`
fans out to every device and forgets the ones the service reports gone;
it never throws. Configuration is two secrets, `VAPID_PRIVATE_JWK` (one
JWK string, `generateVapidJwk()` makes one) and `VAPID_SUBJECT`; without
them the app shows no switch and nothing is sent. Notifications reach
devices through an outbox, not a direct send: `enqueuePush(tx, …)` queues
a row in the same tenant transaction as the notification it mirrors, and
`sweepPushOutbox` on the minute cron delivers it, retrying with doubling
delays and giving up after eight tries with the error on the row
(`push_outbox`, migration 031; the due scan is a security definer function
returning ids only, like the routines one). Nothing is sent from inside a
transaction, and a request that dies after the insert loses nothing. The
notification insert in `src/notifications/store.ts` is the one caller;
the confirmation push on subscribe is sent directly. Three kinds are about
work someone asked for (`notifications/work.ts`, called from the consumer at
approval and outcome time). `approval_requested` and `work_needs_you`
(migration 037) go to every other owner, and to the person who asked when
they asked in the app and can act on it: an approval only to an owner, a
review or a block only to an owner, missing input to whoever asked.
`work_finished` (migration 069) goes to the person who asked alone, for a
work task asked in the app that finished or failed two minutes or more
after it was asked (`FINISHED_PUSH_AFTER_SECONDS`). Quick chat replies,
Telegram (which carries its own reply and buttons) and routines (which have
their own kinds) get none of these. Every business was a business of one on
24 September, and until then these reached nobody at all.
`credit_warning` (migration 071) goes to every owner once a month when 80%
of the month's AI credits are used (`runtime/credit-warning.ts`, checked
right after `finalizeRuntimeUsage`, before the Telegram early return).
"Used" means cost or computer time, whichever is nearer its cap. The key is
`credit_warning:YYYY-MM` on the database's UTC month, the same window
`runtimeBudgetSnapshot` sums. Owners see the same figures on the Profile
tab (`components/CreditUsageCard.tsx`, from `/api/runtime`'s `budget`).
The consumer
sends what it queued at once with `deliverPendingPushes`, because an
approval waits about a minute and the cron could take as long; the cron
stays the backstop. Both paths claim a row by moving `deliver_after`
forward before sending, so they never send one push twice, and the
immediate path judges "due" by the database's clock, not the Worker's.
**A new notification kind ships in the app before the Worker writes it.**
`fetchNotifications` leaves out a row of a kind it does not know (`KINDS` in
`app/src/lib/notifications.ts`) and warns. Until 24 September it rejected the
whole list instead, which would have emptied the inbox of every owner who
received one. The other order no longer breaks anything, but those rows stay
invisible until the app catches up. The order is app, then migration, then
Worker.

Artifacts are files the agent hands the owner. The runner gives each task
a folder (`/home/sprite/aisar/outputs/<task>`), appends an instruction
pointing the model at it, and on completion uploads every file there to
`POST /v1/runtime/artifacts` with the runtime credential the config channel
uses, before the task reads as complete — so the first "completed" the
control plane sees already carries the files. The worker stores bytes in
R2 (`ARTIFACTS`, bucket `jentera-artifacts`) and indexes them in `artifact`
under RLS (migration 032); `GET /api/artifacts/:id` resolves the row under
the tenant before touching the bucket and always answers as an attachment.
Names are plain (`[A-Za-z0-9][A-Za-z0-9._-]{0,119}`), 20 MB a file, 20 a
run. The runner half ships in the bundle like any runner change.

Knowledge comes in three ways and is tended in one place, the Knowledge tab.
A page (`POST /api/runs/ingest`) or an uploaded document
(`POST /api/runs/ingest/file`: text, Markdown, CSV and JSON read as they
are up to 1 MiB; PDF, Office documents and images up to 8 MiB through
Workers AI's `toMarkdown` on the same binding) is read by `extractFacts`,
and what it finds lands unconfirmed with the page or file name as its
source; the file itself is not kept. What the agent notes for itself is a
different store: Hermes keeps two small §-delimited files per profile on
the sprite, `MEMORY.md` and `USER.md`. The runner exposes them
(`GET /v1/memory`, `POST /v1/memory/forget`, refused while a task runs
because Hermes writes them mid-run under its own lock) and the worker
relays them to the owner alone (`routes/agent-memory.ts`,
`can(identity, 'agent.memory')`), sanitised to the narrow shape, as "What
Jentera has picked up" with a Forget on each entry. A runtime on a release
before the endpoint reads as not available. The agent is also told every
turn not to copy the business facts it is handed into that memory
(`prepareHermesAgent`), so the few kilobytes it has stay for what Jentera
cannot tell it. Private chats are private from people, not from this
memory; see `docs/team-plan.md`.

A chat is a row, and it decides who may read a run. `chat_session`
(migration 034) is owned by whoever opened the chat; the app's chat id
becomes the row's id under `(business_id, id)`, and `run.session_id`
points at it. `chat-sessions.ts` states the one rule: a run with no chat —
Telegram, a routine, an ingest — is the business's and every member may
read it; a run with a chat may be read by the person who opened that chat.
`visibleRunPredicate` is that rule as one SQL fragment — a chat's run is
also readable by every member of the workspace it was opened in
(`workspace`, `workspace_member`, migration 036) — and the run, Activity
and artifact queries embed it rather than restate it; `runVisibleTo`
answers 404, never 403, for a colleague's private run, so the id alone
confirms nothing, and Activity carries `canOpen` per row so the app shows
the outcome without a way into the conversation. A chat opened with
`workspaceId` on the ask stays in that workspace for life; `/api/chats`
lists a workspace's chats and one chat's turns to whoever may read them,
so members who never saw a chat typed can pick it up. With one person per
business nothing is hidden.
Team features are a plan: `business.plan` is `free | pro | team`
(migration 033), `/api/me` carries `features.team`, and every team write
checks it inside the tenant transaction (402 otherwise). An operator puts a
business on the plan with one `update business set plan = 'team'` on the
owner connection; nothing sets it automatically. `src/routes/team.ts` is
the whole team surface: members and open invitations for any member,
invite and revoke for the owner (`can(identity, 'team.manage')`), and
acceptance. An invitation (`invitation`, migration 035) names an address;
the token travels only in the email and the row keeps its SHA-256, the
business behind a token is found by `invitation_by_token`, a security
definer returning ids only, and acceptance is a conditional UPDATE under a
row lock. Whoever signs in through any door with that verified address may
accept; an account that already belongs to a business is refused with a
message, because switching is deferred. A staff seat counts only while the
business is on the team plan: `verifySession` and `authLandingPath` skip
staff memberships otherwise, through `business_plan(uuid)`, a security
definer (migration 038) because `business` is RLS-protected outside a
tenant transaction — so leaving the plan ends staff access at once and
returning restores it, memberships untouched. Removing a member
(`DELETE /api/team/members/:userId`, owner only, never the owner) ends
everything that lets them in or reaches them in one transaction: the
membership, their sessions, their devices and pending pushes, their
workspace seats, any open invitation for their address. Their chats and
the work they asked for stay as history. Roles are decided in one place,
`permissions.ts`, where a permission is a row — `permissions.test.ts`
fails on any `role !== 'owner'` that comes back at a call site. The agent
is told who is typing (`speakerInstructions` in `ask.ts`): a staff request
is never the owner's word, and what Hermes learns from staff carries their
name, since its memory is per business. `docs/plans/2026-09-12-team-features.md`
is the plan and its status; `docs/team-plan.md` is the reference — roles,
tables, routes, the visibility rule, joining, offboarding, notifications,
and how to operate it.

### Where work runs

`src/runtime/` is the seam. `run.runtime` and `run.model` are snapshots
taken from whichever adapter executed the work, so history stays
truthful after a runtime change — never look them up live.

An adapter reads and reasons; it never writes AISAR data or sends
anything. The control plane decides what to persist and what needs
approval. A runtime that could act directly would be a runtime that
could bypass the approval gate.

`test/orchestration.test.ts` exercises the real control-plane path:
`testEnv()` points Hyperdrive at the test container, so `withTenant`,
RLS and the transactions all run for real. Only the model and outbound
HTTP are faked — the two things that would otherwise leave the machine.
Prefer that over stubbing the data layer; the bugs here have all been
in the seams a stub would hide.

The queue consumer runs far from Neon (LAX and SJC measured 2026-09-10;
the cron in IAD): `placement.region` covers HTTP invocations only, and a
tenant transaction that costs 60 ms in a route cost 1.1 to 2.3 s there.
Two things follow. The app intake and the Telegram webhook run the first
slice of a run themselves (`src/runtime/inline-slice.ts`) and hand the rest
to the queue. And the consumer does not run the message itself: it hands it
through the `SELF` service binding to `POST /api/support/runtime-slice`
(`src/runtime/placed-slice.ts`), which is the same code in a placed
invocation — 16 to 28 ms from Neon — and runs it locally only if that
fails. A request to the public hostname is not a substitute: it is not
reliably routed (error 522 from IAD), and `request.cf.colo` names the
ingress edge, not where the code ran.

A turn is answered by the specialist that answered the previous turn of the
same chat, for six hours after it (`specialistForTurn` in `specialists.ts`);
only a fresh or quiet chat is scored on its own words. Hermes keeps each
profile's conversation in its own store on the sprite, so a turn routed to a
different specialist cannot see the turns before it — which is how "yes run
the test run" reached a Chief of Staff who had never seen the digest request
Growth had just scheduled. The Telegram session is one for life, so the
window is what lets it re-route once a thread has gone quiet.

The outcome assessor (`task-outcome.ts`) decides whether a finished reply
was work and what state it left, and the reply waits on it. It has one
budget, `ASSESSMENT_BUDGET_MS` (5 s), across however many calls it makes: a
call that errors at once is tried again inside what is left, a call that
runs out the clock is not, and a well-formed answer it cannot parse is not
retried. When it gives up, the saved `outcome.observed` says
`classifier_unavailable` with `uncertaintyDetail` — `timeout`,
`unparseable`, or `error:<message>` — and a `console.warn` names the run.
It was unavailable 4 times in the three days to 12 September, before the
retry; the detail is what tells the next reading which kind it was.

`docs/reply-latency.md` is where reply time and channel parity live: the
path a message takes, what Telegram and app chat share, dated measurements
and the levers tried. `worker/scripts/reply-latency.sh` reproduces its
numbers; re-run it before quoting them.

`docs/sprites-vs-dedicated-vms.md` records the 10 September 2026 compute-provider
comparison: retain Sprites, with an Alibaba 4 GB pilot proposed for sustained
browser workloads. Its costs are illustrative, not our invoice. Read it before
proposing a provider migration; model-loop cost work is a separate plan.

`docs/openmausbot-comparison.md` records the 23 September 2026 comparison
with OpenMausBot (Apache-2.0, except its `enterprise/`, which nothing may be
copied from): four gaps it exposed in our live code, what is worth taking by
area, what is kept for expansion (specialists working together, Composio)
with the preconditions, and where Jentera is already ahead. Read it before
proposing a feature "like OpenMausBot's" or porting its code.

`docs/provisioning-time.md` is where cold-provision and upgrade time live: the
measured cost of each bootstrap stage, the 160 s around the bootstrap that
nothing times yet, why the script-level speedups were not taken, and what Fly
has said about forking a sprite from a template. Read it before touching
`bootstrap-runtime.sh` for speed.

`test/runtime.test.ts` runs a contract over every adapter in one list.
A new runtime is added there and either passes or is not finished.

The spec (`2026-08-26-hermes-sprites-runtime.md`) specifies
`startRun/resumeRun/cancelRun/streamEvents`. Those describe a runtime
that outlives its request; the inline one cannot implement them
meaningfully, so they arrive with the first adapter that needs them
rather than as stubs nothing verifies. `mode` is how a caller will tell
the two apart.

### Shipping to sprites

One path, no exceptions. A fleet change lands on main, then
`worker/scripts/ship-runtime.sh -m "why"` pins that commit as the bundle,
bumps `RUNTIME_RELEASE`, runs the release gate, commits, pushes, deploys the
worker, triggers the drift sweep, waits for convergence, and runs
`fleet-verify.sh` on every sprite. `--dry-run` stops after the gate.
`docs/release-playbook.md` is the same procedure written out, with rollback.
`docs/todo.md` is the open follow-up list: what shipped but was never
exercised live, what the next release must carry, what waits on Fly or on the
owner, and what was deferred. Read it before asking what is next; move an
item to its Closed section when it is done.

**`ship-runtime.sh` pins `origin/main`, not your HEAD.** A release has to be
reproducible from main — the bundle is packed from the pinned commit and its
digest is written into `wrangler.toml` — so an unpushed commit is one nobody
else could rebuild, and the script refuses it by design. The failure that follows is silent rather than
loud: work that is committed but not pushed simply is not in the release, the
gate passes, convergence reports success, and the release commit carries
whatever message you gave it — on 21 September `2026.09.21-2` went out titled
"owner can restart a wedged business browser" pinned to a bundle six commits
behind HEAD that contained no such thing, and thirteen sprites converged on it
happily. Only calling the action on a live sprite found it: `invalid_command`
from a runner reporting the new release. **Push first, and check the
`RUNTIME_BUNDLE_COMMIT` the dry run prints is the commit you mean.**

**The bundle comes from R2, not GitHub.** A sprite used to build its runner
directory from 24 anonymous curls against `raw.githubusercontent.com`, which
serves public repositories and nothing else — the single reason this
repository could not be private. Making it private on 23 September answered
404 to every bootstrap and killed the next fresh provision with `curl: (22)`;
visibility was reverted the same day. `ship-runtime.sh` now packs the pinned
commit into one gzipped object (`bundle-pack.mjs`, deterministic, so the gate
verifies it by rebuilding it), uploads it to `jentera-runtime-bundles` and
writes its sha256 to `RUNTIME_BUNDLE_SHA256` beside the commit. The sprite
fetches `/v1/runtime/bundle/<commit>.tar.gz` on a 15-minute ticket the control
plane mints into the command that runs it — the download happens before the
runner exists, so the sprite has no credential of its own — and checks the
bytes against the pin. The pin rather than a digest from the bucket, because
that is what catches the right key holding the wrong bytes. Two guards run as
`predeploy`: `check-bundle-pin.mjs` refuses a deploy whose pinned commit has
no object or whose digest disagrees with a local repack, and the release gate
makes the same check with the bytes pulled back out of the bucket. `qhkm/hermes-agent`
is a separate repository and is still fetched from GitHub anonymously, so it
stays public.

**A transfer field and its `case` arm ship in the same bundle.** The fields
in `provision.ts`'s `transfer` are parsed by `bootstrap-runtime.sh` against a
closed allowlist that exits 1 on anything else — and `bootstrapRuntime` curls
that bootstrap from `RUNTIME_BUNDLE_COMMIT` and executes it, so the **pin**
decides what parses, not whatever a sprite has on disk.

The shape that breaks is a `provision.ts` that has outrun its pin, which
`wrangler deploy` ships happily with no release involved. On 2026-09-10
`EXTRACT_BASE_B64` went out in a worker deploy while the pinned bundle's
bootstrap had no matching arm: every sprite rejected the transfer, upgrade
tasks retried to exhaustion, and convergence stalled until the field was
withdrawn and a bundle containing the arm was pinned.

So: add the arm, pin a bundle that contains it, and only then deploy a worker
that sends the field. `worker/scripts/check-transfer-fields.mjs` runs as
`predeploy` and blocks exactly that mismatch; the release gate makes the same
check with retries. Note this is a *pin* ordering rule, not a two-release
rule — an earlier version of this file claimed sprites run their own on-disk
bootstrap, which is true only of `upgrade-existing-sprite.sh`.

Anything read at bootstrap still reaches a sprite only by re-bootstrap, so a
config-only change needs a `RUNTIME_RELEASE` bump to take effect.

A checkpoint that fails after a healthy bootstrap does not block convergence.
Fly's checkpoint rename can find an orphan directory on its own volume
(NEOREKA ASIA on 7 September, cleared when Fly rebuilt its checkpoint store;
BoxCompute from 12 September, 317 attempts in nine hours). The release is
real on the sprite, so `bootstrapRuntime` records it as converged with the
failure kept in `last_error` as a warning
(`markRuntimeReadyWithoutCheckpoint`), keeps the previous checkpoint as the
rollback point, and leaves the prior inference key unrevoked — a restore to
that older checkpoint would bring the old key back, so it must stay valid
until a checkpoint carrying the replacement exists. The next release that
checkpoints cleanly clears the warning. The API cannot delete such an
orphan (it has no row for it) and the host path is unreachable from inside
the sprite; only Fly can remove it.

The checkpoint id the control plane keeps must be a versioned one, `v64`,
not `Current`. Fly's list endpoint leads with the live state as an entry
named `Current`, newer than every real checkpoint, and may carry hourly
`auto-<epoch>` snapshots; `FlySpriteProvider.checkpoint` reads the newest
entry after the create stream, and until 12 September it took whatever was
newest, so all thirteen runtimes recorded `Current` as their rollback point
while the real checkpoints sat one row down. A restore to `Current` is a
restore to what the sprite holds now. The provider now keeps only
`/^v\d+$/` entries and treats a list without one as a failed checkpoint,
which the tolerance above records as a warning. Rows written before the fix
still say `Current` until the next release checkpoints them.

**Replacing a sprite is a one-way door for most businesses.** Fly places a
sprite near whoever created it — the queue consumer, which is why every
sprite made before `3fbf487` (10 Sep) is in LAX or SJC and every one since
is in `sin`. Moving one means deleting it and provisioning again, and while
`ACCESS_MODE` is `waitlist` the control plane admits `delete` as maintenance
but refuses `provision` for a business whose owner holds no
`platform_access` grant, acking the refusal and leaving the row `queued` so
it reads as a slow queue. A queued runtime task also waits for the
quarter-hour cron, not the minute one, and a file written to a sprite is not
durable until it is checkpointed. `docs/moving-a-sprite.md` is the procedure
and the day those three were each learned the expensive way;
`worker/scripts/move-runtime-region.mjs` is it as code.

Nothing is applied to a sprite by hand. A sprite's Hermes checkout and
runner directory survive re-bootstrap exactly as they are, so a hand-applied
change is invisible to the next release and a removed one lingers:
background review had to be switched off on twelve sprites before it was
pinned in `configure-model-provider.py`, and retiring the wire-order patch
needed an explicit unpatch stage because the patched files were still there.
If it must be true on every sprite, it goes in the bundle. `fleet-exec.sh
'snippet'` is for reading state and for one-off cleanups the next release
makes permanent; it iterates correctly under zsh and closes stdin, which the
ad hoc loops it replaces did not.

### Routines

Owner-scheduled jobs use Postgres as the scheduler: `routine.next_run_at` is
the clock, the one-minute cron in `index.ts` calls `dispatchDueRoutines`,
and the cross-tenant due scan is a `SECURITY DEFINER` function that returns
nothing but ids. Everything else runs inside `withTenant` under a row lock.
The three report/reminder jobs remain deterministic. `agent_task` creates a
normal metered `schedule` run, durable runtime task and outbox wake; the queue
wakes the tenant's Sprite and the consumer projects completion or approval back
onto the occurrence. Scheduled outcomes create recipient-scoped rows in
`notification`; Sprites still never own a local cron.
Behind `ROUTINES_ENABLED` and `AISAR_ROUTINES_BUSINESS_IDS`; the contract,
amendments and acceptance gate live in `docs/plans/2026-09-09-routines-api-v1.md`.

### Business apps (Bookings)

Bookings is the first of the apps in
`docs/plans/2026-09-23-apps-wired-to-automation.md`: a public page where a
customer asks for a time, and one tap for the owner to confirm, decline or
cancel, with a prepared WhatsApp message and the event kept in Google
Calendar. The spec is `docs/plans/2026-09-23-apps-shell-and-bookings-v1.md`;
plans 1–4 beside it end with "As built" notes that carry what the release
must do.

Customers can later manage a booking with its reference and WhatsApp number.
That proof creates a two-hour opaque session whose token is stored only as a
SHA-256 hash (`booking_customer_session`, migration 072). Cancellation releases
the slot immediately. Rescheduling atomically cancels the old row and creates a
new pending request, rather than silently moving a confirmed appointment; any
old Google Calendar event is removed through the same durable Calendar job.
The owner chooses how long before the appointment customers may still change it
(six hours by default). Confirmed bookings create durable 24-hour and two-hour
reminder rows. The minute cron turns each due row into one owner notification
and push whose booking card has a prepared WhatsApp reminder. This is deliberately
an owner nudge, not a claim that Jentera sent the customer a message: there is no
live WhatsApp Cloud API connector yet.

It is a pilot. `APPS_ENABLED` and `APPS_BUSINESS_IDS` (exact UUIDs, at most
20, empty means nobody) sit in both `[vars]` and `[env.sites.vars]` of
`worker/wrangler.toml`, and `worker/scripts/check-apps-flags.mjs` fails a deploy
when the two drift. Off the list, every owner and public path answers 404,
and `/api/me` sends `features.apps` to owners only, so staff never see it.

The public pages are a second deploy of `worker/`, `jentera-sites`
(`pnpm deploy:sites`), on its own origin, `book.jentera.ai` (since 25
September; any other host, including the first `workers.dev` links, gets a
308 there). That is the same *site* as `api.jentera.ai`, so SameSite=Lax no
longer keeps the session cookie off a write sent from a booking page:
`guardApiRequest` refuses a POST, PUT or DELETE that carries the session
cookie and an `Origin` outside `ALLOWED_ORIGINS`. It never reads or sets a cookie,
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
before the Worker writes it** (see Web push above): an app without
`booking_requested` in `KINDS` leaves those rows out, so owners would never
see their requests.

Google Calendar sync is durable: the decision commits a
`booking_calendar_job`, `processBookingCalendarJob`
(`src/apps/bookings/calendar-sync.ts`) claims it with a lease, calls Google
outside any transaction within 8 s, and records the result only if the lease
and revision still hold. The first attempt runs from `ctx.waitUntil` after
the owner's tap; the minute cron's `sweepBookingCalendar` retries (8 tries,
up to an hour apart) and recovers orphaned attempts. A booking remembers its
Google account and never touches another one; a failure carries a
machine-readable `calendar.reason` and `canRetry` for the app to word.

Booking availability is protected separately from event creation. Owners can
save business-wide closures in `booking_block`. For a connected Google
Calendar, the API Worker keeps a five-minute cache of busy time ranges in
`booking_calendar_busy`; it never stores event titles, descriptions, guests or
locations. The public booking Worker reads only those ranges and manual
closures, while a pending confirmation forces a fresh Google check and remains
pending on either a collision or a provider outage. OAuth primes the cache and
the minute cron refreshes due businesses. Google credentials never enter the
public Worker import graph.

In the app, `useAppsEnabled() && repository.apps` gates everything
(`LocalRepository` has no `apps`, so the demo never shows it); `AppsProvider`
in `Dashboard` holds the installed apps and waiting requests for Home, the
bell, the daily brief and `view=apps`. Home switches to option B — apps in
the tile row, Alerts as a bell — only once an app is installed.
`app/src/i18n/__tests__/pages-parity.test.ts` keeps English and Malay in
step.

### Looking at production

```bash
./worker/scripts/stats.sh            # signups, businesses, runs, connections
./worker/scripts/stats.sh users      # per-account: playbook, plan, runs, conns
./worker/scripts/stats.sh runs 20 | runtimes | usage
./worker/scripts/stats.sh sql "select ..."
```

Credentials come from `neonctl` (already logged in) or `AISAR_NEON_OWNER_URL`.
The command names the `production` branch explicitly; Neon's default branch is
not the deployed database. It uses the direct endpoint because the pooled
endpoint rejects the read-only startup option.
It connects as `neondb_owner` on purpose — RLS scopes every tenant table to
`app.business_id`, so `aisar_app` outside `withTenant` counts nothing. The
session sets `default_transaction_read_only`, so the owner connection cannot
write; that's a server-side guard, not a regex over the query.

### Migrations in production

Nothing applies `worker/migrations/` to production; each migration is run by
hand, and one can be skipped while its code ships. `045_native_login_handoff.sql`
was, and from about 15 to 25 September every magic link and every
password-signup verification answered an empty 500 — Google sign-in hid it.
`worker/scripts/check-migrations-applied.mjs` now compares every table,
column and function the migrations create (following later drops and
renames) with production, read-only, and refuses the deploy on a gap. It runs
in `predeploy`, in `deploy:sites`, and in `ship-runtime.sh` before its
`wrangler deploy` (which skips `predeploy`). It fails closed when production
cannot be reached — an expired `neonctl` login is the usual cause; run
`neonctl auth` — and `AISAR_SKIP_MIGRATION_CHECK=1` skips it, loudly, for an
emergency. It does not see indexes, policies or constraints. Apply the
migration first, then deploy the code that needs it.

### Running the worker locally

```bash
worker/scripts/dev-db.sh            # local Postgres, every migration, aisar_app
worker/scripts/dev-db.sh --reset    # rebuild it from empty
```

Hyperdrive has no local target of its own. `wrangler dev` starts happily with
nothing behind the binding and the first query is where that surfaces, so the
connection string goes on the command line — it is a process variable, not a
`.dev.vars` entry:

```bash
cd worker && WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$(worker/scripts/dev-db.sh --url)" pnpm dev
cd app && VITE_API_URL=http://localhost:8787 pnpm dev
```

Connect as `aisar_app`, which is what the script creates and what production
uses. As the owner every policy is still there and enforcing nothing, so a
local run would behave correctly while production leaked — the same reason
the test harness hands out both roles.

This database persists; the test suite's is a throwaway container per run, so
the two never meet. Without `RESEND_API_KEY` a magic link is logged rather
than sent, which leaves the password door as the one that works end to end
locally, and without `TURNSTILE_SECRET` that check is skipped rather than
refusing every door.

### Testing the worker

```bash
cd worker && pnpm test       # needs Docker running
cd worker && pnpm typecheck  # src, then src + test
```

The suite runs a throwaway Postgres in Docker and applies `migrations/`
in order, including `000_role.sql`, which is the only description
anywhere of the `aisar_app` role and its grants.

The container is named and ported per run, so two suites can run at once
— they used to share one fixed name that `startDatabase` begins by
`docker rm -f`-ing, which meant a second run deleted the first run's
database out from under it and produced hundreds of failures that looked
like real ones. A run that crashes leaves its container behind; the next
run collects it, and only if the owning process is gone.

`pnpm typecheck` runs twice, and both passes matter. The first is `src`
alone under Worker globals, so a Node API that reached the Worker is
still an error. The second adds `test/`, which nothing checked until
2026-09-10: `tsconfig.json` includes only `src`, and the eighty-four
errors that surfaced were mostly fakes declared with no parameters, whose
`mock.calls[0][1]` read as `never` — assertions about what the code sent
that could not fail. `fetchFake`, `sendFake` and `jsonOf` in `harness.ts`
are the typed stand-ins to reach for instead of a bare `vi.fn`.

**Assert as `aisar_app`, arrange as `owner`.** `harness.ts` hands out
both. RLS does not exist for a superuser, so a test that asserts as the
owner passes while production leaks — that split is the point of the
harness, not a convenience.

Tests import the production queries (`claimGoogleIdentity`,
`countAndRecord` take a connection rather than an `Env` for this
reason) instead of copying the SQL. A copied query is a test that keeps
passing while the real one drifts.

Still worth an end-to-end run against the deployed API for anything
touching routes, asserting status codes on every write — sending them
to `/dev/null` hid a 500 on every policy write for two full runs.

Magic links are really delivered. `RESEND_API_KEY` holds a key scoped to
`sending_access` on jentera.ai alone, so a leak cannot send as the other
domains on that Resend account. jentera.ai carries SPF, DKIM and DMARC
(`p=quarantine` since 2026-09-09, aggregate reports to
admin@kitakodventures.com). Resend is the only sender: the apex has no MX
and no SPF, DKIM is signed as jentera.ai with the `resend` selector, and the
return path is send.jentera.ai, which aligns under relaxed SPF. Gmail's
Authentication-Results on a real magic link read dkim=pass, spf=pass,
dmarc=pass before the flip. Any new sender must go through Resend or carry
its own aligned DKIM, or its mail lands in spam.

Missing email configuration logs only a generic delivery warning, never the
recipient or authentication link. Test without sending through mocked delivery;
bearer links and provider response bodies must not become log material.
Resend's `delivered@resend.dev`
simulates a delivery and is the right recipient for load tests: a bounce
from a made-up address would damage the sending reputation being tested.

## Conventions

- **Several agents work in this one checkout at once.** Someone else's
  uncommitted work is usually sitting in the tree beside yours, and it moves
  between one command and the next. Stage **named paths**; never `git add -A`
  or `git add .`. On 23 September that swept 536 lines of another session's
  in-flight plan into an unrelated commit. The same care applies outward:
  `./deploy.sh` publishes the **working tree**, not HEAD, so anyone's
  unfinished `app/` work ships with it — check `git status` first. And
  `git push` sends all of main, so read `origin/main..main` and know whose
  commits you are publishing before you do. `ship-runtime.sh` is the exception
  that needs no care: it commits only `worker/wrangler.toml`, in a scratch
  worktree detached from `origin/main`.
- TypeScript + React under `app/`, two-space indent, semicolons, single quotes, camelCase.
- Import shared modules via the `@/` alias rather than long relative paths.
- Preserve `prefers-reduced-motion` handling and accessibility labels.
- Commits: Conventional Commit subjects, one visible behaviour per commit.

## Gotchas

- `_next/static/` are deployed artifacts from an upstream Next.js build that is **not in this repo**. Treat as opaque. The React app does not load them — its design system was extracted into `design-system/` and reimplemented.
- The landing page at `/` is English; `/ms` is its Bahasa Malaysia twin and the
  two are paired with hreflang in `lib/seo.ts`. Every other marketing page is
  English only. A claim stated on one landing must hold on the other — the
  prices and limits on `/ms` come from `launch-offer.ts` through
  `landing-content-ms.ts` so they cannot drift, and `seo.test.tsx` fails if an
  English chrome string reaches the Malay page.
- Public pages are `/`, `/ms`, `/pricing`, `/about`, `/connect`,
  `/connect/telegram`, `/connect/google-calendar`, `/privacy`, `/terms`.
  `INDEXABLE_PATHS` in `lib/seo.ts` is the list; adding a path there is what
  prerenders it, sitemaps it and puts it under `check-seo.mjs`. A new page also
  needs its trailing-slash 301 in `public/_redirects` and a cache rule in
  `public/_headers`, both of which the tests check against `INDEXABLE_PATHS`.
- **A connector only gets a page under `/connect/` if it is in
  `LIVE_CONNECTORS`.** `unbackedConnectorPages()` fails the test otherwise. A
  page for a planned connector is a page about something that does nothing.
