# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` carries the same house rules in shorter form. `PRODUCT_VISION.md`, `DISCUSSION_SUMMARY.md` and `TECHNICAL_ARCHITECTURE.md` carry product direction — read those before changing what the product *does*, not just how it's built.

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

- `app/src/lib/data/` is hand-maintained TypeScript. Add a playbook with `scripts/add-playbook.mjs`, which edits `playbooks.ts` directly — don't hand-merge.
- Controls share `--control-h` / `--control-pad-y`. A `text-*` or `py-*` utility on a `.btn`/`.input` overrides the component and breaks the shared height — this caused three separate visual bugs. Let components own their type and padding.
- The old static engine wrote work-done indices as **strings**; the app reads either format and writes strings, so existing users' approvals survive the cutover.
- **Playbook figures are for the anonymous demo only.** Every playbook carries plausible counters, work items and customer conversations; they are the same for every business of a type and move for nobody. Shown to a signed-in owner they are lies, and they were shipped as lies three times: a "4 connections" badge for an account with one, a dashboard that read 82% handled, and an inbox naming customers who do not exist. `useActivity` answers `real` / `pending` / `demo` — branch on `demo` before borrowing anything, and treat `pending` as the real layout with nothing in it. A boolean is what caused this: "not real yet" and "show the demo" are different answers.

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
each origin exactly — a wildcard is rejected by the browser outright.

`/api/auth/request` is rate limited three ways: an edge burst binding
(5/60s per IP), and Postgres counters of 50/24h per IP and 10/24h per
address. IP limits answer 429; the per-address one answers 204, because
its counter includes requests made by anyone for that address and a 429
would leak third-party activity. `MAX_OUTSTANDING` in `auth.ts` is a
separate, stricter short-range brake on concurrent live links.

**Still missing, and known:** connector execution is stubbed in
`src/connectors.ts` for everything but Telegram, pending OAuth
registrations. `app/src/lib/live-connectors.ts` mirrors that list, and
its test reads this directory rather than restating it, so the
Connections tab offers a working button only where something is behind
it.

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
the confirmation push on subscribe is sent directly. On a team, two more
kinds reach owners (`work_needs_you`, `approval_requested`, migration 037):
a colleague's task that ended waiting on the owner, or an action awaiting an
owner's decision, told to every owner except the one who asked
(`notifications/recipients.ts`, `notifications/work.ts`, called from the
consumer at outcome and approval time). A business of one, where the owner
asks everything, receives none of them.

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
is the plan and its status.

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

`docs/reply-latency.md` is where reply time and channel parity live: the
path a message takes, what Telegram and app chat share, dated measurements
and the levers tried. `worker/scripts/reply-latency.sh` reproduces its
numbers; re-run it before quoting them.

`docs/sprites-vs-dedicated-vms.md` records the 10 September 2026 compute-provider
comparison: retain Sprites, with an Alibaba 4 GB pilot proposed for sustained
browser workloads. Its costs are illustrative, not our invoice. Read it before
proposing a provider migration; model-loop cost work is a separate plan.

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

### Looking at production

```bash
./worker/scripts/stats.sh            # signups, businesses, runs, connections
./worker/scripts/stats.sh users      # per-account: playbook, plan, runs, conns
./worker/scripts/stats.sh runs 20 | runtimes | usage
./worker/scripts/stats.sh sql "select ..."
```

Credentials come from `neonctl` (already logged in) or `AISAR_NEON_OWNER_URL`.
It connects as `neondb_owner` on purpose — RLS scopes every tenant table to
`app.business_id`, so `aisar_app` outside `withTenant` counts nothing. The
session sets `default_transaction_read_only`, so the owner connection cannot
write; that's a server-side guard, not a regex over the query.

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

Unsetting the secret falls back to logging the link to `npx wrangler tail`,
which is how to test without sending. Resend's `delivered@resend.dev`
simulates a delivery and is the right recipient for load tests: a bounce
from a made-up address would damage the sending reputation being tested.

## Conventions

- TypeScript + React under `app/`, two-space indent, semicolons, single quotes, camelCase.
- Import shared modules via the `@/` alias rather than long relative paths.
- Preserve `prefers-reduced-motion` handling and accessibility labels.
- Commits: Conventional Commit subjects, one visible behaviour per commit.

## Gotchas

- `_next/static/` are deployed artifacts from an upstream Next.js build that is **not in this repo**. Treat as opaque. The React app does not load them — its design system was extracted into `design-system/` and reimplemented.
- The landing page is English-only; only the dashboard is bilingual.
