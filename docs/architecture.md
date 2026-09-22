# Jentera architecture, as built

Dated 22 September 2026. This describes the system that is deployed and
serving traffic, read off the code rather than recalled.

`TECHNICAL_ARCHITECTURE.md` at the repository root is the other half of the
pair and is **not** superseded by this: it holds the product and platform
boundary thinking — what Jentera is for, where Compute / Connect / Control /
Solutions divide, what the MVP phases were. It was written when the backend
did not exist yet, so it describes intent. Read that for *why*, this for
*what*. `CLAUDE.md` is denser than both and organised as house rules: it is
the place where a hard-won operational fact lives, and it wins on any
conflict with this file, because it is maintained edit by edit.

---

## 1. The shape

Five things deploy independently.

```
  Browser / installed PWA          Telegram            iOS · Android
        │                             │                     │
        │  session cookie             │ webhook             │ (Capacitor
        ▼                             ▼                     ▼  WebView)
  ┌──────────────────────────────────────────────────────────────┐
  │  aisar-api  ·  Cloudflare Worker  ·  placed ap-southeast-1   │
  │  auth · tenancy · policy · approvals · billing · connectors  │
  └──────────────────────────────────────────────────────────────┘
     │            │             │            │              │
     │ Hyperdrive │ Queues      │ R2         │ Durable      │ service
     ▼            ▼             ▼            ▼  Object      ▼  binding
  Neon Postgres  aisar-runtime  jentera-    RunStream    aisar-vault
  (AWS ap-se-1)  + DLQ          artifacts   (live SSE/WS) (no public route)
                     │
                     ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  One Fly Sprite per business  ·  region sin                  │
  │  runner (Node) → Hermes (Python) → model · browser · desktop │
  └──────────────────────────────────────────────────────────────┘
```

The one-line summary: **the control plane is Cloudflare, the agent's
computer is Fly, and the database is Neon.** Everything else follows from
those three choices.

## 2. The five deployables

| | Code | Runs as | Shipped by |
|---|---|---|---|
| **Web app** | `app/` | Cloudflare Pages project `aisar-jentera`, serving `jentera.ai` and `jentera.aisar.ai` | `./deploy.sh "msg"` |
| **Control plane** | `worker/` | Cloudflare Worker `aisar-api`, custom domain `api.jentera.ai` | `wrangler deploy`, or step 4 of `ship-runtime.sh` |
| **Agent host** | `runner/` + pinned Hermes | Node + Python on a Fly Sprite, one per business | `worker/scripts/ship-runtime.sh` |
| **Native shell** | `mobile/` | Capacitor, app id `ai.jentera.app` | Xcode / Gradle, manual |
| **Credential vault** | not in this repo | Workers `aisar-vault` and `aisar-vault-deposit` | separately |

`shared/` holds the handful of types both the app and the Worker need
(`bot-avatars.ts` today). `design-system/` is reference HTML and notes, not
built code. `future/` holds work parked before it was wired up.

### The web app

React + Vite + TypeScript. Public marketing pages are prerendered;
`INDEXABLE_PATHS` in `lib/seo.ts` is the list, and adding a path there is
what prerenders it, sitemaps it and puts it under `check-seo.mjs`.

It runs fully without a backend. `app/src/lib/repo/` is a `Repository`
interface with two implementations: `LocalRepository` (browser storage, the
anonymous demo) and `RemoteRepository` (the Worker). `VITE_API_URL` chooses.
This is why the marketing site can demonstrate the product to a stranger
with no account, and it is also the source of a recurring class of bug —
**playbook figures are demo-only and have been shown to real owners three
times as if they were theirs.** `useActivity` answers `real` / `pending` /
`demo` for that reason; a boolean is what caused the bug.

Installed as a PWA it updates on a prompt, never mid-reply
(`registerType: 'prompt'`). `pwa/update-checks.ts` asks on every return to
the foreground and hourly while open, because a browser otherwise looks for
a new service worker only on navigation and at most daily.

### The control plane

