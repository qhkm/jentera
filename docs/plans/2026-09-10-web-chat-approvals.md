# Web-chat approvals — one decision path, two surfaces, and an honest machine

Status: **proposed**. Prepared 10 September 2026 against `main` at ad19c3a
(the config-channel commits are in; `RUNTIME_RELEASE` is `2026.09.10-5`,
Hermes pinned at `v2026.9.8`, commit ff5b9fcf). Nothing here changes
production by being written down.

This is a sequencing document in the shape of
`2026-09-10-fleet-config-delivery.md`: what to change, in what order, why
that order, what proves each step, and what each step does not do. Every
file, function and column named below was read in the code, not taken from
the report; where the report and the code disagree, the "checked against
the code" section says so. Hermes facts were read at the pinned tag in the
local checkout (`~/ios/hermes-agent`), not at its HEAD, because the fleet
runs the tag.

## The problem, in one sentence

An owner in the web chat asked Jentera to `wrangler login`; the agent
answered with a menu ("install it first? or the API token approach?") and
stopped, and the owner wants that moment to be a button that, once pressed,
makes the thing happen — but the only approval surface Jentera has is a
Telegram inline keyboard, and the web chat cannot even *hold* an approval:
it fails the run.

## What the report actually was, checked against the code

The report is right about the shape — the machinery exists end to end and
only Telegram can see it — and wrong in details that decide what to build.

- **A web run that hits a Hermes approval does not "time out into a
  deny"; it fails, after burning five attempts.** The consumer's `approval`
  branch (`worker/src/runtime/consumer.ts:1500-1504`) begins
  `if (!telegram?.privateChat) throw new Error('Hermes approval cannot be
  presented outside a private Telegram chat')` — and that throw comes
  **before** `pauseRuntimeTaskForApproval` (line 1527), so nothing durable
  is created. The catch at line 1773 sees neither a `RuntimeBusyError` nor a
  flood-wait, so it takes the retry branch (lines 1983-1996): `retryRuntimeTask`,
  a `retrying` progress event to the web chat, a 30 s requeue. The retry
  re-dispatches, `client.stream` returns the still-pending approval from the
  runner's history (`runner/src/server.mjs:1741-1757` keeps it there until
  a decision arrives at line 1865), and the branch throws again. At
  `MAX_TASK_ATTEMPTS = 5` (line 91) the terminal branch stops the Hermes
  run, exhausts the task and finishes the run `failed` with reason
  `attempts_exhausted` (lines 1861-1900). The owner sees "Jentera could not
  answer that just now" some two and a half minutes later. Meanwhile Hermes's
  own `approvals.timeout` (90 s, `runner/bin/configure-model-provider.py:233-235`)
  auto-denies on the sprite, which the worker never learns. `settleApprovalBubble`'s
  early return on a missing Telegram hint (line 2177) is real but is
  downstream of the throw and never reached. Read, not reproduced; step 0's
  gate reproduces it.
- **That is not what happened on 2026-09-10.** No approval fired. Hermes's
  gate at the pin is command-pattern detection on the `terminal` tool
  (`tools/approval.py`, `DANGEROUS_PATTERNS`, ~47 rules: recursive deletes,
  `mkfs`/`dd`, `curl | sh`, writes to `~/.ssh` and Hermes's own config,
  `git push --force`, `docker … down`, and so on) plus a whole-script gate
  on `execute_code` (`check_execute_code_guard`, `tools/approval.py:3795`).
  `npm install -g wrangler` and `wrangler login` match nothing on that list.
  Had the agent tried them, they would have run with no approval at all. The
  agent asked in prose because the per-run system prompt tells it to:
  `worker/src/ask.ts:208-210`, "Before an irreversible external action …
  obtain clear confirmation unless that exact action was explicitly
  requested in the current message" — and because it genuinely had a choice
  to put to the owner. So there are two systems here, and the report treats
  them as one: a **mechanism** (Hermes's gate → runner `approval.request` →
  worker → a surface) that fires narrowly, and a **habit** (the prompt) that
  fires broadly and produces prose. Section 5 is about closing that gap;
  sections 1-4 are about giving the mechanism a web surface, which is
  necessary either way and useful today for the commands the gate does
  catch.
- **The gate may not even reach a human.** Hermes's `DEFAULT_CONFIG`
  (`hermes_cli/config.py:2664-2667` at the pin) sets `approvals.mode:
  smart`: a flagged command is first judged by the auxiliary model
  (`_smart_approve`, `tools/approval.py:2725`; the aux `approval` task is
  routed to the same FMCV model by `configure-model-provider.py:119-139`),
  whose prompt says to APPROVE "development tools, package installs, git
  operations" and to ESCALATE only when uncertain. Only an ESCALATE (or
  every match under `mode: manual`) produces the `approval.request` the
  owner sees. `configure-model-provider.py` sets `approvals.timeout` and
  nothing else in that block, and `_get_approval_mode()` falls back to
  `manual` **only when the key is absent** (`tools/approval.py:2625-2628`).
  Whether a sprite's `config.yaml` carries the installer's `mode: smart` or
  no `mode` at all decides which world we are in, and this document does
  not know. It is the first open question, and step 2 answers it before
  changing anything.
- **The timeout pin is backwards from what its comment says.** The comment
  at `configure-model-provider.py:228-232` says the stock default is 20 s
  and we raise it to 90. At the pin, `_get_approval_timeout` defaults to
  **300 s** (`tools/approval.py:2652-2663`, with a docstring explaining that
  60 s "proved too tight" for Telegram taps). We *lower* it to 90 so it sits
  just above `HERMES_APPROVAL_WAIT_SECONDS = 60` (`consumer.ts:122`). The
  ordering (worker < Hermes) is the thing that matters and is correct; the
  comment is stale and step 2 fixes it in passing.
