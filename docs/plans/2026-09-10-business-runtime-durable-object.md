# BusinessRuntime: one Durable Object per business replaces the reply queue

Status: stress-tested 2026-09-10 and **not proceeding now**. Five independent
reviews (durability, platform limits and cost, security and tenancy, product
semantics and migration, devil's advocate) found six blocking defects in the
draft below and a cheaper fix for the measured problem. The corrected
contract and the verdict are in "Stress test" at the end; the draft is kept
as written so the corrections read against it. Nothing here is built.

## Why

A reply today crosses: intake (placed HTTP handler) → Postgres task row →
Cloudflare Queue → queue consumer → runner on the sprite → Hermes → consumer
relay → RunStream Durable Object → browser (or Telegram edit). Measured on
2026-09-10 (Workers Logs, `[runtime-latency]`):

- The queue consumer runs far from Neon. `placement.region` covers HTTP
  invocations only. Every tenant transaction cost it 1.1 to 2.3 s; the same
  transaction from the placed intake costs 60 to 100 ms.
- Queue delivery is a steady 4.4 to 4.7 s.
- Hermes itself admits a run in 50 ms and answers "yob" in 4 s.
- Net: 12 to 16 s before Hermes was asked. After moving the first 20 s of
  every run into the intake (`src/runtime/inline-slice.ts`, same day), 2.4
  to 3.9 s. But that is a patch: `waitUntil` allows 30 s, so long runs still
  hand over to the far consumer, a message that arrives behind another reply
  polls for the slot, and the queue is kept as a delayed safety net.

The machinery that makes the queue safe is most of `runtime/consumer.ts`
(2,423 lines): lease claim with an advisory lock, lease heartbeats, dead-owner
recovery, orphan reclaim through the runner, a transactional outbox for queue
sends, a lease-horizon watchdog, observation slices with `stream_seq` resume,
a recovery cron, and Telegram-specific admission. All of it exists to give one
guarantee — one reply per business at a time, and no reply lost when the thing
running it dies — on top of a stateless, far-away consumer.

A Durable Object is that guarantee as a primitive.

## The object

`BusinessRuntime`, one instance per business, `idFromName(businessId)`,
created with `locationHint: 'apac-se'` (hints are best effort; the intakes are
already placed in Singapore, which is where the first request comes from).
SQLite-backed.

It owns, for its business:

1. **Admission.** Both intakes (app `POST /api/runs/ask`, Telegram webhook)
   call `submit()` and return. The object creates the `run` and the
   `work_record` placeholder in Postgres, appends the message to its own
   ordered inbox, and answers with `{ runId, position }`. Idempotent on the
   caller's dedupe key (request id, or Telegram connection+chat+message).
2. **The slot.** The object processes its inbox one message at a time. A
   Durable Object handles one event at a time by construction; "one reply
   per business" needs no lease, heartbeat, or advisory lock.
3. **Dispatch.** readyz through the Sprites edge, budget reservation in
   Postgres, `POST /v1/tasks` on the runner with the tool grant and the
   deadline, exactly as `run-task.ts` does today.
4. **The relay.** Reads the runner's event stream and forwards it: live
   events to `RunStream` (browser), text and status edits to the Telegram
   bubble, `agent.tool` and lifecycle rows to Postgres. Runs for the whole
   reply. Keeps `lastSeq` in its storage so a resumed relay skips the
   runner's history replay.
5. **Approvals.** A native Hermes approval pauses the relay; the decision
   arrives by `decide()` from the Telegram callback route; the timeout is an
   alarm. No `resume` task, no lease release and re-lease.
6. **Cancellation.** `cancel(runId)` stops the runner's task and settles the
   rows, from the same place that started it.
7. **Deadlines.** The quick cap (300 s) and the deep budget (900 s) are
   alarms. The runner enforces its own copy of the deadline as today.
8. **Completion.** Status load, usage finalisation, work record, Telegram
   final edit, `completed` lifecycle event — then the next inbox message.
9. **Recovery.** Every await that can hang has an alarm behind it. If the
   object is evicted mid-relay, the alarm re-enters, finds `active` in
   storage, and re-attaches from `lastSeq`. If the runner no longer knows
   the run, the object marks the run failed and moves on.

What it never does: write anything a runtime could use to act directly. The
adapter reads and reasons; the object is the control plane (CLAUDE.md,
"Where work runs"). Runner and Hermes keys stay in Postgres under the
credential key and are decrypted per dispatch, not cached in object storage.

### Contract (RPC methods on the stub)

```
submit(input: {
  channel: 'app' | 'telegram';
  dedupeKey: string;
  question: string;             // the user turn, exactly as typed
  responseMode: 'quick' | 'deep';
  sessionId: string;
  requestedBy?: string;         // app user id
  telegram?: { connectionId; chatId; messageId; from };
  requestedAtMs: number;
}) → { runId: string; position: number; accepted: boolean }

decide(input: { runId; requestId; decision: 'approve' | 'deny'; by }) → { ok }
cancel(input: { runId }) → { ok; state }
status() → { active: { runId, startedAt, stage } | null; waiting: number }
```

Model, facts, recent work and the instructions are built by the object at
dispatch time (`retrieveHermesContext`, `prepareHermesAgent`), not by the
caller, so a message that waited ten minutes still gets fresh context.

### Storage (SQLite in the object)

```
inbox(seq PRIMARY KEY, run_id, submitted_at, payload JSON)
active(run_id, task_id, remote_run_id, started_at, stage, last_seq,
       deadline_at, approval JSON NULL)               -- at most one row
settled(dedupe_key PRIMARY KEY, run_id, settled_at)   -- 24 h, for idempotency
```

Postgres remains the system of record: `run`, `run_event`, `work_record`,
`runtime_usage`, facts, approvals visible in the app. The object writes
through. `runtime_task` stays only for fleet lifecycle work (provision,
upgrade, delete), which keeps the queue.

### Execution shape

`submit()` must return in well under a second, so the relay cannot run
inside it. The object sets an immediate alarm and runs the reply inside the
alarm handler. An alarm handler may run 15 minutes; the deep budget is 900 s,
so at 13 minutes the relay checkpoints `last_seq`, re-arms the alarm, and the
next invocation re-attaches. Quick replies never reach that point.

Other calls (`submit`, `decide`, `cancel`, `status`) are handled while the
relay awaits the network; the object's input gate only serialises storage
operations. A new message therefore lands in the inbox immediately and its
`position` is exact.

### Where things stay the same

- Sprites, the runner, Hermes, the release bundle, `ship-runtime.sh`.
- `RunStream` (browser fan-out) — fed by the object instead of the consumer.
- `run-task.ts` dispatch (readyz attestation, tool grant, deadline) —
  called from the object.
- Telegram delivery helpers (bubble create/edit/final, typing) — called from
  the object.
- Budgets, the credit-cap notice, conversation-versus-work classification.

### What is deleted, at the end

`consumer.ts` reply path: lease claim, heartbeats, `recoverDeadRuntimeTaskLease`,
`probeOrphanedRun`, `reclaimRuntimeTaskLease`, the outbox and its drain, the
lease-horizon watchdog, observation slices, `stream_seq`, Telegram intake
admission, `wakeNextRuntimeTask`; `inline-slice.ts`; `sweepRuntimeTaskRecovery`
for reply tasks; migration 025's column. Roughly 2,000 lines and four
mechanisms.

## Rollout

1. Build the object behind `AISAR_BUSINESS_RUNTIME_IDS` (per-business
   allow list, like routines). Intakes route listed businesses to
   `submit()`, everyone else to today's path.
2. Kitakod Ventures first, for a week. Compare `reply-latency.sh db 7` for
   the two paths.
3. Approvals and Telegram bubbles move in, behind the same flag.
4. Fleet-wide. Then delete the consumer's reply path and the tables' lease
   columns.

Rollback at any step: remove the business from the list; in-flight objects
finish their inbox and idle.

## Open questions for the stress test

1. Does an outbound `fetch` of the runner's SSE stream keep the object alive,
   or only `connect()` and outbound WebSockets (June 2026 changelog)? If only
   those, the runner's event stream becomes a WebSocket, or the relay runs
   in an alarm handler as described and the question is moot.
2. What happens to an in-flight relay when the object's data center degrades?
   Objects do not relocate. Is "that business's replies stall until Cloudflare
   recovers the object" acceptable, given the sprite is single-homed anyway?
3. Exactly-once on the Postgres side: the object can crash between a Postgres
   write and its own storage commit. Which writes must be idempotent, and is
   `run_id` enough of a key everywhere?
4. Is the per-business inbox the right fairness for a team of several owners
   messaging one business?
5. Cost at 12 businesses and at 500.
6. Test strategy: `@cloudflare/vitest-pool-workers` for the object with the
   Postgres container, or keep the object thin and test the pieces it calls?

## Stress test (2026-09-10)

Five reviewers, each with a different lens, each required to bring file:line
or documentation evidence and a concrete failure scenario per finding. What
follows is the consolidated result; duplicates across reviewers are merged.

### Verdict

Do not build the object now. The measured problem was database distance from
the queue consumer, and a placed HTTP handler fixes that deterministically;
a location-hinted object that never relocates fixes it only probabilistically
(hints are best effort; `placement.region` covers fetch handlers only, not
objects). The reply-path code the object would delete is about 500 of the
consumer's 2,400 lines; the rest — Telegram admission and bubbles, approvals
against the runner, flood deferral, budget and usage, attempt grading,
wedged-runner escalation — exists for reasons that do not change and would
be re-hosted inside a class with a harder concurrency model. Parity was
estimated at 5 to 7 engineer-weeks, not 1 to 2, with the test harness
(`@cloudflare/vitest-pool-workers` plus the Postgres container plus alarm
control) as the largest unknown.

What to do instead, in order:

1. **Placed slice for the consumer (Alternative A).** The queue consumer
   becomes a thin holder: it calls an internal, secret-guarded endpoint on
   the worker's own hostname — `POST /internal/runtime/slice` — with the
   queue message, waits up to 13 minutes, and acks or retries from the
   JSON result. The endpoint runs `handleRuntimeQueueMessage` exactly as
   today, but in a placed fetch invocation next to Neon. About 100 lines;
   every consumer test survives unchanged; together with the inline first
   slice already shipped, every path becomes near-database. **Spike first:**
   confirm a self-request to `api.jentera.ai` (or a self service binding)
   is placed, by returning `request.cf.colo` from the endpoint and logging
   it from the consumer. If neither is placed, the alternative is dead and
   this document's object comes back.
2. Re-run `reply-latency.sh db 7` after a week. If deep runs and Telegram
   are within a second of the app quick path, stop here.
3. Revisit the object only for a reason placement cannot give: a
   per-business brain that also owns routines, scheduled work and
   multi-owner fairness. Build it from the corrected contract below, not
   from the draft.

### Blocking defects in the draft

1. **Tenant binding is unstated.** The RPC inputs carry `connectionId`,
   `chatId`, `requestedBy`, `by` from the caller and nothing binds them to a
   verified tenant. Correction: the object's business id is `ctx.id.name`
   and the only value ever passed to `withTenant`; no RPC input names a
   business; the object exposes no `fetch()` route; stubs are obtained only
   through one helper that takes a resolved `TenantIdentity` or the verified
   webhook access (`routes/connect.ts` `telegramWebhookAccess`), never a
   string; `by`/`requestedBy` are set by the route from verified identity.
2. **Write fencing goes with the leases.** Every reply write today is
   conditioned on `status='leased' and lease_token=…` (`runtime/tasks.ts`),
   which is what makes an evicted or duplicated relay harmless. The draft's
   13-minute checkpoint plus "the alarm re-enters and re-attaches" allows two
   relays on one run (the old SSE reader still draining) both writing
   `agent.tool`, usage and terminal rows. Correction: a per-attach fencing
   token stored in the object and in Postgres; every write conditioned on
   it; completion by compare-and-set on `run.status`
   (`update run … where status in ('working','needs_approval') returning`);
   a partial unique index on `work_record(run_id)`; `finishRun` and
   `recordWork` made idempotent on `run_id`.
3. **The reply's `runtime_task` row cannot be dropped.** Five live readers
   key on it: `runtime_usage.runtime_task_id` is a NOT NULL unique FK
   (migration 015), so `reserveRuntimeUsage` cannot insert; `workKindForRun`
   reads `payload->>'responseMode'`; `/api/runs/:id` returns text, usedKeys,
   grounded, kind and the cap notice from the task branch; `/stop` finds the
   run by `payload.telegram.chatId`; app cancel is `/api/runtime/tasks/:id/cancel`.
   It is also the only Postgres-side idempotency key: `submit()` evicted
   between the `run` insert and the inbox insert, then a browser retry with
   the same request id, creates a second run and leaves the first `working`
   forever. Correction: keep one `runtime_task` row per reply, upserted by
   dedupe key in the same transaction as `run`, with no lease columns; the
   inbox is rebuilt from those rows on re-entry; the runner task id is the
   task id and is persisted with a dispatch phase *before* `POST /v1/tasks`
   (the runner dedupes on task id only; a fresh id after eviction gets
   `runtime_busy` and later a second Hermes run).
4. **The approval decision races the timeout.** The object's input gate
   does not cover awaits, so `decide()` awaiting the runner while the 60 s
   alarm sends deny, or a callback replayed after eviction, resumes a run
   with no recorded owner decision. Today the callback carries an opaque
   random approval id, the claim moves pending→deciding under the business
   lock, failure releases, completion is guarded on `deciding` and the same
   decision, expiry is durable before any network call, and the runner 409s
   a differing decision. Correction: the object mints its own opaque id;
   state transitions happen in SQLite synchronously before the runner call;
   the timeout refuses unless `pending`; a same-decision replay is a
   duplicate, a different decision is refused; `approval.granted/rejected`
   is written in the same tenant transaction as the resume.
5. **One alarm per object, and an alarm cannot preempt a running handler.**
   Deadlines, the approval timeout, the 13-minute checkpoint and "next inbox
   item" all share `setAlarm`, and while the relay runs inside `alarm()` no
   other alarm fires. Correction: deadlines and the approval wait are
   in-handler timers (`AbortSignal.timeout`, as `observationSliceFetch` does
   today); the single alarm is the watchdog, set to now+14 min at handler
   entry and reset to "now" or deleted at exit; storage keeps one
   `next_wake_at` with a reason. And the handler never throws: alarm retries
   are bounded (six, from 2 s backoff) and a throwing handler — for example
   `RuntimeBudgetExceeded` on every entry — leaves `active` frozen with
   nothing to enumerate objects. Correction: an attempt counter in `active`
   with the consumer's exhaustion path (failed run, work record, usage), and
   `submit()` plus the cron re-arm the alarm whenever `active` exists and
   `getAlarm()` is null.
6. **Approvals cannot ship in step 3.** With intakes routed to the object and
   approvals still on `claimRuntimeApprovalDecision`, Kitakod's first native
   approval in the canary week has no task to pause into: the callback
   answers "no longer active" and the timeout denies. Correction: one
   `replyRuntimeFor(businessId)` seam consulted by intake, callback, `/stop`,
   app cancel, the recovery sweep and `wakeNextRuntimeTask`; approvals ship
   in step 1.

### Important corrections

- **"One event at a time by construction" is false.** `async`/`await` lets
  requests interleave; the slot holds only because a single `alarm()`
  instance runs at a time. `submit()` must append to the inbox and compute
  `position` in one synchronous `sql.exec` block before any Postgres await.
- **Placement does not carry into the object.** Measure the first
  `withTenant` round trip inside the object and log it; name objects
  `businessId:g<N>` with `N` in Postgres so a badly placed object can be
  abandoned once its inbox drains.
- **Never hold a Postgres client across awaits.** A Hyperdrive connection is
  a `connect()` socket and keeps the object in memory, billing duration, for
  up to 15 minutes per connection — about $4 per object per month, $2,000 a
  month at 500 businesses. Today's `connect()`/`end()` per call in `db.ts`
  is the right shape.
- **`lastSeq` is not stable across runner restarts.** Seq is runner process
  memory; after a restart the replay starts at 1 and everything is dropped.
  Key the resume on the runner identity (`runner.startedAt` from readyz)
  and reset `lastSeq` when it changes.
- **Terminal outcome before delivery.** Store the bounded outcome in
  `active` before any Telegram send, so a 429 followed by a runner 404 does
  not turn an answered run into a failed one. Flood deferral must not spend
  attempts or block the next inbox item.
- **Pre-dispatch gates stay:** release drift → upgrade task, model-key
  rotation, wedged-slot escalation, the 5-attempt retry at 30 s, and the
  Sprites org quota ("Maximum concurrent sprites limit") recognised as a
  quota and backed off without counting.
- **Lifecycle exclusion.** The one-lease index spans every task kind today,
  so an upgrade cannot lease mid-reply. Split out, the drift sweep could
  re-bootstrap the sprite under a live relay. Lifecycle tasks must call
  `status()` and defer while `active` is set.
- **Attestation on every attach.** `ready()` runs only in the first dispatch
  today; a resumed relay must re-attest release, source hash and patch id
  against Postgres `desired_release`. Move the `*.sprites.app` host check
  into `RunnerClient`; decrypt keys under `withTenant` at every attach and
  never cache them.
- **Object storage holds identifiers only:** seq, run id, task id, dedupe
  key, channel, timestamps, deadlines, opaque approval ids, fencing token.
  Never the question, facts, deltas, thinking, tool previews, approval text,
  chat ids beyond what routing needs, runner or Hermes keys, the Sprites
  token, tool grants or the bot token. `active` is deleted at completion;
  business deletion calls `deleteAll()`. `RunStream` already lives by this
  rule and expires after 24 h; the business object would not expire.
- **Relay content is display only.** Object state changes only on
  `approval`, `done` and a terminal `/v1/tasks/:id` status; a missing run
  is confirmed twice before failing; tool names are matched to the fleet
  list before an `agent.tool` row is written.
- **Flood.** Keep `AGENT_RUN_BURST` ahead of `submit()`, cap inbox depth
  (`accepted: false` beyond about five), dedupe before any Postgres write,
  let `/stop` clear the inbox, and give intake RPCs a timeout so a wedged
  object cannot hold the placed handler.
- **Rollout and rollback.** Flip a business only when it has no queued or
  leased reply task; the object's dispatch takes the same
  `pg_advisory_xact_lock(hashtextextended(businessId, 0))` the consumer
  takes; rollback stops admission only and keeps routing `decide`, `/stop`
  and cancel to the object until `status().active` is null. Stamp
  `work.started` with the executor and extend `reply-latency.sh` so the two
  paths can be compared.
- **Checkpoint frequency.** Persisting `last_seq` per delta is ~90 M rows a
  month at 500 businesses (~$40); checkpoint on heartbeat and tool events.
- **Timers and hibernation.** A lingering 15-minute `AbortSignal.timeout`
  keeps the object non-hibernatable; clear timers explicitly.

### Behaviours the draft dropped or left ambiguous

Dropped: flood backoff with the owner notice and snapshot redelivery;
not-ready, drift and key-rotation deferral; wedged-slot escalation; the
5-attempt retry; the app `retrying` event; "Finishing your previous message
first…"; run detail text, usedKeys, grounded and kind; the cap notice in
the web chat; the task card only for work. Ambiguous: sprite prewarm under
the webhook; the speculative Telegram placeholder and who edits it to
"In line (position #n)"; the final edit under the `run.status='working'`
guard; `/stop` states and the cancelled bubble; `waking` versus `working`;
in-flight Telegram redelivery before settlement.

### Cost (verified, Workers Paid)

Noise either way. 12 businesses at 40 replies a day: $0 on both paths. 500
businesses: object duration $23 to $154 a month depending on idle time
before hibernation, plus rows; the queue path about $3 to $4. Sprite awake
time and model tokens dominate both by two orders of magnitude.

### Verified platform facts

- A plain `fetch()` never keeps an object alive, even while the response
  body streams; only `connect()` sockets and outbound WebSockets do, for at
  most 15 minutes. Running the relay inside `alarm()` is the right answer
  to open question 1; SSE can stay.
- Alarm handlers have a 15-minute wall time; request handlers are unlimited
  while the caller stays connected. Alarms are at-least-once with up to six
  retries. Objects "may shut down at any time due to deployments,
  inactivity, or runtime decisions".
- Input gates pause event delivery only during storage operations and
  synchronous execution; other calls are handled while the relay awaits the
  network.
- `apac-se` is a listed hint; hints are best effort; objects do not
  relocate.
- 128 MB, 30 s CPU per event, 6 simultaneous outgoing connections, 10 GB
  SQLite: none binds for a 15-minute relay of a bounded stream.

### Questions still open

- Whether a self-request to the worker's own hostname, or a self service
  binding, is placed — decides Alternative A.
- Whether Hermes rejects a repeated approval `request_id` after a runner
  restart (`resolvedApprovals` is in-process on the runner).
- Whether the sprite stays awake on the object's outbound SSE read the way
  it does on the consumer's (docs.sprites.dev says an open TCP connection
  does).