One Worker, `worker/src/index.ts`, dispatching to ~29 route modules. The
order in that file is load-bearing: the runtime-facing routes (model proxy,
runtime config, calendar, connector, connect, artifact upload) are mounted
**before** `guardApiRequest`, because a sprite presents a runtime credential
rather than a session cookie and a chat body exceeds the API body cap.

`[placement] region = "aws:ap-southeast-1"` puts `fetch` invocations beside
Neon. This is the region hint, not `mode = "smart"`.

### The agent host

`runner/src/server.mjs` is a small HTTP server on the sprite exposing
`/healthz`, `/readyz`, `/v1/tasks`, `/v1/skills`, `/v1/memory`,
`/v1/memory/forget` and `/v1/browser`. It owns the task lifecycle, streams
tool and token events back, gives each task an output folder, and uploads
whatever lands there to `POST /v1/runtime/artifacts` **before** the task
reads as complete — so the first "completed" the control plane sees already
carries the files.

Hermes (`qhkm/hermes-agent`, a fork of `NousResearch/hermes-agent`) is the
agent loop. Its release is pinned in exactly one file,
`worker/src/runtime/hermes-pin.ts`, and `hermes-pin.test.ts` fails on a
Hermes SHA written anywhere else — the pin used to be a literal in eight
places and missing one failed silently rather than loudly.

## 3. Tenancy: the invariant everything else rests on

Two rules, both load-bearing:

**`resolveTenant` is the only source of a business id.** No route reads one
from a request body. That was the hole this design replaced.

**RLS is forced on every tenant table**, scoped by a transaction-local
`app.business_id` that only `withTenant` sets. The predicates written into
route SQL are deliberate belt-and-braces, not the boundary.

```ts
// worker/src/db.ts
await sql.begin(async (tx) => {
  await tx`select set_config('app.business_id', ${businessId}, true)`;
  return fn(tx);
});
```

`local = true` is not a detail. Hyperdrive pools connections, so a
session-level GUC would leak one tenant's scope into the next request that
reused the socket. Verified against the pooled endpoint on 2026-08-25.

`resolveTenant` deliberately queries only `session`, `app_user` and
`membership` — the three tables with no RLS policy — because it runs
*before* a tenant is known. Joining a policy-protected table there would
return nothing and lock everyone out.

The Worker connects as `aisar_app`, never `neondb_owner`. **Postgres
silently bypasses RLS for table owners**, so an owner connection would leave
every policy configured and enforcing nothing. The same split is why the
test harness hands out both roles and the house rule is *assert as
`aisar_app`, arrange as `owner`*.

**Hyperdrive query caching is off and must stay off.** It is on by default
and caches plain SELECTs for ~60 s. `verifySession`, `resolveTenant` and the
password lookup all run outside a transaction, so all three were cacheable:
a logout did not take effect until the entry expired and a revoked session
kept authenticating. It surfaced as a freshly verified account still being
told it was unverified.

### The database

Neon Postgres in `ap-southeast-1`, 65 migrations in `worker/migrations/`
applied in order. `000_role.sql` is the only description anywhere of the
`aisar_app` role and its grants. (Numbering runs to `065`; `051` was
withdrawn and the gap is deliberate.)

The shape, by area:

- **Identity** — `app_user`, `session`, `membership`, password and OAuth
  identity, native auth codes, `session_kind`
- **Business** — `business` (carries `plan`), `business_fact`, fact proposals
- **Work** — `run`, `run_event` (the spine), `work record kind`, `goals` and
  goal checkpoints, `chat_session`, `workspace` + `workspace_member`
- **Runtime** — `agent_runtime`, `runtime_task` (status, leases, recovery,
  stream sequence), runtime identity, safety, liveness, egress, drift
  sweep, spares and their quarantine
- **Money** — `model_call`, FMCV rider spend, budget token caps, Stripe
  billing, payment evidence, lifecycle, purchase eligibility
- **Reach** — `connections`, webhook secrets, `notification`,
  `push_subscription`, `push_outbox`, `invitation`, reminders, `routine`