- **`ApprovalInbox` is not localStorage-only.** For a signed-in owner it
  reads `approval` rows through `GET /api/state` (`app/src/lib/repo/remote.ts:150-156`)
  and decides through `POST /api/state/approvals/:id/decide`
  (`worker/src/routes/repo.ts:451-458`, owner-only), which on approve
  **executes** the connector action itself (the Telegram `send_message` at
  lines 508-565). `aisar-approvals` is the `LocalRepository` demo path. This
  is the `action.proposed` → owner edits → `action.executed` model: the
  control plane holds a proposal and performs it. A runtime tool approval is
  a different animal — a yes/no gate on a live Hermes run with a deadline,
  where the *agent* performs the action after the answer — and section 7
  keeps the tables apart while sharing the surface.
- **The event vocabulary is ready.** `EVENTS` in `worker/src/runs.ts:32-48`
  carries `approval.requested`, `approval.granted`, `approval.rejected`, and
  the runtime path already writes all three: `finishRun(…, 'needs_approval')`
  appends `approval.requested` (`runs.ts:158-181`), `resumeRunAfterApproval`
  appends granted/rejected (`runs.ts:184-206`). The connector path writes the
  same names from `routes/repo.ts`. No new event type; the payloads gain a
  `surface` and a `decidedBy`.
- **The web progress channel exists and is the right transport, with one
  rule.** `createWebProgress` (`worker/src/runtime/web-progress.ts`) publishes
  into the `RunStream` Durable Object; lifecycle events are stored and
  replayed to late subscribers, live events are not
  (`worker/src/run-stream-events.ts:1-11`). The object's contract is explicit:
  "No prompt, model output, credential, provider id, or customer data is
  stored here" (`worker/src/run-stream.ts:21-27`). An approval's `message`
  is model output. So the stream may say *that* a decision is needed, and
  Postgres must say *what*. Section 1 is built on that split.
- **The web chat forgets in-flight work on reload by design.**
  `stableMessages` (`app/src/hooks/useAsk.ts:105-108`) drops any pending
  pair before persisting, "so a reload never restores a spinner that can
  never finish". A pending approval is therefore invisible in the chat
  after a reload unless it is rendered from durable state somewhere else.
  That somewhere is the "Waiting for you" list and the task page, which
  already know `needs_approval` (`app/src/routes/views/TaskDetailView.tsx:16,69,109-114`).

## Where the agent runs, and what "approve and run" must mean

The owner's mental model — "approve, and it runs `wrangler login`" — has
the wrong machine in it. Every run executes on the business's Fly sprite
(`agent_runtime.provider = 'fly-sprite'`, Singapore), inside Hermes, behind
the runner. `wrangler login` there would open an OAuth page in a browser on
the sprite, which nobody will ever see, and on success would write a
Cloudflare credential into the sprite's home directory — a machine whose
credential file already holds the runner key, the Hermes key and the model
credential (`runner/README.md`, "Key co-residency"). The API-token path the
agent offered is the correct one for that machine, and the agent was right
to offer it. What it should not have done is offer it as a *question*.

Two things follow for this plan.

1. **The approval card says where the action runs, every time.** Not the
   provider — the prompt at `ask.ts:205-207` forbids naming the hosting
   stack, and the UI holds to the same line — but plainly: "Runs on
   Jentera's cloud agent, not on your computer. It cannot see your files,
   browser or logins." An owner who reads that will not expect `wrangler
   login` to open a tab on their laptop, and will understand why a token
   is the right answer.
2. **The agent is told the same thing.** One sentence in
   `HERMES_AGENT_PROMPT`: it runs on a cloud machine the owner cannot see,
   so interactive logins, device-code flows and anything that opens a
   browser for the owner will not work there; ask for a token or a key
   instead. That is what turns "which would you prefer?" into "I'll use an
   API token; paste one and I'll set it up" — a request for information the
   agent cannot obtain, which is the one kind of question the rewritten
   rule in section 5 still permits.

"Approve and run" therefore means: *the agent proposed a specific command
on its own machine, the owner saw it, said yes, and the agent ran it there.*
Never: the owner's machine, and never: a command the agent did not propose.

## Invariants

Held through every step. A step that needs to break one is a different plan.

- **One decision path.** Telegram and web are *surfaces*; the claim →
  runner decision → complete → resume sequence lives in one function and
  both surfaces call it. A surface may render, authenticate and bind; it may
  not decide. This is enforced by a contract test over the list of surfaces
  (section 6), not by review.
- **The stream carries the fact of a decision, never its content.** The
  `RunStream` object stores `{ type: 'needs_approval', approvalId }` and
  nothing else about the approval. The tool name, the message and the
  deadline come from `runtime_task.result.approval` under `withTenant`, on
  request. This keeps the object's "no model output" contract and makes the
  database the source of truth for what was approved, the same rule the
  durable answer already follows.
- **An approval can only approve what Hermes asked.** The web route takes
  an opaque approval id and a decision; `requestId` is read from the row,
  never from the body. The runner then binds it to its FIFO head
  (`server.mjs:1831-1834`) and Hermes to its live approval session. There is
  no way to use the route to make the agent do something it did not
  propose. The "approve" button is a new way to *permit* an action, not a
  new way to *cause* one.
- **`resolveTenant` is the only source of a business id; the approval id
  is opaque and tenant-scoped.** The lookup is `result #>> '{approval,id}'`
  under RLS. A foreign id is a 404 indistinguishable from a stale one.
- **A run waiting on a human is charged as if it were working.** Three
  clocks run through the wait — the worker's reservation deadline
  (`run-task.ts:222`, 300 s quick / 900 s deep), the runner's task-age
  watchdog (`server.mjs:24`, 15 min quick / 90 min deep) and Hermes's own
  `approvals.timeout` — and none distinguishes waiting from working. Until
  one does (section 3, deferred), the wait stays short and the expiry stays
  honest. This plan does not pretend otherwise.
- **The business is blocked while an approval waits.** `leaseRuntimeTask`'s
  `approval_wait` predicate (`tasks.ts:325-332`, and again at 485) refuses
  every other lease for the business while a `resume` task with an approval
  is queued. That is correct — the paused Hermes run holds the runner's one
  slot — and it is the strongest argument against long waits.
