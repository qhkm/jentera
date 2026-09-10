# BusinessRuntime: one Durable Object per business replaces the reply queue

Status: proposal, under stress test (2026-09-10). Nothing here is built.

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