- **Output** — `artifact`
- **Gates** — access gate, waitlist notice, chat preview, account blocks,
  `specialist_profile`, `bot_preference`

Cross-tenant scans — the routine due-scan, `invitation_by_token`,
`business_plan(uuid)` — are `SECURITY DEFINER` functions that return ids
only. That is the only sanctioned way to look across tenants.

## 4. A message, end to end

This is the path that matters most and the one most shaped by measurement.

1. **Intake.** `POST /api/runs/ask` resolves the tenant, opens or finds the
   `chat_session`, picks a specialist, writes `run` + `runtime_task` in one
   transaction, and publishes a Queue message. The message is a **wake-up
   hint only**: task kind, payload, run id and tenant all come from the
   leased Postgres row, never from the message.

2. **Inline first slice.** The intake request runs the first slice itself
   (`runtime/inline-slice.ts`) instead of waiting for the consumer. This
   exists because of a measurement, not a preference — see below.

3. **Queue.** `aisar-runtime`, `max_batch_size = 1` so one long streamed
   response cannot head-of-line block other tenants. Delivery is treated as
   at-least-once; `runtime_task` in Postgres owns status and leases, so a
   duplicate costs nothing. 8 retries, then `aisar-runtime-dlq` retries 20
   more times at 5-minute spacing.

4. **Placed slice.** The consumer does **not** run the message itself. It
   hands it through the `SELF` service binding to
   `POST /api/support/runtime-slice` (`runtime/placed-slice.ts`) — the same
   code in a placed invocation — and only runs it locally if that fails.

5. **The sprite.** `RunnerClient` wakes the sprite if paused, posts the task
   to `/v1/tasks`, and relays the event stream: tool started/finished,
   token deltas, approval requests.

6. **Progress out.** Telegram gets an edited message bubble
   (`TelegramLiveStream`); the web gets `createWebProgress` →
   `publishRunProgressSafely` → the `RunStream` Durable Object → WebSocket →
   `applyProgress` in the app. The DO uses hibernation
   (`ctx.acceptWebSocket`), so an idle watcher costs nothing.

7. **Outcome.** `task-outcome.ts` classifies whether the reply was work and
   what state it left, inside one 5-second budget across however many calls
   it makes. When it gives up, `outcome.observed` says
   `classifier_unavailable` with a `uncertaintyDetail` of `timeout`,
   `unparseable` or `error:<message>` — an honest "don't know" rather than a
   guess.

### Why steps 2 and 4 exist

Measured 2026-09-10, six app-chat quick replies, before the inline slice:

| stage | elapsed |
|---|---|
| queue consumer invoked | 4.4–4.7 s |
| leased | +2.6 s prelude, +1.9 s lease transaction |
| database ready | +4.5 s |
| runner ready | +0.07 s |
| Hermes started | +0.07 s |
| first token | +2.7 s |
| **total** | **17.4–17.7 s** |

Every tenant transaction in the queue consumer cost **1.1–2.3 s**; the same
transactions from a placed HTTP handler cost **60–100 ms**. The sprite was
awake throughout — the wait was almost entirely the consumer talking to a
database on the other side of the Pacific.

After both slices landed the same day, "yob" answered in 5.2 s to first
token, 6.0 s to done. `docs/reply-latency.md` is the full record and
`worker/scripts/reply-latency.sh` reproduces it; re-run it before quoting
any of these numbers.

### The Telegram variant

Same spine. The webhook runs the first slice itself for the same reason.
Admission and dedupe use connection, chat and message ids, so a webhook
retry cannot create a second paid Hermes run. A reply to the paired owner
is an internal response, not a customer-send, so customer-messaging
permissions do not disable the owner's own assistant.

### Which specialist answers

A turn is answered by the specialist that answered the previous turn of the
same chat, for six hours after it (`specialistForTurn`). Only a fresh or
quiet chat is scored on its own words. The reason is concrete: Hermes keeps
each profile's conversation in its own store on the sprite, so a re-routed
turn cannot see what came before it — which is how "yes run the test run"
once reached a Chief of Staff who had never seen the digest request Growth
had just scheduled.