- **Nothing here changes what the agent is allowed to do.** The gate's
  patterns, the toolsets and the approval timeout stay in the bundle (the
  same column of `2026-09-10-fleet-config-delivery.md` §2 they are in
  today). Section 5 proposes changing `approvals.mode`, and that is a
  release, reviewed, not a config document.
- **Every step is reversible with a worker deploy or a Pages deploy**,
  except the one Hermes config change, which is a release with the
  playbook's rollback.

## 1. Surfacing: how a pending approval reaches the web client

### The durable park comes first

Today the park is Telegram-shaped: `pauseRuntimeTaskForApproval`
(`tasks.ts:575-626`) requires `connectionId`, `chatId` and `messageId`, and
`runtimeApprovalFromResult` (`tasks.ts:1051-1076`) refuses a row without
them. `RuntimeApproval` becomes surface-tagged:

```ts
interface RuntimeApproval {
  id: string;                // opaque, random — what the surfaces hold
  requestId: string;         // Hermes's, 32 hex — what the runner binds
  tool: string;              // ^[a-zA-Z0-9_.:-]{1,96}$
  message: string;           // ≤ 1,000 chars, runner-redacted
  status: 'pending' | 'deciding' | 'approved' | 'denied' | 'expired';
  decision?: 'approve' | 'deny';
  expiresAt: string;
  decidedAt?: string;
  surface: 'telegram' | 'web';
  telegram?: { connectionId: string; chatId: number; messageId: number };
  decidedBy?: string;        // app_user.id for web; absent for Telegram
  channel: 'app' | 'telegram';   // payload.channel at park time, for the list
}
```

The validator reads both shapes — a row with flat `connectionId/chatId/
messageId` and no `surface` is a Telegram approval written before this
change — and writes only the new one, the rule CLAUDE.md already applies to
work-done indices. No migration: the approval lives in `runtime_task.result`
(jsonb). The `approval_wait` lease predicate and every `result #>> '{approval,…}'`
path are untouched.

In the consumer, the branch at 1500 becomes: `surface = telegramHint(payload)
?.privateChat ? 'telegram' : 'web'`. The Telegram arm keeps its bubble; the
web arm skips the bubble, parks with `surface: 'web'`, calls `finishRun(…,
'needs_approval', { runtimeTaskId, requestId, tool, message, surface })`
— `message` joins the event payload because `run_event` is the append-only
evidence (migration 007) of what the owner was asked, and the task's
`result` is not — and publishes the stream event below. The requeue stays
`HERMES_APPROVAL_WAIT_SECONDS`.

### The stream event

`RUN_PROGRESS_TYPES` (`run-stream-events.ts:12-20`) gains `'needs_approval'`;
`RunProgressEvent` gains an optional `approvalId: string` (uuid, validated
in `RunStream.publish` beside `progressType`, dropped if malformed). It is a
lifecycle event, so it is stored, replayed to a subscriber who connects
late, and deduplicated by `lastType` (`run-stream.ts:94`) — two approvals
in one run alternate with `working`, so dedupe cannot swallow the second.
`rememberLive` is untouched: nothing about the content enters the object.
The publish body stays well under the 2 KB bound (`run-stream.ts:191`).

Wire: `{ version: 1, seq, type: 'needs_approval', at, approvalId }`.

On the client, `isProgressEventType` (`remote.ts:490`) admits
`needs_approval`; `AskProgressEvent` (`app/src/lib/repo/types.ts:76`) gains
`approvalId?: string`; `useAsk`'s `project` (`useAsk.ts:322-359`) maps it
to `state: 'needs_approval'` with the id on the message, keeping any answer
text already streamed. `AskReply` renders a `RuntimeApprovalCard` in that
state (section 4), which fetches the content.

### What the client fetches, and reload

`GET /api/runtime/approvals/:id` (session, `withTenant`, any member may
*read*) answers
`{ ok, approval: { id, runId, tool, message, expiresAt, status, surface, channel } }`
from `runtime_task` where `result #>> '{approval,id}' = :id`, or 404.
`GET /api/runtime/approvals` lists the tenant's pending and deciding ones
the same way; there is at most one per business by the lease invariant, but
the route returns a list so the surface never has to assume that.
`GET /api/runs/:id` (`routes/runs.ts`, the `pending: true` branch) adds
`approvalId` when the run is `needs_approval` and its task holds a
web-surface approval, so `pollAsk` — the fallback when WebSockets are
unavailable — can show the same card.

Reload mid-approval: the chat message is gone (`stableMessages`), and that
is left alone. The run outlives the tab, so the approval must be visible
from durable state: **"Waiting for you"** in `ActivityView`
(`app/src/routes/views/ActivityView.tsx:200-219`, the `real` branch) lists
runtime approvals from `GET /api/runtime/approvals` above the connector
approvals it already shows, with the same card; and `TaskDetailView`'s
`needs_approval` branch (`:109-114`), which today links to the connector
inbox, renders the card inline when the run's approval is a runtime one.
The `needs_you` counter (`worker/src/runs.ts:402`) counts pending runtime
approvals too, so the dashboard number is honest. Re-inserting the card
into the chat transcript after a reload is a later nicety, not a gate.

## 2. Deciding: the route, who may call it, and what two clicks do

### One function, two callers

`handleRuntimeApprovalCallback` (`consumer.ts:429-517`) already contains the
sequence: claim under the business advisory lock → `decideRuntimeTaskApproval`
(runner, idempotent by `requestId`) → on failure `releaseRuntimeApprovalDecision`
→ `completeRuntimeApprovalDecision` + `resumeRunAfterApproval` in one
transaction → `signalRuntimeTask`. The Telegram-specific parts are the
binding (connection, chat, message id) and the bubble edits. Extract the
sequence into

```ts
applyRuntimeApprovalDecision(env, businessId, binding, decision, fetcher)
  : Promise<'accepted' | 'duplicate' | 'invalid' | 'unavailable'>
```