## 5. The fleet

One Fly Sprite per business, region `sin`. `RuntimeProvider`
(`runtime/provider.ts`) is compute lifecycle — create, wake, stop, status,
checkpoint, restore, destroy — deliberately separate from `RuntimeAdapter`,
which is agent semantics. The split is what would let Fly be replaced
without touching task history, approvals, connectors or the frontend.

### Shipping

One path, no exceptions. A fleet change lands on main, then
`worker/scripts/ship-runtime.sh -m "why"` pins that commit as the bundle,
bumps `RUNTIME_RELEASE`, runs the release gate, commits, pushes, deploys the
Worker, triggers the drift sweep, waits for convergence, and runs
`fleet-verify.sh` on every sprite.

Three rules that were each learned expensively:

- **`ship-runtime.sh` pins `origin/main`, not your HEAD.** A sprite
  downloads its bundle from GitHub, so an unpushed commit is one no sprite
  could fetch. The failure is silent: on 21 September a release went out
  titled "owner can restart a wedged business browser", pinned six commits
  behind HEAD, containing no such thing — and thirteen sprites converged on
  it happily.
- **A transfer field and its bootstrap `case` arm ship in the same pin.**
  `bootstrapRuntime` curls the bootstrap from `RUNTIME_BUNDLE_COMMIT`, so
  the *pin* decides what parses. On 2026-09-10 `EXTRACT_BASE_B64` went out
  in a Worker deploy while the pinned bootstrap had no matching arm; every
  sprite rejected the transfer and convergence stalled.
  `check-transfer-fields.mjs` now blocks this as a `predeploy` hook.
- **Nothing is applied to a sprite by hand.** A sprite's Hermes checkout
  survives re-bootstrap exactly as it is, so a hand-applied change is
  invisible to the next release and a removed one lingers. If it must be
  true everywhere, it goes in the bundle.

Anything read at bootstrap reaches a sprite only by re-bootstrap, so a
config-only change still needs a `RUNTIME_RELEASE` bump.

### Checkpoints

The checkpoint id kept must be a versioned one (`v64`), never `Current` —
Fly's list endpoint leads with live state as an entry named `Current`, newer
than every real checkpoint, and restoring to it restores what the sprite
holds now. A checkpoint that fails after a healthy bootstrap does not block
convergence: the release is real on the sprite, so it is recorded as
converged with the failure kept as a warning, the previous checkpoint stays
as the rollback point, and the prior inference key stays unrevoked because a
restore would bring it back.

### Drift

The quarter-hour cron publishes upgrade tasks for any sprite not on the
pinned release. A release bump therefore converges by itself; no per-business
message and no operator trigger.

## 6. Doors, sessions and the edge

Three doors — magic link, password, Google — converging on one session
cookie, so nothing downstream distinguishes them. `email_verified` is what
keeps them safe together: a password alone never proves ownership of an
address. Signing up on an existing address never overwrites its password and
never says so; Google claiming an *unverified* account clears whatever
password it held.

The magic link token is stored SHA-256 hashed, single-use via a conditional
UPDATE, exchanged for an HttpOnly/Secure/SameSite=Lax cookie.

Because the cookie travels cross-origin, `ALLOWED_ORIGINS` must name each
origin exactly — a wildcard is rejected by the browser outright. **Two
lists must name every method a route handles**, and neither is visible to a
route's own tests: `Access-Control-Allow-Methods` in `index.ts`, and the
allowlist in `request-guard.ts`. `PUT` was in neither for the push
subscription route for a day, so the notifications switch read "not
available" on every device while curl and the route's own tests passed.
`test/cors.test.ts` now scans routes against both.

Turnstile stands in front of the link request, password signup and password
login. Google is not behind it — Google already stands in front of that
door. Order matters when enabling: ship the app with the site key first,
then set the secret.

Six rate-limit namespaces, each sized to what the endpoint can spend:

| binding | limit | why |
|---|---|---|
| `AUTH_BURST` | 5/60s | refuses before any database or email work |
| `API_BURST` | 120/60s | before session verification or Neon |
| `AGENT_RUN_BURST` | 10/60s | a run buys compute and model tokens |
| `RUNTIME_MUTATION_BURST` | 3/60s | provisioning creates paid infrastructure |
| `RUN_STREAM_BURST` | 12/60s | long-lived resource admission |
| `RUNTIME_CONFIG_BURST` | 30/60s | a brake if a sprite starts spinning |

Plus Postgres counters on `/api/auth/request`: 50/24h per IP, 10/24h per
address. The per-address one answers **204, not 429**, because its counter
includes requests made by anyone for that address and a 429 would leak
third-party activity.

## 7. Permissions, plans and who can read what

Roles are decided in one place, `permissions.ts`, where a permission is a
row; `permissions.test.ts` fails on any `role !== 'owner'` that appears at a
call site.

`business.plan` is `free | pro | team`. Team writes check the feature inside
the tenant transaction and answer 402 otherwise. An operator sets the plan
with one UPDATE; nothing sets it automatically. A staff seat counts only
while the business is on the team plan — `verifySession` and
`authLandingPath` skip staff memberships otherwise, through
`business_plan(uuid)`, a `SECURITY DEFINER` function because `business` is
RLS-protected outside a tenant transaction. Leaving the plan ends staff
access at once; returning restores it, memberships untouched.

Run visibility is one rule: a run with no chat — Telegram, a routine, an
ingest — belongs to the business and every member may read it; a run with a
chat may be read by whoever opened that chat, plus every member of the
workspace it was opened in. `visibleRunPredicate` is that rule as one SQL
fragment, embedded by the run, Activity and artifact queries rather than
restated. `runVisibleTo` answers **404, never 403**, so an id alone confirms
nothing, and Activity carries `canOpen` per row so a colleague's outcome
shows without a way into the conversation.

Removing a member ends everything that lets them in or reaches them in one
transaction: membership, sessions, devices, pending pushes, workspace seats,
open invitations. Their chats and the work they asked for stay as history.

## 8. The agent boundary

`RuntimeAdapter` is documented in `runtime/types.ts` with the constraint
stated outright:

> Every method here is free of side effects on Jentera's own data. The
> adapter reads and reasons; the control plane decides what to persist and
> what needs approval. A runtime that could write facts or send messages
> directly would be a runtime that could bypass the approval gate.

`run.runtime` and `run.model` are snapshots taken from whichever adapter
executed the work, so history stays truthful after a runtime change. They
are never looked up live.

**The agent never holds a service credential.** When Hermes needs a
connected service it asks the control plane
(`routes/runtime-connector.ts`), which performs the call. Each runtime gets
a signed five-minute tool grant bound to its business and task.

Model access is the same shape: sprites are handed
`AISAR_RUNTIME_MODEL_BASE`, this Worker's own proxy, which verifies the
derived runtime credential and enforces a per-rider budget
(`fmcv-verifier.ts`, `routes/model.ts`) before forwarding to an allowlisted
upstream with a credential the sprite never sees.

Two model-side guards worth naming: `answer-guardrails.ts` and
`answer-stream-policy.ts` gate what reaches the owner, and
`think-scrubber.ts` keeps reasoning out of the answer.

Agent memory is deliberately *not* the fact store. Hermes keeps two small
files per profile on the sprite (`MEMORY.md`, `USER.md`); the runner exposes
them and the Worker relays them to the owner alone, sanitised, as "What
Jentera has picked up" with a Forget on each entry. The agent is told every
turn not to copy business facts it was handed into that memory, so the few
kilobytes it has stay for what Jentera cannot tell it.

## 9. Storage and side channels

- **R2 `jentera-artifacts`** — files the agent hands the owner. Keys are
  `<business>/<run>/<artifact id>/<name>`; `GET /api/artifacts/:id` resolves
  the row under the tenant before touching the bucket and always answers as
  an attachment. Names are plain, 20 MB a file, 20 a run.
- **Durable Object `RunStream`** — one hibernating WebSocket broadcaster per
  business/run pair. Exact per-run and per-user concurrency caps live inside
  the object, in addition to the edge limiter.