in `worker/src/runtime/approvals.ts`, where `binding` is
`{ surface: 'telegram', approvalId, connectionId, chatId, messageId }` or
`{ surface: 'web', approvalId, userId }`. `claimRuntimeApprovalDecision`
takes the same union: a Telegram claim checks the three Telegram fields as
today (`tasks.ts:656-659`); a web claim checks `surface === 'web'` and
records `decidedBy`. The Telegram callback becomes a thin caller that adds
`answerCallbackQuery` and the bubble edits around it. The consumer's own
timeout path (lines 1157-1235) keeps calling the pieces directly; it is not
a surface.

### The route

`POST /api/runtime/approvals/:id/decide`, in `routes/runtime.ts` beside
`cancel`. Body `{ decision: 'approve' | 'deny' }`. In order:

1. `resolveTenant` + `hasBusiness`, as every `/api/runtime` route
   (`runtime.ts:30-34`).
2. `identity.role === 'owner'`, as `cancel` (`:134-136`) and as the
   connector decide route (`repo.ts:453-458`, "a staff member must not be
   able to authorise customer-facing sends"). A tool approval can run a
   command on the business's machine; the same line holds. Staff may read
   the list and the card; the buttons are disabled for them with the reason
   shown.
3. Exact `Origin` against `ALLOWED_ORIGINS`, the check the WebSocket
   handshake already does (`routes/runs.ts:407-411`), and
   `Content-Type: application/json`. `request-guard.ts` enforces neither
   (it checks method, size and rate; CORS headers in `index.ts:38-61` shape
   the *response*, they do not stop a cross-site POST from arriving). The
   SameSite=Lax cookie is the real cross-site defence; this is the belt to
   its braces, and it is what the routines contract asked of new mutation
   routes.
4. Rate: the path joins the `agentRun` classifier in `request-guard.ts:129`
   (`AGENT_RUN_BURST`, 10/60 s, fail-closed). A decision resumes a paid
   agent run, which is exactly what that brake is for.
   `RUNTIME_MUTATION_BURST` at 3/60 s would refuse an owner who denies one
   approval and approves the next.
5. `applyRuntimeApprovalDecision(env, businessId, { surface: 'web',
   approvalId, userId }, decision)`.

Answers:

| outcome | status | body |
|---|---|---|
| `accepted` | 200 | `{ ok: true, status: 'applied', approval }` |
| `duplicate` (same decision again) | 200 | `{ ok: true, status: 'already_applied', approval }` |
| `invalid` (expired, decided otherwise, unknown, not pending) | 409 | `{ ok: false, code: 'APPROVAL_NOT_PENDING' }` |
| `unavailable` (runner unreachable; row released to `pending`) | 503 | `{ ok: false, code: 'RUNTIME_UNAVAILABLE' }`, `Retry-After: 2` |

Every response is `Cache-Control: private, no-store`. After `accepted` the
route publishes nothing: the consumer publishes `working` when it leases
the resume (`consumer.ts:984-989`), and the durable state is what the card
polls if the socket is gone.

### Idempotency and the races

- **Two clicks.** The second claim finds `status: 'approved'` with the same
  decision → `duplicate` → 200. Approve then deny → `invalid` → 409; the
  card reloads the row and shows what stood.
- **Two tabs.** Same as two clicks; the advisory lock in
  `claimRuntimeApprovalDecision` (`tasks.ts:647`) serialises them.
- **A click racing the timeout.** Here the existing code has a hole, and
  it is Telegram's too. The consumer leases the resume at `available_at`
  (= `expiresAt`), reads the row as `pending` and calls
  `expireRuntimeApproval` — which accepts `pending` **or** `deciding`
  (`tasks.ts:761-762`). If a click claimed the row (`deciding`) and the
  runner already accepted `approve` between that read and that write, the
  expiry marks it `expired/deny`, the click's `completeRuntimeApprovalDecision`
  finds no `deciding` row and reports `unavailable`, and the consumer then
  sends the runner `deny` for a request it has resolved `approve` — a 409
  from `resolveApproval` (`server.mjs:1827-1829`), which `RunnerClient.decideApproval`
  turns into a throw (`runner-client.ts:254-273` accepts only 200), which
  retries until the attempts are gone. Hermes, meanwhile, ran the tool.
  Fix: `expireRuntimeApproval` accepts `pending` only. A `deciding` row at
  expiry is left to the branch that already exists for it
  (`consumer.ts:1192-1235`): replay the stored decision to the runner, which
  is idempotent by `requestId`, then complete. The window is a few hundred
  milliseconds today; a web surface with a visible countdown makes
  "click at the last second" the normal case, so this lands in step 0.
- **Runner unreachable on click.** `releaseRuntimeApprovalDecision` puts
  the row back to `pending`; the card says "couldn't reach your agent, try
  again"; the deadline is unchanged. If the sprite is merely paused
  (section 3), the decision request is what wakes it.
- **Decision after the run is gone.** The runner answers 404/409 (task
  terminal) → `unavailable` → the row is released → next lease expires it.
  The card shows the run's final state from `GET /api/runs/:id`.

## 3. The timeout

### What a parked run actually costs

Sixty seconds (`HERMES_APPROVAL_WAIT_SECONDS`) is a phone-notification
number. For someone reading a chat it is short; for someone who stepped
away it is nothing. The question is what a longer wait costs, and the
answer is not "sprite time".

- **The sprite, probably nothing.** With `AISAR_KEEPALIVE_GRACE_HOURS = "0"`
  the worker sends no hold. When the consumer parks the task it releases
  the lease and closes the runner's SSE stream; `docs/reply-latency.md:171-178`
  measured a sprite going `running → warm` within 15 s of its last activity,
  and only live activity — an exec, a TTY, an open TCP connection — keeps
  it awake. A Hermes process blocked on an approval wait has none. So the
  sprite freezes, billing stops, and the decision request (or the expiry
  deny) wakes it in 100-500 ms. **Whether Hermes's own 90 s timer advances
  through that freeze is unknown**: a frozen process's monotonic clock may
  or may not jump on restore. It matters both ways — if the timer does not
  advance, the worker's expiry is the only thing that ends a wait, and a
  longer worker wait is safe on the Hermes side without a release; if it
  does, any worker wait above 90 s is decided by Hermes first. Measured on
  the dev sprite before anything in this section changes.
- **The worker's clocks, everything.** The reservation deadline is
  absolute: `deadlineAt = reservation.startedAt + runSeconds`
  (`run-task.ts:222`), 300 s for quick (`QUICK_RUN_CAP_SECONDS`, `:42`) and
  the budget's `max_run_seconds` (900) for deep, and `runtimeUsageDeadline`
  cuts the observation slice at the same instant. A minute of waiting is a
  fifth of a quick reply's life. The runner's `TASK_AGE_LIMIT_MS` (15 min
  quick, 90 min deep) is the outer wall. None of these can tell waiting from
  working, because none was built to.
- **The business, all of it.** The `approval_wait` predicate blocks every
  other lease for the business. The owner's next chat message — or a
  customer's Telegram message — is admitted, sits behind the parked task
  ("Finishing your previous message first…", `inline-slice.ts:52-53`, then
  the 30 s safety net), and runs after the decision or the expiry. A
  five-minute wait is five minutes in which the business's agent answers
  nobody.

### The decision

**Keep 60 s for both surfaces, and make the expiry truthful on the web.**
Not because 60 s is right, but because the three things that would let it
be longer — a clock that excludes the wait, a Hermes timeout raised in the
bundle, and a product answer to "the business is blocked" — are each real
work, and none is needed to fix the reported problem, which is that the
web chat cannot hold an approval at all. Concretely:

- The card shows a countdown from `expiresAt` and says what happens at
  zero: "If you don't decide, Jentera will continue without running this."
- At expiry, the existing resume path denies with `reason:
  'approval_timeout'` and `approval.rejected` on the trace; the web arm of
  `settleApprovalBubble`'s job is one live `status` line ("Approval timed
  out — continuing without the tool") and the run finishes with Hermes's
  own answer, which will say it could not do the thing. The owner asks
  again. Nothing was run; nothing is pretended.
- The one-message-behind case is told the truth too: the waiting status
  becomes "Waiting for your approval on the previous message" when the
  block is an `approval_wait`, not a running reply.

**Deferred: a longer web wait**, as its own step (step 3 below) with
preconditions, so nobody quietly bumps the constant: (1) the dev-sprite
measurement above; (2) `runtime_usage.waited_ms`, accumulated by
`completeRuntimeApprovalDecision`/`expireRuntimeApproval` from the park
time, added to `deadlineAt` and `runtimeUsageDeadline` so the wait is not
charged as work — a migration, and a budget rule; (3) `approvals.timeout`
raised in `configure-model-provider.py` to at least the new wait plus 30 s,
which is a release; (4) a decision, written down, that a business may be
blocked for that long, with the blocked status visible. Rejected
alternatives, so they are not reopened by accident: *parking the run and
denying Hermes now, then executing the approved command from the control
plane later* turns a live approval into a deferred action, needs a new
runner execution primitive, and breaks the adapter rule ("an adapter reads
and reasons; it never sends"); *pre-empting a parked approval with the
owner's next message* is a guess about intent dressed as a rule.

## 4. What the owner is actually approving

### What reaches the card, and what does not

The runner is Hermes's only event subscriber and is deliberately narrow.
From `approval.request` it keeps `request_id` (32 hex), a tool name and
Hermes's `description`, and drops "approval commands/patterns, tool
results, full arguments" (`server.mjs:1612-1620`, `1741-1757`). The
`description` is passed through `safeToolPreview` (`server.mjs:2091-2097`):
control characters stripped, `Bearer …` and `api_key=…`/`token=…`/
`secret=…`/`password=…` redacted, cut at 1,000 bytes. The tool name comes
from `approvalToolName` (`:2114-2125`): Hermes's event has no tool field,
so a pattern hit or a `command` becomes `execute_code`, a plugin rule its
plugin name, else `tool`. Hermes itself redacts credentials from the
command before emitting (`gateway/platforms/api_server.py:5066-5074` at the
pin).

So the owner sees **Hermes's description of what it is about to do, with a
coarse tool label — not the raw arguments**. For a terminal command the
description carries the flagged command; for an `execute_code` script it is
Hermes's fixed sentence ("execute_code script execution. The script can
spawn subprocesses…", `tools/approval.py:3816-3820`) and the owner cannot
see the script. The plan does not change what crosses the runtime boundary
— widening it means full arguments travel through the worker and into
Postgres, and that is a separate decision with its own redaction work.
What it does is refuse to overstate: the card labels the text "What Jentera
says it will run", shows the tool label separately, and when the text hit
the 1,000-byte cap shows "(cut short — N more characters not shown)" so a
truncated command is never approved as if it were whole. That number is
available only if the runner reports the original length alongside the
preview; it is a one-field addition to the approval event and to
`RunnerApprovalRequest` (`runner-client.ts:441-446`), and it is in step 1.

### Rendering, as data

The message is model output and may contain instructions aimed at the
reader ("this is safe, approve it"). The card renders it in a `<pre>` as
text — React escaping, no markdown, no autolinks, `white-space: pre-wrap`,
`overflow-x: auto` — inside a bordered box whose heading is the product's,
not the model's. Approve and Deny are plain buttons outside the box with
Deny as prominent as Approve, the rule `ApprovalInbox` already follows
("offers declining as prominently as approving",
`ApprovalInbox.test.tsx:78`). The countdown, the "runs on Jentera's cloud
agent, not on your computer" line and the tool label are the product's
text and sit outside the untrusted box. Nothing on the card is derived from
the message except the message. EN and BM strings go in
`app/src/i18n/pages.ts` beside `ask.reply.*`.

## 5. Which tools are gated — a mechanism and a habit

What is real, at the pin:

- **A gate exists and is a mechanism.** `terminal` runs every command
  through `check_all_command_guards` (`tools/terminal_tool.py:281-286`):
  a hardline blocklist that yolo cannot bypass, the owner's
  `approvals.deny` globs, a `sudo -S` guard, then `DANGEROUS_PATTERNS`.
  `execute_code` is gated as a whole script in gateway contexts
  (`check_execute_code_guard`). A match, in `manual` mode, is an
  `approval.request` the runner relays and the worker parks. That part is a
  guarantee.
- **The gate is narrow, and under `smart` it is narrower.** Package
  installs, `curl` without a pipe to a shell, `wrangler`, `gh auth`,
  writes outside the listed credential paths, most network calls — none
  match. Under `mode: smart`, a match is first shown to the auxiliary
  model, whose instructions name "package installs" and "git operations" as
  things to APPROVE; only ESCALATE reaches a human. Whether the fleet is
  in `smart` or `manual` is open question 1.
- **The prose habit is a prompt rule, and only that.** `ask.ts:208-210`.
  It produces the behaviour the owner complained about, and it is not a
  guarantee of anything: a model that skips the confirmation runs the
  command. It is also broader than the gate in the useful direction — it
  covers "sending a message, purchasing, publishing, changing an account",
  which no shell pattern will ever catch.

What to change, and what each change does and does not buy:

1. **`approvals.mode: manual`, pinned in `configure-model-provider.py`
   beside `timeout`** (one release). Every `DANGEROUS_PATTERNS` match
   reaches a human. This is the difference between "an LLM decided a
   `git push --force` was fine" and "the owner did". It is also why the
   web surface must exist first: on the fleet today, more approvals means
   more web runs failing at `consumer.ts:1503`. Cost: more prompts on
   Telegram for the commands the aux model was waving through; the list is
   the one in `tools/approval.py`, and none of it is routine business work.
   Correct the 20 s comment in the same commit.
2. **Rewrite the prompt rule** (a deploy). From "obtain clear confirmation"
   to: *do not ask permission in prose for an action you can perform on
   this machine; perform it, and Jentera's approval gate will ask the owner
   where it must. Ask a question only when you need information you cannot
   obtain — a credential, a choice between genuinely different outcomes —
   and then ask for exactly that. Before an external action that affects a
   customer, money or an account, the gate applies; do not bypass it.*
   Plus the "cloud machine, no interactive logins" sentence from earlier.
   This is still a habit. It is a better habit only because change 1 made
   the gate a guarantee for the dangerous class, and the "affects a
   customer, money or an account" clause still rests on the model.
3. **Widen the gate for this deployment, by configuration in the bundle,
   not by patterns in a plan.** `approvals.deny` globs are the wrong tool
   (they block unconditionally). What is wanted is "ask", and Hermes's
   `DANGEROUS_PATTERNS` is code at the pin. Two honest options: (a) a
   plugin rule — `approvalToolName` already understands
   `plugin_rule:<name>` (`server.mjs:2120-2122`), so Hermes has a plugin
   seam for approval rules; whether the pinned tag lets a plugin *add ask
   rules* for terminal commands is open question 2; (b) a reviewed patch to
   `DANGEROUS_PATTERNS` applied by `patch-hermes-dependencies.mjs`, the
   mechanism the reviewed dependency pins already use — a package-install
   rule (`npm i -g`, `pip install`, `apt`, `brew`), a credential-touching
   rule (`login`, `auth`, writes under `~/.config`, `~/.wrangler`,
   `~/.cloudflared`), a remote-fetch-and-run rule wider than `| sh`. Either
   is a release. Neither makes `wrangler login` *work*; both make it ask.
   The plan recommends (a) if the answer to question 2 is yes and (b)
   otherwise, and either only after 1 and 2 have been in service for a
   week, because each new "ask" is a new 60 s block on the business.

What no change here buys: a rule the model does not trigger runs unasked.
The gate is a floor under the prompt, not a ceiling over the model. The
plan says that plainly so nobody sells "approve and run" as "nothing runs
without approval".

## 6. Telegram and web must not diverge — enforced by a test

`worker/test/runtime-approval-surfaces.test.ts`, on the existing harness
(a real Postgres, arrange as owner, assert as `aisar_app`, the fake runner
from `runtime-consumer.test.ts`). One scenario, run once per entry in a
list `['telegram', 'web']`; a third surface is added to the list or is not
finished — the same shape as `test/runtime.test.ts` over adapters.

For each surface: enqueue a `run` (with a Telegram hint or without), have
the fake runner emit an approval event, drive `handleRuntimeQueueMessage`,
and assert: the task is `resume`/`queued` with `result.approval` in
`pending` carrying the surface; the run is `needs_approval`; the trace has
`approval.requested` with `tool`, `message` and `surface`; the stream
publish carried `needs_approval` with the approval id and nothing else; the
lease predicate refuses a second task. Then decide through the surface's
own entry — `handleRuntimeApprovalCallback` with a callback shaped as
`routes/connect.ts:347-368` requires, or `handleRuntime` with a session
cookie, the exact Origin and a JSON body — and assert: the fake runner
received exactly one `POST /v1/tasks/:id/approval` with the row's
`requestId` and the decision; the row is `approved`; the run is `working`;
the trace has `approval.granted` with `surface` and, for web, `decidedBy`.
Then: the same decision again → no second runner call, `duplicate`; the
opposite decision → `invalid`, row unchanged; expiry with no decision →
`expired`, `approval.rejected` with `approval_timeout`, runner told `deny`
once; a `deciding` row at expiry → `expireRuntimeApproval` refuses, the
stored decision is replayed. Finally, a two-tenant check: business B's
owner posting business A's approval id gets 404 and A's row is untouched.

Two structural assertions beside the scenario: `routes/*.ts` contain no
call to `decideRuntimeTaskApproval`, `claimRuntimeApprovalDecision` or
`completeRuntimeApprovalDecision` (a source-reading lint, the pattern
`extract-endpoint.test.ts` uses), and `applyRuntimeApprovalDecision` is
the only caller of `RunnerClient.decideApproval` outside the consumer's
timeout branch.

## 7. The older approval table

`approval` (connector proposals; `routes/repo.ts`, `ApprovalInbox`) and
`runtime_task.result.approval` (Hermes tool gates) stay separate. They
differ in every way that matters: who performs the action (the worker vs
the agent), whether the owner can edit it (the draft vs nothing), whether
it has a deadline (no vs 60 s), and what a decision does to the run (ends it
vs resumes it). Unifying the storage would mean one of them lying about
one of those.

What is unified is the **surface**: one "Waiting for you" list, one card
component with two variants, one `needs_you` count, and the task page
rendering whichever kind the run holds. The demo path (`ActivityView`'s
`demo` branch) is untouched and shows no runtime approvals — a signed-out
visitor has no agent, and per CLAUDE.md a demo figure shown to a real
owner is a lie.

## 8. What this does not fix, and what it makes worse

Not fixed:

- **`wrangler login` itself.** It will never work on the sprite. The fix is
  the agent asking for a token, which is the prompt sentence in section 5,
  which is a habit.
- **Prose questions for anything the gate does not catch.** After section
  5, the agent should act rather than ask for ungated actions — which
  means those actions run with no approval at all. That is today's
  behaviour made explicit, not a new exposure, but an owner who reads
  "approve and run" as "everything asks" is wrong and the card copy does
  not say otherwise.
- **The owner can't see the script.** `execute_code` approvals show
  Hermes's fixed sentence. Widening the runtime boundary is its own plan.
- **Reload loses the chat card.** The list and the task page carry it;
  the transcript does not, until someone does the re-insertion.
- **Telegram's 60 s.** Same clock, same reasons.
- **One approval blocks the business.** By design, and now visible.

New risks, each with what bounds it:

- **A session-authenticated route resumes a paused agent run and lets it
  execute a command.** Bounded by: owner role; the opaque id; `requestId`
  never taken from the request; the runner's FIFO binding; Hermes's own
  live-session check (`approval_not_active` → 409); exact Origin + JSON
  content type; SameSite=Lax; `AGENT_RUN_BURST`. A stolen owner session
  could already `cancel`, `provision`, `upgrade` and `DELETE` the runtime
  and send customer messages through the connector approvals; this adds
  "say yes to something the agent already proposed" to that list. It does
  not add "make the agent do X".
- **A button makes approving easy, and the message is the model's.** A
  prompt-injected agent proposes something harmful with a reassuring
  description; a hurried owner clicks. Bounded by rendering the text as
  untrusted data, Deny as prominent as Approve, the truncation notice, the
  tool label from the runner not the message, and the fact that the
  hardline list blocks the catastrophic class regardless. Not bounded:
  everything in `DANGEROUS_PATTERNS` that is merely dangerous. That is
  what the owner is being asked to judge, and the card must not pretend
  the judgement was made for them.
- **`mode: manual` means more prompts and more blocked minutes.** Bounded
  by the list being what it is and by shipping it after the web surface,
  as one release, with the playbook's rollback.
- **A wider gate (section 5, change 3) means more 60 s blocks.** Bounded by
  doing it last, after a week of numbers on how often the gate fires.
- **A new lifecycle type in the stream.** Bounded by the object validating
  the id, storing nothing else, and the client ignoring what it does not
  know — as it does today for any unknown type.

## Acceptance gate

Step 0 — the web chat can hold an approval (worker deploy, no UI)

- [ ] `RuntimeApproval` is surface-tagged; `runtimeApprovalFromResult`
      accepts the old flat Telegram shape and the new one, refuses a
      `web` row carrying Telegram fields and a `telegram` row missing them
      (`runtime-task.test.ts`).
- [ ] A run without a Telegram hint that receives an approval event parks
      (`resume`, `result.approval.surface = 'web'`), the run is
      `needs_approval`, the trace carries `approval.requested` with `tool`,
      `message`, `surface`, and **no attempt is consumed**
      (`runtime-approval-surfaces.test.ts`, the `web` entry; the same test
      against `main` reproduces today's throw and the five attempts).
- [ ] At expiry the web row denies with `approval_timeout`, the run
      resumes and completes with the agent's answer; the stream saw
      `needs_approval` then `working` then `completed`.
- [ ] `expireRuntimeApproval` refuses a `deciding` row; a `deciding` row at
      expiry is replayed, not expired, for both surfaces
      (`orchestration.test.ts:541` extended).
- [ ] `run-stream-events`/`RunStream`: `needs_approval` is stored with a
      validated `approvalId` and replayed; a malformed id is dropped; the
      publish body carries no other approval field (`run-progress.test.ts`).
- [ ] Deployed; on the canary business, a `terminal` command matching a
      dangerous pattern from the web chat produces a `needs_approval` run,
      a 60 s wait, and a completed run whose answer says the command was
      not run. The run id and the trace pasted here with the date.

Step 1 — surface and decision (worker deploy + Pages deploy)

- [ ] `applyRuntimeApprovalDecision` exists; `handleRuntimeApprovalCallback`
      calls it; the source lint over `routes/*.ts` passes.
- [ ] `POST /api/runtime/approvals/:id/decide`: 401 without a session,
      404 for another tenant's id and for an unknown id (identical
      bodies), 403 for `staff`, 403 for a wrong `Origin`, 415 for a
      non-JSON body, 429 through `AGENT_RUN_BURST`; 200 `applied`, 200
      `already_applied`, 409 `APPROVAL_NOT_PENDING`, 503
      `RUNTIME_UNAVAILABLE` with the row back to `pending`
      (`routes.test.ts`, as `aisar_app`, two tenants).
- [ ] `GET /api/runtime/approvals` and `/:id` answer under RLS and show a
      member the same row an owner sees; `GET /api/runs/:id` carries
      `approvalId` while `needs_approval` (`run-ask-route.test.ts`).
- [ ] The surfaces contract test passes for `['telegram', 'web']`
      including duplicate, opposite, expiry, replay and cross-tenant cases.
- [ ] Runner: the approval event and `RunnerApprovalRequest` carry the
      original description length; the client refuses a forged one
      (`runtime-runner.test.ts:901` block extended). Ships as part of the
      next release; the worker tolerates its absence until then.
- [ ] App: `useAsk` projects `needs_approval` with the id and keeps
      streamed text (`useAsk.test.tsx`); `AskReply` renders the card in that
      state and the text as escaped `<pre>` with Deny as prominent as
      Approve, the countdown, the truncation notice and the "cloud agent,
      not your computer" line (`AskReply.test.tsx`); a click calls
      `decideRuntimeApproval` once, disables both buttons, and a 409 reloads
      the row rather than pretending; `ActivityView`'s real branch lists
      runtime approvals above connector approvals and never in the demo
      branch; `TaskDetailView` renders the card for a runtime approval and
      the inbox link for a connector one; `needs_you` counts both.
- [ ] EN and BM strings present; `prefers-reduced-motion` respected on the
      countdown; buttons labelled for assistive tech.
- [ ] Deployed; on the canary business, a dangerous-pattern command from
      the web chat shows the card within the first token's latency, an
      Approve runs it and the answer reflects the result, a Deny ends with
      an answer that says so, and a reload mid-wait shows the same approval
      under "Waiting for you". Run ids pasted here.

Step 2 — the gate becomes a guarantee for the dangerous class (one release, one deploy)

- [ ] Open question 1 answered on the canary sprite and recorded here
      (`fleet-exec.sh` is read-only: `grep -A4 '^approvals' ~/.hermes/config.yaml`).
- [ ] `configure-model-provider.py` pins `approvals.mode = "manual"` and
      keeps `timeout = 90`; the 20 s comment corrected; `runner/test`
      covers the pinned block.
- [ ] Shipped via `ship-runtime.sh`; `fleet-verify.sh` green; on the
      canary, a `DANGEROUS_PATTERNS` command that `smart` used to approve
      now produces a card on the web and a keyboard on Telegram.
- [ ] `HERMES_AGENT_PROMPT` rewritten per section 5 (2), including the
      cloud-machine sentence and without naming the hosting stack;
      `ask.test.ts` (or the nearest existing prompt test) asserts the
      sentences are present. A week of runs after: the number of replies
      that end in a permission question, before and after, from
      `stats.sh runs`, pasted here.

Step 3 — a longer web wait (only if wanted; nothing by default)

- [ ] Dev-sprite measurement: does Hermes's approval timer advance through
      a warm pause? Method and number recorded here.
- [ ] If pursued: `runtime_usage.waited_ms` migration and apply script;
      `deadlineAt` and `runtimeUsageDeadline` exclude it; `approvals.timeout`
      raised in the bundle to wait + 30 s; the blocked-business status line
      names the approval; `HERMES_APPROVAL_WAIT_SECONDS` becomes
      per-surface. Contract test extended with the wait excluded from the
      cap.

Throughout

- [ ] No `fleet-exec.sh` write at any step.
- [ ] CLAUDE.md "Backend" gains a paragraph: runtime approvals have one
      decision path and two surfaces; the stream carries the id, Postgres
      the content; the gate is `DANGEROUS_PATTERNS` under `manual`, and the
      prompt rule is a habit, not a guarantee.

## Delivery order

1. Step 0 this week. A day: the shape change, the branch, the expiry fix,
   the stream type, the tests. Deploy, then wait for one real approval on
   the canary or provoke one. Independently valuable: the web chat stops
   failing runs on approvals, the trace becomes truthful, and the
   click-racing-expiry hole is closed for Telegram too. Reversible by
   redeploying the previous worker.
2. Step 1 in two deploys: worker first (the routes are inert without a
   caller), then Pages. Two to three days. The runner's length field rides
   the next release whenever that is; nothing waits on it.
3. Step 2 after a week of step 1 in service, so the first effect of
   `manual` is more cards, not more failures. One release, then the prompt
   deploy the same day.
4. Section 5 change 3 (a wider gate) only with a week of numbers on how
   often the gate fires and how long the blocks are, as its own short
   plan.
5. Step 3 is a measurement first; the code only if the measurement and the
   product both say yes.

## Open questions

Stated so nobody mistakes a guess here for a fact.

1. **Is the fleet in `smart` or `manual`?** `configure-model-provider.py`
   does not set `mode`; the code default when the key is absent is
   `manual`; the installer's default config says `smart`. Which one a
   sprite's `config.yaml` holds decides whether an LLM is currently
   approving dangerous commands on the owner's behalf. Read it on the
   canary before step 2.
2. **Can a Hermes plugin add "ask" rules for terminal commands at the
   pin?** `approvalToolName` already parses `plugin_rule:<name>`, so the
   event shape exists; whether the pinned tag exposes a plugin API that
   raises them for arbitrary commands is unverified. Decides (a) versus
   (b) in section 5 change 3.
3. **Does Hermes's approval timer advance through a warm pause?** Decides
   whether a longer worker wait needs a release. Measured on the dev sprite
   in step 3, or earlier if cheap.
4. **Does `retryRuntimeTask` persist `stream_seq`?** The reading in
   "checked against the code" assumes the retry replays the approval event
   from the runner's history. If the seq is persisted past it, the retry
   would instead see the run continue after Hermes's own auto-deny and the
   failure mode would differ. Either way the run does not park; step 0's
   reproduction settles it.
5. **What does Hermes send as `description` for a `terminal` match?** The
   plan assumes the flagged command, redacted. If it is only the pattern's
   description ("recursive delete"), the card shows less than section 4
   promises and the runner would need to relay the redacted `command`
   field (`api_server.py:5072-5074` already redacts it) — a boundary
   widening this plan does not authorise on its own.