- **Workers AI** — `toMarkdown` for uploaded PDFs, Office documents and
  images during knowledge ingest. Chosen so the feature needs no third-party
  key.
- **Analytics Engine `jentera_product`** — product events.
- **Workers Logs** — invocation telemetry. Note that `wrangler tail` returns
  nothing on this Worker; verify through Postgres or the response instead.

## 10. Notifications

Web push is RFC 8291 payload encryption and RFC 8292 VAPID on Web Crypto,
held to the RFC's worked example byte for byte by `test/push-crypto.test.ts`
— a change that still works against one browser but drifts from the spec
fails there first.

Nothing is pushed from inside a transaction. `enqueuePush(tx, …)` queues a
row in the same tenant transaction as the notification it mirrors, and
`sweepPushOutbox` on the minute cron delivers it, doubling the delay and
giving up after eight tries with the error on the row. A request that dies
after the insert loses nothing.

Subscriptions are keyed by the browser's endpoint, which is unique across
tenants — the same browser keeps its endpoint whoever signs in, so a second
account's insert collides with a row RLS hides, the route answers 409, and
the app takes a fresh endpoint.

Email is Resend, with a key scoped to `sending_access` on jentera.ai alone
so a leak cannot send as the other domains on that account. Every new
account sends one plain-text notice to `SIGNUP_NOTICE_TO` behind the
response via `ctx.waitUntil`, so Resend being slow cannot delay a sign-in.

## 11. Scheduling

Postgres is the scheduler. `routine.next_run_at` is the clock, the
one-minute cron calls `dispatchDueRoutines`, and the cross-tenant due scan
is a `SECURITY DEFINER` function returning ids only. Everything else runs
inside `withTenant` under a row lock. Sprites never own a local cron.

Two cron expressions, both firing at :00, :15, :30, :45 — `index.ts`
branches on `controller.cron` so the fleet sweep never runs every minute.

## 12. Testing architecture

`pnpm test` in `worker/` runs a throwaway Postgres in Docker and applies
`migrations/` in order. The container is named and ported per run, so two
suites can run at once; they used to share one fixed name that the harness
began by `docker rm -f`-ing, which meant a second run deleted the first
run's database and produced hundreds of failures that looked real.

`test/orchestration.test.ts` exercises the real control-plane path:
`testEnv()` points Hyperdrive at the test container, so `withTenant`, RLS
and the transactions all run for real. Only the model and outbound HTTP are
faked — the two things that would otherwise leave the machine. The bugs here
have all been in the seams a stub would hide.

`pnpm typecheck` runs twice and both passes matter: `src` alone under Worker
globals, so a Node API that reached the Worker is still an error; then `src`
plus `test/`, which nothing checked until 2026-09-10 and which surfaced
eighty-four errors, mostly fakes declared with no parameters whose
`mock.calls[0][1]` read as `never` — assertions that could not fail.

`test/runtime.test.ts` runs one contract over every adapter in a list. A new
runtime is added there and either passes or is not finished.

Local development is `worker/scripts/dev-db.sh` plus
`WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` on the command
line — a process variable, not a `.dev.vars` entry. Connect as `aisar_app`;
as the owner every policy is present and enforcing nothing, so a local run
would behave correctly while production leaked.

## 13. Where the design has slack

Honest list. Each is something measured or read, not a style preference.

**1. Two settings are still sized for a cap that no longer exists.**
The Sprites org limit went from 10 to 100 concurrent on 2026-09-16.
`max_concurrency = 20` on the queue consumer and
`AISAR_KEEPALIVE_GRACE_HOURS = "0"` both predate that. Keepalive 0 means
every message after an idle period pays a 15–30 s wake; the config comment
gives billing as the reason, so the trade is real money against first-message
latency and it deserves re-deciding now rather than inheriting. Queue
concurrency at 20 is now likely the binding constraint rather than Sprites.

**2. The `SELF` double-invocation is labelled a spike but is load-bearing.**
`wrangler.toml` still says "Remove with the spike". It cannot be removed —
it is the only thing that made the consumer fast, and a request to the
public hostname is not a reliable substitute (522 from IAD). Every queued
message therefore costs two Worker invocations. The real fix is either
placement for queue consumers, which Cloudflare does not offer, or moving
orchestration into a Durable Object with a location hint so its alarms fire
beside the database. `docs/plans/2026-09-10-business-runtime-durable-object.md`
is that plan, written and not taken.

**3. `consumer.ts` is 125 KB with 49 `withTenant` call sites.**
There are 266 across the Worker. Each opens a connection, begins a
transaction, sets the GUC, commits and closes. On the consumer path that
was 1.1–2.3 s each before the placed slice, and it is still the unit of cost
on every path. Nothing currently reports how many a single run makes, which
means the most expensive thing in the system is also the least measured.
Splitting that module is worth it for reviewability alone;
`routes/runs.ts` (50 KB), `runtime/tasks.ts` (48 KB) and `routes/repo.ts`
(39 KB) are next.

**4. The spare pool is off, so every signup pays cold provisioning.**
Preparation failed four times out of four after migration 062, each attempt
creating a sprite that never attested. `spare-worker.ts` records no error by
design, so nothing in the database or the logs says why. Turning it back on
needs one preparation watched live.

**5. Hyperdrive caching is off globally to protect three queries.**
`verifySession`, `resolveTenant` and the password lookup are cacheable only
because they run outside a transaction. Wrapping them would make them
uncacheable on their own terms and let caching return for everything else.
Low priority, but the current state costs a Neon round trip on every read in
the product to protect three.

**6. The model proxy is ours.** `routes/model.ts` (25 KB) plus
`fmcv-verifier.ts` exist because we needed per-tenant budget enforcement.
Whether AI Gateway can now do that is worth asking rather than assuming.

**7. `RuntimeAdapter` no longer describes how production work runs.**
It has `readPage` and `answerQuestion`, and `runtimeFor()` returns
`InlineRuntime` unconditionally. Real agent work goes through
`RuntimeProvider` + `RunnerClient` + `tasks.ts` + the consumer, which that
interface does not model. The interface is honest about deferring lifecycle
methods until something needed them — something now does.

## 14. What is deliberately not built

- **Connector execution is stubbed** in `src/connectors.ts` for everything
  but Telegram, pending OAuth registrations. `app/src/lib/live-connectors.ts`
  mirrors that list and its test reads the directory rather than restating
  it, so the Connections tab offers a working button only where something is
  behind it. A connector gets a `/connect/` page only if it is in
  `LIVE_CONNECTORS`.
- **Native bearer auth.** `NATIVE_AUTH_ENABLED = "false"` until the callback
  is a verified App Link and Universal Link rather than a custom scheme any
  installed app can claim. Native-only feature calls fail loudly rather than
  falling back to the cross-site cookie.
- **Sprite region moves.** Replacing a sprite is close to a one-way door;
  `docs/moving-a-sprite.md` is the procedure and
  `move-runtime-region.mjs` is it as code.

`docs/todo.md` is the live list: what shipped but was never exercised in
production, what the next release must carry, what waits on Fly or on the
owner. Read it before asking what is next.

## 15. Where to look next

| Question | File |
|---|---|
| Reply time, channel parity, what was tried | `docs/reply-latency.md` |
| How to ship to the fleet, and roll back | `docs/release-playbook.md` |
| Cold provision and upgrade cost | `docs/provisioning-time.md` |
| Compute provider comparison | `docs/sprites-vs-dedicated-vms.md` |
| Teams: roles, tables, joining, offboarding | `docs/team-plan.md` |
| Routines contract and acceptance gate | `docs/plans/2026-09-09-routines-api-v1.md` |
| Cloudflare surface and account asks | `docs/cloudflare-account-review-2026-09-23.md` |
| Open work | `docs/todo.md` |
| House rules and hard-won facts | `CLAUDE.md` |
| Product and platform intent | `TECHNICAL_ARCHITECTURE.md` |
